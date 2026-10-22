"""Dangote HTTP API + MCP endpoint (runs locally or on Azure Container Apps).

    GET  /api                          service index
    GET  /api/scenarios                the storylines
    GET  /api/matches/prepare          everything the web app needs to play a match locally
    GET  /api/matches/summary|state|teams|players|insights
    GET  /api/matches/events.jsonl | insights.csv | data-card    dataset exports
    POST /api/factcheck                verify any sentence against the ledger
    GET  /api/catchup                  verified recap from the viewer's side
    GET  /api/stream                   SSE: live ticks, overlays and trust records
    POST /mcp                          the studio as MCP tools (Streamable HTTP, stateless)

In production the built web app (frontend/dist) is served from the same origin.
"""

from __future__ import annotations

import asyncio
import csv
import io
import os
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Callable

import orjson
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, mcp, service
from .agents.templates import TEMPLATE_LANGS
from .agents.translator import LANGUAGES
from .broadcast import Director, LiveSession
from .factcheck import fact_check
from .models import Event, Profile, clock
from .scenarios import SCENARIOS

STATIC = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))


class FastJSON(JSONResponse):
    def render(self, content: Any) -> bytes:
        return orjson.dumps(content)


class _Cache:
    """Small LRU for deterministic, expensive responses."""

    def __init__(self, size: int = 256):
        self.size = size
        self.data: OrderedDict[str, Any] = OrderedDict()

    async def get(self, key: str, compute: Callable[[], Any]) -> Any:
        if key in self.data:
            self.data.move_to_end(key)
            return self.data[key]
        value = await asyncio.to_thread(compute)
        self.data[key] = value
        if len(self.data) > self.size:
            self.data.popitem(last=False)
        return value


cache = _Cache()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Warm the default storyline so the first visitor doesn't wait for the simulation.
    await asyncio.to_thread(service.analysis, *service.resolve(None, None))
    yield


app = FastAPI(title="Dangote API", version=__version__, default_response_class=FastJSON, lifespan=lifespan,
              description="Verified, personalized football match intelligence over synthetic events.")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


def _resolve(scenario: str | None, seed: int | None) -> tuple[str, int]:
    try:
        return service.resolve(scenario, seed)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


def _profile(persona: str, club: str | None, player: str | None, lang: str) -> Profile:
    return Profile(persona if persona in ("casual", "analyst") else "casual",
                   club if club in ("home", "away") else None, player or None, lang or "en")


def _sse(kind: str, data: Any) -> bytes:
    return b"event: " + kind.encode() + b"\ndata: " + orjson.dumps(data) + b"\n\n"


# ---- index -------------------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "dangote-api", "version": __version__}


@app.get("/api")
def index() -> dict[str, Any]:
    sc = SCENARIOS[0].id
    return {
        "ok": True,
        "service": "dangote-api",
        "version": __version__,
        "services": service.settings().describe(),
        "endpoints": [
            "GET  /api/scenarios",
            f"GET  /api/matches/prepare?scenario={sc}&persona=casual&lang=en",
            f"GET  /api/matches/summary?scenario={sc}",
            f"GET  /api/matches/state?scenario={sc}&minute=60",
            f"GET  /api/matches/teams?scenario={sc}&minute=60",
            f"GET  /api/matches/players?scenario={sc}&minute=60",
            f"GET  /api/matches/insights?scenario={sc}&min_priority=2",
            f"GET  /api/matches/events.jsonl?scenario={sc}",
            f"GET  /api/matches/insights.csv?scenario={sc}",
            f"GET  /api/matches/data-card?scenario={sc}",
            f"GET  /api/catchup?scenario={sc}&minute=63&club=away",
            f"GET  /api/stream?scenario={sc}&speed=60",
            "POST /api/factcheck   {scenario, minute, text}",
            "POST /mcp             MCP tools over Streamable HTTP",
        ],
        "docs": "/docs",
    }


@app.get("/api/scenarios")
def scenarios() -> dict[str, Any]:
    return {"scenarios": [s.summary() for s in SCENARIOS]}


@app.get("/api/config")
def config(scenario: str | None = None, seed: int | None = None) -> dict[str, Any]:
    sc, sd = _resolve(scenario, seed)
    meta, events = service.match(sc, sd)
    s = service.settings()
    available = list(LANGUAGES) if (s.translator_enabled or s.llm_enabled) else list(TEMPLATE_LANGS)
    return {"meta": meta.to_dict(), "events": len(events), "languages": {k: LANGUAGES[k] for k in available},
            "services": s.describe(), "scenarios": [x.summary() for x in SCENARIOS]}


# ---- matches -----------------------------------------------------------------------------------

@app.get("/api/matches/prepare")
async def prepare(scenario: str | None = None, seed: int | None = None, persona: str = "casual",
                  club: str | None = None, player: str | None = None, lang: str = "en") -> Any:
    sc, sd = _resolve(scenario, seed)
    profile = _profile(persona, club, player, lang)
    return await cache.get(f"prepare|{sc}|{sd}|{profile.key}", lambda: service.prepare(sc, sd, profile))


