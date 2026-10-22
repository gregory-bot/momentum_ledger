import pytest

from dangote.ledger import Ledger, QueryError
from dangote.pitch import xg, xt


def test_value_models_are_sane():
    assert xt(100, 34) > xt(88, 34) > xt(52, 34) > xt(10, 34)
    assert xt(95, 34) > xt(95, 5)
    assert 0.5 < xg(100, 34) < 0.75
    assert xg(85, 34) < 0.12


def test_every_engine_fact_rederives_from_the_ledger(full_pipeline):
    """The engine (incremental) and ledger (from scratch) are independent code paths; they must agree."""
    p = full_pipeline
    checked = 0
    for insight in p.insights:
        for f in insight.facts.values():
            truth = p.ledger.evaluate(f.query)
            if isinstance(f.value, (int, float)):
                assert abs(round(truth, f.precision) - f.value) <= 0.5 * 10 ** -f.precision + 1e-9, (insight.id, f.key)
            else:
                assert truth == f.value, (insight.id, f.key)
            checked += 1
    assert checked > 500


def test_detects_the_planted_tactical_story(full_pipeline):
    stories = [i for i in full_pipeline.insights if i.kind == "tactical_story" and i.team == "away"]
    assert stories, "the away high press after 56' should be detected from data alone"
    s = stories[0]
    assert 56 <= s.minute <= 68
    assert s.facts["passes_recent"].value < s.facts["passes_before"].value


def test_ledger_is_idempotent(match):
    meta, events = match
    ledger = Ledger(meta, events)
    for e in events[:100]:
        ledger.append(e)
    assert len(ledger) == len(events)


def test_unknown_event_cannot_be_proven(match):
    meta, events = match
    with pytest.raises(QueryError):
        Ledger(meta, events).evaluate({"op": "event_field", "id": "e99999", "field": "x"})
