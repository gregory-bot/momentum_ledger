import os

import pytest

# Tests must be deterministic and offline regardless of the developer's .env.
for key in ("AZURE_OPENAI_ENDPOINT", "AZURE_TRANSLATOR_KEY", "EVENTHUB_CONNECTION", "COSMOS_ENDPOINT"):
    os.environ[key] = ""

from momentum.config import load_settings  # noqa: E402
from momentum.pipeline import MatchPipeline  # noqa: E402
from momentum.simulator import generate_match  # noqa: E402


@pytest.fixture(scope="session")
def match():
    return generate_match(7)


@pytest.fixture(scope="session")
def full_pipeline(match):
    meta, events = match
    p = MatchPipeline(meta)
    for _ in p.run(events):
        pass
    return p


@pytest.fixture
def settings():
    return load_settings()
