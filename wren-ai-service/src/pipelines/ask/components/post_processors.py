import json
import os
from typing import Any, Dict, List, Optional

from haystack import Document, component

from src.utils import (
    classify_invalid_generation_results,
    clean_generation_result,
    load_env_vars,
)

load_env_vars()


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
            print(f"Error in PostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }


@component
class RetrievalPostProcessor:
    @component.output_types(
        documents=List[Optional[Document]],
    )
    def run(self, documents: List[Document]):
        return {
            "documents": list(filter(lambda document: document.score >= 0.6, documents))
        }


def init_generation_post_processor():
    return GenerationPostProcessor()


def init_retrieval_post_processor():
    return RetrievalPostProcessor()
