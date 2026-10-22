"""Orchestrator: coordinates the Narrator, Verifier and Translator agents over the shared ledger.

For every (insight, viewer) pair:

    personalize ─► narrate (LLM) ─► verify ──ok──► translate ─► re-verify ──► on air
                      ▲               │                              │
                      └── feedback ◄──┘ (retry once)                 └─ fail: verified source text
                  template narrator ◄── LLM down / still rejected
                  suppress ◄── nothing verifiable

Every step lands in the trust log, which the UI shows as the trust panel.
"""

from __future__ import annotations

import itertools
import threading
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from ..config import Settings
from ..ledger import Ledger
from ..llm import AzureLLM, LLMError
from ..models import Insight, MatchMeta, Profile
from ..moments import fact
from .faults import FaultInjector
from .narrator import Narrator
from .templates import TEMPLATE_LANGS
from .translator import TranslationError, Translator
from .verifier import Verifier

MAX_LLM_ATTEMPTS = 2


@dataclass
class TrustRecord:
    id: int
    insight_id: str
    kind: str
    minute: int
    profile: str
    agent: str  # narrator | template | translator
    attempt: int
    lang: str
    text: str
    status: str  # verified | blocked | error | note
    checks: list[dict[str, Any]] = field(default_factory=list)
    injected: str | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Rendered:
    insight: Insight
    profile: Profile
    text: str | None
    lang: str
    source: str
    trail: list[TrustRecord]
    checks: list[dict[str, Any]] = field(default_factory=list)

    @property
    def on_air(self) -> bool:
        return self.text is not None


class Orchestrator:
    def __init__(self, meta: MatchMeta, ledger: Ledger, settings: Settings, llm: AzureLLM | None = None):
        self.meta = meta
        self.settings = settings
        self.llm = llm
        self.narrator = Narrator(meta, llm)
        self.verifier = Verifier(meta, ledger, llm)
        self.translator = Translator(settings, llm)
        self.faults = FaultInjector(meta, settings.fault_rate) if settings.inject_faults else None
        self._ids = itertools.count(1)
        self._cache: dict[tuple[str, str], Rendered] = {}
        self._lock = threading.Lock()

    # -- personalization ------------------------------------------------------------------------------

    def personalize(self, insight: Insight, profile: Profile) -> Insight:
        if not profile.club:
            return insight
        team = self.meta.team(profile.club)
        viewer = fact("viewer_club", profile.club, {"op": "const", "value": profile.club}, display=team.name)
        return replace(insight, facts={**insight.facts, "viewer_club": viewer},
                       entities=sorted(set(insight.entities) | {team.name}))

    # -- main entry -------------------------------------------------------------------------------------

    def render(self, insight: Insight, profile: Profile) -> Rendered:
        key = (insight.id, profile.key)
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        result = self._render(self.personalize(insight, profile), profile)
        with self._lock:
            self._cache[key] = result
        return result

    def _record(self, trail: list[TrustRecord], insight: Insight, profile: Profile, agent: str, attempt: int,
                lang: str, text: str, status: str, checks: list | None = None, injected: str | None = None,
                note: str = "") -> None:
        trail.append(TrustRecord(next(self._ids), insight.id, insight.kind, insight.minute, profile.key, agent,
                                 attempt, lang, text, status, checks or [], injected, note))

    def _render(self, insight: Insight, profile: Profile) -> Rendered:
        trail: list[TrustRecord] = []
        out: tuple[str, str, str, list] | None = None  # (text, source, lang, checks)
        judge = self.settings.llm_judge

        if self.llm:
            feedback = None
            for attempt in range(1, MAX_LLM_ATTEMPTS + 1):
                try:
                    draft = self.narrator.llm_draft(insight, profile, feedback)
                except LLMError as exc:
                    self._record(trail, insight, profile, "narrator", attempt, "en", "", "error",
                                 note=f"LLM unavailable, handing off to template narrator ({exc.__class__.__name__})")
                    break
                text, injected = self._inject(draft.text, insight, "en", attempt)
                verdict = self.verifier.verify(text, insight, "en", judge)
                self._record(trail, insight, profile, "narrator", attempt, "en", text,
                             "verified" if verdict.ok else "blocked", verdict.to_dict()["checks"], injected)
                if verdict.ok:
                    out = (text, "azure-openai", "en", verdict.to_dict()["checks"])
                    break
                feedback = verdict.issues

        if out is None:
            lang = profile.lang if profile.lang in TEMPLATE_LANGS else "en"
            for attempt in (1, 2):
                draft = self.narrator.template(insight, profile, lang)
                text, injected = self._inject(draft.text, insight, lang, attempt) if not self.llm else (draft.text, None)
                verdict = self.verifier.verify(text, insight, lang)
                self._record(trail, insight, profile, "template", attempt, lang, text,
                             "verified" if verdict.ok else "blocked", verdict.to_dict()["checks"], injected)
                if verdict.ok:
                    out = (text, "template", lang, verdict.to_dict()["checks"])
                    break
                if not injected:
                    break

        if out is None:
            self._record(trail, insight, profile, "orchestrator", 0, profile.lang, "", "note",
                         note="nothing verifiable: insight suppressed, never shown")
            return Rendered(insight, profile, None, profile.lang, "suppressed", trail)

        text, source, lang, checks = out
        if lang != profile.lang:
            text, source, lang, checks = self._translate(insight, profile, trail, out)
        return Rendered(insight, profile, text, lang, source, trail, checks)

    def _translate(self, insight: Insight, profile: Profile, trail: list[TrustRecord],
                   verified: tuple[str, str, str, list]) -> tuple[str, str, str, list]:
        text, source, lang, checks = verified
        if not self.translator.available:
            self._record(trail, insight, profile, "translator", 1, profile.lang, "", "note",
                         note=f"no translation service offline; showing verified {lang} text")
            return verified
        try:
            translated, engine = self.translator.translate(text, profile.lang, insight.entities)
        except TranslationError as exc:
            self._record(trail, insight, profile, "translator", 1, profile.lang, "", "error",
                         note=f"translation failed ({exc}); showing verified {lang} text")
            return verified
        verdict = self.verifier.verify(translated, insight, profile.lang)
        self._record(trail, insight, profile, "translator", 1, profile.lang, translated,
                     "verified" if verdict.ok else "blocked", verdict.to_dict()["checks"], note=engine)
        if verdict.ok:
            return translated, f"{source}+{engine}", profile.lang, verdict.to_dict()["checks"]
        return verified

    def _inject(self, text: str, insight: Insight, lang: str, attempt: int) -> tuple[str, str | None]:
        if self.faults and attempt == 1:
            return self.faults.maybe_corrupt(text, insight, lang)
        return text, None
