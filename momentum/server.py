"""Web API and live overlay UI (runs locally or on Azure Container Apps).

    GET /api/config      match metadata, rosters, languages, active Azure services
    GET /api/stream      SSE: live ticks, verified overlays and trust records for one viewer
    GET /api/catchup     "I just joined": verified recap from the viewer's perspective
    GET /api/overlays    full-match overlay JSON for a profile (graphics-partner export)
    GET /api/events      the synthetic event stream itself
"""

from __future__ import annotations

import asyncio
import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .agents.templates import TEMPLATE_LANGS
from .agents.translator import LANGUAGES
from .broadcast import Director, LiveSession, catch_up
from .config import Settings, load_settings
from .llm import AzureLLM
from .models import Event, MatchMeta, Profile, clock
from .simulator import generate_match

WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Momentum Ledger", version=__version__)
app.mount("/static", StaticFiles(directory=WEB), name="static")


@lru_cache
def settings() -> Settings:
    return load_settings()


@lru_cache
def match() -> tuple[MatchMeta, list[Event]]:
    return generate_match(settings().match_seed)


@lru_cache
def llm() -> AzureLLM | None:
    s = settings()
    return AzureLLM(s) if s.llm_enabled else None


def _profile(persona: str, club: str | None, player: str | None, lang: str) -> Profile:
    return Profile(persona if persona in ("casual", "analyst") else "casual",
                   club if club in ("home", "away") else None, player or None, lang or "en")


def _sse(kind: str, data: Any) -> str:
    return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/api/config")
def config() -> dict[str, Any]:
    meta, events = match()
    s = settings()
    available = list(LANGUAGES) if (s.translator_enabled or s.llm_enabled) else list(TEMPLATE_LANGS)
    return {
        "meta": meta.to_dict(),
        "events": len(events),
        "languages": {k: LANGUAGES[k] for k in available},
        "services": s.describe(),
    }


@app.get("/api/events")
def events(until: float = 5400.0) -> JSONResponse:
    meta, evs = match()
    return JSONResponse({"meta": meta.to_dict(), "events": [e.to_dict() for e in evs if e.t <= until * 60]})


def _tick(session: LiveSession, e: Event) -> dict[str, Any]:
    snap = session.pipeline.state.snapshot()
    p = session.meta.player(e.player_id) if e.player_id else None
    snap.update({
        "clock": clock(e.t),
        "event": {"id": e.id, "type": e.type, "team": e.team, "player": p.name if p else None,
                  "outcome": e.outcome, "x": e.x, "y": e.y, "end_x": e.end_x, "end_y": e.end_y},
    })
    return snap


@app.get("/api/stream")
async def stream(request: Request, persona: str = "casual", club: str | None = None, player: str | None = None,
                 lang: str = "en", speed: float = Query(20.0, gt=0, le=600), start: float = Query(0.0, ge=0, le=90),
                 source: str = "local") -> StreamingResponse:
    meta, all_events = match()
    s = settings()
    profile = _profile(persona, club, player, lang)
    session = LiveSession(meta, s, profile, llm())
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
            await asyncio.sleep(max(0.0, (e.t - prev) / speed))
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
                await queue.put(("tick", _tick(session, e)))
                tasks += [asyncio.create_task(render(i)) for i in found]
            await asyncio.gather(*tasks)
            await queue.put(("end", {"score": session.pipeline.state.score}))
        finally:
            await queue.put(None)

    async def body() -> AsyncIterator[str]:
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


@app.get("/api/catchup")
async def catchup(minute: float = Query(..., ge=1, le=95), persona: str = "casual", club: str | None = None,
                  player: str | None = None, lang: str = "en") -> dict[str, Any]:
    meta, all_events = match()
    profile = _profile(persona, club, player, lang)
    session = LiveSession(meta, settings(), profile, llm())
    session.seek(all_events, minute * 60)
    return await asyncio.to_thread(catch_up, session, profile)


@app.get("/api/overlays")
async def overlays(persona: str = "casual", club: str | None = None, player: str | None = None,
                   lang: str = "en") -> dict[str, Any]:
    meta, all_events = match()
    profile = _profile(persona, club, player, lang)
    session = LiveSession(meta, settings(), profile, llm())

    def run() -> list[dict[str, Any]]:
        out = []
        for e in all_events:
            for i in session.feed(e):
                r = session.render(i)
                if r.on_air:
                    out.append(Director.overlay(r))
        return out

    items = await asyncio.to_thread(run)
    return {"match_id": meta.match_id, "profile": profile.key, "count": len(items), "overlays": items}
