"""Live game-state engine: turns each event into a measured change in the match.

The engine is incremental and fast enough to run on every event. It is the system that
*finds* moments; the ledger is the system that *proves* them.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
from dataclasses import dataclass, field
from statistics import mean
from typing import Any

from .models import AWAY, HOME, Event, MatchMeta, other
from .pitch import lines_broken, pass_difficulty, to_rel, xt

MOMENTUM_TAU = 240.0  # seconds for a contribution to decay by 1/e
BLOCK_WINDOW = 600.0
PRESSURE_WINDOW = 3.0


@dataclass
class EventValue:
    event_id: str
    team: str
    player_id: str | None
    kind: str
    delta: float
    xt_before: float | None = None
    xt_after: float | None = None
    lines: int = 0
    difficulty: int | None = None
    pressured: bool = False


@dataclass
class PlayerLine:
    passes: int = 0
    completed: int = 0
    threat: float = 0.0
    def_actions: int = 0
    shots: int = 0
    goals: int = 0


@dataclass
class TeamLine:
    shots: int = 0
    xg: float = 0.0
    goals: int = 0
    def_actions: deque = field(default_factory=deque)  # (t, own_x) of pressures, tackles, interceptions
    pressures: list = field(default_factory=list)  # (t, own_x)
    threat: list = field(default_factory=list)  # (t, positive xT added)


class GameState:
    def __init__(self, meta: MatchMeta):
        self.meta = meta
        self.t = 0.0
        self.period = 1
        self.finished = False
        self.last_event: Event | None = None
        self.teams = {HOME: TeamLine(), AWAY: TeamLine()}
        self.players: dict[str, PlayerLine] = defaultdict(PlayerLine)
        self.possessions: list[dict[str, Any]] = []
        self.on_pitch = {HOME: {p.id for p in meta.home.players}, AWAY: {p.id for p in meta.away.players}}
        self.momentum = {HOME: 0.0, AWAY: 0.0}
        self.pressured_at = {HOME: -99.0, AWAY: -99.0}
        self.turnovers: deque = deque()

    @property
    def score(self) -> dict[str, int]:
        return {s: self.teams[s].goals for s in (HOME, AWAY)}

    # -- event application -----------------------------------------------------------------------

    def apply(self, e: Event) -> EventValue | None:
        self._decay(e.t)
        self.t, self.period, self.last_event = e.t, e.period, e
        handler = getattr(self, f"_on_{e.type}", None)
        return handler(e) if handler else None

    def _decay(self, t: float) -> None:
        dt = max(t - self.t, 0.0)
        if dt:
            f = math.exp(-dt / MOMENTUM_TAU)
            for s in self.momentum:
                self.momentum[s] *= f

    def _on_full_time(self, e: Event) -> None:
        self.finished = True

    def _on_substitution(self, e: Event) -> None:
        self.on_pitch[e.team].discard(e.extras["off_id"])
        self.on_pitch[e.team].add(e.player_id)

    def _on_possession_change(self, e: Event) -> None:
        self.possessions.append({"id": e.possession, "team": e.team, "start": e.t, "passes": 0})
        if len(self.possessions) > 1 and self.possessions[-2]["team"] != e.team:
            self.turnovers.append(e.t)

    def _on_pressure(self, e: Event) -> None:
        own_x = to_rel(e.team, e.x, e.y)[0]
        self.teams[e.team].def_actions.append((e.t, own_x))
        self.teams[e.team].pressures.append((e.t, own_x))
        self.pressured_at[other(e.team)] = e.t

    def _on_pass(self, e: Event) -> EventValue:
        if self.possessions and self.possessions[-1]["id"] == e.possession:
            self.possessions[-1]["passes"] += 1
        pl = self.players[e.player_id]
        pl.passes += 1
        sx, sy = to_rel(e.team, e.x, e.y)
        ex, ey = to_rel(e.team, e.end_x, e.end_y)
        before, after = xt(sx, sy), xt(ex, ey)
        pressured = e.t - self.pressured_at[e.team] <= PRESSURE_WINDOW
        lines = lines_broken(sx, ex, self.block_height(other(e.team), e.t))
        difficulty = pass_difficulty(e.extras["length_m"], lines, pressured, ex > sx)
        if e.outcome == "success":
            pl.completed += 1
            delta = after - before
            pl.threat += delta
            self._credit(e.team, delta, e.t)
        else:
            delta = -before
        return EventValue(e.id, e.team, e.player_id, "pass", delta, before, after, lines, difficulty, pressured)

    def _on_carry(self, e: Event) -> EventValue:
        sx, sy = to_rel(e.team, e.x, e.y)
        ex, ey = to_rel(e.team, e.end_x, e.end_y)
        before, after = xt(sx, sy), xt(ex, ey)
        self.players[e.player_id].threat += after - before
        self._credit(e.team, after - before, e.t)
        return EventValue(e.id, e.team, e.player_id, "carry", after - before, before, after)

    def _defensive(self, e: Event) -> EventValue:
        self.teams[e.team].def_actions.append((e.t, to_rel(e.team, e.x, e.y)[0]))
        self.players[e.player_id].def_actions += 1
        danger = xt(*to_rel(other(e.team), e.x, e.y))
        return EventValue(e.id, e.team, e.player_id, "danger_removed", danger)

    _on_tackle = _defensive
    _on_interception = _defensive

    def _on_shot(self, e: Event) -> EventValue:
        chance = e.extras["xg"]
        self.teams[e.team].shots += 1
        self.teams[e.team].xg += chance
        self.players[e.player_id].shots += 1
        self.momentum[e.team] += chance
        return EventValue(e.id, e.team, e.player_id, "shot", chance)

    def _on_goal(self, e: Event) -> EventValue:
        self.teams[e.team].goals += 1
        self.players[e.player_id].goals += 1
        self.momentum[e.team] += 0.3
        return EventValue(e.id, e.team, e.player_id, "goal", 1.0)

    def _credit(self, side: str, delta: float, t: float) -> None:
        if delta > 0:
            self.momentum[side] += delta
            self.teams[side].threat.append((t, delta))

    # -- derived metrics ----------------------------------------------------------------------------

    def block_height(self, side: str, t: float) -> float:
        xs = [x for (at, x) in self.teams[side].def_actions if t - BLOCK_WINDOW <= at < t]
        return mean(xs) if len(xs) >= 3 else 45.0

    def press_height(self, side: str, t0: float, t1: float) -> tuple[float, int] | None:
        """Mean distance from own goal at which `side` engages, and how often it did so."""
        xs = [x for (at, x) in self.teams[side].pressures if t0 <= at <= t1]
        return (mean(xs), len(xs)) if xs else None

    def finished_possessions(self, side: str) -> list[dict[str, Any]]:
        return [p for p in self.possessions[:-1] if p["team"] == side]

    def possession_pct(self, side: str, t0: float, t1: float) -> float:
        held = {HOME: 0.0, AWAY: 0.0}
        for i, p in enumerate(self.possessions):
            end = self.possessions[i + 1]["start"] if i + 1 < len(self.possessions) else t1
            overlap = min(end, t1) - max(p["start"], t0)
            if overlap > 0:
                held[p["team"]] += overlap
        total = sum(held.values()) or 1.0
        return 100 * held[side] / total

    def team_threat(self, side: str, t0: float, t1: float) -> float:
        return sum(d for (at, d) in self.teams[side].threat if t0 <= at <= t1)

    def momentum_index(self) -> float:
        """-1 (away on top) .. +1 (home on top). Built only from attacking output (threat added,
        chances, goals), so it always agrees with the facts a momentum insight quotes."""
        return math.tanh((self.momentum[HOME] - self.momentum[AWAY]) / 0.6)

    def chaos_index(self, window: float = 300.0) -> float:
        """0-100: how often the ball is changing hands right now."""
        while self.turnovers and self.turnovers[0] < self.t - window:
            self.turnovers.popleft()
        per_min = len(self.turnovers) / (window / 60)
        return min(100.0, per_min * 20)

    def snapshot(self) -> dict[str, Any]:
        t = self.t
        ball = None
        if self.last_event and self.last_event.x is not None:
            e = self.last_event
            ball = [e.end_x if e.end_x is not None else e.x, e.end_y if e.end_y is not None else e.y]
        return {
            "t": t,
            "period": self.period,
            "score": self.score,
            "momentum": round(self.momentum_index(), 3),
            "chaos": round(self.chaos_index(), 1),
            "possession_10m": round(self.possession_pct(HOME, max(0.0, t - 600), t), 1) if self.possessions else 50.0,
            "shots": {s: self.teams[s].shots for s in (HOME, AWAY)},
            "xg": {s: round(self.teams[s].xg, 2) for s in (HOME, AWAY)},
            "ball": ball,
        }
