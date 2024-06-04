import asyncio
import functools
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Tuple

from dotenv import load_dotenv

from src.core.provider import DocumentStoreProvider, LLMProvider
from src.providers import loader

logger = logging.getLogger("wren-ai-service")
test_records = []


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
    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    return "dev" if is_dev_env else "prod"


def init_providers() -> Tuple[LLMProvider, DocumentStoreProvider]:
    load_env_vars()

    logger.info("Initializing providers...")
    loader.import_mods()

    llm_provider = loader.get_provider(os.getenv("LLM_PROVIDER", "openai"))
    document_store_provider = loader.get_provider(
        os.getenv("DOCUMENT_STORE_PROVIDER", "qdrant")
    )
    return llm_provider(), document_store_provider()


def timer(func):
    load_env_vars()

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

            test_records.append(
                f"{func.__qualname__} Elapsed time: {elapsed_time:0.4f} seconds"
            )

            if (
                func.__qualname__ == "AskService.get_ask_result"
                and result.status == "finished"
            ):
                if not Path("./outputs").exists():
                    Path("./outputs").mkdir()

                output_file = f"./outputs/test_record_{datetime.now().strftime("%Y%m%d%H%M%S")}.txt"
                with open(output_file, "a") as f:
                    f.write("\n".join(test_records[:-1:]))
                    f.write("\n-----------------------\n")
                    f.write(test_records[-1])

            return result

        return func(*args, **kwargs)

    return wrapper_timer


def async_timer(func):
    load_env_vars()

    async def process(func, *args, **kwargs):
        if asyncio.iscoroutinefunction(func):
            logger.info("this function is a coroutine: {}".format(func.__name__))
            return await func(*args, **kwargs)
        else:
            logger.info("this is not a coroutine")
            return func(*args, **kwargs)

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
