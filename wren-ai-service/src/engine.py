import logging
import re
from typing import Dict, List, Optional

import requests
import sqlglot

logger = logging.getLogger("wren-ai-service")


def classify_invalid_generation_results(
    api_endpoint: str,
    generation_results: List[Dict[str, str]],
) -> List[Optional[Dict[str, str]]]:
    valid_generation_results = []
    invalid_generation_results = []

    for generation_result in generation_results:
        quoted_sql = add_quotes(generation_result["sql"])

        response = requests.get(
            f"{api_endpoint}/v1/mdl/dry-run",
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
        f"{api_endpoint}/v1/mdl/dry-run",
        json={
            "sql": remove_limit_statement(add_quotes(sql)),
            "limit": 1,
        },
    )

    if response.status_code != 200:
        logger.debug(f"SQL is not executable: {response.json()}")

    return True if response.status_code == 200 else False


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


def remove_limit_statement(sql: str) -> str:
    pattern = r"\s*LIMIT\s+\d+(\s*;?\s*--.*|\s*;?\s*)$"
    modified_sql = re.sub(pattern, "", sql, flags=re.IGNORECASE)

    return modified_sql


def add_quotes(sql: str) -> str:
    logger.debug(f"Original SQL: {sql}")

    quoted_sql = sqlglot.transpile(sql, read="trino", identify=True)[0]

    logger.debug(f"Quoted SQL: {quoted_sql}")

    return quoted_sql
