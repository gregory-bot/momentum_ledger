"""Scenarios, fact-check desk, MCP server and the prepare endpoint."""

import pytest
from fastapi.testclient import TestClient

from dangote.factcheck import fact_check
from dangote.scenarios import SCENARIOS
from dangote.server import app
from dangote.service import analysis

client = TestClient(app)


@pytest.mark.parametrize("sc, score", [("press-trap", (1, 2)), ("late-show", (2, 0)), ("end-to-end", (3, 3))])
def test_scenarios_play_their_storyline(sc, score):
    a = analysis(sc, next(s.seed for s in SCENARIOS if s.id == sc))
    assert (a.pipeline.state.score["home"], a.pipeline.state.score["away"]) == score
    for i in a.pipeline.insights:  # every fact in every storyline re-derives from the ledger
        for f in i.facts.values():
            truth = a.pipeline.ledger.evaluate(f.query)
            if isinstance(f.value, (int, float)):
                assert abs(round(truth, f.precision) - f.value) <= 0.5 * 10 ** -f.precision + 1e-9
            else:
                assert truth == f.value


@pytest.fixture(scope="module")
def trap():
    return analysis("press-trap", 7)


@pytest.mark.parametrize("text, verdict", [
    ("Malik Otieno has 2 goals.", "supported"),
    ("Callum Shaw has scored 2 goals.", "unsupported"),
    ("Otieno's 4th goal of the season!", "out_of_scope"),
    ("What a match this is.", "no_claims"),
])
def test_fact_check(trap, text, verdict):
    assert fact_check(trap.meta, trap.pipeline.ledger, 90, text)["verdict"] == verdict


def test_fact_check_respects_the_minute(trap):
    # Otieno's second goal comes at 82': before that, "2 goals" is not yet true.
    assert fact_check(trap.meta, trap.pipeline.ledger, 70, "Malik Otieno has 2 goals.")["verdict"] == "unsupported"


def test_prepare_pack():
    d = client.get("/api/matches/prepare", params={"scenario": "late-show", "persona": "analyst"}).json()
    assert d["scenario"]["id"] == "late-show"
    assert d["events"] and d["timeline"] and d["overlays"]
    assert all(o["verification"]["status"] == "verified" for o in d["overlays"])


def test_unknown_scenario_is_404():
    assert client.get("/api/matches/summary", params={"scenario": "nope"}).status_code == 404


def test_mcp_handshake_and_tools():
    init = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).json()
    assert init["result"]["serverInfo"]["name"] == "dangote"
    assert client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
    tools = {t["name"] for t in client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]}
    assert {"fact_check", "match_summary", "query_events", "catch_up"} <= tools
    call = client.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "match_summary", "arguments": {"scenario": "end-to-end"}}}).json()["result"]
    assert call["structuredContent"]["result"]["final_score"] == {"home": 3, "away": 3}
    bad = client.post("/mcp", json={"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "nope"}}).json()
    assert bad["error"]["code"] == -32602


def test_dataset_exports():
    assert client.get("/api/matches/events.jsonl", params={"scenario": "press-trap"}).text.count("\n") > 2000
    assert client.get("/api/matches/insights.csv", params={"scenario": "press-trap"}).text.startswith("id,minute")
    assert "Fully synthetic" in client.get("/api/matches/data-card").text
