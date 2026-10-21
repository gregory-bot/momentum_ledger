"""Demo-only fault injection: corrupts a share of first drafts the way a real LLM can fail live.

This makes the trust panel show real blocks during a demo even when the narrator behaves.
Every injected fault is labelled in the trust log, so the demo never pretends it was organic.
"""

from __future__ import annotations

import hashlib
import re

from ..models import Insight, MatchMeta

FAULTS = ("invented_history", "wrong_number", "wrong_player")

HISTORY = {
    "en": " That's his 4th goal of the season.",
    "es": " Es su 4º gol de la temporada.",
    "sw": " Hilo ni goli lake la 4 msimu huu.",
}


class FaultInjector:
    def __init__(self, meta: MatchMeta, rate: float):
        self.meta = meta
        self.rate = rate

    def _roll(self, insight: Insight, salt: str) -> float:
        h = hashlib.sha256(f"{insight.id}:{salt}".encode()).hexdigest()
        return int(h[:8], 16) / 0xFFFFFFFF

    def maybe_corrupt(self, text: str, insight: Insight, lang: str) -> tuple[str, str | None]:
        # Goals are always targeted so the headline moment of a demo exercises the verifier.
        if insight.kind != "goal" and self._roll(insight, "fire") >= self.rate:
            return text, None
        order = list(FAULTS)
        start = int(self._roll(insight, "kind") * len(order))
        for kind in order[start:] + order[:start]:
            corrupted = getattr(self, f"_{kind}")(text, insight, lang)
            if corrupted and corrupted != text:
                return corrupted, kind
        return text, None

    def _invented_history(self, text: str, insight: Insight, lang: str) -> str | None:
        if insight.kind != "goal":
            return None
        return text + HISTORY.get(lang, HISTORY["en"])

    def _wrong_number(self, text: str, insight: Insight, lang: str) -> str | None:
        for f in insight.facts.values():
            if not isinstance(f.value, (int, float)) or f.key in ("minute", "since_minute"):
                continue
            pattern = rf"(?<![\d.]){re.escape(f.display)}(?![\d.])"
            if re.search(pattern, text):
                taken = {g.display for g in insight.facts.values()}
                bumped = f.value
                while True:  # a "wrong" number that happens to equal another fact is not a hallucination
                    bumped += 2 if f.precision == 0 else 1.3
                    new = f"{bumped:.{f.precision}f}" if f.precision else str(int(bumped))
                    if new not in taken:
                        return re.sub(pattern, new, text, count=1)
        return None

    def _wrong_player(self, text: str, insight: Insight, lang: str) -> str | None:
        for name in insight.entities:
            pid = _player_id(self.meta, name)
            if not pid or name not in text:
                continue
            for p in self.meta.team(self.meta.side_of(pid)).players:
                if p.name not in insight.entities:
                    return re.sub(re.escape(name), p.name, text, count=1)
        return None


def _player_id(meta: MatchMeta, name: str) -> str | None:
    for team in (meta.home, meta.away):
        for p in team.all_players():
            if p.name == name:
                return p.id
    return None
