import logging

import yaml
from yaml.loader import SafeLoader

from src.core.engine import Engine
from src.core.pipeline import PipelineComponent
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")
loader.import_mods()


def provider_factory(
    config: dict = {},
) -> LLMProvider | EmbedderProvider | DocumentStoreProvider | Engine:
    return loader.get_provider(config.get("provider"))(**config)


def load_config(path: str = "config.yaml") -> list[dict]:
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
            "embedder": pipe.get("embedding"),
            "document_store": pipe.get("document_store"),
            "engine": pipe.get("engine"),
        }
        for pipe in entry["pipes"]
    }


def convert_data(config: dict) -> dict:
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


def generate_components() -> dict[str, PipelineComponent]:
    config = convert_data(load_config())

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
