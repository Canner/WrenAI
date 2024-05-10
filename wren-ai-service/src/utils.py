import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
import sqlglot
from dotenv import load_dotenv
from haystack.utils.auth import Secret
from openai import OpenAI

from src.core.document_store_provider import DocumentStoreProvider
from src.core.llm_provider import LLMProvider
from src.providers.document_store.qdrant import QdrantProvider
from src.providers.llm.openai import OpenAILLMProvider

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
    def _verify_env_vars() -> None:
        """
        this is a temporary solution to verify that the required environment variables are set
        """
        OpenAI().models.list()

    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    _verify_env_vars()
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

    return True if response.status_code == 200 else False


def generate_semantics(mdl_str: str) -> Dict[str, Any]:
    mdl_json = json.loads(mdl_str)

    for i, _ in enumerate(mdl_json["relationships"]):
        mdl_json["relationships"][i]["type"] = "relationship"

    semantics = {"models": [], "relationships": mdl_json["relationships"]}

    for model in mdl_json["models"]:
        columns = []
        for column in model["columns"]:
            if "relationship" in column:
                columns.append(
                    {
                        "name": column["name"],
                        "properties": column["properties"],
                        "type": column["type"],
                        "relationship": column["relationship"],
                    }
                )
            else:
                columns.append(
                    {
                        "name": column["name"],
                        "properties": column["properties"],
                        "type": column["type"],
                    }
                )

        semantics["models"].append(
            {
                "type": "model",
                "name": model["name"],
                "properties": model["properties"],
                "columns": columns,
                "primaryKey": model["primaryKey"],
            }
        )
    return semantics


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

    llm_provider = OpenAILLMProvider(
        api_key=Secret.from_env_var("OPENAI_API_KEY"),
    )
    document_store_provider = QdrantProvider(
        location=os.getenv("QDRANT_HOST"),
    )
    return llm_provider, document_store_provider
