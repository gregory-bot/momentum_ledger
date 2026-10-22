"""Settings from the environment (or a local .env). Every Azure service is optional: when one
isn't configured, the pipeline degrades to a local equivalent instead of failing."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path = ROOT / ".env") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    openai_endpoint: str | None
    openai_key: str | None
    openai_deployment: str
    openai_api_version: str
    translator_key: str | None
    translator_region: str | None
    translator_endpoint: str
    eventhub_connection: str | None
    eventhub_name: str
    cosmos_endpoint: str | None
    cosmos_key: str | None
    cosmos_database: str
    llm_judge: bool
    inject_faults: bool
    fault_rate: float
    match_seed: int

    @property
    def llm_enabled(self) -> bool:
        return bool(self.openai_endpoint and self.openai_deployment)

    @property
    def translator_enabled(self) -> bool:
        return bool(self.translator_key)

    @property
    def eventhubs_enabled(self) -> bool:
        return bool(self.eventhub_connection)

    @property
    def cosmos_enabled(self) -> bool:
        return bool(self.cosmos_endpoint)

    def describe(self) -> dict[str, str]:
        return {
            "narrator": f"Azure OpenAI ({self.openai_deployment})" if self.llm_enabled else "templates (offline)",
            "translator": "Azure AI Translator" if self.translator_enabled else "templates en/es/sw (offline)",
            "ingest": f"Azure Event Hubs ({self.eventhub_name})" if self.eventhubs_enabled else "local replay",
            "store": "Azure Cosmos DB" if self.cosmos_enabled else "in-memory ledger",
            "verifier": "deterministic + LLM judge" if self.llm_judge and self.llm_enabled else "deterministic",
            "fault_injection": f"on ({self.fault_rate:.0%})" if self.inject_faults else "off",
        }


def load_settings() -> Settings:
    _load_dotenv()
    env = os.getenv
    return Settings(
        openai_endpoint=env("AZURE_OPENAI_ENDPOINT") or None,
        openai_key=env("AZURE_OPENAI_API_KEY") or None,
        openai_deployment=env("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
        openai_api_version=env("AZURE_OPENAI_API_VERSION", "2024-10-21"),
        translator_key=env("AZURE_TRANSLATOR_KEY") or None,
        translator_region=env("AZURE_TRANSLATOR_REGION") or None,
        translator_endpoint=env("AZURE_TRANSLATOR_ENDPOINT", "https://api.cognitive.microsofttranslator.com"),
        eventhub_connection=env("EVENTHUB_CONNECTION") or None,
        eventhub_name=env("EVENTHUB_NAME", "match-events"),
        cosmos_endpoint=env("COSMOS_ENDPOINT") or None,
        cosmos_key=env("COSMOS_KEY") or None,
        cosmos_database=env("COSMOS_DATABASE", "momentum"),
        llm_judge=_flag("VERIFIER_LLM_JUDGE"),
        inject_faults=_flag("DEMO_INJECT_FAULTS", True),
        fault_rate=float(env("DEMO_FAULT_RATE", "0.15")),
        match_seed=int(env("MATCH_SEED", "7")),
    )
