"""Decides which moments are worth telling and packages them as verifiable facts.

Two families of insight:
  * moments that changed the game: goals, big chances, line-breaking passes, danger removed
  * points where the game changed character: regime shifts in control, press and momentum

No prose is produced here. Each insight is a set of facts, and every fact carries the
ledger query that proves it.
"""

from __future__ import annotations

from typing import Any

from .engine import EventValue, GameState
from .models import AWAY, HOME, Event, Fact, Insight, MatchMeta, minute_of, other

REGIME_RECENT, REGIME_BASELINE = 8, 16
PRESS_WINDOW = 8 * 60.0
PLAYER_CARD_MINUTES = {15, 30, 45, 60, 75, 90}


def fact(key: str, value: Any, query: dict[str, Any], precision: int = 0,
         unit: str | None = None, display: str | None = None) -> Fact:
    if isinstance(value, float):
        value = round(value, precision) if precision else round(value)
    if display is None:
        display = f"{value:.{precision}f}" if precision else str(value)
    return Fact(key, value, display, query, precision, unit)


class MomentDetector:
    def __init__(self, meta: MatchMeta, state: GameState):
        self.meta = meta
        self.state = state
        self.checked_minute = 0
        self.cooldown: dict[str, float] = {}
        self.recent_shifts: list[Insight] = []
        self.momentum_history: list[tuple[int, float]] = []

    # -- facts about people -------------------------------------------------------------------------

    def _player_fact(self, key: str, event_id: str, field: str = "player_id") -> Fact | None:
        e_field = self._lookup(event_id, field)
        p = self.meta.player(e_field) if e_field else None
        if not p:
            return None
        return fact(key, p.id, {"op": "event_field", "id": event_id, "field": field}, display=p.name)

    def _lookup(self, event_id: str, field: str) -> Any:
        e = self._events[event_id]
        node: Any = e.to_dict()
        for part in field.split("."):
            node = node.get(part) if isinstance(node, dict) else None
        return node

    def _team_fact(self, side: str, event_id: str | None = None, key: str = "team") -> Fact:
        query = {"op": "event_field", "id": event_id, "field": "team"} if event_id else {"op": "const", "value": side}
        return fact(key, side, query, display=self.meta.team(side).name)

    def _cooling(self, key: str, t: float, seconds: float) -> bool:
        if t - self.cooldown.get(key, -1e9) < seconds:
            return True
        self.cooldown[key] = t
        return False

    def _insight(self, id: str, t: float, kind: str, priority: int, impact: float, team: str | None,
                 player_id: str | None, facts: list[Fact | None], evidence: list[str]) -> Insight:
        fs = {f.key: f for f in facts if f is not None}
        entities = []
        for f in fs.values():
            if f.query.get("field") in ("player_id", "receiver_id", "extras.assist_id", "team") or f.key.startswith("team"):
                entities.append(f.display)
            elif f.key in ("player", "scorer"):
                entities.append(f.display)
        return Insight(id, t, kind, priority, round(impact, 4), team, player_id, sorted(set(entities)), fs, evidence)

    # -- per-event ----------------------------------------------------------------------------------

    def bind(self, events: dict[str, Event]) -> None:
        self._events = events

    def before_event(self, e: Event) -> list[Insight]:
        """Clock-driven checks for every whole minute that elapsed before this event."""
        out: list[Insight] = []
        while (self.checked_minute + 1) * 60 < e.t:
            self.checked_minute += 1
            out += self._minute_checks(self.checked_minute * 60.0)
        return out

    def on_event(self, e: Event, v: EventValue | None) -> list[Insight]:
        handler = getattr(self, f"_on_{e.type}", None)
        out = handler(e, v) if handler else None
        return [i for i in (out if isinstance(out, list) else [out]) if i is not None]

    def _on_goal(self, e: Event, v: EventValue) -> Insight:
        shot_id = e.extras["shot"]
        t = e.t
        goals = self.state.players[e.player_id].goals
        facts = [
            self._player_fact("scorer", e.id),
            self._team_fact(e.team, e.id),
            fact("minute", e.minute, {"op": "minute", "id": e.id}),
            fact("score_home", self.state.score[HOME], {"op": "score", "side": HOME, "t1": t}),
            fact("score_away", self.state.score[AWAY], {"op": "score", "side": AWAY, "t1": t}),
            fact("xg", self._lookup(shot_id, "extras.xg"), {"op": "event_field", "id": shot_id, "field": "extras.xg"}, 2),
            fact("shot_speed_kmh", self._lookup(shot_id, "extras.shot_speed_kmh"),
                 {"op": "event_field", "id": shot_id, "field": "extras.shot_speed_kmh"}, 0, "km/h"),
            fact("player_goals", goals, {"op": "player_goals", "player_id": e.player_id, "t1": t}),
            self._team_fact(HOME, key="team_home"),
            self._team_fact(AWAY, key="team_away"),
        ]
        if e.extras.get("assist_id"):
            facts.append(self._player_fact("assist", e.id, "extras.assist_id"))
        return self._insight(f"goal-{e.id}", t, "goal", 3, 1.0, e.team, e.player_id, facts, [e.id, shot_id])

    def _on_shot(self, e: Event, v: EventValue) -> Insight | None:
        if e.outcome == "goal" or e.extras["xg"] < 0.12:
            return None
        facts = [
            self._player_fact("player", e.id),
            self._team_fact(e.team, e.id),
            fact("xg", e.extras["xg"], {"op": "event_field", "id": e.id, "field": "extras.xg"}, 2),
            fact("outcome", e.outcome, {"op": "event_field", "id": e.id, "field": "outcome"}),
            fact("shot_speed_kmh", e.extras["shot_speed_kmh"],
                 {"op": "event_field", "id": e.id, "field": "extras.shot_speed_kmh"}, 0, "km/h"),
            fact("minute", e.minute, {"op": "minute", "id": e.id}),
        ]
        return self._insight(f"chance-{e.id}", e.t, "big_chance", 2, e.extras["xg"], e.team, e.player_id, facts, [e.id])

    def _on_pass(self, e: Event, v: EventValue) -> Insight | None:
        if e.outcome != "success" or v.xt_before < 0.01:
            return None
        mult = v.xt_after / v.xt_before
        if not ((v.lines >= 2 and v.delta >= 0.02) or v.delta >= 0.07):
            return None
        if self._cooling(f"lbp-{e.team}", e.t, 150) and v.lines < 3:
            return None
        facts = [
            self._player_fact("player", e.id),
            self._player_fact("receiver", e.id, "receiver_id"),
            self._team_fact(e.team, e.id),
            fact("lines_broken", v.lines, {"op": "lines_broken", "id": e.id}),
            fact("xt_before", v.xt_before, {"op": "xt_start", "id": e.id}, 3),
            fact("xt_after", v.xt_after, {"op": "xt_end", "id": e.id}, 3),
            fact("threat_multiplier", mult, {"op": "threat_multiplier", "id": e.id}, 1, "x"),
            fact("pass_length_m", e.extras["length_m"], {"op": "event_field", "id": e.id, "field": "extras.length_m"}, 0, "m"),
            fact("difficulty", v.difficulty, {"op": "pass_difficulty", "id": e.id}, 0, "/100"),
            fact("minute", e.minute, {"op": "minute", "id": e.id}),
        ]
        priority = 2 if v.lines >= 3 or mult >= 4 else 1
        return self._insight(f"pass-{e.id}", e.t, "line_breaking_pass", priority, v.delta, e.team, e.player_id, facts, [e.id])

    def _defensive(self, e: Event, v: EventValue) -> Insight | None:
        if v.delta < 0.07 or self._cooling(f"def-{e.team}", e.t, 120):
            return None
        facts = [
            self._player_fact("player", e.id),
            self._team_fact(e.team, e.id),
            fact("action", e.type, {"op": "event_field", "id": e.id, "field": "type"}),
            fact("danger_removed", v.delta, {"op": "danger_removed", "id": e.id}, 2, "xT"),
            fact("minute", e.minute, {"op": "minute", "id": e.id}),
        ]
        priority = 2 if v.delta >= 0.15 else 1
        return self._insight(f"def-{e.id}", e.t, "danger_removed", priority, v.delta, e.team, e.player_id, facts, [e.id])

    _on_tackle = _defensive
    _on_interception = _defensive

    def _on_carry(self, e: Event, v: EventValue) -> Insight | None:
        speed = e.extras.get("speed_kmh", 0)
        if speed < 33 or self._cooling(f"speed-{e.player_id}", e.t, 600):
            return None
        facts = [
            self._player_fact("player", e.id),
            self._team_fact(e.team, e.id),
            fact("speed_kmh", speed, {"op": "event_field", "id": e.id, "field": "extras.speed_kmh"}, 1, "km/h"),
            fact("distance_m", e.extras["distance_m"], {"op": "event_field", "id": e.id, "field": "extras.distance_m"}, 0, "m"),
        ]
        return self._insight(f"speed-{e.id}", e.t, "speed_alert", 1, 0.0, e.team, e.player_id, facts, [e.id])

    def _on_half_time(self, e: Event, v: Any) -> Insight:
        return self._summary(e, "half_time", 0.0)

    def _on_full_time(self, e: Event, v: Any) -> Insight:
        return self._summary(e, "full_time", 0.0)

    def _summary(self, e: Event, kind: str, t0: float) -> Insight:
        t = e.t
        s = self.state
        facts = [
            self._team_fact(HOME, key="team_home"),
            self._team_fact(AWAY, key="team_away"),
            fact("score_home", s.score[HOME], {"op": "score", "side": HOME, "t1": t}),
            fact("score_away", s.score[AWAY], {"op": "score", "side": AWAY, "t1": t}),
            fact("possession_home", s.possession_pct(HOME, t0, t), {"op": "possession_pct", "side": HOME, "t0": t0, "t1": t}, 0, "%"),
            fact("possession_away", s.possession_pct(AWAY, t0, t), {"op": "possession_pct", "side": AWAY, "t0": t0, "t1": t}, 0, "%"),
            fact("shots_home", s.teams[HOME].shots,
                 {"op": "count", "t0": t0, "t1": t, "where": {"type": "shot", "team": HOME}}),
            fact("shots_away", s.teams[AWAY].shots,
                 {"op": "count", "t0": t0, "t1": t, "where": {"type": "shot", "team": AWAY}}),
            fact("xg_home", s.teams[HOME].xg, {"op": "team_xg", "side": HOME, "t0": t0, "t1": t}, 1),
            fact("xg_away", s.teams[AWAY].xg, {"op": "team_xg", "side": AWAY, "t0": t0, "t1": t}, 1),
        ]
        return self._insight(f"{kind}-{e.id}", t, kind, 3, 0.5, None, None, facts, [e.id])

    # -- clock-driven -----------------------------------------------------------------------------

    def _minute_checks(self, t: float) -> list[Insight]:
        out: list[Insight] = []
        minute = int(t // 60)
        if minute >= 14:
            for side in (HOME, AWAY):
                out += [i for i in (self._control_shift(side, t), self._press_shift(side, t)) if i]
        out += [i for i in [self._momentum_swing(t, minute)] if i]
        if minute in PLAYER_CARD_MINUTES:
            out += self._player_cards(t)
        return out

    def _control_shift(self, side: str, t: float) -> Insight | None:
        poss = self.state.finished_possessions(side)
        if len(poss) < REGIME_RECENT + REGIME_BASELINE:
            return None
        recent = [p["passes"] for p in poss[-REGIME_RECENT:]]
        base = [p["passes"] for p in poss[-(REGIME_RECENT + REGIME_BASELINE):-REGIME_RECENT]]
        r, b = sum(recent) / len(recent), sum(base) / len(base)
        if b >= 4.0 and r <= 0.6 * b and b - r >= 2:
            direction = "lost"
        elif r >= 4.0 and r >= 1.6 * b and r - b >= 2:
            direction = "gained"
        else:
            return None
        if self._cooling(f"control-{side}", t, 15 * 60):
            return None
        q = {"op": "poss_passes_mean", "side": side, "t1": t}
        facts = [
            self._team_fact(side),
            fact("direction", direction, {"op": "const", "value": direction}),
            fact("possessions", REGIME_RECENT, {"op": "const", "value": REGIME_RECENT}),
            fact("passes_recent", r, {**q, "last_n": REGIME_RECENT}, 1),
            fact("passes_before", b, {**q, "last_n": REGIME_BASELINE, "skip": REGIME_RECENT}, 1),
            fact("since_minute", minute_of(poss[-REGIME_RECENT]["start"]),
                 {"op": "poss_start_minute", "side": side, "t1": t, "last_n": REGIME_RECENT}),
        ]
        return self._shift(t, "control", side, facts, abs(b - r) / max(b, r))

    def _press_shift(self, side: str, t: float) -> Insight | None:
        w = PRESS_WINDOW
        t_mid, t0 = t - w, t - 2 * w
        recent = self.state.press_height(side, t_mid, t)
        base = self.state.press_height(side, t0, t_mid - 0.05)
        if not recent or not base:
            return None
        delta = recent[0] - base[0]
        height_shift = abs(delta) >= 12 and recent[1] >= 10 and base[1] >= 5
        intensity_shift = recent[1] >= 15 and recent[1] >= 2.5 * base[1]
        if not (height_shift or intensity_shift) or self._cooling(f"press-{side}", t, 15 * 60):
            return None
        direction = "higher" if delta > 0 else "deeper"
        count = {"op": "count", "where": {"type": "pressure", "team": side}}
        facts = [
            self._team_fact(side),
            fact("direction", direction, {"op": "const", "value": direction}),
            fact("window_min", int(w // 60), {"op": "const", "value": int(w // 60)}),
            fact("pressures_recent", recent[1], {**count, "t0": t_mid, "t1": t}),
            fact("pressures_before", base[1], {**count, "t0": t0, "t1": t_mid - 0.05}),
            fact("press_recent_m", recent[0], {"op": "press_height", "side": side, "t0": t_mid, "t1": t}, 0, "m"),
            fact("press_before_m", base[0], {"op": "press_height", "side": side, "t0": t0, "t1": t_mid - 0.05}, 0, "m"),
            fact("press_change_m", abs(round(recent[0]) - round(base[0])),
                 {"op": "press_change", "side": side, "t0": t0, "t_mid": t_mid, "t1": t}, 0, "m"),
            fact("since_minute", minute_of(t_mid), {"op": "const", "value": minute_of(t_mid)}),
        ]
        return self._shift(t, "press", side, facts, abs(delta) / 40 + recent[1] / (base[1] + 1) / 10)

    def _shift(self, t: float, metric: str, side: str, facts: list[Fact], impact: float) -> Insight:
        """A regime shift. When it completes a story already in progress (one side presses higher
        and the other loses control), emit the combined tactical story instead."""
        minute = int(t // 60)
        self.recent_shifts = [s for s in self.recent_shifts if t - s.t <= 8 * 60]
        insight = self._insight(f"regime-{metric}-{side}-{minute}", t, "regime_shift", 3, impact, side, None,
                                [*facts, fact("metric", metric, {"op": "const", "value": metric})], [])
        partner = next((s for s in self.recent_shifts if s.team != side and s.facts["metric"].value != metric), None)
        self.recent_shifts.append(insight)
        if not partner:
            return insight
        press, control = (insight, partner) if metric == "press" else (partner, insight)
        if press.facts["direction"].value != "higher" or control.facts["direction"].value != "lost":
            return insight
        combined = [self._team_fact(control.team, key="team"), self._team_fact(press.team, key="team_pressing")]
        for f in control.facts.values():
            if f.key in ("passes_recent", "passes_before", "possessions", "since_minute"):
                combined.append(f)
        for f in press.facts.values():
            if f.key in ("press_change_m", "press_recent_m", "press_before_m", "pressures_recent",
                         "pressures_before", "window_min"):
                combined.append(f)
        self.recent_shifts.clear()
        return self._insight(f"story-press-{minute}", t, "tactical_story", 3, 1.0, press.team, None, combined, [])

    def _momentum_swing(self, t: float, minute: int) -> Insight | None:
        idx = self.state.momentum_index()
        self.momentum_history.append((minute, idx))
        past = [v for (m, v) in self.momentum_history if minute - 6 <= m <= minute - 4]
        if not past or abs(idx) < 0.35 or past[0] * idx >= 0:
            return None
        if self._cooling("momentum", t, 10 * 60):
            return None
        side = HOME if idx > 0 else AWAY
        t0 = max(0.0, t - 600)
        s = self.state
        facts = [
            self._team_fact(side),
            self._team_fact(other(side), key="team_other"),
            fact("window_min", 10, {"op": "const", "value": 10}),
            fact("threat_10m", s.team_threat(side, t0, t), {"op": "team_threat", "side": side, "t0": t0, "t1": t}, 2, "xT"),
            fact("threat_other_10m", s.team_threat(other(side), t0, t),
                 {"op": "team_threat", "side": other(side), "t0": t0, "t1": t}, 2, "xT"),
            fact("possession_10m", s.possession_pct(side, t0, t), {"op": "possession_pct", "side": side, "t0": t0, "t1": t}, 0, "%"),
        ]
        return self._insight(f"momentum-{minute}", t, "momentum_swing", 2, abs(idx), side, None, facts, [])

    def _player_cards(self, t: float) -> list[Insight]:
        out = []
        minute = int(t // 60)
        for side in (HOME, AWAY):
            for pid in sorted(self.state.on_pitch[side]):
                pl = self.state.players.get(pid)
                if not pl or pl.passes < 5:
                    continue
                p = self.meta.player(pid)
                facts = [
                    fact("player", pid, {"op": "const", "value": pid}, display=p.name),
                    self._team_fact(side),
                    fact("minute", minute, {"op": "const", "value": minute}),
                    fact("passes_completed", pl.completed,
                         {"op": "count", "t0": 0, "t1": t, "where": {"type": "pass", "player_id": pid, "outcome": "success"}}),
                    fact("pass_accuracy", 100 * pl.completed / pl.passes, {"op": "player_pass_accuracy", "player_id": pid, "t1": t}, 0, "%"),
                    fact("threat_added", pl.threat, {"op": "player_threat", "player_id": pid, "t1": t}, 2, "xT"),
                    fact("def_actions", pl.def_actions, {"op": "player_def_actions", "player_id": pid, "t1": t}),
                ]
                out.append(self._insight(f"card-{pid}-{minute}", t, "player_card", 1, 0.0, side, pid, facts, []))
        return out
