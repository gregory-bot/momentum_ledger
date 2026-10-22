"""The ledger: an append-only event store plus a small query language over it.

Every fact an insight carries includes a query. The verifier re-runs that query here, from
raw events, through code that is deliberately separate from the incremental game-state
engine. A number reaches the screen only when both paths agree.
"""

from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any, Callable

from .models import Event, MatchMeta, minute_of, other
from .pitch import lines_broken, pass_difficulty, to_rel, xt

DEF_TYPES = ("pressure", "tackle", "interception")
BLOCK_WINDOW = 600.0
PRESSURE_WINDOW = 3.0


class QueryError(Exception):
    pass


class Ledger:
    def __init__(self, meta: MatchMeta, events: list[Event] | None = None):
        self.meta = meta
        self.events: list[Event] = []
        self.by_id: dict[str, Event] = {}
        for e in events or []:
            self.append(e)

    def append(self, e: Event) -> None:
        if e.id in self.by_id:
            return  # idempotent: replays and at-least-once delivery are safe
        self.events.append(e)
        self.by_id[e.id] = e

    def __len__(self) -> int:
        return len(self.events)

    # -- query entry point -----------------------------------------------------------------------

    def evaluate(self, query: dict[str, Any]) -> Any:
        op = query.get("op")
        fn: Callable[..., Any] | None = getattr(self, f"_q_{op}", None)
        if fn is None:
            raise QueryError(f"unknown query op '{op}'")
        args = {k: v for k, v in query.items() if k != "op"}
        try:
            return fn(**args)
        except (KeyError, TypeError, ZeroDivisionError) as exc:
            raise QueryError(f"{op}: {exc!r}") from exc

    # -- primitives --------------------------------------------------------------------------------

    def _event(self, id: str) -> Event:
        if id not in self.by_id:
            raise QueryError(f"event {id} is not in the ledger")
        return self.by_id[id]

    def _window(self, t0: float, t1: float) -> list[Event]:
        return [e for e in self.events if t0 <= e.t <= t1]

    def possessions(self, t1: float) -> list[dict[str, Any]]:
        out: dict[int, dict[str, Any]] = {}
        for e in self.events:
            if e.t > t1:
                break
            if e.type == "possession_change":
                out[e.possession] = {"id": e.possession, "team": e.team, "start": e.t, "passes": 0}
            elif e.type == "pass" and e.possession in out:
                out[e.possession]["passes"] += 1
        return sorted(out.values(), key=lambda p: p["start"])

    def block_height(self, side: str, t: float) -> float:
        xs = [to_rel(side, e.x, e.y)[0] for e in self.events
              if e.team == side and e.type in DEF_TYPES and t - BLOCK_WINDOW <= e.t < t]
        return mean(xs) if len(xs) >= 3 else 45.0

    def _xt_pair(self, e: Event) -> tuple[float, float]:
        sx, sy = to_rel(e.team, e.x, e.y)
        ex, ey = to_rel(e.team, e.end_x, e.end_y)
        return xt(sx, sy), xt(ex, ey)

    def _was_pressured(self, e: Event) -> bool:
        return any(p.type == "pressure" and p.team == other(e.team) and e.t - PRESSURE_WINDOW <= p.t <= e.t
                   for p in self._window(e.t - PRESSURE_WINDOW, e.t))

    # -- query ops -----------------------------------------------------------------------------------

    def _q_const(self, value: Any) -> Any:
        """A definitional constant (window size, label), not a claim about the match."""
        return value

    def _q_press_change(self, side: str, t0: float, t_mid: float, t1: float) -> int:
        before = self._q_press_height(side, t0, t_mid - 0.05)
        after = self._q_press_height(side, t_mid, t1)
        return abs(round(after) - round(before))

    def _q_event_field(self, id: str, field: str) -> Any:
        node: Any = self._event(id).to_dict()
        for part in field.split("."):
            node = node[part]
        return node

    def _q_minute(self, id: str) -> int:
        return minute_of(self._event(id).t)

    def _q_score(self, side: str, t1: float) -> int:
        return sum(1 for e in self.events if e.type == "goal" and e.team == side and e.t <= t1)

    def _q_player_goals(self, player_id: str, t1: float) -> int:
        return sum(1 for e in self.events if e.type == "goal" and e.player_id == player_id and e.t <= t1)

    def _q_xt_start(self, id: str) -> float:
        return self._xt_pair(self._event(id))[0]

    def _q_xt_end(self, id: str) -> float:
        return self._xt_pair(self._event(id))[1]

    def _q_threat_multiplier(self, id: str) -> float:
        a, b = self._xt_pair(self._event(id))
        return b / a

    def _q_lines_broken(self, id: str) -> int:
        e = self._event(id)
        sx = to_rel(e.team, e.x, e.y)[0]
        ex = to_rel(e.team, e.end_x, e.end_y)[0]
        return lines_broken(sx, ex, self.block_height(other(e.team), e.t))

    def _q_pass_difficulty(self, id: str) -> int:
        e = self._event(id)
        sx = to_rel(e.team, e.x, e.y)[0]
        ex = to_rel(e.team, e.end_x, e.end_y)[0]
        lines = lines_broken(sx, ex, self.block_height(other(e.team), e.t))
        return pass_difficulty(e.extras["length_m"], lines, self._was_pressured(e), ex > sx)

    def _q_danger_removed(self, id: str) -> float:
        e = self._event(id)
        return xt(*to_rel(other(e.team), e.x, e.y))

    def _q_poss_passes_mean(self, side: str, t1: float, last_n: int, skip: int = 0) -> float:
        # Only possessions that have finished count, so a live one cannot skew the average.
        poss = [p for p in self.possessions(t1)[:-1] if p["team"] == side]
        end = len(poss) - skip
        chunk = poss[max(0, end - last_n):end]
        if len(chunk) < last_n:
            raise QueryError("not enough possessions")
        return mean(p["passes"] for p in chunk)

    def _q_poss_start_minute(self, side: str, t1: float, last_n: int) -> int:
        poss = [p for p in self.possessions(t1)[:-1] if p["team"] == side]
        return minute_of(poss[-last_n]["start"])

    def _q_press_height(self, side: str, t0: float, t1: float) -> float:
        xs = [to_rel(side, e.x, e.y)[0] for e in self._window(t0, t1) if e.team == side and e.type == "pressure"]
        if not xs:
            raise QueryError("no pressure events in window")
        return mean(xs)

    def _q_possession_pct(self, side: str, t0: float, t1: float) -> float:
        poss = self.possessions(t1)
        held: dict[str, float] = defaultdict(float)
        for i, p in enumerate(poss):
            end = poss[i + 1]["start"] if i + 1 < len(poss) else t1
            overlap = min(end, t1) - max(p["start"], t0)
            if overlap > 0:
                held[p["team"]] += overlap
        total = sum(held.values())
        return 100 * held[side] / total

    def _q_count(self, t0: float, t1: float, where: dict[str, Any]) -> int:
        return sum(1 for e in self._window(t0, t1) if all(getattr(e, k) == v for k, v in where.items()))

    def _q_player_pass_accuracy(self, player_id: str, t1: float) -> float:
        ps = [e for e in self.events if e.type == "pass" and e.player_id == player_id and e.t <= t1]
        return 100 * sum(e.outcome == "success" for e in ps) / len(ps)

    def _q_player_threat(self, player_id: str, t1: float) -> float:
        total = 0.0
        for e in self.events:
            if e.t > t1:
                break
            if e.player_id == player_id and e.type in ("pass", "carry") and e.outcome == "success":
                a, b = self._xt_pair(e)
                total += b - a
        return total

    def _q_player_def_actions(self, player_id: str, t1: float) -> int:
        return sum(1 for e in self.events
                   if e.player_id == player_id and e.type in ("tackle", "interception") and e.t <= t1)

    def _q_team_threat(self, side: str, t0: float, t1: float) -> float:
        total = 0.0
        for e in self._window(t0, t1):
            if e.team == side and e.type in ("pass", "carry") and e.outcome == "success":
                a, b = self._xt_pair(e)
                total += max(b - a, 0.0)
        return total

    def _q_team_xg(self, side: str, t0: float, t1: float) -> float:
        return sum(e.extras["xg"] for e in self._window(t0, t1) if e.type == "shot" and e.team == side)
