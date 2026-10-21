"""Translator agent: carries verified text into any language with Azure AI Translator.

Translation runs *after* verification, and the translated line is verified again (numbers
and names must survive), so every language inherits the grounding of the source.
"""

from __future__ import annotations

import json
import re
import urllib.request
import uuid

from ..config import Settings
from ..llm import AzureLLM, LLMError

LANGUAGES = {
    "en": "English", "es": "Español", "sw": "Kiswahili", "fr": "Français", "pt": "Português",
    "ar": "العربية", "hi": "हिन्दी", "yo": "Yorùbá", "zh-Hans": "中文",
}


class TranslationError(Exception):
    pass


class Translator:
    def __init__(self, settings: Settings, llm: AzureLLM | None = None):
        self.settings = settings
        self.llm = llm

    @property
    def available(self) -> bool:
        return self.settings.translator_enabled or self.llm is not None

    def translate(self, text: str, to: str, protect: list[str]) -> tuple[str, str]:
        """Returns (translated text, engine). Names in `protect` are kept verbatim."""
        if self.settings.translator_enabled:
            return self._azure(text, to, protect), "azure-translator"
        if self.llm:
            return self._llm(text, to, protect), "azure-openai"
        raise TranslationError("no translation service configured")

    def _azure(self, text: str, to: str, protect: list[str]) -> str:
        # Wrap names in notranslate spans so player and club names survive untouched.
        marked = text
        for name in sorted(protect, key=len, reverse=True):
            marked = re.sub(rf"(?<![\w>]){re.escape(name)}(?![\w<])",
                            f'<span class="notranslate">{name}</span>', marked)
        s = self.settings
        url = f"{s.translator_endpoint}/translate?api-version=3.0&from=en&to={to}&textType=html"
        headers = {"Ocp-Apim-Subscription-Key": s.translator_key, "Content-Type": "application/json",
                   "X-ClientTraceId": str(uuid.uuid4())}
        if s.translator_region:
            headers["Ocp-Apim-Subscription-Region"] = s.translator_region
        req = urllib.request.Request(url, json.dumps([{"text": marked}]).encode(), headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                out = json.loads(resp.read())[0]["translations"][0]["text"]
        except Exception as exc:
            raise TranslationError(str(exc)) from exc
        return re.sub(r'<span class="notranslate">(.*?)</span>', r"\1", out)

    def _llm(self, text: str, to: str, protect: list[str]) -> str:
        system = ("Translate the football graphic into the target language. Keep every number, name and "
                  "unit exactly as written. Add nothing. Reply as JSON: {\"text\": \"...\"}")
        try:
            out = self.llm.json(system, json.dumps({"target": LANGUAGES.get(to, to), "text": text,
                                                    "keep_verbatim": protect}, ensure_ascii=False), 0)
        except LLMError as exc:
            raise TranslationError(str(exc)) from exc
        return str(out.get("text", "")).strip() or text
