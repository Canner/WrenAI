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
        post_processing_results=Optional[Dict[str, Any]],
    )
    def run(self, inputs: List[str]):
        cleaned_generation_result = json.loads(clean_generation_result(inputs[0]))

        steps = cleaned_generation_result.get("steps", [])
        if not steps:
            return {
                "post_processing_results": None,
            }

        sql_with_cte = ""
        for i, step in enumerate(steps):
            if i == len(steps) - 1:
                sql = sql_with_cte + step["sql"]
            else:
                sql = step["sql"]
                sql_with_cte += f'WITH {step["cte_name"]} AS ({sql})\n'

            if not check_if_sql_executable(os.getenv("WREN_ENGINE_ENDPOINT"), sql):
                return {
                    "post_processing_results": None,
                }

        # make sure the last step has an empty cte_name
        cleaned_generation_result["steps"][-1]["cte_name"] = ""

        return {
            "post_processing_results": cleaned_generation_result,
        }


def init_generation_post_processor():
    return GenerationPostProcessor()
