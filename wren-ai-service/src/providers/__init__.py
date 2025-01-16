import logging
from dataclasses import dataclass

from src.core.engine import Engine
from src.core.pipeline import PipelineComponent
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")


def provider_factory(
    config: dict = {},
) -> LLMProvider | EmbedderProvider | DocumentStoreProvider | Engine:
    logger.info(f"initializing provider: {config.get('provider')}")
    return loader.get_provider(config.get("provider"))(**config)


def llm_processor(entry: dict) -> dict:
    """
    Process the LLM configuration entry.

    This function takes a dictionary containing LLM configuration and processes it
    into a standardized format. The input dictionary is expected to have the following structure:

    {
        "type": "llm",
        "provider": "openai_llm",
        "models": [
            {
                "model": "gpt-4o-mini",
                "kwargs": {
                    "temperature": 0,
                    "n": 1,
                    "max_tokens": 4096,
                    "response_format": {"type": "json_object"}
                }
            }
        ],
        "api_base": "https://api.openai.com/v1"
    }

    The function processes this input and returns a dictionary with the following structure:

    {
        "openai_llm.gpt-4o-mini": {
            "provider": "openai_llm",
            "model": "gpt-4o-mini",
            "kwargs": {
                "temperature": 0,
                "n": 1,
                "max_tokens": 4096,
                "response_format": {"type": "json_object"}
            },
            "api_base": "https://api.openai.com/v1"
        }
    }

    Args:
        entry (dict): The input LLM configuration dictionary.

    Returns:
        dict: A processed dictionary with standardized LLM configuration.

    Note:
        The function does not handle the `api_key` field. It is to be handled by the provider itself.
    """
    others = {k: v for k, v in entry.items() if k not in ["type", "provider", "models"]}
    returned = {}
    for model in entry.get("models", []):
        model_name = f"{entry.get('provider')}.{model.get('model')}"
        model_additional_params = {
            k: v for k, v in model.items() if k not in ["model", "kwargs"]
        }
        returned[model_name] = {
            "provider": entry["provider"],
            "model": model["model"],
            "kwargs": model["kwargs"],
            **model_additional_params,
            **others,
        }
    return returned


def embedder_processor(entry: dict) -> dict:
    """
    Process the embedder configuration entry.

    This function takes a dictionary containing embedder configuration and processes it
    into a standardized format. The input dictionary is expected to have the following structure:

    {
        "type": "embedder",
        "provider": "openai_embedder",
        "models": [
            {
                "model": "text-embedding-ada-002",
                "dimension": 1536
            }
        ]
    }

    The function processes this input and returns a dictionary with the following structure:

    {
        "openai_embedder.text-embedding-ada-002": {
            "provider": "openai_embedder",
            "model": "text-embedding-ada-002",
            "dimension": 1536
        }
    }

    Args:
        entry (dict): The input embedder configuration dictionary.

    Returns:
        dict: A processed dictionary with standardized embedder configuration.

    Note:
        The function does not handle the `api_key` field. It is to be handled by the provider itself.
    """
    others = {k: v for k, v in entry.items() if k not in ["type", "provider", "models"]}
    returned = {}
    for model in entry["models"]:
        identifier = f"{entry['provider']}.{model['model']}"
        returned[identifier] = {
            "provider": entry["provider"],
            "model": model["model"],
            **others,
        }

    return returned


def document_store_processor(entry: dict) -> dict:
    """
    Process the document store configuration entry.

    This function takes a dictionary containing document store configuration and processes it
    into a standardized format. The input dictionary is expected to have the following structure:

    {
        "type": "document_store",
        "provider": "qdrant",
        "location": "http://localhost:6333",
        "embedding_model_dim": 3072,
        "timeout": 120,
        "recreate_index": False,
    }

    The function processes this input and returns a dictionary with the following structure:

    {
        "qdrant": {
            "provider": "qdrant",
            "location": "http://localhost:6333",
            "embedding_model_dim": 3072,
            "timeout": 120,
            "recreate_index": False,
        }
    }

    Args:
        entry (dict): The input document store configuration dictionary.

    Returns:
        dict: A processed dictionary with standardized document store configuration.

    Note:
        The function does not handle the `api_key` field. It is to be handled by the provider itself.
    """
    return {entry["provider"]: {k: v for k, v in entry.items() if k not in ["type"]}}


