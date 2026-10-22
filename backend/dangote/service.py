"""One service layer over the pipeline. The REST API, the MCP tools and the web app all read
from here, so what an agent queries is exactly what a viewer sees.

Everything is deterministic for (scenario, seed, profile), so results are cached.
"""

from __future__ import annotations

import threading
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from .broadcast import Director, LiveSession, catch_up
from .config import Settings, load_settings
from .llm import AzureLLM
from .models import AWAY, HOME, Event, Insight, MatchMeta, Profile, clock, minute_of
from .pipeline import MatchPipeline
from .scenarios import SCENARIOS, get_scenario
from .simulator import generate_match

TIMELINE_STEP = 15.0  # seconds of match time between state snapshots
_lock = threading.Lock()


@lru_cache
def settings() -> Settings:
    return load_settings()


@lru_cache
def llm() -> AzureLLM | None:
    s = settings()
    return AzureLLM(s) if s.llm_enabled else None


def resolve(scenario: str | None, seed: int | None) -> tuple[str, int]:
    sc = get_scenario(scenario or SCENARIOS[0].id)
    return sc.id, sc.seed if seed is None else seed


@lru_cache(maxsize=16)
def match(scenario: str, seed: int) -> tuple[MatchMeta, list[Event]]:
    return generate_match(seed, scenario)


@dataclass
class Analysis:
    meta: MatchMeta
    events: list[Event]
    pipeline: MatchPipeline
    timeline: list[dict[str, Any]]
    times: list[float]


@lru_cache(maxsize=16)
def analysis(scenario: str, seed: int) -> Analysis:
    """The full match through ingest -> interpret -> detect, with periodic state snapshots."""
    meta, events = match(scenario, seed)
    pipe = MatchPipeline(meta)
    timeline: list[dict[str, Any]] = []
    next_t = 0.0
    for e in events:
        pipe.feed(e)
        while e.t >= next_t:
            snap = pipe.state.snapshot()
            snap["t"] = next_t
            timeline.append(_compact_snapshot(snap))
            next_t += TIMELINE_STEP
    timeline.append(_compact_snapshot(pipe.state.snapshot()))
    return Analysis(meta, events, pipe, timeline, [s["t"] for s in timeline])


def _compact_snapshot(s: dict[str, Any]) -> dict[str, Any]:
    return {"t": s["t"], "score": s["score"], "momentum": s["momentum"], "chaos": s["chaos"],
            "possession_10m": s["possession_10m"], "shots": s["shots"], "xg": s["xg"]}


def state_at(scenario: str, seed: int, minute: float) -> dict[str, Any]:
    a = analysis(scenario, seed)
    i = max(0, bisect_right(a.times, minute * 60) - 1)
    return {**a.timeline[i], "clock": clock(a.timeline[i]["t"])}


def session_at(scenario: str, seed: int, profile: Profile, minute: float | None = None) -> LiveSession:
    meta, events = match(scenario, seed)
    s = LiveSession(meta, settings(), profile, llm())
    if minute is not None:
        s.seek(events, minute * 60)
    return s


@lru_cache(maxsize=64)
def rendered(scenario: str, seed: int, profile: Profile) -> dict[str, Any]:
    """Every verified overlay and every trust record for one viewer, across the whole match."""
    meta, events = match(scenario, seed)
    session = session_at(scenario, seed, profile)
    overlays, trust = [], []
    for e in events:
        for i in session.feed(e):
            r = session.render(i)
            trust += [rec.to_dict() for rec in r.trail]
            if r.on_air:
                overlays.append(Director.overlay(r))
    return {"overlays": overlays, "trust": trust}


def compact_event(e: Event, meta: MatchMeta) -> dict[str, Any]:
    p = meta.player(e.player_id) if e.player_id else None
    out = {"id": e.id, "t": e.t, "type": e.type, "team": e.team, "player": p.name if p else None,
           "player_id": e.player_id, "outcome": e.outcome, "x": e.x, "y": e.y, "end_x": e.end_x, "end_y": e.end_y}
    if "xg" in e.extras:
        out["xg"] = e.extras["xg"]
    if e.receiver_id:
        out["receiver_id"] = e.receiver_id
    if "off_id" in e.extras:
        out["off_id"] = e.extras["off_id"]
    return {k: v for k, v in out.items() if v is not None}


def prepare(scenario: str, seed: int, profile: Profile) -> dict[str, Any]:
    """Everything the web app needs to play a match locally: pause, scrub and speed changes
    then cost nothing, and personalization only re-fetches the overlays."""
    a = analysis(scenario, seed)
    r = rendered(scenario, seed, profile)
    sc = get_scenario(scenario)
    return {
        "scenario": sc.summary(),
        "seed": seed,
        "meta": a.meta.to_dict(),
        "duration": a.events[-1].t,
        "events": [compact_event(e, a.meta) for e in a.events if e.x is not None or e.type in ("goal", "substitution")],
        "timeline": a.timeline,
        "overlays": r["overlays"],
        "trust": r["trust"],
        "profile": profile.key,
        "services": settings().describe(),
    }


def catch_up_at(scenario: str, seed: int, profile: Profile, minute: int) -> dict[str, Any]:
    with _lock:
        s = session_at(scenario, seed, profile, minute)
    return catch_up(s, profile)


# ---- queries shared by REST and MCP --------------------------------------------------------

