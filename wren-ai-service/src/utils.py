import os
import re
from typing import Dict, List, Optional

import psycopg2
import requests
from dotenv import load_dotenv


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
    )


def load_env_vars() -> str:
    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    return "dev" if is_dev_env else "prod"


def get_mdl_catalog_and_schema(api_endpoint: str):
    response = requests.get(f"{api_endpoint}/v1/mdl")
    if response.status_code != 200:
        raise Exception(f"Error fetching MDL catalog and schema: {response.text}")

    mdl_json = response.json()

    return mdl_json["catalog"], mdl_json["schema"]


def classify_invalid_generation_results(
    sql_endpoint: str,
    generation_results: List[Dict[str, str]],
) -> List[Optional[Dict[str, str]]]:
    valid_generation_results = []
    invalid_generation_results = []

    conn = psycopg2.connect(dsn=sql_endpoint)

    for generation_result in generation_results:
        try:
            with conn.cursor() as cursor:
                cursor.execute(generation_result["sql"])
            valid_generation_results.append(generation_result)
        except Exception as e:
            invalid_generation_results.append(
                {
                    "sql": generation_result["sql"],
                    "summary": generation_result["summary"],
                    "error": str(e),
                }
            )

    conn.close()

    return valid_generation_results, invalid_generation_results