@app.get("/api/matches/summary")
async def summary(scenario: str | None = None, seed: int | None = None) -> Any:
    sc, sd = _resolve(scenario, seed)
    return await cache.get(f"summary|{sc}|{sd}", lambda: service.match_summary(sc, sd))


@app.get("/api/matches/state")
async def state(scenario: str | None = None, seed: int | None = None, minute: float = Query(90, ge=0, le=95)) -> Any:
    sc, sd = _resolve(scenario, seed)
    return await asyncio.to_thread(service.state_at, sc, sd, minute)


@app.get("/api/matches/teams")
async def teams(scenario: str | None = None, seed: int | None = None, minute: float = Query(95, ge=0, le=95)) -> Any:
    sc, sd = _resolve(scenario, seed)
    return await cache.get(f"teams|{sc}|{sd}|{int(minute)}", lambda: service.team_stats(sc, sd, int(minute)))


@app.get("/api/matches/players")
async def players(scenario: str | None = None, seed: int | None = None, minute: float = Query(95, ge=0, le=95)) -> Any:
    sc, sd = _resolve(scenario, seed)
    return await cache.get(f"players|{sc}|{sd}|{int(minute)}", lambda: service.player_stats(sc, sd, int(minute)))


@app.get("/api/matches/insights")
async def insights(scenario: str | None = None, seed: int | None = None, kind: str | None = None,
                   min_priority: int = Query(1, ge=1, le=3)) -> Any:
    sc, sd = _resolve(scenario, seed)
    return await asyncio.to_thread(service.query_insights, sc, sd, kind, min_priority)


@app.get("/api/matches/events.jsonl")
async def events_jsonl(scenario: str | None = None, seed: int | None = None) -> Response:
    sc, sd = _resolve(scenario, seed)
    _, evs = service.match(sc, sd)
    body = b"\n".join(orjson.dumps(e.to_dict()) for e in evs) + b"\n"
    return Response(body, media_type="application/x-ndjson",
                    headers={"Content-Disposition": f'inline; filename="{sc}-{sd}-events.jsonl"'})


@app.get("/api/matches/insights.csv")
async def insights_csv(scenario: str | None = None, seed: int | None = None) -> Response:
    sc, sd = _resolve(scenario, seed)
    rows = await asyncio.to_thread(service.query_insights, sc, sd)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "minute", "kind", "priority", "team", "impact", "facts", "evidence"])
    for r in rows:
        facts = "; ".join(f"{k}={v}" for k, v in r["facts"].items())
        w.writerow([r["id"], r["minute"], r["kind"], r["priority"], r["team"], r["impact"], facts, " ".join(r["evidence"])])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'inline; filename="{sc}-{sd}-insights.csv"'})


@app.get("/api/matches/data-card", response_class=PlainTextResponse)
async def data_card(scenario: str | None = None, seed: int | None = None) -> str:
    sc, sd = _resolve(scenario, seed)
    s = await asyncio.to_thread(service.match_summary, sc, sd)
    goals = "\n".join(f"- {g['minute']}' {g['scorer']} ({g['team']})" for g in s["goals"]) or "- none"
    return f"""# Data card: {s['name']} ({s['match_id']})

{s['tagline']}

| | |
|---|---|
| Home | {s['home']['name']} |
| Away | {s['away']['name']} |
| Final score | {s['final_score']['home']}-{s['final_score']['away']} |
| Events | {s['events']} |
| Detected insights | {s['insights']} |
| Seed | {sd} (same seed, same match, on any machine) |

## Goals
{goals}

## Provenance
Fully synthetic. Generated by `dangote.simulator` from scenario `{sc}`. Clubs and players are fictional.
No real match data is used. Team styles (possession, low block, high press) shape event patterns;
tactical changes are never emitted as events and must be detected from the data.

## Event schema (events.jsonl)
`id, match_id, seq, t (s from kickoff), period, type, team (home|away), player_id, x, y, end_x, end_y
(metres, home attacks toward x=105), outcome, receiver_id, possession, extras`.
"""


# ---- fact-check desk ---------------------------------------------------------------------------

class FactCheckRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=600)
    minute: float = Field(90, ge=0, le=95)
    scenario: str | None = None
    seed: int | None = None
    lang: str = "en"


@app.post("/api/factcheck")
async def factcheck(req: FactCheckRequest) -> Any:
    sc, sd = _resolve(req.scenario, req.seed)
    a = await asyncio.to_thread(service.analysis, sc, sd)
    return await asyncio.to_thread(fact_check, a.meta, a.pipeline.ledger, req.minute, req.text, req.lang)


# ---- viewer endpoints --------------------------------------------------------------------------

