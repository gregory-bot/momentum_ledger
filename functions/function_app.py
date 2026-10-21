"""Azure Functions: the event-driven production path.

    Event Hubs ──► ingest (trigger) ──► Cosmos `events` (ledger)
                                   └──► replay ledger ► detect ► narrate ► verify ► Cosmos `overlays`
    HTTP GET /api/overlays?match_id=...&since=...  ◄── graphics partner / web app polls

The function is stateless: each batch rebuilds game state by replaying the match ledger from
Cosmos. That makes it idempotent under at-least-once delivery and lets it recover from any
crash. Overlay ids are deterministic, so upserts never duplicate.
"""

from __future__ import annotations

import json
import logging

import azure.functions as func

from momentum.azure_io import CosmosStore
from momentum.broadcast import Director, LiveSession
from momentum.config import load_settings
from momentum.llm import AzureLLM
from momentum.models import Event, Profile
from momentum.simulator import default_meta

app = func.FunctionApp()

# Default renditions produced for every verified insight; others are rendered on demand by the web app.
PROFILES = [Profile("casual", None, None, "en"), Profile("analyst", None, None, "en"),
            Profile("casual", None, None, "es"), Profile("casual", None, None, "sw")]


@app.event_hub_message_trigger(arg_name="batch", event_hub_name="%EVENTHUB_NAME%", connection="EVENTHUB_CONNECTION",
                               cardinality=func.Cardinality.MANY, consumer_group="$Default")
def ingest(batch: list[func.EventHubEvent]) -> None:
    settings = load_settings()
    store = CosmosStore(settings)
    incoming = [Event.from_dict(json.loads(m.get_body().decode())) for m in batch]
    if not incoming:
        return
    store.put_events(incoming)

    by_match: dict[str, list[Event]] = {}
    for e in incoming:
        by_match.setdefault(e.match_id, []).append(e)

    llm = AzureLLM(settings) if settings.llm_enabled else None
    for match_id, new in by_match.items():
        new_ids = {e.id for e in new}
        ledger = store.load_events(match_id)
        meta = default_meta(int(match_id.split("-")[-1]))
        produced = 0
        for profile in PROFILES:
            session = LiveSession(meta, settings, profile, llm)
            for e in ledger:
                found = session.feed(e)
                if e.id not in new_ids:
                    continue  # insights triggered by earlier batches were rendered then
                for insight in found:
                    r = session.render(insight)
                    if r.on_air:
                        store.put_overlay(match_id, Director.overlay(r))
                        produced += 1
        logging.info("match %s: %d new events, %d overlays", match_id, len(new), produced)


@app.route(route="overlays", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET"])
def overlays(req: func.HttpRequest) -> func.HttpResponse:
    match_id = req.params.get("match_id")
    if not match_id:
        return func.HttpResponse("match_id is required", status_code=400)
    since = float(req.params.get("since", "-1"))
    store = CosmosStore(load_settings())
    body = json.dumps({"match_id": match_id, "overlays": store.overlays_since(match_id, since)}, ensure_ascii=False)
    return func.HttpResponse(body, mimetype="application/json")
