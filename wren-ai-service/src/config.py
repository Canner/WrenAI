import logging
from typing import Literal
from pathlib import Path

import yaml
from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings

logger = logging.getLogger("wren-ai-service")


class Settings(BaseSettings):
    """
    Configuration settings for the Wren AI service.

    The settings are loaded in the following order of precedence:
    1. Default values: Defined in the class attributes.
    2. Environment variables: Overrides default values if set.
    3. .env.dev file: Loads additional settings or overrides previous ones.
    4. config.yaml file: Provides the highest priority configuration.

    This hierarchical loading allows for flexible configuration management
    across different environments and deployment scenarios.
    """

    host: str = Field(default="127.0.0.1", alias="WREN_AI_SERVICE_HOST")
    port: int = Field(default=5555, alias="WREN_AI_SERVICE_PORT")

    # indexing and retrieval config
    column_indexing_batch_size: int = Field(default=50)
    table_retrieval_size: int = Field(default=10)
    table_column_retrieval_size: int = Field(default=100)
    enable_column_pruning: bool = Field(default=False)
    historical_question_retrieval_similarity_threshold: float = Field(default=0.9)
    sql_pairs_similarity_threshold: float = Field(default=0.7)
    sql_pairs_retrieval_max_size: int = Field(default=10)
    instructions_similarity_threshold: float = Field(default=0.7)
    instructions_top_k: int = Field(default=10)

    # generation config
    allow_intent_classification: bool = Field(default=True)
    allow_sql_generation_reasoning: bool = Field(default=True)
    allow_sql_functions_retrieval: bool = Field(default=True)
    allow_sql_diagnosis: bool = Field(default=True)
    allow_sql_knowledge_retrieval: bool = Field(default=False)
    max_histories: int = Field(default=5)
    max_sql_correction_retries: int = Field(default=3)

    # engine config
    engine_timeout: float = Field(default=30.0)
    skill_runner_enabled: bool = Field(default=False, alias="SKILL_RUNNER_ENABLED")
    skill_runner_endpoint: str = Field(
        default="http://127.0.0.1:5600",
        alias="SKILL_RUNNER_ENDPOINT",
    )
    skill_runner_timeout: float = Field(
        default=30.0,
        alias="SKILL_RUNNER_TIMEOUT",
    )
    ask_runtime_mode: Literal["legacy", "deepagents"] = Field(
        default="legacy",
        alias="ASK_RUNTIME_MODE",
    )
    ask_shadow_compare_enabled: bool = Field(
        default=False,
        alias="ASK_SHADOW_COMPARE_ENABLED",
    )

    # service config
    query_cache_ttl: int = Field(default=3600)  # unit: seconds
    query_cache_maxsize: int = Field(
        default=1_000_000,
        comment="""
        the maxsize is a necessary parameter to init cache, but we don't want to expose it to the user
        so we set it to 1_000_000, which is a large number
        """,
    )

    # user guide config
    is_oss: bool = Field(default=True)
    doc_endpoint: str = Field(default="https://docs.getwren.ai")

    # langfuse config
    # in order to use langfuse, we also need to set the LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY in the .env or .env.dev file
    langfuse_host: str = Field(default="https://cloud.langfuse.com")
    langfuse_enable: bool = Field(default=True)

    # debug config
    logging_level: str = Field(default="INFO")
    development: bool = Field(default=False)

    # this is used to store the config like type: llm, embedder, etc. and we will process them later
    config_path: str = Field(default="config.yaml", alias="CONFIG_PATH")
    _components: list[dict]

    sql_pairs_path: str = Field(default="sql_pairs.json")

    def __init__(self):
        load_dotenv(".env.dev", override=True)
        super().__init__()
        raw = self.config_loader()
        self.override(raw)
        self._components = [
            component for component in raw if "settings" not in component
        ]

    def config_loader(self):
        candidates = self._resolve_config_candidates()

        for path in candidates:
            try:
                with open(path, "r") as file:
                    return list(yaml.load_all(file, Loader=yaml.SafeLoader))
            except FileNotFoundError:
                continue
            except yaml.YAMLError as e:
                logger.exception(f"Error parsing YAML file {path}: {e}")
                return []

        message = (
            f"Warning: Configuration file {self.config_path} not found. "
            f"Checked: {', '.join(str(path) for path in candidates)}. "
            "Using default settings."
        )
        logger.warning(message)
        return []

    def _resolve_config_candidates(self) -> list[Path]:
        configured = Path(self.config_path)
        candidates: list[Path] = []

        if configured.is_absolute():
            candidates.append(configured)
            return candidates

        repo_root = Path(__file__).resolve().parents[2]
        service_root = Path(__file__).resolve().parents[1]

        for candidate in (
            Path.cwd() / configured,
            service_root / configured,
            repo_root / configured,
            repo_root / "docker" / configured.name,
        ):
            if candidate not in candidates:
                candidates.append(candidate)

        return candidates

    def override(self, raw: list[dict]) -> None:
        override_settings = {}

        for doc in raw:
            if "settings" in doc:
                override_settings = doc["settings"]
                break

        for key, value in override_settings.items():
            if hasattr(self, key):
                setattr(self, key, value)
            else:
                message = f"Warning: Unknown configuration key '{key}' in YAML file."
                logger.warning(message)

    @property
    def components(self) -> list[dict]:
        return self._components


settings = Settings()
