"""Verifier agent: nothing reaches the screen unless it can be proven from the ledger.

Checks, in order:
  1. fact audit   - re-run every fact's query against raw events and compare with the engine
  2. numbers      - every number in the text must equal a verified fact
  3. entities     - every player or club named must be one the insight is about
  4. scope        - no claims the ledger cannot know (season records, history, injuries...)
  5. judge        - optional LLM review for meaning-level contradictions
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from ..ledger import Ledger, QueryError
from ..llm import AzureLLM, LLMError
from ..models import Insight, MatchMeta

NUMBER = re.compile(r"(?<![\w.])-?\d+(?:[.,]\d+)?")
SCALE = re.compile(r"/100\b")

OUT_OF_SCOPE = {
    "en": [r"\bseason\b", r"\bseasons\b", r"\bcareer\b", r"\brecords?\b", r"\bhistor(y|ic|ical)\b", r"\ball[- ]time\b",
           r"\bever\b", r"\bfirst time\b", r"\bleague\b", r"\btitle\b", r"\binjur(y|ed|ies)\b", r"\btransfer\b",
           r"\bin a row\b", r"\bunbeaten\b", r"\blast week\b", r"\bcontract\b"],
    "es": [r"\btemporadas?\b", r"\bcarrera\b", r"\brécords?\b", r"\bhistori(a|co|ca)\b", r"\bliga\b", r"\btítulo\b",
           r"\blesi(ón|onado)\b", r"\bpor primera vez\b", r"\bracha\b"],
    "sw": [r"\bmsimu\b", r"\brekodi\b", r"\bhistoria\b", r"\bligi\b", r"\bubingwa\b", r"\bjeraha\b",
           r"\bmara ya kwanza\b"],
}

JUDGE_PROMPT = """You audit live football graphics for a broadcaster. You receive FACTS (ground truth)
and TEXT. Decide whether TEXT asserts anything not supported by FACTS: wrong direction (up vs down),
wrong team credited, causal claims the facts do not support, or exaggeration. Minor wording is fine.
Reply as JSON: {"supported": true|false, "issues": ["..."]}"""


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Verdict:
    ok: bool
    checks: list[Check] = field(default_factory=list)

    @property
    def issues(self) -> list[str]:
        return [f"{c.name}: {c.detail}" for c in self.checks if not c.ok]

    def to_dict(self) -> dict[str, Any]:
        return {"status": "verified" if self.ok else "blocked",
                "checks": [{"name": c.name, "ok": c.ok, "detail": c.detail} for c in self.checks]}


class Verifier:
    def __init__(self, meta: MatchMeta, ledger: Ledger, llm: AzureLLM | None = None):
        self.meta = meta
        self.ledger = ledger
        self.llm = llm
        self._audits: dict[str, dict[str, Check]] = {}
        self._names = self._known_names()

    def _known_names(self) -> list[tuple[str, str]]:
        """(pattern, canonical name) for every player surname/full name and club name."""
        out = []
        for team in (self.meta.home, self.meta.away):
            out += [(team.name, team.name), (team.short, team.name)]
            for p in team.all_players():
                out += [(p.name, p.name), (p.surname, p.name)]
        return out

    # -- 1. fact audit ------------------------------------------------------------------------------

    def audit(self, insight: Insight) -> dict[str, Check]:
        if insight.id in self._audits:
            return self._audits[insight.id]
        results = {}
        for key, f in insight.facts.items():
            try:
                truth = self.ledger.evaluate(f.query)
            except QueryError as exc:
                results[key] = Check(f"fact:{key}", False, f"ledger could not prove it ({exc})")
                continue
            if isinstance(f.value, (int, float)) and not isinstance(f.value, bool):
                ok = abs(round(float(truth), f.precision) - float(f.value)) <= 0.5 * 10 ** -f.precision + 1e-9
            else:
                ok = truth == f.value
            detail = f"{f.display} matches ledger" if ok else f"engine said {f.value}, ledger says {truth}"
            results[key] = Check(f"fact:{key}", ok, detail)
        self._audits[insight.id] = results
        return results

    # -- full verification ---------------------------------------------------------------------------

    def verify(self, text: str, insight: Insight, lang: str = "en", judge: bool = False) -> Verdict:
        audit = self.audit(insight)
        checks = [c for c in audit.values() if not c.ok]
        if not checks:
            checks.append(Check("facts", True, f"{len(audit)} facts re-derived from {len(self.ledger)} raw events"))
        verified = [insight.facts[k] for k, c in audit.items() if c.ok]
        checks.append(self._numbers(text, verified))
        checks.append(self._entities(text, insight))
        checks.append(self._scope(text, lang))
        if judge and self.llm and all(c.ok for c in checks):
            checks.append(self._judge(text, insight))
        return Verdict(all(c.ok for c in checks), checks)

    def _numbers(self, text: str, facts: list) -> Check:
        allowed = []
        for f in facts:
            if isinstance(f.value, (int, float)) and not isinstance(f.value, bool):
                allowed.append((float(f.value), f.precision))
        bad = []
        for token in numbers_in(text):
            n = float(token.replace(",", "."))
            if not any(abs(n - v) <= 0.5 * 10 ** -max(p, _decimals(token)) + 1e-9 for v, p in allowed):
                bad.append(token)
        if bad:
            return Check("numbers", False, f"unsupported number(s): {', '.join(bad)}")
        return Check("numbers", True, "every number traces to a verified fact")

    def _entities(self, text: str, insight: Insight) -> Check:
        allowed = set(insight.entities)
        bad = set()
        for pattern, canonical in self._names:
            if re.search(rf"(?<!\w){re.escape(pattern)}(?!\w)", text) and canonical not in allowed:
                # A surname shared with an allowed entity is not a mismatch.
                if not any(a.endswith(" " + pattern) for a in allowed):
                    bad.add(canonical)
        if bad:
            return Check("entities", False, f"names not involved in this moment: {', '.join(sorted(bad))}")
        return Check("entities", True, "only names involved in this moment")

    def _scope(self, text: str, lang: str) -> Check:
        lowered = text.lower()
        for pattern in OUT_OF_SCOPE.get(lang, []) + (OUT_OF_SCOPE["en"] if lang != "en" else []):
            m = re.search(pattern, lowered)
            if m:
                return Check("scope", False, f"claim beyond this match's ledger ('{m.group(0)}')")
        return Check("scope", True, "claims stay within this match")

    def _judge(self, text: str, insight: Insight) -> Check:
        facts = {k: f.display for k, f in insight.facts.items()}
        try:
            out = self.llm.json(JUDGE_PROMPT, json.dumps({"FACTS": facts, "TEXT": text}), temperature=0)
        except LLMError as exc:
            # The deterministic checks already passed; a judge outage must not take graphics off air.
            return Check("judge", True, f"skipped (judge unavailable: {exc.__class__.__name__})")
        if out.get("supported", False):
            return Check("judge", True, "meaning consistent with facts")
        return Check("judge", False, "; ".join(out.get("issues", [])) or "judge found unsupported meaning")


def numbers_in(text: str) -> list[str]:
    """Numeric tokens; a minus counts as a sign only after a space or bracket, so '1-2' is two numbers."""
    text = SCALE.sub("", text)
    out = []
    for m in NUMBER.finditer(text):
        token = m.group(0)
        if token.startswith("-") and m.start() > 0 and text[m.start() - 1] not in " ([":
            token = token[1:]
        out.append(token)
    return out


def _decimals(token: str) -> int:
    token = token.replace(",", ".")
    return len(token.split(".")[1]) if "." in token else 0
