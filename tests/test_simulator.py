from momentum.models import AWAY, HOME
from momentum.simulator import generate_match


def test_deterministic(match):
    _, a = match
    _, b = generate_match(7)
    assert [e.to_dict() for e in a] == [e.to_dict() for e in b]


def test_storyline_comeback(match):
    _, events = match
    goals = [(e.minute, e.team, e.player_id) for e in events if e.type == "goal"]
    assert [g[1] for g in goals] == [HOME, AWAY, AWAY]
    assert goals[1][2] == goals[2][2] == "R9"
    assert events[-1].type == "full_time"


def test_events_are_football_shaped(match):
    _, events = match
    types = {e.type for e in events}
    assert {"pass", "carry", "shot", "tackle", "interception", "pressure", "possession_change"} <= types
    assert all(0 <= e.x <= 105 and 0 <= e.y <= 68 for e in events if e.x is not None)
    assert [e.t for e in events] == sorted(e.t for e in events)


def test_press_switch_changes_patterns(match):
    """The away side's style change is never emitted, but it must show up in the data."""
    _, events = match
    def pressures(t0, t1):
        return sum(1 for e in events if e.type == "pressure" and e.team == AWAY and t0 <= e.t < t1)
    assert pressures(57 * 60, 75 * 60) > 3 * pressures(30 * 60, 48 * 60)
