import functools
import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from langfuse.decorators import langfuse_context

logger = logging.getLogger("wren-ai-service")


class CustomFormatter(logging.Formatter):
    # grey = "\x1b[38;20m"
    # yellow = "\x1b[33;20m"
    # red = "\x1b[31;20m"
    # bold_red = "\x1b[31;1m"
    # reset = "\x1b[0m"
    # format = (
    #     "%(asctime)s - %(name)s - %(levelname)s - %(message)s (%(filename)s:%(lineno)d)"
    # )

    # FORMATS = {
    #     logging.DEBUG: yellow + format + reset,
    #     logging.INFO: grey + format + reset,
    #     logging.WARNING: yellow + format + reset,
    #     logging.ERROR: red + format + reset,
    #     logging.CRITICAL: bold_red + format + reset,
    # }
    logging_format = (
        "{levelname:<.1}{asctime}.{msecs}000 {process} {name}:{lineno}] {message}"
    )
    date_format = "%Y-%m-%d %H:%M:%S"

    def format(self, record):
        formatter = logging.Formatter(
            fmt=self.logging_format, datefmt=self.date_format, style="{"
        )
        return formatter.format(record)


def setup_custom_logger(name, level_str: str):
    level_str = level_str.upper()

    if level_str not in logging._nameToLevel:
        raise ValueError(f"Invalid logging level: {level_str}")

    level = logging._nameToLevel[level_str]

    handler = logging.StreamHandler()
    handler.setFormatter(CustomFormatter())

    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.addHandler(handler)
    return logger


def load_env_vars() -> str:
    # DEPRECATED: This method is deprecated and will be removed in the future
    if Path(".env.dev").exists():
        load_dotenv(".env.dev", override=True)
        return "dev"

    return "prod"


def remove_trailing_slash(endpoint: str) -> str:
    return endpoint.rstrip("/") if endpoint.endswith("/") else endpoint


def init_langfuse():
    from src.config import settings

    langfuse_context.configure(
        enabled=settings.langfuse_enable,
        host=settings.langfuse_host,
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
    )

    logger.info(f"LANGFUSE_ENABLE: {settings.langfuse_enable}")
    logger.info(f"LANGFUSE_HOST: {settings.langfuse_host}")


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
        if hasattr(request, "query"):
            metadata["query"] = request.query

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
                "pipes_metadata": {},
                "service_version": "",
            },
        )
        langfuse_metadata = {
            **service_metadata.get("pipes_metadata"),
            **addition,
            "mdl_hash": metadata.get("mdl_hash"),
            "project_id": metadata.get("project_id"),
            "query": metadata.get("query"),
        }
        langfuse_context.update_current_trace(
            user_id=metadata.get("user_id"),
            session_id=metadata.get("thread_id"),
            release=service_metadata.get("service_version"),
            metadata=langfuse_metadata,
        )

        return results

    return wrapper
