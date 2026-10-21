"""Thin Azure OpenAI client (works with Microsoft Foundry deployments) returning JSON."""

from __future__ import annotations

import json
from typing import Any

from .config import Settings


class LLMError(Exception):
    pass


class AzureLLM:
    def __init__(self, settings: Settings, timeout: float = 12.0):
        from openai import AzureOpenAI  # imported lazily so offline mode needs no SDK setup

        kwargs: dict[str, Any] = {
            "azure_endpoint": settings.openai_endpoint,
            "api_version": settings.openai_api_version,
            "timeout": timeout,
            "max_retries": 1,
        }
        if settings.openai_key:
            kwargs["api_key"] = settings.openai_key
        else:
            # Keyless: Entra ID via managed identity in Azure, or `az login` locally.
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider

            kwargs["azure_ad_token_provider"] = get_bearer_token_provider(
                DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
        self.client = AzureOpenAI(**kwargs)
        self.deployment = settings.openai_deployment

    def json(self, system: str, user: str, temperature: float = 0.4) -> dict[str, Any]:
        try:
            resp = self.client.chat.completions.create(
                model=self.deployment,
                temperature=temperature,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            )
            return json.loads(resp.choices[0].message.content or "{}")
        except Exception as exc:  # network, quota, content filter, malformed JSON
            raise LLMError(str(exc)) from exc
