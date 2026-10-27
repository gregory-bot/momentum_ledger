"""Static export: runs the real pipeline and writes everything the web app needs as JSON files,
so the frontend can be hosted on any static host (GitHub Pages) without a server.

    python -m dangote export --out ../frontend/public/static-api

Layout
    config.json                                   scenarios, rosters, languages
    match/<scenario>.json                         events + state timeline (shared by all viewers)
    overlays/<scenario>/<persona>-<club>-<lang>.json   verified overlays + trust log for that viewer

Every overlay in the export passed the same verifier as the live API.
"""

from __future__ import annotations

import json
from itertools import product
from pathlib import Path

from . import service
from .agents.templates import TEMPLATE_LANGS
from .agents.translator import LANGUAGES
from .models import Profile
from .scenarios import SCENARIOS

PERSONAS = ("casual", "analyst")
CLUBS = ("", "home", "away")


def _write(path: Path, data: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    path.write_text(raw, encoding="utf-8")
    return len(raw)


def export(out: Path) -> dict[str, int]:
    sizes = {"files": 0, "bytes": 0}

    def put(rel: str, data: object) -> None:
        sizes["bytes"] += _write(out / rel, data)
        sizes["files"] += 1

    meta, _ = service.match(*service.resolve(None, None))
    put("config.json", {
        "meta": meta.to_dict(),
        "events": 0,
        "languages": {k: LANGUAGES[k] for k in TEMPLATE_LANGS},
        "services": {"mode": "static demo (GitHub Pages)", "narrator": "verified templates",
                     "verifier": "deterministic", "fact_check": "needs the live API"},
        "scenarios": [s.summary() for s in SCENARIOS],
        "static": True,
    })
    for sc in SCENARIOS:
        pack = service.prepare(sc.id, sc.seed, Profile())
        put(f"match/{sc.id}.json", {k: v for k, v in pack.items() if k not in ("overlays", "trust", "profile")})
        for persona, club, lang in product(PERSONAS, CLUBS, TEMPLATE_LANGS):
            r = service.rendered(sc.id, sc.seed, Profile(persona, club or None, None, lang))
            put(f"overlays/{sc.id}/{persona}-{club or 'neutral'}-{lang}.json",
                {"overlays": r["overlays"], "trust": r["trust"], "profile": f"{persona}|{club or '-'}|-|{lang}"})
    return sizes
