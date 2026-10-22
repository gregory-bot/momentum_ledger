"""Storylines and the fictional clubs that play them.

A scenario fixes the two clubs, each side's tactical style over time, and when goals happen.
Everything else (every pass, press and tackle) emerges from the simulator, so the engine
still has to discover each story's tactical turns from the data alone.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import AWAY, HOME, MatchMeta, Player, Team
from .simulator import Storyline

M = 60.0  # seconds per minute, for readable storyline timings


def _squad(prefix: str, rows: list[tuple[int, str, str]]) -> list[Player]:
    return [Player(f"{prefix}{n}", name, n, role) for n, name, role in rows]


@dataclass(frozen=True)
class Club:
    code: str
    name: str
    short: str
    color: str
    venue: str
    prefix: str
    starters: tuple[tuple[int, str, str], ...]
    bench: tuple[tuple[int, str, str], ...]

    def team(self, side: str) -> Team:
        return Team(side, self.code, self.name, self.short, self.color,
                    _squad(self.prefix, list(self.starters)), bench=_squad(self.prefix, list(self.bench)))


CLUBS = {
    "NBR": Club("NBR", "Northbridge FC", "Northbridge", "#f97316", "Northbridge Park", "N", (
        (1, "Tom Hale", "GK"), (2, "Kai Brennan", "DEF"), (4, "Kofi Mensah", "DEF"), (5, "Luca Ferri", "DEF"),
        (3, "Owen Tate", "DEF"), (6, "Jonah Reyes", "MID"), (8, "Ethan Vale", "MID"), (10, "Ade Bakare", "MID"),
        (7, "Ryo Takeda", "FWD"), (9, "Callum Shaw", "FWD"), (11, "Mateo Quint", "FWD"),
    ), ((14, "Nico Barros", "MID"),)),
    "KIL": Club("KIL", "Kilima Rangers", "Kilima", "#3b82f6", "Kilima Stadium", "R", (
        (1, "Piet Janssen", "GK"), (2, "Felix Moreau", "DEF"), (5, "Isaac Duru", "DEF"), (6, "Henrik Lund", "DEF"),
        (3, "Yusuf Kaya", "DEF"), (4, "Danny Cole", "MID"), (8, "Theo Marsh", "MID"), (10, "Samir Haddad", "MID"),
        (7, "Leo Kamau", "FWD"), (9, "Malik Otieno", "FWD"), (11, "Jamie Rook", "FWD"),
    ), ((14, "Brian Wanjala", "FWD"),)),
    "CST": Club("CST", "Coastline FC", "Coastline", "#14b8a6", "The Breakwater", "C", (
        (1, "Marco Ellis", "GK"), (2, "Jalen Okafor", "DEF"), (4, "Sven Holm", "DEF"), (5, "Dario Costa", "DEF"),
        (3, "Ibrahim Sow", "DEF"), (6, "Felipe Arana", "MID"), (8, "Kenji Mori", "MID"), (10, "Nuno Pires", "MID"),
        (7, "Tariq Bello", "FWD"), (9, "Oscar Lindqvist", "FWD"), (11, "Ravi Menon", "FWD"),
    ), ((14, "Eli Navarro", "FWD"),)),
    "HVA": Club("HVA", "Highveld Athletic", "Highveld", "#a855f7", "Highveld Arena", "H", (
        (1, "Bram Visser", "GK"), (2, "Thabo Nkosi", "DEF"), (4, "Luca Bianchi", "DEF"), (5, "Ethan Ward", "DEF"),
        (3, "Sipho Dube", "DEF"), (6, "Andile Zulu", "MID"), (8, "Pierre Lambert", "MID"), (10, "Mateus Rocha", "MID"),
        (7, "Kwame Asante", "FWD"), (9, "Zane Mokoena", "FWD"), (11, "Hugo Lefevre", "FWD"),
    ), ((14, "Tom Brandt", "MID"),)),
}


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    tagline: str
    home: str
    away: str
    seed: int
    story: Storyline

    def summary(self) -> dict:
        h, a = CLUBS[self.home], CLUBS[self.away]
        club = lambda c: {"code": c.code, "name": c.name, "short": c.short, "color": c.color}  # noqa: E731
        return {"id": self.id, "name": self.name, "tagline": self.tagline, "seed": self.seed,
                "home": club(h), "away": club(a), "venue": h.venue}


SCENARIOS = [
    Scenario(
        "press-trap", "The Press Trap",
        "Northbridge own the ball for an hour. Then Kilima press, and everything breaks.",
        "NBR", "KIL", 7,
        Storyline(
            phases=[(0.0, "possession", "low_block"), (56 * M, "possession", "high_press")],
            goals=[(22 * M + 40, HOME, "N9"), (63 * M + 30, AWAY, "R9"), (80 * M + 50, AWAY, "R9")],
            subs=[(55 * M + 40, AWAY, "R11", "R14")],
        ),
    ),
    Scenario(
        "late-show", "The Late Show",
        "Seventy-five minutes against a wall. Then Coastline go all in.",
        "CST", "HVA", 11,
        Storyline(
            phases=[(0.0, "possession", "low_block"), (70 * M, "high_press", "low_block")],
            goals=[(77 * M + 20, HOME, "C9"), (87 * M + 40, HOME, "C10")],
            subs=[(66 * M, HOME, "C11", "C14")],
        ),
    ),
    Scenario(
        "end-to-end", "End to End",
        "Two pressing sides, no midfield, and six goals.",
        "HVA", "KIL", 23,
        Storyline(
            phases=[(0.0, "high_press", "high_press")],
            goals=[(8 * M + 30, HOME, "H9"), (20 * M + 50, AWAY, "R9"), (37 * M + 10, HOME, "H7"),
                   (54 * M + 40, AWAY, "R9"), (69 * M + 30, AWAY, "R7"), (87 * M + 50, HOME, "H9")],
            subs=[(60 * M, AWAY, "R11", "R14")],
        ),
    ),
]

_BY_ID = {s.id: s for s in SCENARIOS}


def get_scenario(scenario_id: str) -> Scenario:
    if scenario_id not in _BY_ID:
        raise KeyError(f"unknown scenario '{scenario_id}' (choose from {', '.join(_BY_ID)})")
    return _BY_ID[scenario_id]


def build_meta(sc: Scenario, seed: int) -> MatchMeta:
    h, a = CLUBS[sc.home], CLUBS[sc.away]
    return MatchMeta(f"{sc.id}-{seed}", "Synthetic Premier Match", h.venue, h.team(HOME), a.team(AWAY), seed)


def parse_match_id(match_id: str) -> tuple[str, int]:
    scenario, _, seed = match_id.rpartition("-")
    return scenario, int(seed)
