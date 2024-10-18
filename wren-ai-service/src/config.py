import logging

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    host: str = Field(default="127.0.0.1", env="WREN_AI_SERVICE_HOST")
    port: int = Field(default=5556, env="WREN_AI_SERVICE_PORT")

    # indexing and retrieval config
    column_indexing_batch_size: int = Field(default=50)
    table_retrieval_size: int = Field(default=10)
    table_column_retrieval_size: int = Field(default=1000)

    # service config
    query_cache_maxsize: int = Field(default=1000)
    query_cache_ttl: int = Field(default=3600)

    # provider api keys
    openai_api_key: str = ""
    azure_openai_api_key: str = ""
    qdrant_api_key: str = ""

    # langfuse config
    langfuse_host: str = Field(default="https://cloud.langfuse.com")
    langfuse_enable: bool = Field(default=True)
    langfuse_secret_key: str = ""
    langfuse_public_key: str = ""

    # debug config
    enable_timer: bool = Field(default=False)
    logging_level: str = Field(default="INFO")
    development: bool = Field(default=False)

    # override from .env.dev file
    model_config = SettingsConfigDict(env_file=".env.dev", extra="allow")

    # this is used to store the config like type: llm, embedder, etc. and we will process them later
    config_path: str = Field(default="config.yaml")
    _configs: list[dict]

    def __init__(self):
        super().__init__()
        raw = self.config_loader()
        self.override(raw)
        self._configs = raw

    def config_loader(self):
        try:
            with open(self.config_path, "r") as file:
                return list(yaml.load_all(file, Loader=yaml.SafeLoader))
        except FileNotFoundError:
            message = f"Warning: Configuration file {self.config_path} not found. Using default settings."
            logger.exception(message)
            return []
        except yaml.YAMLError as e:
            logger.exception(f"Error parsing YAML file: {e}")
            return []

    def override(self, raw: list[dict]) -> None:
        override_settings = {}

        for doc in raw:
            if "settings" in doc:
                override_settings = doc.pop("settings")
                break

        for key, value in override_settings.items():
            if hasattr(self, key):
                setattr(self, key, value)
            else:
                message = f"Warning: Unknown configuration key '{key}' in YAML file."
                logger.warning(message)
