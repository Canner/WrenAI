import json
import os
from typing import Any, Dict, List, Optional

from haystack import component

from src.utils import (
    classify_invalid_generation_results,
    clean_generation_result,
    load_env_vars,
)

load_env_vars()


@component
class PostProcessor:
    @component.output_types(
        valid_generation_results=List[Optional[Dict[str, Any]]],
        invalid_generation_results=List[Optional[Dict[str, Any]]],
    )
    def run(self, replies: List[str]):
        try:
            cleaned_generation_result = json.loads(clean_generation_result(replies[0]))

            if isinstance(cleaned_generation_result, dict):
                cleaned_generation_result = [cleaned_generation_result]

            if cleaned_generation_result[0]["sql"] == "":
                return {
                    "valid_generation_results": [],
                    "invalid_generation_results": [],
                }

            (
                valid_generation_results,
                invalid_generation_results,
            ) = classify_invalid_generation_results(
                os.getenv("WREN_ENGINE_ENDPOINT"),
                cleaned_generation_result,
            )

            return {
                "valid_generation_results": valid_generation_results,
                "invalid_generation_results": invalid_generation_results,
            }
        except Exception as e:
            print(f"Error in PostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }


def init_post_processor():
    return PostProcessor()
