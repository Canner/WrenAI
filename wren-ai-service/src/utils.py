import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import requests
import sqlglot
from dotenv import load_dotenv
from openai import OpenAI

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
    quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]

    logger.debug(f"Original SQL: {sql}")
    logger.debug(f"Quoted SQL: {quoted_sql}")

    return quoted_sql


def classify_invalid_generation_results(
    api_endpoint: str,
    generation_results: List[Dict[str, str]],
) -> List[Optional[Dict[str, str]]]:
    valid_generation_results = []
    invalid_generation_results = []

    for generation_result in generation_results:
        response = requests.get(
            f"{api_endpoint}/v1/mdl/preview",
            json={
                "sql": remove_limit_statement(add_quotes(generation_result["sql"])),
                "limit": 1,
            },
        )
        if response.status_code == 200:
            valid_generation_results.append(generation_result)
        else:
            invalid_generation_results.append(
                {
                    "sql": generation_result["sql"],
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
            "sql": remove_limit_statement(sql),
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


def generate_ddls_from_semantics(
    models: List[Dict[str, Any]],
    relationships: List[Dict[str, Any]],
) -> List[str]:
    ddl_commands = []
    # A map to store model primary keys for foreign key relationships
    primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

    for model in models:
        table_name = model["name"]
        columns_ddl = []
        for column in model["columns"]:
            if "relationship" not in column:
                if column["properties"]:
                    comment = f"-- {json.dumps(column['properties'])}\n  "
                else:
                    comment = ""
                column_name = column["name"]
                column_type = column["type"]
                column_ddl = f"{comment}{column_name} {column_type}"

                # If column is a primary key
                if column_name == model.get("primaryKey", ""):
                    column_ddl += " PRIMARY KEY"

                columns_ddl.append(column_ddl)

        # Add foreign key constraints based on relationships
        for relationship in relationships:
            if (
                table_name == relationship["models"][0]
                and relationship["joinType"].upper() == "MANY_TO_ONE"
            ):
                related_table = relationship["models"][1]
                fk_column = relationship["condition"].split(" = ")[0].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)
            elif (
                table_name == relationship["models"][1]
                and relationship["joinType"].upper() == "ONE_TO_MANY"
            ):
                related_table = relationship["models"][0]
                fk_column = relationship["condition"].split(" = ")[1].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)
            elif (
                table_name in relationship["models"]
                and relationship["joinType"].upper() == "ONE_TO_ONE"
            ):
                index = relationship["models"].index(table_name)
                related_table = [m for m in relationship["models"] if m != table_name][
                    0
                ]
                fk_column = relationship["condition"].split(" = ")[index].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)

        if model["properties"]:
            comment = f"\n/* {json.dumps(model['properties'])} */\n"
        else:
            comment = ""
        create_table_ddl = (
            f"{comment}CREATE TABLE {table_name} (\n  "
            + ",\n  ".join(columns_ddl)
            + "\n);"
        )

        ddl_commands.append(create_table_ddl)

    return ddl_commands


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
