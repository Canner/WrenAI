import logging
import os
from pprint import pformat
from typing import Any, Dict, List, Optional

import orjson as json
from haystack import component

from src.utils import (
    add_quotes,
    check_if_sql_executable,
    clean_generation_result,
    load_env_vars,
)

logger = logging.getLogger("wren-ai-service")
load_env_vars()


@component
class GenerationPostProcessor:
    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    def run(self, replies: List[str]) -> Dict[str, Any]:
        cleaned_generation_result = json.loads(clean_generation_result(replies[0]))

        steps = cleaned_generation_result.get("steps", [])
        if not steps:
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        for step in steps:
            step["sql"] = add_quotes(step["sql"])

        sql = _build_cte_query(steps)
        logger.debug(f"GenerationPostProcessor: steps: {pformat(steps)}")
        logger.debug(f"GenerationPostProcessor: final sql: {sql}")

        if not check_if_sql_executable(os.getenv("WREN_ENGINE_ENDPOINT"), sql):
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        # make sure the last step has an empty cte_name
        steps[-1]["cte_name"] = ""

        return {
            "results": {
                "description": cleaned_generation_result["description"],
                "steps": steps,
            },
        }


def _build_cte_query(steps) -> str:
    ctes = ",\n".join(
        f"{step['cte_name']} AS ({step['sql']})" for step in steps if step["cte_name"]
    )

    return f"WITH {ctes}\n" + steps[-1]["sql"] if ctes else steps[-1]["sql"]


def init_generation_post_processor():
    return GenerationPostProcessor()
