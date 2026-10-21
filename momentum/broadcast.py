"""Render stage: the Director decides what each viewer sees, when, and in which graphic.

Output is timecoded, machine-readable overlay JSON that a graphics partner can key over a
live feed, plus a live session object that the web server and CLI both drive.
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable

from .agents.orchestrator import Orchestrator, Rendered
from .agents.templates import TEMPLATE_LANGS, render_header
from .config import Settings
from .llm import AzureLLM
from .models import AWAY, HOME, Event, Insight, MatchMeta, Profile, clock, minute_of
from .moments import fact
from .pipeline import MatchPipeline

FPS = 25

GRAPHIC = {
    "goal": "goal_flash", "half_time": "scoreboard_summary", "full_time": "scoreboard_summary",
    "tactical_story": "tactical_panel", "regime_shift": "tactical_panel", "momentum_swing": "momentum_banner",
    "player_card": "player_card", "speed_alert": "player_tag",
}


def timecode(t: float) -> str:
    """SMPTE-style HH:MM:SS:FF on the match clock (kickoff = 00:00:00:00)."""
    frames = int(round(t * FPS))
    s, f = divmod(frames, FPS)
    m, s = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}:{f:02d}"


class Director:
    """Editorial filter: what each profile should see."""

    @staticmethod
    def wants(insight: Insight, profile: Profile) -> bool:
        follows = profile.player_id and profile.player_id in (insight.player_id, *[
            f.value for f in insight.facts.values() if f.key in ("receiver", "assist")])
        if insight.kind == "player_card":
            return insight.player_id == profile.player_id
        if follows:
            return True
        if insight.kind == "speed_alert":
            return profile.persona == "analyst"
        if profile.persona == "analyst":
            return True
        return insight.priority >= 2

    @staticmethod
    def overlay(r: Rendered, latency_ms: float = 0.0) -> dict[str, Any]:
        i, p = r.insight, r.profile
        duration = 10.0 if i.priority >= 3 else 7.0
        if i.kind in ("half_time", "full_time"):
            duration = 15.0
        oid = hashlib.sha1(f"{i.id}|{p.key}".encode()).hexdigest()[:12]
        return {
            "type": "overlay",
            "id": f"ov-{oid}",
            "insight_id": i.id,
            "kind": i.kind,
            "graphic": GRAPHIC.get(i.kind, "lower_third"),
            "priority": i.priority,
            "impact": i.impact,
            "team": i.team,
            "player_id": i.player_id,
            "trigger": {"t": i.t, "match_clock": clock(i.t), "timecode": timecode(i.t), "minute": i.minute},
            "duration_s": duration,
            "profile": {"persona": p.persona, "club": p.club, "player_id": p.player_id, "lang": p.lang},
            "lang": r.lang,
            "text": r.text,
            "source": r.source,
            "data": {k: f.display for k, f in i.facts.items()},
            "evidence": i.evidence,
            "verification": {"status": "verified", "checks": r.checks},
            "latency_ms": round(latency_ms, 1),
        }


class LiveSession:
    """One viewer's live experience: feeds events through the pipeline and renders overlays."""

    def __init__(self, meta: MatchMeta, settings: Settings, profile: Profile, llm: AzureLLM | None = None):
        self.meta = meta
        self.profile = profile
        self.pipeline = MatchPipeline(meta)
        self.orchestrator = Orchestrator(meta, self.pipeline.ledger, settings, llm)

    def feed(self, e: Event) -> list[Insight]:
        return [i for i in self.pipeline.feed(e) if Director.wants(i, self.profile)]

    def render(self, insight: Insight) -> Rendered:
        return self.orchestrator.render(insight, self.profile)

    def seek(self, events: Iterable[Event], t: float) -> None:
        for e in events:
            if e.t > t:
                break
            self.pipeline.feed(e)


def catch_up(session: LiveSession, profile: Profile, max_items: int = 4) -> dict[str, Any]:
    """'I just joined, I support X, give me 30 seconds': the highest-value moments so far,
    told from the viewer's side, not a chronological log."""
    pipe = session.pipeline
    t = pipe.state.t
    pool = [i for i in pipe.insights if i.t <= t]
    goals = [i for i in pool if i.kind == "goal"]
    stories = sorted([i for i in pool if i.kind in ("tactical_story", "regime_shift")],
                     key=lambda i: (i.kind == "tactical_story", i.impact, i.t))
    moments = [i for i in pool if i.kind in ("big_chance", "line_breaking_pass", "danger_removed") and i.priority >= 2]
    club_bias = (lambda i: i.team == profile.club) if profile.club else (lambda i: False)
    moments.sort(key=lambda i: (club_bias(i), i.impact), reverse=True)
    momentum = [i for i in pool if i.kind == "momentum_swing" and t - i.t <= 600][-1:]

    picked = goals[-2:] + stories[-1:] + momentum + moments
    chosen: list[Insight] = []
    for i in picked:
        if i not in chosen and len(chosen) < max_items:
            chosen.append(i)
    chosen.sort(key=lambda i: i.t)

    header_insight = Insight(
        id=f"catchup-{int(t)}", t=t, kind="catchup", priority=3, impact=0.0, team=None, player_id=None,
        entities=[session.meta.home.name, session.meta.away.name],
        facts={f.key: f for f in [
            fact("minute", minute_of(t), {"op": "const", "value": minute_of(t)}),
            fact("score_home", pipe.state.score[HOME], {"op": "score", "side": HOME, "t1": t}),
            fact("score_away", pipe.state.score[AWAY], {"op": "score", "side": AWAY, "t1": t}),
            fact("team_home", HOME, {"op": "const", "value": HOME}, display=session.meta.home.name),
            fact("team_away", AWAY, {"op": "const", "value": AWAY}, display=session.meta.away.name),
        ]},
        evidence=[],
    )
    lang = profile.lang if profile.lang in TEMPLATE_LANGS else "en"
    header = render_header(header_insight, lang)
    verdict = session.orchestrator.verifier.verify(header, header_insight, lang)

    items, trail = [], []
    for i in chosen:
        r = session.orchestrator.render(i, profile)
        trail += [rec.to_dict() for rec in r.trail]
        if r.on_air:
            items.append({"minute": i.minute, "kind": i.kind, "text": r.text, "insight_id": i.id})
    return {
        "type": "catch_up",
        "minute": minute_of(t),
        "header": header if verdict.ok else None,
        "header_verification": verdict.to_dict(),
        "items": items,
        "trust": trail,
    }
