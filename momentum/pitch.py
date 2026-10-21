"""Pitch geometry and the value models (expected threat, expected goals, defensive lines).

All value functions take attacker-relative coordinates: the team on the ball attacks toward x=105.
"""

from __future__ import annotations

import math

LENGTH, WIDTH = 105.0, 68.0
GOAL_WIDTH = 7.32


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def to_rel(side: str, x: float, y: float) -> tuple[float, float]:
    """Absolute -> attacker-relative for `side`. Self-inverse."""
    return (x, y) if side == "home" else (LENGTH - x, WIDTH - y)


to_abs = to_rel


def xt(x: float, y: float) -> float:
    """Expected threat: the chance that possession at (x, y) ends in a goal soon.

    A smooth parametric surface: it rises sharply near goal and narrows toward the centre,
    which keeps it explainable and cheap enough to evaluate on every event.
    """
    dx = max(LENGTH - x, 0.0)
    dy = abs(y - WIDTH / 2)
    depth = math.exp(-dx / 16.0)
    width = math.exp(-((dy / (10.0 + 0.35 * dx)) ** 2))
    return round(0.004 + 0.42 * depth * width + 0.02 * (x / LENGTH) ** 2, 4)


def shot_angle(x: float, y: float) -> float:
    dx = max(LENGTH - x, 0.5)
    dy = abs(y - WIDTH / 2)
    half = GOAL_WIDTH / 2
    a = math.atan2(GOAL_WIDTH * dx, dx * dx + dy * dy - half * half)
    return a if a >= 0 else a + math.pi


def xg(x: float, y: float) -> float:
    """Expected goals from shot distance and the angle the goal mouth subtends."""
    d = math.hypot(LENGTH - x, y - WIDTH / 2)
    z = -0.6 - 0.12 * d + 1.6 * shot_angle(x, y)
    return round(1 / (1 + math.exp(-z)), 3)


def defensive_lines(block_height: float) -> list[float]:
    """Attacker-relative x of the defending team's three lines, given how high their top line sits."""
    h = clamp(block_height, 25.0, 80.0)
    return [LENGTH - h, LENGTH - 0.62 * h, LENGTH - 0.3 * h]


def lines_broken(start_x: float, end_x: float, block_height: float) -> int:
    return sum(1 for line in defensive_lines(block_height) if start_x < line <= end_x)


def pass_difficulty(length: float, lines: int, pressured: bool, forward: bool) -> int:
    """0-100 rating: long, line-breaking, forward passes under pressure are the hardest."""
    score = 10 + 0.9 * length + 16 * lines + (20 if pressured else 0) + (8 if forward and length > 25 else 0)
    return int(clamp(round(score), 0, 100))


def zone_name(own_x: float) -> str:
    """Describe a defensive action by distance from the defender's own goal."""
    if own_x <= 16.5:
        return "box"
    if own_x <= 35:
        return "defensive_third"
    if own_x <= 70:
        return "midfield"
    return "attacking_third"
