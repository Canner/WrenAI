import logging
import os
from typing import Any, Dict, List, Optional

import orjson as json
from haystack import component

from src.utils import (
    classify_invalid_generation_results,
    clean_generation_result,
    load_env_vars,
)

load_env_vars()
logger = logging.getLogger("wren-ai-service")


@component
class QueryUnderstandingPostProcessor:
    @component.output_types(
        is_valid_query=bool,
    )
    def run(self, replies: List[str]):
        try:
            result = json.loads(replies[0])["result"]

            if result == "yes":
                return {
                    "is_valid_query": True,
                }

            return {
                "is_valid_query": False,
            }
        except Exception as e:
            logger.error(f"Error in QueryUnderstandingPostProcessor: {e}")

            return {
                "is_valid_query": True,
            }


@component
class GenerationPostProcessor:
    @component.output_types(
        valid_generation_results=List[Optional[Dict[str, Any]]],
        invalid_generation_results=List[Optional[Dict[str, Any]]],
    )
    def run(self, replies: List[str]):
        try:
            cleaned_generation_result = json.loads(clean_generation_result(replies[0]))[
                "results"
            ]

            if isinstance(cleaned_generation_result, dict):
                cleaned_generation_result = [cleaned_generation_result]

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
            logger.error(f"Error in GenerationPostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }


def init_query_understanding_post_processor():
    return QueryUnderstandingPostProcessor()


def init_generation_post_processor():
    return GenerationPostProcessor()
