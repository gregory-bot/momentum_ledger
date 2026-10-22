"""Fact-check desk: verify any sentence (a pundit's line, a social post, an LLM draft) against
the match ledger at a given minute.

Each clause is checked on its own. Numbers next to a player or club must match one of that
subject's facts; other numbers must match a match-level fact. Claims the ledger can't know
(seasons, records, history) are flagged as out of scope rather than guessed at.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .agents.verifier import OUT_OF_SCOPE, numbers_in
from .ledger import Ledger
from .models import AWAY, HOME, MatchMeta, minute_of

CLAUSE = re.compile(r"[^.;!?\n]+")

STAT_WORDS = {
    "goal": "goals", "scor": "goals", "shot": "shots", "pass": "passes completed", "tackl": "tackles + interceptions",
    "intercept": "tackles + interceptions", "press": "pressures", "possession": "possession %", "ball": "possession %",
    "xg": "xG", "expected": "xG",
}


@dataclass
class Fact:
    subject: str  # a player's or club's name, or "match"
    label: str
    value: float
    display: str


def _facts_at(meta: MatchMeta, ledger: Ledger, t: float) -> list[Fact]:
    q = ledger.evaluate
    out: list[Fact] = [Fact("match", "minute", minute_of(t), str(minute_of(t)))]
    for side in (HOME, AWAY):
        team = meta.team(side)
        add = lambda label, v, p=0: out.append(Fact(team.name, label, round(v, p) if p else round(v),  # noqa: E731
                                                  f"{v:.{p}f}" if p else str(round(v))))
        add("goals", q({"op": "score", "side": side, "t1": t}))
        add("shots", q({"op": "count", "t0": 0, "t1": t, "where": {"type": "shot", "team": side}}))
        add("xG", q({"op": "team_xg", "side": side, "t0": 0, "t1": t}), 2)
        add("passes completed", q({"op": "count", "t0": 0, "t1": t,
                                   "where": {"type": "pass", "team": side, "outcome": "success"}}))
        add("pressures", q({"op": "count", "t0": 0, "t1": t, "where": {"type": "pressure", "team": side}}))
        if t > 60:
            add("possession %", q({"op": "possession_pct", "side": side, "t0": 0, "t1": t}))
        for p in team.all_players():
            padd = lambda label, v, p_=p: out.append(Fact(p_.name, label, v, str(v)))  # noqa: E731
            padd("goals", q({"op": "player_goals", "player_id": p.id, "t1": t}))
            padd("shots", q({"op": "count", "t0": 0, "t1": t, "where": {"type": "shot", "player_id": p.id}}))
            padd("passes completed", q({"op": "count", "t0": 0, "t1": t,
                                        "where": {"type": "pass", "player_id": p.id, "outcome": "success"}}))
            padd("tackles + interceptions", q({"op": "player_def_actions", "player_id": p.id, "t1": t}))
    return out


def _matches(token: str, value: float) -> bool:
    n = float(token.replace(",", "."))
    decimals = len(token.split(".")[1]) if "." in token else 0
    return abs(round(value, decimals) - n) < 1e-9  # "0.9 xG" is a fair rounding of 0.87


def _names(meta: MatchMeta) -> list[tuple[str, str]]:
    out = []
    for team in (meta.home, meta.away):
        out += [(team.name, team.name), (team.short, team.name)]
        for p in team.all_players():
            out += [(p.name, p.name), (p.surname, p.name)]
    return sorted(out, key=lambda x: -len(x[0]))


def fact_check(meta: MatchMeta, ledger: Ledger, minute: float, text: str, lang: str = "en") -> dict[str, Any]:
    t = minute * 60
    facts = _facts_at(meta, ledger, t)
    names = _names(meta)
    claims, mentioned = [], []

    for clause in CLAUSE.findall(text):
        subjects = []
        for pattern, canonical in names:
            if re.search(rf"(?<!\w){re.escape(pattern)}(?!\w)", clause) and canonical not in subjects:
                if not any(canonical != s and pattern in s for s in subjects):
                    subjects.append(canonical)
        mentioned += [s for s in subjects if s not in mentioned]
        # If the clause names a stat ("goals", "shots"...), a number must match *that* stat.
        lowered = clause.lower()
        stats = {label for word, label in STAT_WORDS.items() if re.search(rf"\b{word}", lowered)}
        for token in numbers_in(clause):
            pool = [f for f in facts if f.subject in subjects] if subjects else facts
            if stats:
                pool = [f for f in pool if f.label in stats]
            pool += [f for f in facts if f.subject == "match" and f not in pool]
            hits = [f for f in pool if _matches(token, f.value)]
            claims.append({
                "number": token,
                "clause": clause.strip(),
                "subjects": subjects,
                "supported": bool(hits),
                "matches": [{"subject": f.subject, "label": f.label, "value": f.display} for f in hits[:4]],
            })

    lowered = text.lower()
    scope_hits = sorted({m.group(0) for pat in OUT_OF_SCOPE.get(lang, []) + OUT_OF_SCOPE["en"]
                         for m in [re.search(pat, lowered)] if m})
    unsupported = [c for c in claims if not c["supported"]]
    verdict = "out_of_scope" if scope_hits else ("unsupported" if unsupported else "supported")
    if not claims and not scope_hits:
        verdict = "no_claims"
    return {
        "verdict": verdict,
        "minute": minute_of(t),
        "text": text,
        "claims": claims,
        "names": mentioned,
        "out_of_scope": scope_hits,
        "facts_checked": len(facts),
        "events_in_ledger": sum(1 for e in ledger.events if e.t <= t),
        "summary": {
            "supported": "Every number traces to the match ledger.",
            "unsupported": f"{len(unsupported)} number(s) don't match anything the ledger knows for that subject.",
            "out_of_scope": "Makes claims this match's data can't prove: " + ", ".join(scope_hits) + ".",
            "no_claims": "No checkable numbers in this sentence.",
        }[verdict],
    }