@app.get("/api/catchup")
async def catchup(minute: int = Query(..., ge=1, le=95), scenario: str | None = None, seed: int | None = None,
                  persona: str = "casual", club: str | None = None, player: str | None = None, lang: str = "en") -> Any:
    sc, sd = _resolve(scenario, seed)
    profile = _profile(persona, club, player, lang)
    return await cache.get(f"catchup|{sc}|{sd}|{minute}|{profile.key}",
                           lambda: service.catch_up_at(sc, sd, profile, minute))


@app.get("/api/overlays")
async def overlays(scenario: str | None = None, seed: int | None = None, persona: str = "casual",
                   club: str | None = None, player: str | None = None, lang: str = "en") -> Any:
    sc, sd = _resolve(scenario, seed)
    profile = _profile(persona, club, player, lang)
    r = await asyncio.to_thread(service.rendered, sc, sd, profile)
    return {"match_id": f"{sc}-{sd}", "profile": profile.key, "count": len(r["overlays"]), "overlays": r["overlays"]}


@app.get("/api/events")
def events(scenario: str | None = None, seed: int | None = None, until: float = Query(90.0, ge=0, le=95)) -> Any:
    sc, sd = _resolve(scenario, seed)
    meta, evs = service.match(sc, sd)
    return {"meta": meta.to_dict(), "events": [e.to_dict() for e in evs if e.t <= until * 60]}


def _tick(session: LiveSession, e: Event) -> dict[str, Any]:
    snap = session.pipeline.state.snapshot()
    p = session.meta.player(e.player_id) if e.player_id else None
    snap["clock"] = clock(e.t)
    snap["event"] = {"id": e.id, "type": e.type, "team": e.team, "player": p.name if p else None,
                     "outcome": e.outcome, "x": e.x, "y": e.y, "end_x": e.end_x, "end_y": e.end_y}
    return snap


@app.get("/api/stream")
async def stream(request: Request, scenario: str | None = None, seed: int | None = None, persona: str = "casual",
                 club: str | None = None, player: str | None = None, lang: str = "en",
                 speed: float = Query(20.0, gt=0, le=600), start: float = Query(0.0, ge=0, le=90),
                 ticks: bool = True, source: str = "local") -> StreamingResponse:
    sc, sd = _resolve(scenario, seed)
    meta, all_events = service.match(sc, sd)
    s = service.settings()
    profile = _profile(persona, club, player, lang)
    session = LiveSession(meta, s, profile, service.llm())
    queue: asyncio.Queue[tuple[str, Any] | None] = asyncio.Queue()

    async def render(i: Any) -> None:
        t0 = time.perf_counter()
        r = await asyncio.to_thread(session.render, i)
        for rec in r.trail:
            await queue.put(("trust", rec.to_dict()))
        if r.on_air:
            await queue.put(("overlay", Director.overlay(r, (time.perf_counter() - t0) * 1000)))

    async def source_events() -> AsyncIterator[Event]:
        if source == "eventhubs" and s.eventhubs_enabled:
            from .azure_io import consume_events

            async for e in consume_events(s, meta.match_id):
                yield e
            return
        prev = start * 60
        for e in all_events:
            if e.t <= start * 60:
                continue
            if e.t > prev:
                await asyncio.sleep((e.t - prev) / speed)
            prev = e.t
            yield e

    async def produce() -> None:
        try:
            if start:
                session.seek(all_events, start * 60)
                await queue.put(("joined", {"minute": start, "state": session.pipeline.state.snapshot()}))
            tasks = []
            async for e in source_events():
                found = session.feed(e)
                if ticks:
                    await queue.put(("tick", _tick(session, e)))
                tasks += [asyncio.create_task(render(i)) for i in found]
            await asyncio.gather(*tasks)
            await queue.put(("end", {"score": session.pipeline.state.score}))
        finally:
            await queue.put(None)

    async def body() -> AsyncIterator[bytes]:
        task = asyncio.create_task(produce())
        yield _sse("hello", {"profile": profile.key, "services": s.describe()})
        try:
            while True:
                item = await queue.get()
                if item is None or await request.is_disconnected():
                    break
                yield _sse(*item)
        finally:
            task.cancel()

    return StreamingResponse(body(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---- MCP -----------------------------------------------------------------------------------------

@app.post("/mcp")
async def mcp_endpoint(request: Request) -> Response:
    try:
        body = orjson.loads(await request.body())
    except orjson.JSONDecodeError:
        return FastJSON({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}, 400)
    if isinstance(body, list):
        out = [r for r in await asyncio.gather(*(asyncio.to_thread(mcp.handle, m) for m in body)) if r]
        return FastJSON(out) if out else Response(status_code=202)
    result = await asyncio.to_thread(mcp.handle, body)
    return FastJSON(result) if result else Response(status_code=202)


@app.get("/mcp")
def mcp_get() -> Response:
    # Stateless server: no server-initiated SSE stream.
    return Response(status_code=405, headers={"Allow": "POST"})


# ---- production: serve the built web app from the same origin ----
if (STATIC / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = (STATIC / path).resolve()
        if path and file.is_file() and STATIC.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(STATIC / "index.html")
