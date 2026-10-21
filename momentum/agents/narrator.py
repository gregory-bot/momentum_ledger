"""Narrator agent: writes one overlay line per insight and viewer, grounded in facts.

With Azure OpenAI configured it writes with the LLM, and on any failure it hands off to the
deterministic template narrator. A rejected draft comes back with the verifier's reasons.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..llm import AzureLLM, LLMError
from ..models import Insight, MatchMeta, Profile
from . import templates

SYSTEM = """You write live on-screen graphics for a football broadcast. Write ONE line, max 32 words.

Hard rules (a verifier enforces them, and violations are blocked from air):
- Use ONLY the FACTS given. Every number you write must be copied exactly from a fact's "display".
- Mention only the people and clubs in ENTITIES.
- No claims about seasons, careers, records, history, league position or injuries. You only know this match.
- Explain why the moment matters, not just that it happened.

Audience: {persona_rule}
{club_rule}{player_rule}
Reply as JSON: {{"text": "...", "used_facts": ["fact_key", ...]}}"""

PERSONA_RULES = {
    "casual": "a casual fan. Plain language, vivid, no jargon (avoid 'xT'/'xG'), at most two numbers.",
    "analyst": "a data-hungry analyst. Lead with the tactical meaning, include the key metrics with units.",
}


@dataclass
class Draft:
    text: str
    source: str  # llm | template
    lang: str
    used_facts: list[str]
    note: str = ""


class Narrator:
    def __init__(self, meta: MatchMeta, llm: AzureLLM | None = None):
        self.meta = meta
        self.llm = llm

    def template(self, insight: Insight, profile: Profile, lang: str) -> Draft:
        return Draft(templates.render(insight, profile, lang), "template", lang, list(insight.facts))

    def llm_draft(self, insight: Insight, profile: Profile, feedback: list[str] | None = None) -> Draft:
        if not self.llm:
            raise LLMError("no LLM configured")
        club_rule = ""
        if profile.club and "viewer_club" in insight.facts:
            club_rule = (f"The viewer supports {insight.facts['viewer_club'].display}. Frame it from their side "
                         "(partisan tone is fine, but facts stay exact).\n")
        player_rule = ""
        if profile.player_id:
            p = self.meta.player(profile.player_id)
            if p and p.name in insight.entities:
                player_rule = f"The viewer is following {p.name}; centre the line on them.\n"
        system = SYSTEM.format(persona_rule=PERSONA_RULES.get(profile.persona, PERSONA_RULES["casual"]),
                               club_rule=club_rule, player_rule=player_rule)
        payload = {
            "MOMENT": insight.kind,
            "MATCH_MINUTE": insight.minute,
            "FACTS": {k: {"display": f.display, "unit": f.unit} for k, f in insight.facts.items()},
            "ENTITIES": insight.entities,
        }
        if feedback:
            payload["PREVIOUS_ATTEMPT_REJECTED_BECAUSE"] = feedback
        out = self.llm.json(system, json.dumps(payload, ensure_ascii=False))
        text = str(out.get("text", "")).strip()
        if not text:
            raise LLMError("empty narration")
        return Draft(text, "llm", "en", [k for k in out.get("used_facts", []) if k in insight.facts])
