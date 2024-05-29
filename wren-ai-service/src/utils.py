import functools
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests
import sqlglot
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


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return (
        _normalize_whitespace(result)
        .replace("\\n", " ")
        .replace("```sql", "")
        .replace('"""', "")
        .replace("'''", "")
        .replace("```", "")
        .replace(";", "")
    )


def load_env_vars() -> str:
    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    return "dev" if is_dev_env else "prod"


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


def add_quotes(sql: str) -> str:
    logger.debug(f"Original SQL: {sql}")

    quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]

    logger.debug(f"Quoted SQL: {quoted_sql}")

    return quoted_sql


def classify_invalid_generation_results(
    api_endpoint: str,
    generation_results: List[Dict[str, str]],
) -> List[Optional[Dict[str, str]]]:
    valid_generation_results = []
    invalid_generation_results = []

    for generation_result in generation_results:
        quoted_sql = add_quotes(generation_result["sql"])

        response = requests.get(
            f"{api_endpoint}/v1/mdl/preview",
            json={
                "sql": remove_limit_statement(quoted_sql),
                "limit": 1,
            },
        )
        if response.status_code == 200:
            valid_generation_results.append(
                {
                    "sql": quoted_sql,
                    "summary": generation_result["summary"],
                }
            )
        else:
            invalid_generation_results.append(
                {
                    "sql": quoted_sql,
                    "summary": generation_result["summary"],
                    "error": response.json()["message"],
                }
            )

    return valid_generation_results, invalid_generation_results


def check_if_sql_executable(
    api_endpoint: str,
    sql: str,
):
    response = requests.get(
        f"{api_endpoint}/v1/mdl/preview",
        json={
            "sql": remove_limit_statement(add_quotes(sql)),
            "limit": 1,
        },
    )

    if response.status_code != 200:
        logger.debug(f"SQL is not executable: {response.json()}")

    return True if response.status_code == 200 else False


def remove_duplicates(dicts):
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
            value = func(*args, **kwargs)
            endTime = time.perf_counter()
            elapsed_time = endTime - startTime

            test_records.append(
                f"{func.__qualname__} Elapsed time: {elapsed_time:0.4f} seconds"
            )

            if (
                func.__qualname__ == "AskService.get_ask_result"
                and value.status == "finished"
            ):
                if not Path("./outputs").exists():
                    Path("./outputs").mkdir()

                output_file = f"./outputs/test_record_{datetime.now().strftime("%Y%m%d%H%M%S")}.txt"
                with open(output_file, "a") as f:
                    f.write("\n".join(test_records[:-1:]))
                    f.write("\n-----------------------\n")
                    f.write(test_records[-1])

            return value

        return func(*args, **kwargs)

    return wrapper_timer