def engine_processor(entry: dict) -> dict:
    """
    Process the engine configuration entry.

    This function takes a dictionary containing engine configuration and processes it
    into a standardized format. The input dictionary is expected to have the following structure:

    {
        "type": "engine",
        "provider": "wren_ui",
        "kwargs": {
            "host": "localhost",
            "port": 8000
        }
    }

    The function processes this input and returns a dictionary with the following structure:

    {
        "wren_ui": {
            "provider": "wren_ui",
            "kwargs": {
                "host": "localhost",
                "port": 8000
            }
        }
    }

    Args:
        entry (dict): The input engine configuration dictionary.

    Returns:
        dict: A processed dictionary with standardized engine configuration.
    """
    return {entry["provider"]: {k: v for k, v in entry.items() if k not in ["type"]}}


def pipeline_processor(entry: dict) -> dict:
    """
    Process the pipeline configuration entry.

    This function takes a dictionary containing pipeline configuration and processes it
    into a standardized format. The input dictionary is expected to have the following structure:

    {
        "type": "pipeline",
        "pipes": [
            {
                "name": "indexing",
                "llm": "openai_llm.gpt-4o-mini",
                "embedder": "openai_embedder.text-embedding-3-large",
                "document_store": "qdrant",
                "engine": "wren_ui"
            }
        ]
    }

    The function processes this input and returns a dictionary with the following structure:

    {
        "indexing": {
            "llm": "openai_llm.gpt-4o-mini",
            "embedder": "openai_embedder.text-embedding-3-large",
            "document_store": "qdrant",
            "engine": "wren_ui",
        }
    }

    Args:
        entry (dict): The input pipeline configuration dictionary.

    Returns:
        dict: A processed dictionary with standardized pipeline configuration.
    """
    return {
        pipe["name"]: {
            "llm": pipe.get("llm"),
            "embedder": pipe.get("embedder"),
            "document_store": pipe.get("document_store"),
            "engine": pipe.get("engine"),
        }
        for pipe in entry["pipes"]
    }


@dataclass
class Configuration:
    providers: dict
    pipelines: dict


def transform(config: list[dict]) -> Configuration:
    _TYPE_TO_PROCESSOR = {
        "llm": llm_processor,
        "embedder": embedder_processor,
        "document_store": document_store_processor,
        "engine": engine_processor,
        "pipeline": pipeline_processor,
    }

    returned = {
        "embedder": {},
        "llm": {},
        "document_store": {},
        "engine": {},
        "pipeline": {},
    }

    for entry in config:
        type = entry["type"]
        processor = _TYPE_TO_PROCESSOR.get(type)
        if not processor:
            logger.error(f"Unknown type: {type}")
            raise ValueError(f"Unknown type: {type}")

        converted = processor(entry)
        returned[type].update(converted)

    return Configuration(
        providers={k: v for k, v in returned.items() if k != "pipeline"},
        pipelines=returned["pipeline"],
    )


def generate_components(configs: list[dict]) -> dict[str, PipelineComponent]:
    """
    Generate pipeline components from configuration.

    This function takes a list of configuration dictionaries and generates pipeline components
    based on the provided configurations. The configurations are processed into a standardized
    format and then instantiated into actual provider objects.

    Args:
        configs (list[dict]): A list of configuration dictionaries.

    Returns:
        dict: A dictionary of pipeline components.

    Note:
        instantiated_providers example:
        {
            "embedder": {
                "openai_embedder.text-embedding-3-large": <EmbedderProvider>
            },
            "llm": {
                "openai_llm.gpt-4o-mini": <LLMProvider>
            },
            ...
        }

    """
    loader.import_mods()

    config = transform(configs)

    instantiated_providers = {
        type: {
            identifier: provider_factory(config)
            for identifier, config in configs.items()
        }
        for type, configs in config.providers.items()
    }

    def get(type: str, components: dict, instantiated_providers: dict):
        identifier = components.get(type)
        return instantiated_providers[type].get(identifier)

    def componentize(components: dict, instantiated_providers: dict):
        return PipelineComponent(
            embedder_provider=get("embedder", components, instantiated_providers),
            llm_provider=get("llm", components, instantiated_providers),
            document_store_provider=get(
                "document_store", components, instantiated_providers
            ),
            engine=get("engine", components, instantiated_providers),
        )

    return {
        pipe_name: componentize(components, instantiated_providers)
        for pipe_name, components in config.pipelines.items()
    }
