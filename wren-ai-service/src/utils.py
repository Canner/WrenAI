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
    enabled = os.getenv("LANGFUSE_ENABLE", "false")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    langfuse_context.configure(
        enabled=False if enabled.lower() == "false" else True,
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
        Any: the result of the decorated function
    """

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        langfuse_context.update_current_trace(
            user_id="developer",  # user id to project id
            session_id="thread-id",  # session id to thread id
            release="",  # ai service version
            metadata={
                "generation_model": "",
                "generation_model_args": {},
                "embedding_model": "",
                "embedding_model_dim": {},
            },
        )

        return await func(*args, **kwargs)

    return wrapper
