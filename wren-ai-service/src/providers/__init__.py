import logging
import os
from collections.abc import Mapping
from typing import Tuple

import yaml
from yaml.loader import SafeLoader

from src.core.engine import Engine, EngineConfig
from src.core.pipeline import PipelineComponent
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")


def provider_factory(
    config: dict = {},
) -> LLMProvider | EmbedderProvider | DocumentStoreProvider | Engine:
    return loader.get_provider(config.get("provider"))(**config)


def load_config(path: str = "config.yaml") -> list[dict]:
    if not os.path.exists(path):
        return []

    with open(path, "r") as f:
        return list(yaml.load_all(f, Loader=SafeLoader))


def process_llm(entry: dict) -> dict:
    others = {
        k: v
        for k, v in entry.items()
        if k not in ["type", "provider", "api_key", "models"]
    }
    returned = {}
    for model in entry["models"]:
        model_name = f"{entry['provider']}.{model['model']}"
        returned[model_name] = {
            "provider": entry["provider"],
            "api_key": entry["api_key"],
            "kwargs": model["kwargs"],
            **others,
        }
    return returned


def process_embedder(entry: dict) -> dict:
    others = {
        k: v
        for k, v in entry.items()
        if k not in ["type", "provider", "api_key", "models"]
    }
    returned = {}
    for model in entry["models"]:
        model_name = f"{entry['provider']}.{model['model']}"
        returned[model_name] = {
            "provider": entry["provider"],
            "api_key": entry["api_key"],
            "dimension": model["dimension"],
            **others,
        }

    return returned


def process_document_store(entry: dict) -> dict:
    return {entry["provider"]: {k: v for k, v in entry.items() if k not in ["type"]}}


def process_engine(entry: dict) -> dict:
    return {entry["provider"]: {k: v for k, v in entry.items() if k not in ["type"]}}


def process_pipeline(entry: dict) -> dict:
    return {
        pipe["name"]: {
            "llm": pipe.get("llm"),
            "embedder": pipe.get("embedder"),
            "document_store": pipe.get("document_store"),
            "engine": pipe.get("engine"),
        }
        for pipe in entry["pipes"]
    }


def convert_data(config: list[dict]) -> dict:
    returned = {
        "embedder": {},
        "llm": {},
        "document_store": {},
        "engine": {},
        "pipeline": {},
    }

    type_to_processor = {
        "llm": process_llm,
        "embedder": process_embedder,
        "document_store": process_document_store,
        "engine": process_engine,
        "pipeline": process_pipeline,
    }

    for entry in config:
        type = entry["type"]
        processor = type_to_processor.get(type)
        if not processor:
            logger.error(f"Unknown type: {type}")
            raise ValueError(f"Unknown type: {type}")

        converted = processor(entry)
        returned[type].update(converted)

    return returned


def init_providers(
    engine_config: EngineConfig,
) -> Tuple[LLMProvider, EmbedderProvider, DocumentStoreProvider, Engine]:
    logger.info("Initializing providers...")
    loader.import_mods()

    llm_provider = loader.get_provider(os.getenv("LLM_PROVIDER", "openai_llm"))()
    embedder_provider = loader.get_provider(
        os.getenv("EMBEDDER_PROVIDER", "openai_embedder")
    )()
    document_store_provider = loader.get_provider(
        os.getenv("DOCUMENT_STORE_PROVIDER", "qdrant")
    )()
    engine = loader.get_provider(engine_config.provider)(**engine_config.config)

    return llm_provider, embedder_provider, document_store_provider, engine


class Wrapper(Mapping):
    def __init__(self):
        self.value = PipelineComponent(
            *init_providers(
                engine_config=EngineConfig(provider=os.getenv("ENGINE", "wren_ui"))
            )
        )

    def __getitem__(self, key):
        return self.value

    def __repr__(self):
        return f"Wrapper({self.value})"

    def __iter__(self):
        return iter(self.value)

    def __len__(self):
        return len(self.value)


def generate_components() -> dict[str, PipelineComponent]:
    raw = load_config()
    if not raw:
        # if no config, initialize the providers from the environment variables
        return Wrapper()

    config = convert_data(raw)
    loader.import_mods()

    providers = {
        "embedder": config.get("embedder", {}),
        "llm": config.get("llm", {}),
        "document_store": config.get("document_store", {}),
        "engine": config.get("engine", {}),
    }

    instantiated_providers = {
        category: {
            identifier: provider_factory(config)
            for identifier, config in configs.items()
        }
        for category, configs in providers.items()
    }

    def get(type: str, components: dict):
        return instantiated_providers[type].get(components.get(type))

    def componentize(components: dict):
        return PipelineComponent(
            embedder_provider=get("embedder", components),
            llm_provider=get("llm", components),
            document_store_provider=get("document_store", components),
            engine=get("engine", components),
        )

    return {
        pipe_name: componentize(components)
        for pipe_name, components in config.get("pipeline", {}).items()
    }
