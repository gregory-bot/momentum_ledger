"""Core data structures shared by every stage of the pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

HOME, AWAY = "home", "away"


def other(side: str) -> str:
    return AWAY if side == HOME else HOME


def minute_of(t: float) -> int:
    """Broadcast minute: an event at 22:14 happens in the 23rd minute."""
    return int(t // 60) + 1


def clock(t: float) -> str:
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


@dataclass
class Player:
    id: str
    name: str
    number: int
    role: str  # GK, DEF, MID, FWD

    @property
    def surname(self) -> str:
        return self.name.split()[-1]


@dataclass
class Team:
    side: str
    code: str
    name: str
    short: str
    color: str
    players: list[Player]
    bench: list[Player] = field(default_factory=list)

    def all_players(self) -> list[Player]:
        return self.players + self.bench


@dataclass
class MatchMeta:
    match_id: str
    competition: str
    venue: str
    home: Team
    away: Team
    seed: int

    def team(self, side: str) -> Team:
        return self.home if side == HOME else self.away

    def player(self, player_id: str) -> Player | None:
        for team in (self.home, self.away):
            for p in team.all_players():
                if p.id == player_id:
                    return p
        return None

    def side_of(self, player_id: str) -> str | None:
        for team in (self.home, self.away):
            if any(p.id == player_id for p in team.all_players()):
                return team.side
        return None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> MatchMeta:
        def team(td: dict[str, Any]) -> Team:
            return Team(
                side=td["side"], code=td["code"], name=td["name"], short=td["short"], color=td["color"],
                players=[Player(**p) for p in td["players"]],
                bench=[Player(**p) for p in td.get("bench", [])],
            )
        return cls(d["match_id"], d["competition"], d["venue"], team(d["home"]), team(d["away"]), d["seed"])


@dataclass
class Event:
    """One synthetic match event. Coordinates are absolute: home attacks toward x=105."""

    id: str
    match_id: str
    seq: int
    t: float
    period: int
    type: str
    team: str | None = None
    player_id: str | None = None
    x: float | None = None
    y: float | None = None
    end_x: float | None = None
    end_y: float | None = None
    outcome: str | None = None
    receiver_id: str | None = None
    possession: int = 0
    extras: dict[str, Any] = field(default_factory=dict)

    @property
    def minute(self) -> int:
        return minute_of(self.t)

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Event:
        return cls(**d)


@dataclass
class Fact:
    """A single number or name an insight may state, with the query that proves it."""

    key: str
    value: Any
    display: str
    query: dict[str, Any]
    precision: int = 0
    unit: str | None = None


@dataclass
class Insight:
    """A moment worth telling, expressed as verifiable facts rather than prose."""

    id: str
    t: float
    kind: str
    priority: int  # 1 = niche, 2 = notable, 3 = headline
    impact: float
    team: str | None
    player_id: str | None
    entities: list[str]
    facts: dict[str, Fact]
    evidence: list[str]

    @property
    def minute(self) -> int:
        return minute_of(self.t)

    def fact_values(self) -> dict[str, str]:
        return {k: f.display for k, f in self.facts.items()}

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["minute"] = self.minute
        return d


@dataclass(frozen=True)
class Profile:
    """Who is watching. The same verified insight renders differently per profile."""

    persona: str = "casual"  # casual | analyst
    club: str | None = None  # home | away | None
    player_id: str | None = None
    lang: str = "en"

    @property
    def key(self) -> str:
        return f"{self.persona}|{self.club or '-'}|{self.player_id or '-'}|{self.lang}"
