# Momentum Ledger · Backend

The Python engine and the HTTP API. See the [root README](../README.md) for the full picture.

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m momentum serve            # http://localhost:8010 · docs at /docs
pytest                              # 39 tests
```

Configuration is optional. Copy `.env.example` to `.env` to enable Azure services. With nothing set, everything runs offline.

## Folders

| Folder | What it is |
|---|---|
| `momentum/` | The engine and API (Python package). |
| `tests/` | pytest suite. |
| `data/` | Sample synthetic match. |
| `functions/` | **Azure Functions** app: the serverless production worker. On each Event Hubs batch it stores events in Cosmos DB, replays the ledger, and writes verified overlays. Reuses `momentum/`, which the deploy script copies in. |
| `infra/` | **Bicep** (infrastructure as code): creates Event Hubs, Cosmos DB, Azure OpenAI, Translator, Functions, Container Apps and App Insights in one command. |
| `scripts/deploy.sh` | Provisions `infra/`, publishes `functions/`, and deploys the web container. Run it from anywhere. |

## Module map

| Module | Responsibility |
|---|---|
| `simulator.py` | Synthetic events. Team styles drive the patterns, and a storyline director fixes goal times. |
| `pitch.py` | Value models: xT surface, xG, defensive lines, pass difficulty. |
| `engine.py` | Incremental game state: event values, momentum, press height, possession, chaos. |
| `ledger.py` | Append-only event store and the query language the verifier uses (independent of `engine.py`). |
| `moments.py` | Turns state into insights made of facts, each with the query that proves it. |
| `pipeline.py` | Feeds events through ledger → engine → detector. |
| `agents/` | Narrator (Azure OpenAI / templates), Verifier, Translator, fault injector, Orchestrator. |
| `broadcast.py` | Director (who sees what), overlay JSON, live sessions, catch-up. |
| `server.py` | FastAPI + SSE. Serves `frontend/dist` when it exists. |
| `azure_io.py` | Event Hubs producer/consumer, Cosmos DB store. |

## Adding an insight type

1. Detect it in `moments.py` and return an `Insight` whose facts each carry a ledger `query`.
2. Add any new query op as `_q_<name>` in `ledger.py`, computed from raw events.
3. Add phrases for `en`, `es` and `sw` in `agents/templates.py`.
4. `pytest`: `test_every_engine_fact_rederives_from_the_ledger` and `test_every_template_line_verifies` will check it end to end.
