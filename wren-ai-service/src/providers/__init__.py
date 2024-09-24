import logging

from src.core.engine import Engine
from src.core.pipeline import PipelineComponent
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")


def provider_factory(
    type: str, config: dict = {}
) -> LLMProvider | EmbedderProvider | DocumentStoreProvider | Engine:
    # todo: check all provider config
    return loader.get_provider(type)(**config)


def mock_config():
    return {
        "embedder": {
            "openai.demo-embedding-model": {
                "dimension": 3072,
                "api_key": "sk-xxx",
                "api_base": "https://api.openai.com/v1",
            }
        },
        "llm": {
            "openai.gpt-4o-mini": {
                "api_key": "sk-xxx",
                "kwargs": {"temperature": 0.5},
            },
            "azure.gpt-4o-mini": {
                "api_key": "sk-xxx",
                "api_base": "https://api.openai.com/v1",
                "kwargs": {"temperature": 0.5},
                "version": "2020-05-01",
            },
        },
        "document_store": {
            "qdrant": {
                "host": "http://localhost:6333",
                "api_key": None,
            }
        },
    }, {
        "indexing": {
            "embedder": "openai.demo-embedding-model",
            "document_store": "qdrant",
        },
        "sql_generation": {
            "llm": "openai.gpt-4o-mini",
        },
    }


def generate_components() -> dict[str, PipelineComponent]:
    # todo: read from yaml file, this is just an example
    provider_configs, pipelines_conifg = mock_config()

    providers = {
        "embedder": provider_configs.get("embedder", {}),
        "llm": provider_configs.get("llm", {}),
        "document_store": provider_configs.get("document_store", {}),
        "engine": provider_configs.get("engine", {}),
    }

    instantiated_providers = {
        category: {
            type: provider_factory(type, config) for type, config in configs.items()
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
        for pipe_name, components in pipelines_conifg.items()
    }
