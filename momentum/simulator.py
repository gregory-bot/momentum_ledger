"""Synthetic, football-realistic match generator.

Events come from a possession-based stochastic model in which each team's tactical style
(pass security, directness, press height and intensity, tempo) shapes what happens. A style
change mid-match therefore changes the event *patterns*, and the engine has to discover the
shift from data alone. Nothing downstream ever reads the style.

A storyline director fixes when goals happen so a demo match has a narrative, while every
other event remains emergent.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

from .models import AWAY, HOME, Event, MatchMeta, Player, Team, other
from .pitch import LENGTH, WIDTH, clamp, lines_broken, to_abs, xg

HALF, FULL = 45 * 60.0, 90 * 60.0


@dataclass(frozen=True)
class Style:
    label: str
    pass_success: float     # base completion probability
    directness: float       # share of passes played forward
    pass_length: float      # mean pass length (m)
    press_height: float     # how far from its own goal the team engages (m)
    press_intensity: float  # chance of a pressure event per opponent action inside that zone
    shot_appetite: float    # willingness to shoot once in range
    tempo: float            # mean seconds between on-ball actions


STYLES = {
    "possession": Style("possession", 0.90, 0.36, 16, 58, 0.30, 0.30, 3.3),
    "low_block": Style("low_block", 0.76, 0.62, 24, 36, 0.22, 0.45, 2.7),
    "high_press": Style("high_press", 0.81, 0.58, 21, 78, 0.72, 0.45, 2.3),
}


@dataclass
class Storyline:
    """Style phases per team plus scripted goals and substitutions."""

    phases: list[tuple[float, str, str]]  # (from_t, home_style, away_style)
    goals: list[tuple[float, str, str]]  # (not_before_t, side, scorer_id)
    subs: list[tuple[float, str, str, str]] = field(default_factory=list)  # (t, side, off_id, on_id)

    def styles_at(self, t: float) -> tuple[Style, Style]:
        current = self.phases[0]
        for phase in self.phases:
            if t >= phase[0]:
                current = phase
        return STYLES[current[1]], STYLES[current[2]]


def _squad(prefix: str, rows: list[tuple[int, str, str]]) -> list[Player]:
    return [Player(f"{prefix}{n}", name, n, role) for n, name, role in rows]


def default_meta(seed: int = 7) -> MatchMeta:
    home = Team(HOME, "NBR", "Northbridge FC", "Northbridge", "#e4572e", _squad("N", [
        (1, "Tom Hale", "GK"), (2, "Kai Brennan", "DEF"), (4, "Kofi Mensah", "DEF"), (5, "Luca Ferri", "DEF"),
        (3, "Owen Tate", "DEF"), (6, "Jonah Reyes", "MID"), (8, "Ethan Vale", "MID"), (10, "Ade Bakare", "MID"),
        (7, "Ryo Takeda", "FWD"), (9, "Callum Shaw", "FWD"), (11, "Mateo Quint", "FWD"),
    ]), bench=_squad("N", [(14, "Nico Barros", "MID")]))
    away = Team(AWAY, "RVA", "Riverside Athletic", "Riverside", "#2e86de", _squad("R", [
        (1, "Piet Janssen", "GK"), (2, "Felix Moreau", "DEF"), (5, "Isaac Duru", "DEF"), (6, "Henrik Lund", "DEF"),
        (3, "Yusuf Kaya", "DEF"), (4, "Danny Cole", "MID"), (8, "Theo Marsh", "MID"), (10, "Samir Haddad", "MID"),
        (7, "Leo Varga", "FWD"), (9, "Malik Otieno", "FWD"), (11, "Jamie Rook", "FWD"),
    ]), bench=_squad("R", [(14, "Brian Wanjala", "FWD")]))
    return MatchMeta(f"ml-{seed:04d}", "Synthetic Premier Match", "Northbridge Park", home, away, seed)


# A dominant home first half, a tactical switch by the away side just before the hour,
# then a comeback. The switch is never emitted as an event: the engine must detect it.
DEFAULT_STORY = Storyline(
    phases=[(0.0, "possession", "low_block"), (56 * 60.0, "possession", "high_press")],
    goals=[(22 * 60 + 40.0, HOME, "N9"), (63 * 60 + 30.0, AWAY, "R9"), (80 * 60 + 50.0, AWAY, "R9")],
    subs=[(55 * 60 + 40.0, AWAY, "R11", "R14")],
)

ROLE_CENTRES = {"DEF": (28.0, 18.0), "MID": (55.0, 22.0), "FWD": (84.0, 16.0)}


class MatchSimulator:
    def __init__(self, meta: MatchMeta | None = None, story: Storyline = DEFAULT_STORY):
        self.meta = meta or default_meta()
        self.story = story
        self.rng = random.Random(self.meta.seed)

    # -- public ---------------------------------------------------------------------------------

    def generate(self) -> list[Event]:
        self.events: list[Event] = []
        self.t = 0.0
        self.period = 1
        self.possession_id = 0
        self.scored: set[int] = set()
        self.subs_done: set[int] = set()
        self.on_pitch = {HOME: list(self.meta.home.players), AWAY: list(self.meta.away.players)}

        self._emit("kickoff", HOME, extras={"home": self.meta.home.name, "away": self.meta.away.name})
        side, ball = HOME, (LENGTH / 2, WIDTH / 2)
        while True:
            result = self._possession(side, ball)
            if result is None:
                if self.period == 1:
                    self.t = HALF
                    self._emit("half_time", None)
                    self.period = 2
                    self._emit("kickoff", AWAY)
                    side, ball = AWAY, (LENGTH / 2, WIDTH / 2)
                    continue
                self.t = FULL
                self._emit("full_time", None)
                break
            side, ball = result
        return self.events

    # -- generation -----------------------------------------------------------------------------

    def _possession(self, side: str, ball: tuple[float, float]) -> tuple[str, tuple[float, float]] | None:
        rng = self.rng
        opp = other(side)
        self.possession_id += 1
        x, y = ball
        holder = self._pick(side, x)
        ax, ay = to_abs(side, x, y)
        self._emit("possession_change", side, holder.id, ax, ay)
        last_passer: Player | None = None

        for _ in range(60):
            att, dfn = self._styles(side)
            self.t += rng.uniform(0.6, 1.4) * att.tempo
            if self._period_over():
                return None
            self._apply_subs()
            due = self._goal_due(side)

            pressured = False
            if LENGTH - x <= dfn.press_height and rng.random() < dfn.press_intensity:
                presser = self._pick(opp, LENGTH - x)
                px, py = to_abs(side, x, y)
                self._emit("pressure", opp, presser.id, px, py)
                pressured = True

            if x > 80 and (due is not None or rng.random() < att.shot_appetite * self._shot_zone(x, y)):
                return self._shot(side, holder, x, y, due, last_passer)

            if not pressured and rng.random() < 0.16:
                length = rng.uniform(5, 18)
                ang = rng.gauss(0, 0.5)
                ex, ey = clamp(x + length * math.cos(ang), 1, 104), clamp(y + length * math.sin(ang), 1, 67)
                speed = round(clamp(rng.gauss(24, 5), 12, 35.5), 1)
                self._emit("carry", side, holder.id, *to_abs(side, x, y), *to_abs(side, ex, ey),
                           outcome="success", extras={"speed_kmh": speed, "distance_m": round(length, 1)})
                x, y = ex, ey
                continue

            directness = 0.85 if due is not None else att.directness
            length = clamp(rng.gauss(att.pass_length + (6 if due is not None else 0), 7), 5, 55)
            forward = rng.random() < directness
            ang = rng.gauss(0, 0.45) if forward else rng.choice([
                rng.gauss(math.pi / 2, 0.4), rng.gauss(-math.pi / 2, 0.4), rng.gauss(math.pi, 0.5)])
            ex = clamp(x + length * math.cos(ang), 1, 104)
            ey = clamp(y + length * math.sin(ang), 1, 67)
            lines = lines_broken(x, ex, dfn.press_height)
            p = att.pass_success - (0.26 if pressured else 0) - 0.005 * max(0, length - 18) - 0.05 * lines
            if due is not None:
                p = max(p, 0.92)
            receiver = self._pick(side, ex, exclude=holder.id)
            ok = rng.random() < p
            ball_speed = round(clamp(38 + 1.1 * length + rng.gauss(0, 6), 25, 105), 1)
            self._emit("pass", side, holder.id, *to_abs(side, x, y), *to_abs(side, ex, ey),
                       outcome="success" if ok else "fail", receiver_id=receiver.id if ok else None,
                       extras={"length_m": round(length, 1), "ball_speed_kmh": ball_speed})
            if ok:
                last_passer, holder, x, y = holder, receiver, ex, ey
                continue

            self.t += rng.uniform(0.4, 1.2)
            winner = self._pick(opp, LENGTH - ex)
            wx, wy = to_abs(side, ex, ey)
            if rng.random() < 0.55:
                self._emit("interception", opp, winner.id, wx, wy, outcome="success")
            else:
                self._emit("tackle", opp, winner.id, wx, wy, outcome="success", extras={"on": receiver.id})
            return opp, (LENGTH - ex, WIDTH - ey)

        # Long possession finally recycled to the keeper and cleared.
        return opp, (rng.uniform(40, 60), rng.uniform(10, 58))

    def _shot(self, side: str, holder: Player, x: float, y: float, due: int | None,
              last_passer: Player | None) -> tuple[str, tuple[float, float]]:
        rng = self.rng
        shooter = holder
        if due is not None:
            shooter = self.meta.player(self.story.goals[due][2]) or holder
            x, y = rng.uniform(91, 99), clamp(rng.gauss(34, 5), 22, 46)
        else:
            # Speculative efforts come from wherever the attack stalls, mostly outside the six-yard box.
            x = rng.uniform(80, min(x, 99))
            y = clamp(y + rng.gauss(0, 4), 8, 60)
            if holder.role in ("GK", "DEF"):
                shooter = self._pick(side, x, roles=("FWD", "MID"))
        chance = xg(x, y)
        speed = round(clamp(rng.gauss(96, 13), 55, 128), 1)
        if due is not None:
            outcome = "goal"
        else:
            outcome = rng.choices(["saved", "off_target", "blocked"], [0.38, 0.4, 0.22])[0]
        ax, ay = to_abs(side, x, y)
        shot = self._emit("shot", side, shooter.id, ax, ay, outcome=outcome,
                          extras={"xg": chance, "shot_speed_kmh": speed})
        opp = other(side)
        if outcome == "goal":
            self.scored.add(due)
            assist = last_passer.id if last_passer and last_passer.id != shooter.id else None
            self._emit("goal", side, shooter.id, ax, ay, extras={"shot": shot.id, "assist_id": assist})
            self.t += 50
            return opp, (LENGTH / 2, WIDTH / 2)
        if outcome == "blocked":
            return opp, (LENGTH - x + rng.uniform(2, 8), WIDTH - y)
        return opp, (rng.uniform(6, 12), rng.uniform(25, 43))

    # -- helpers --------------------------------------------------------------------------------

    def _styles(self, side: str) -> tuple[Style, Style]:
        home, away = self.story.styles_at(self.t)
        return (home, away) if side == HOME else (away, home)

    def _period_over(self) -> bool:
        return self.t >= (HALF if self.period == 1 else FULL)

    def _goal_due(self, side: str) -> int | None:
        for i, (t, s, scorer) in enumerate(self.story.goals):
            if i not in self.scored and s == side and self.t >= t and any(p.id == scorer for p in self.on_pitch[side]):
                return i
        return None

    def _apply_subs(self) -> None:
        for i, (t, side, off_id, on_id) in enumerate(self.story.subs):
            if i in self.subs_done or self.t < t:
                continue
            self.subs_done.add(i)
            on = self.meta.player(on_id)
            self.on_pitch[side] = [on if p.id == off_id else p for p in self.on_pitch[side]]
            self._emit("substitution", side, on_id, extras={"off_id": off_id})

    @staticmethod
    def _shot_zone(x: float, y: float) -> float:
        return clamp((x - 80) / 20, 0, 1) * math.exp(-((y - WIDTH / 2) / 16) ** 2) * 0.5

    def _pick(self, side: str, rel_x: float, exclude: str | None = None,
              roles: tuple[str, ...] | None = None) -> Player:
        weights, pool = [], []
        for p in self.on_pitch[side]:
            if p.id == exclude or (roles and p.role not in roles):
                continue
            if p.role == "GK":
                w = 1.5 if rel_x < 18 else 0.0
            else:
                centre, spread = ROLE_CENTRES[p.role]
                w = math.exp(-(((rel_x - centre) / spread) ** 2)) + 0.03
            pool.append(p)
            weights.append(w)
        return self.rng.choices(pool, weights)[0]

    def _emit(self, type_: str, team: str | None, player_id: str | None = None,
              x: float | None = None, y: float | None = None, end_x: float | None = None,
              end_y: float | None = None, outcome: str | None = None, receiver_id: str | None = None,
              extras: dict | None = None) -> Event:
        r = lambda v: None if v is None else round(v, 1)  # noqa: E731
        ev = Event(
            id=f"e{len(self.events) + 1:05d}", match_id=self.meta.match_id, seq=len(self.events) + 1,
            t=round(self.t, 1), period=self.period, type=type_, team=team, player_id=player_id,
            x=r(x), y=r(y), end_x=r(end_x), end_y=r(end_y), outcome=outcome, receiver_id=receiver_id,
            possession=self.possession_id, extras=extras or {},
        )
        self.events.append(ev)
        return ev


def generate_match(seed: int = 7) -> tuple[MatchMeta, list[Event]]:
    meta = default_meta(seed)
    return meta, MatchSimulator(meta).generate()


def save_match(path: Path, meta: MatchMeta, events: list[Event]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"meta": meta.to_dict(), "events": [e.to_dict() for e in events]}, indent=1))


def load_match(path: Path) -> tuple[MatchMeta, list[Event]]:
    data = json.loads(path.read_text())
    return MatchMeta.from_dict(data["meta"]), [Event.from_dict(e) for e in data["events"]]
