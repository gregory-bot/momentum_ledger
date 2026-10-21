"""HTTP API (runs locally or on Azure Container Apps).

    GET /api/config      match metadata, rosters, languages, active Azure services
    GET /api/stream      SSE: live ticks, verified overlays and trust records for one viewer
    GET /api/catchup     "I just joined": verified recap from the viewer's perspective
    GET /api/overlays    full-match overlay JSON for a profile (graphics-partner export)
    GET /api/events      the synthetic event stream itself

In production the built React app (frontend/dist) is served from the same origin.

Speed: the match is generated once at startup; catch-up and overlay exports are deterministic
per (profile, minute) and cached; JSON is encoded with orjson and gzip-compressed (SSE excluded).
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator, Callable

import orjson
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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

STATIC = Path(os.getenv("STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))


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
    match()  # warm: generate the match before the first request
    yield


app = FastAPI(title="Momentum Ledger API", version=__version__, default_response_class=FastJSON,
              lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["GET"], allow_headers=["*"])


def _profile(persona: str, club: str | None, player: str | None, lang: str) -> Profile:
    return Profile(persona if persona in ("casual", "analyst") else "casual",
                   club if club in ("home", "away") else None, player or None, lang or "en")


def _sse(kind: str, data: Any) -> bytes:
    return b"event: " + kind.encode() + b"\ndata: " + orjson.dumps(data) + b"\n\n"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "momentum-ledger", "version": __version__}


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
def events(until: float = Query(90.0, ge=0, le=95)) -> dict[str, Any]:
    meta, evs = match()
    return {"meta": meta.to_dict(), "events": [e.to_dict() for e in evs if e.t <= until * 60]}


def _tick(session: LiveSession, e: Event) -> dict[str, Any]:
    snap = session.pipeline.state.snapshot()
    p = session.meta.player(e.player_id) if e.player_id else None
    snap["clock"] = clock(e.t)
    snap["event"] = {"id": e.id, "type": e.type, "team": e.team, "player": p.name if p else None,
                     "outcome": e.outcome, "x": e.x, "y": e.y, "end_x": e.end_x, "end_y": e.end_y}
    return snap


@app.get("/api/stream")
async def stream(request: Request, persona: str = "casual", club: str | None = None, player: str | None = None,
                 lang: str = "en", speed: float = Query(20.0, gt=0, le=600), start: float = Query(0.0, ge=0, le=90),
                 ticks: bool = True, source: str = "local") -> StreamingResponse:
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


@app.get("/api/catchup")
async def catchup(minute: int = Query(..., ge=1, le=95), persona: str = "casual", club: str | None = None,
                  player: str | None = None, lang: str = "en") -> dict[str, Any]:
    meta, all_events = match()
    profile = _profile(persona, club, player, lang)

    def compute() -> dict[str, Any]:
        session = LiveSession(meta, settings(), profile, llm())
        session.seek(all_events, minute * 60)
        return catch_up(session, profile)

    return await cache.get(f"catchup|{minute}|{profile.key}", compute)


@app.get("/api/overlays")
async def overlays(persona: str = "casual", club: str | None = None, player: str | None = None,
                   lang: str = "en") -> dict[str, Any]:
    meta, all_events = match()
    profile = _profile(persona, club, player, lang)

    def compute() -> dict[str, Any]:
        session = LiveSession(meta, settings(), profile, llm())
        items = []
        for e in all_events:
            for i in session.feed(e):
                r = session.render(i)
                if r.on_air:
                    items.append(Director.overlay(r))
        return {"match_id": meta.match_id, "profile": profile.key, "count": len(items), "overlays": items}

    return await cache.get(f"overlays|{profile.key}", compute)


# ---- production: serve the built React app from the same origin ----
if (STATIC / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = (STATIC / path).resolve()
        if path and file.is_file() and STATIC.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(STATIC / "index.html")
