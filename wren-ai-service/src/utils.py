import os
import re
from typing import Dict, List, Optional

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
                "sql": generation_result["sql"],
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
