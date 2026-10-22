"""Model Context Protocol server: the studio as tools for any agent host.

Transport is MCP Streamable HTTP in stateless JSON mode (POST /mcp), so the container can
scale to zero. Any MCP client, Azure AI Foundry agent or Copilot extension can call the same
pipeline the web app uses, including the fact-check desk.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from . import __version__, service
from .factcheck import fact_check
from .models import Profile
from .scenarios import SCENARIOS

PROTOCOL_VERSION = "2025-06-18"

_SCENARIO = {"type": "string", "description": "Scenario id: " + ", ".join(s.id for s in SCENARIOS),
             "enum": [s.id for s in SCENARIOS]}
_SEED = {"type": "integer", "description": "Simulation seed (defaults to the scenario's own seed)"}
_MINUTE = {"type": "number", "minimum": 0, "maximum": 95}
_PROFILE = {
    "persona": {"type": "string", "enum": ["casual", "analyst"]},
    "club": {"type": "string", "enum": ["home", "away"], "description": "Viewer's club (optional)"},
    "player": {"type": "string", "description": "Player id to follow, e.g. R9 (optional)"},
    "lang": {"type": "string", "description": "Language code, e.g. en, es, sw"},
}


def _schema(props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}


def _sc(args: dict[str, Any]) -> tuple[str, int]:
    return service.resolve(args.get("scenario"), args.get("seed"))


def _profile(args: dict[str, Any]) -> Profile:
    return Profile(args.get("persona", "casual"), args.get("club"), args.get("player"), args.get("lang", "en"))


def _list_scenarios(_: dict[str, Any]) -> Any:
    return [s.summary() for s in SCENARIOS]


def _match_summary(a: dict[str, Any]) -> Any:
    return service.match_summary(*_sc(a))


def _state_at(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    minute = a.get("minute", 90)
    return {"state": service.state_at(sc, seed, minute), "teams": service.team_stats(sc, seed, minute)}


def _query_events(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    return service.query_events(sc, seed, a.get("type"), a.get("team"), a.get("player"),
                                a.get("from_minute", 0), a.get("to_minute", 95), min(a.get("limit", 100), 500))


def _query_insights(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    return service.query_insights(sc, seed, a.get("kind"), a.get("min_priority", 1),
                                  a.get("from_minute", 0), a.get("to_minute", 95))


def _player_stats(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    rows = service.player_stats(sc, seed, a.get("minute", 95))
    if a.get("player"):
        rows = [r for r in rows if r["id"] == a["player"] or a["player"].lower() in r["name"].lower()]
    return rows


def _fact_check(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    an = service.analysis(sc, seed)
    return fact_check(an.meta, an.pipeline.ledger, a.get("minute", 95), a["text"], a.get("lang", "en"))


def _catch_up(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    return service.catch_up_at(sc, seed, _profile(a), int(a.get("minute", 60)))


def _render_overlays(a: dict[str, Any]) -> Any:
    sc, seed = _sc(a)
    lo, hi = a.get("from_minute", 0), a.get("to_minute", 95)
    overlays = service.rendered(sc, seed, _profile(a))["overlays"]
    return [o for o in overlays if lo <= o["trigger"]["minute"] <= hi]


TOOLS: dict[str, tuple[str, dict[str, Any], Callable[[dict[str, Any]], Any]]] = {
    "list_scenarios": ("List the synthetic storylines: id, name, tagline, clubs and default seed.",
                       _schema({}), _list_scenarios),
    "match_summary": ("Final score, goals, event and insight counts, and the headline moments with the "
                      "ledger queries that prove them.", _schema({"scenario": _SCENARIO, "seed": _SEED}, ["scenario"]),
                      _match_summary),
    "match_state_at": ("Live state at a minute: score, momentum, possession (last 10'), control vs chaos, "
                       "shots, xG, plus team stats.",
                       _schema({"scenario": _SCENARIO, "seed": _SEED, "minute": _MINUTE}, ["scenario", "minute"]), _state_at),
    "query_events": ("Raw synthetic events, filtered by type (pass, shot, tackle, pressure...), team, player id "
                     "and minute range.",
                     _schema({"scenario": _SCENARIO, "seed": _SEED, "type": {"type": "string"},
                              "team": {"type": "string", "enum": ["home", "away"]}, "player": {"type": "string"},
                              "from_minute": _MINUTE, "to_minute": _MINUTE,
                              "limit": {"type": "integer", "minimum": 1, "maximum": 500}}, ["scenario"]), _query_events),
    "query_insights": ("Detected moments (goal, big_chance, line_breaking_pass, danger_removed, regime_shift, "
                       "tactical_story, momentum_swing...) with their facts and proofs.",
                       _schema({"scenario": _SCENARIO, "seed": _SEED, "kind": {"type": "string"},
                                "min_priority": {"type": "integer", "minimum": 1, "maximum": 3},
                                "from_minute": _MINUTE, "to_minute": _MINUTE}, ["scenario"]), _query_insights),
    "player_stats": ("Per-player stats up to a minute: passes, accuracy, shots, xG, goals, pressures, "
                     "tackles + interceptions, top speed, average position.",
                     _schema({"scenario": _SCENARIO, "seed": _SEED, "minute": _MINUTE, "player": {"type": "string"}},
                             ["scenario"]), _player_stats),
    "fact_check": ("Verify any sentence against the match ledger at a minute. Returns a verdict and, for every "
                   "number, the facts it matches (or that it matches none).",
                   _schema({"scenario": _SCENARIO, "seed": _SEED, "minute": _MINUTE, "text": {"type": "string"},
                            "lang": {"type": "string"}}, ["scenario", "text"]), _fact_check),
    "catch_up": ("A verified recap up to a minute, told from the viewer's side.",
                 _schema({"scenario": _SCENARIO, "seed": _SEED, "minute": _MINUTE, **_PROFILE}, ["scenario", "minute"]),
                 _catch_up),
    "render_overlays": ("Verified, timecoded broadcast overlays for a viewer profile and minute range.",
                        _schema({"scenario": _SCENARIO, "seed": _SEED, "from_minute": _MINUTE, "to_minute": _MINUTE,
                                 **_PROFILE}, ["scenario"]), _render_overlays),
}


def tool_list() -> list[dict[str, Any]]:
    return [{"name": n, "description": d, "inputSchema": s} for n, (d, s, _) in TOOLS.items()]


def _error(id_: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def handle(message: dict[str, Any]) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. Notifications get no response (None)."""
    method, id_ = message.get("method"), message.get("id")
    if "id" not in message:
        return None
    if method == "initialize":
        result: Any = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}},
                       "serverInfo": {"name": "dangote", "title": "dangote match studio", "version": __version__},
                       "instructions": "Synthetic football match intelligence. Start with list_scenarios, then "
                                       "match_summary. Use fact_check before repeating any number."}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": tool_list()}
    elif method == "tools/call":
        params = message.get("params") or {}
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in TOOLS:
            return _error(id_, -32602, f"unknown tool '{name}'")
        try:
            data = TOOLS[name][2](args)
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}],
                      "structuredContent": {"result": data}, "isError": False}
        except (KeyError, ValueError, TypeError) as exc:
            result = {"content": [{"type": "text", "text": f"{type(exc).__name__}: {exc}"}], "isError": True}
    else:
        return _error(id_, -32601, f"method '{method}' not found")
    return {"jsonrpc": "2.0", "id": id_, "result": result}