def query_events(scenario: str, seed: int, type: str | None = None, team: str | None = None,
                 player: str | None = None, from_minute: float = 0, to_minute: float = 95,
                 limit: int = 200) -> list[dict[str, Any]]:
    meta, events = match(scenario, seed)
    out = []
    for e in events:
        if not (from_minute * 60 <= e.t <= to_minute * 60):
            continue
        if (type and e.type != type) or (team and e.team != team) or (player and e.player_id != player):
            continue
        out.append({**compact_event(e, meta), "minute": e.minute, "extras": e.extras})
        if len(out) >= limit:
            break
    return out


def query_insights(scenario: str, seed: int, kind: str | None = None, min_priority: int = 1,
                   from_minute: float = 0, to_minute: float = 95) -> list[dict[str, Any]]:
    a = analysis(scenario, seed)
    out = []
    for i in a.pipeline.insights:
        if i.priority < min_priority or (kind and i.kind != kind) or not (from_minute * 60 <= i.t <= to_minute * 60):
            continue
        out.append(_insight_dict(i))
    return out


def _insight_dict(i: Insight) -> dict[str, Any]:
    return {"id": i.id, "minute": i.minute, "t": i.t, "kind": i.kind, "priority": i.priority, "team": i.team,
            "impact": i.impact, "facts": {k: f.display for k, f in i.facts.items()},
            "proofs": {k: f.query for k, f in i.facts.items()}, "evidence": i.evidence}


def player_stats(scenario: str, seed: int, minute: float = 95) -> list[dict[str, Any]]:
    meta, events = match(scenario, seed)
    t1 = minute * 60
    rows: dict[str, dict[str, Any]] = {}
    pos: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for team in (meta.home, meta.away):
        for p in team.all_players():
            rows[p.id] = {"id": p.id, "name": p.name, "number": p.number, "role": p.role, "side": team.side,
                          "passes": 0, "completed": 0, "shots": 0, "xg": 0.0, "goals": 0, "def_actions": 0,
                          "pressures": 0, "top_speed_kmh": 0.0, "touches": 0}
    for e in events:
        if e.t > t1:
            break
        r = rows.get(e.player_id or "")
        if not r:
            continue
        if e.x is not None:
            r["touches"] += 1
            pos[e.player_id].append((e.x, e.y))
        if e.type == "pass":
            r["passes"] += 1
            r["completed"] += e.outcome == "success"
        elif e.type == "shot":
            r["shots"] += 1
            r["xg"] = round(r["xg"] + e.extras["xg"], 2)
        elif e.type == "goal":
            r["goals"] += 1
        elif e.type in ("tackle", "interception"):
            r["def_actions"] += 1
        elif e.type == "pressure":
            r["pressures"] += 1
        elif e.type == "carry":
            r["top_speed_kmh"] = max(r["top_speed_kmh"], e.extras.get("speed_kmh", 0))
    for pid, r in rows.items():
        r["pass_accuracy"] = round(100 * r["completed"] / r["passes"]) if r["passes"] else None
        pts = pos.get(pid)
        r["avg_position"] = [round(sum(p[0] for p in pts) / len(pts), 1), round(sum(p[1] for p in pts) / len(pts), 1)] if pts else None
    return [r for r in rows.values() if r["touches"]]


def team_stats(scenario: str, seed: int, minute: float = 95) -> dict[str, Any]:
    a = analysis(scenario, seed)
    t1 = minute * 60
    out = {s: {"passes": 0, "completed": 0, "shots": 0, "on_target": 0, "xg": 0.0, "pressures": 0, "def_actions": 0,
               "final_third": 0} for s in (HOME, AWAY)}
    for e in a.events:
        if e.t > t1:
            break
        if e.team not in out:
            continue
        r = out[e.team]
        if e.type == "pass":
            r["passes"] += 1
            r["completed"] += e.outcome == "success"
            ex = e.end_x if e.team == HOME else 105 - (e.end_x or 0)
            r["final_third"] += e.outcome == "success" and ex >= 70
        elif e.type == "shot":
            r["shots"] += 1
            r["on_target"] += e.outcome in ("goal", "saved")
            r["xg"] = round(r["xg"] + e.extras["xg"], 2)
        elif e.type == "pressure":
            r["pressures"] += 1
        elif e.type in ("tackle", "interception"):
            r["def_actions"] += 1
    pos = a.pipeline.ledger.evaluate({"op": "possession_pct", "side": HOME, "t0": 0, "t1": max(t1, 1)}) if t1 > 0 else 50.0
    out[HOME]["possession"] = round(pos)
    out[AWAY]["possession"] = 100 - round(pos)
    return out


def match_summary(scenario: str, seed: int) -> dict[str, Any]:
    a = analysis(scenario, seed)
    sc = get_scenario(scenario)
    goals = [{"minute": e.minute, "team": e.team, "scorer": a.meta.player(e.player_id).name}
             for e in a.events if e.type == "goal"]
    top = sorted((i for i in a.pipeline.insights if i.priority >= 3), key=lambda i: i.t)
    return {
        **sc.summary(),
        "match_id": a.meta.match_id,
        "seed": seed,
        "final_score": a.pipeline.state.score,
        "goals": goals,
        "events": len(a.events),
        "insights": len(a.pipeline.insights),
        "headline_moments": [_insight_dict(i) for i in top],
    }


def minute_label(t: float) -> int:
    return minute_of(t)
