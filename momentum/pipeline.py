"""Glue for the analytic half of the pipeline: ingest -> interpret -> detect."""

from __future__ import annotations

from typing import Iterable, Iterator

from .engine import EventValue, GameState
from .ledger import Ledger
from .models import Event, Insight, MatchMeta
from .moments import MomentDetector


class MatchPipeline:
    """Feeds events one at a time. Holds the ledger (truth), state (live metrics) and detector."""

    def __init__(self, meta: MatchMeta):
        self.meta = meta
        self.ledger = Ledger(meta)
        self.state = GameState(meta)
        self.detector = MomentDetector(meta, self.state)
        self.detector.bind(self.ledger.by_id)
        self.insights: list[Insight] = []
        self.values: dict[str, EventValue] = {}

    def feed(self, e: Event) -> list[Insight]:
        if e.id in self.ledger.by_id:
            return []
        found = self.detector.before_event(e)
        self.ledger.append(e)
        v = self.state.apply(e)
        if v:
            self.values[e.id] = v
        found += self.detector.on_event(e, v)
        self.insights += found
        return found

    def run(self, events: Iterable[Event]) -> Iterator[tuple[Event, list[Insight]]]:
        for e in events:
            yield e, self.feed(e)
