from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class CacheConfig:
    ttl: int = 60 * 60 * 24 * 30  # 30 days
    maxsize: int = 1000


@dataclass
class HeliconeSingleton:
    api_key: Optional[str] = None
    base_url: Optional[str] = "https://oai.helicone.ai"
    cache_config: Optional[CacheConfig] = None
    _instance: Optional["HeliconeSingleton"] = None

    # New fields for configurable headers
    target_url: Optional[str] = None
    openai_api_base: Optional[str] = None
    request_id: Optional[str] = None
    model_override: Optional[str] = None
    prompt_id: Optional[str] = None
    user_id: Optional[str] = None
    fallbacks: Optional[str] = None
    rate_limit_policy: Optional[str] = None
    session_id: Optional[str] = None
    session_path: Optional[str] = None
    session_name: Optional[str] = None
    posthog_key: Optional[str] = None
    posthog_host: Optional[str] = None
    omit_response: Optional[bool] = None
    omit_request: Optional[bool] = None
    cache_enabled: Optional[bool] = None
    retry_enabled: Optional[bool] = None
    moderations_enabled: Optional[bool] = None
    llm_security_enabled: Optional[bool] = None
    stream_force_format: Optional[bool] = None
    custom_properties: Dict[str, str] = field(default_factory=dict)

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def default_headers(self) -> Dict[str, Any]:
        headers = {"Helicone-Auth": f"Bearer {self.api_key}"}

        if self.target_url:
            headers["Helicone-Target-URL"] = self.target_url
        if self.openai_api_base:
            headers["Helicone-OpenAI-Api-Base"] = self.openai_api_base
        if self.request_id:
            headers["Helicone-Request-Id"] = self.request_id
        if self.model_override:
            headers["Helicone-Model-Override"] = self.model_override
        if self.prompt_id:
            headers["Helicone-Prompt-Id"] = self.prompt_id
        if self.user_id:
            headers["Helicone-User-Id"] = self.user_id
        if self.fallbacks:
            headers["Helicone-Fallbacks"] = self.fallbacks
        if self.rate_limit_policy:
            headers["Helicone-RateLimit-Policy"] = self.rate_limit_policy
        if self.session_id:
            headers["Helicone-Session-Id"] = self.session_id
        if self.session_path:
            headers["Helicone-Session-Path"] = self.session_path
        if self.session_name:
            headers["Helicone-Session-Name"] = self.session_name
        if self.posthog_key:
            headers["Helicone-Posthog-Key"] = self.posthog_key
        if self.posthog_host:
            headers["Helicone-Posthog-Host"] = self.posthog_host

        # Boolean headers
        for header, value in {
            "Helicone-Omit-Response": self.omit_response,
            "Helicone-Omit-Request": self.omit_request,
            "Helicone-Cache-Enabled": (self.cache_enabled and "true")
            or (self.cache_config.maxsize or self.cache_config.ttl and "true"),  # type: ignore
            "Helicone-Retry-Enabled": self.retry_enabled,
            "Helicone-Moderations-Enabled": self.moderations_enabled,
            "Helicone-LLM-Security-Enabled": self.llm_security_enabled,
            "Helicone-Stream-Force-Format": self.stream_force_format,
        }.items():
            if value is not None:
                headers[header] = str(value).lower()

        # Custom properties
        for key, value in self.custom_properties.items():
            headers[f"Helicone-Property-{key}"] = value

        return headers

    @property
    def is_enabled(self):
        return self.api_key is not None


helicone_config = HeliconeSingleton()
