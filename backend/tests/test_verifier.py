from dataclasses import replace

import pytest

from momentum.agents.templates import TEMPLATE_LANGS, render
from momentum.agents.verifier import Verifier
from momentum.broadcast import Director, LiveSession
from momentum.models import Profile


@pytest.fixture(scope="module")
def verifier(full_pipeline):
    return Verifier(full_pipeline.meta, full_pipeline.ledger)


@pytest.fixture(scope="module")
def goal(full_pipeline):
    return next(i for i in full_pipeline.insights if i.kind == "goal")


def test_clean_line_passes(verifier, goal):
    assert verifier.verify(render(goal, Profile()), goal).ok


@pytest.mark.parametrize("suffix, check", [
    (" His 4th goal of the season.", "numbers"),
    (" A club record.", "scope"),
    (" Brilliant work from Piet Janssen.", "entities"),
])
def test_hallucinations_are_blocked(verifier, goal, suffix, check):
    v = verifier.verify(render(goal, Profile()) + suffix, goal)
    assert not v.ok
    assert check in {c.name for c in v.checks if not c.ok}


def test_wrong_number_is_blocked(verifier, goal):
    text = render(goal, Profile(persona="analyst"))
    bad = text.replace(goal.facts["xg"].display, "0.91")
    assert not verifier.verify(bad, goal).ok


def test_tampered_fact_fails_the_audit(full_pipeline, goal):
    v = Verifier(full_pipeline.meta, full_pipeline.ledger)
    forged = replace(goal, id="forged", facts={**goal.facts, "xg": replace(goal.facts["xg"], value=0.99, display="0.99")})
    verdict = v.verify(render(forged, Profile(persona="analyst")), forged)
    assert not verdict.ok
    assert any(c.name == "fact:xg" and not c.ok for c in verdict.checks)


@pytest.mark.parametrize("lang", TEMPLATE_LANGS)
@pytest.mark.parametrize("persona", ["casual", "analyst"])
@pytest.mark.parametrize("club", [None, "home", "away"])
def test_every_template_line_verifies(full_pipeline, verifier, lang, persona, club):
    """No fault injection: every line the template narrator writes, for every insight, must pass."""
    from momentum.agents.orchestrator import Orchestrator
    from momentum.config import load_settings

    orch = Orchestrator(full_pipeline.meta, full_pipeline.ledger, replace(load_settings(), inject_faults=False))
    profile = Profile(persona, club, None, lang)
    for insight in full_pipeline.insights:
        r = orch.render(insight, profile)
        assert r.on_air, (insight.id, [t.checks for t in r.trail])
        assert r.lang == lang


def test_injected_faults_never_reach_air(match, settings):
    meta, events = match
    session = LiveSession(meta, replace(settings, inject_faults=True, fault_rate=0.5), Profile("analyst"))
    injected = 0
    for e in events:
        for i in session.feed(e):
            r = session.render(i)
            for rec in r.trail:
                if rec.injected:
                    injected += 1
                    assert rec.status == "blocked"
                    assert rec.text != r.text
    assert injected > 10


def test_overlay_is_timecoded_and_machine_readable(match, settings):
    meta, events = match
    session = LiveSession(meta, settings, Profile())
    for e in events:
        found = session.feed(e)
        if any(i.kind == "goal" for i in found):
            o = Director.overlay(session.render(next(i for i in found if i.kind == "goal")))
            break
    assert o["graphic"] == "goal_flash"
    assert o["trigger"]["timecode"].count(":") == 3
    assert o["verification"]["status"] == "verified"
    assert o["evidence"]
