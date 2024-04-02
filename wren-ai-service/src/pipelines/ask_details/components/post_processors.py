import json
import os
from typing import Any, Dict, List, Optional

from haystack import component

from src.utils import (
    check_if_sql_executable,
    clean_generation_result,
    load_env_vars,
)

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
                "replies": replies,
                "results": None,
            }

        sql = _build_cte_query(steps)

        if not check_if_sql_executable(os.getenv("WREN_ENGINE_ENDPOINT"), sql):
            return {
                "replies": replies,
                "results": None,
            }

        # make sure the last step has an empty cte_name
        cleaned_generation_result["steps"][-1]["cte_name"] = ""

        return {
            "replies": replies,
            "results": cleaned_generation_result,
        }


def _build_cte_query(steps) -> str:
    ctes = ",\n".join(
        f"{step['cte_name']} AS ({step['sql']})" for step in steps if step["cte_name"]
    )

    return f"WITH {ctes}\n" + steps[-1]["sql"] if ctes else steps[-1]["sql"]


def init_generation_post_processor():
    return GenerationPostProcessor()
