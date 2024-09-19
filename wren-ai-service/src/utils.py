import asyncio
import functools
import logging
import os
import time
from pathlib import Path
from typing import Tuple

from dotenv import load_dotenv
from langfuse.decorators import langfuse_context

from src.core.engine import Engine, EngineConfig
from src.core.provider import DocumentStoreProvider, EmbedderProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")


class CustomFormatter(logging.Formatter):
    grey = "\x1b[38;20m"
    yellow = "\x1b[33;20m"
    red = "\x1b[31;20m"
    bold_red = "\x1b[31;1m"
    reset = "\x1b[0m"
    format = (
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s (%(filename)s:%(lineno)d)"
    )

    FORMATS = {
        logging.DEBUG: yellow + format + reset,
        logging.INFO: grey + format + reset,
        logging.WARNING: yellow + format + reset,
        logging.ERROR: red + format + reset,
        logging.CRITICAL: bold_red + format + reset,
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno)
        formatter = logging.Formatter(log_fmt)
        return formatter.format(record)


def setup_custom_logger(name, level=logging.INFO):
    handler = logging.StreamHandler()
    handler.setFormatter(CustomFormatter())

    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.addHandler(handler)
    return logger


def load_env_vars() -> str:
    if Path(".env.dev").exists():
        load_dotenv(".env.dev", override=True)
        return "dev"

    return "prod"


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


def timer(func):
    @functools.wraps(func)
    def wrapper_timer(*args, **kwargs):
        if os.getenv("ENABLE_TIMER", False):
            startTime = time.perf_counter()
            result = func(*args, **kwargs)
            endTime = time.perf_counter()
            elapsed_time = endTime - startTime

            logger.info(
                f"{func.__qualname__} Elapsed time: {elapsed_time:0.4f} seconds"
            )

            return result

        return func(*args, **kwargs)

    return wrapper_timer


def async_timer(func):
    async def process(func, *args, **kwargs):
        assert asyncio.iscoroutinefunction(func)
        return await func(*args, **kwargs)

    @functools.wraps(func)
    async def wrapper_timer(*args, **kwargs):
        if os.getenv("ENABLE_TIMER", False):
            startTime = time.perf_counter()
            result = await process(func, *args, **kwargs)
            endTime = time.perf_counter()
            elapsed_time = endTime - startTime

            logger.info(
                f"{func.__qualname__} Elapsed time: {elapsed_time:0.4f} seconds"
            )

            return result

        return await process(func, *args, **kwargs)

    return wrapper_timer


def remove_trailing_slash(endpoint: str) -> str:
    return endpoint.rstrip("/") if endpoint.endswith("/") else endpoint


def init_langfuse():
    enabled = bool(os.getenv("LANGFUSE_ENABLE", False))
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    langfuse_context.configure(
        enabled=enabled,
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY", ""),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY", ""),
        host=host,
    )

    logger.info(f"LANGFUSE_ENABLE: {enabled}")
    logger.info(f"LANGFUSE_HOST: {host}")


def trace_metadata(func):
    """
    This decorator is used to add metadata to the current Langfuse trace.
    It should be applied after creating a trace. Here’s an example of how to use it:

    ```python
    @observe(name="Mock")
    @trace_metadata
    async def mock():
        return "Mock"
    ```

    Args:
        func (Callable): the function to decorate

    Returns:
        Callable: the decorated function
    """

    def extract(*args) -> dict:
        request = args[1]  # fix the position of the request object
        metadata = {}

        if hasattr(request, "project_id"):
            metadata["project_id"] = request.project_id
        if hasattr(request, "thread_id"):
            metadata["thread_id"] = request.thread_id
        if hasattr(request, "mdl_hash"):
            metadata["mdl_hash"] = request.mdl_hash
        if hasattr(request, "user_id"):
            metadata["user_id"] = request.user_id

        return metadata

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        results = await func(*args, **kwargs)

        addition = {}
        if isinstance(results, dict):
            additional_metadata = results.get("metadata", {})
            addition.update(additional_metadata)

        metadata = extract(*args)
        service_metadata = kwargs.get(
            "service_metadata",
            {
                "models_metadata": {},
                "service_version": "",
            },
        )
        langfuse_metadata = {
            **service_metadata.get("models_metadata"),
            **addition,
            "mdl_hash": metadata.get("mdl_hash"),
            "project_id": metadata.get("project_id"),
        }
        langfuse_context.update_current_trace(
            user_id=metadata.get("user_id"),
            session_id=metadata.get("thread_id"),
            release=service_metadata.get("service_version"),
            metadata=langfuse_metadata,
        )

        return results

    return wrapper


def remove_sql_summary_duplicates(dicts):
    """
    Removes duplicates from a list of dictionaries based on 'sql' and 'summary' fields.

    Args:
    dicts (list of dict): The list of dictionaries to be deduplicated.

    Returns:
    list of dict: A list of dictionaries after removing duplicates.
    """
    # Convert each dictionary to a tuple of (sql, summary) to make them hashable
    seen = set()
    unique_dicts = []
    for d in dicts:
        identifier = (
            d["sql"],
            d["summary"],
        )  # This assumes 'sql' and 'summary' always exist
        if identifier not in seen:
            seen.add(identifier)
            unique_dicts.append(d)
    return unique_dicts
