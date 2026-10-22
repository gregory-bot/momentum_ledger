# Dangote · Backend

The Python engine, the HTTP API and the MCP server. See the [root README](../README.md) for the full picture.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m dangote serve            # http://localhost:8010 · OpenAPI at /docs · MCP at POST /mcp
pytest                             # 51 tests
```

Configuration is optional: copy `.env.example` to `.env` to enable Azure services. With nothing set, everything runs offline.

## Folders

| Folder | What it is |
|---|---|
| `dangote/` | The engine, API and MCP server (Python package). |
| `tests/` | pytest suite. |
| `data/` | The three storylines as JSON (`python -m dangote simulate --scenario <id>`). |
| `functions/` | **Azure Functions** app: the serverless production worker. On each Event Hubs batch it stores events in Cosmos DB, replays the ledger and writes verified overlays. The deploy script copies `dangote/` in. |
| `infra/` | **Bicep**: Event Hubs, Cosmos DB, Azure OpenAI, Translator, Functions, Container Apps and App Insights in one command. |
| `scripts/deploy.sh` | Provisions `infra/`, publishes `functions/` and deploys the container. |

## Module map

| Module | Responsibility |
|---|---|
| `simulator.py` | Seeded events; team styles drive the patterns, a storyline director fixes goal times. |
| `scenarios.py` | The storylines and the fictional clubs. |
| `pitch.py` | Value models: xT surface, xG, defensive lines, pass difficulty. |
| `engine.py` | Incremental game state: event values, momentum, press height, possession, chaos. |
| `ledger.py` | Append-only event store and the query language the verifier uses (independent of `engine.py`). |
| `moments.py` | Turns state into insights made of facts, each with the query that proves it. |
| `agents/` | Narrator (Azure OpenAI / templates), Verifier, Translator, fault injector, Orchestrator. |
| `broadcast.py` | Director (who sees what), overlay JSON, live sessions, catch-up. |
| `service.py` | One cached service layer behind REST, MCP and the web app. |
| `factcheck.py` | Fact-check any sentence against the ledger at a minute. |
| `mcp.py` | MCP server: 9 tools over Streamable HTTP. |
| `server.py` | FastAPI app; serves `frontend/dist` when it exists. |

## Adding a storyline

Add a `Scenario` to `SCENARIOS` in `scenarios.py` (clubs, style phases, goal times, subs). The test
`test_scenarios_play_their_storyline` checks the score and that every fact re-derives from the ledger.
