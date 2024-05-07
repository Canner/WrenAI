import logging
from typing import Any

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.post_processors import (
    init_query_understanding_post_processor,
)
from src.pipelines.ask.components.prompts import init_query_preprocess_prompt_builder

logger = logging.getLogger("wren-ai-service")


class QueryUnderstanding(BasicPipeline):
    def __init__(
        self,
        generator: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "query_preprocess_prompt_builder",
            init_query_preprocess_prompt_builder(),
        )
        self._pipeline.add_component(
            "query_preprocessor",
            generator,
        )
        self._pipeline.add_component(
            "post_processor",
            init_query_understanding_post_processor(),
        )
        self._pipeline.connect(
            "query_preprocess_prompt_builder.prompt", "query_preprocessor.prompt"
        )
        self._pipeline.connect("query_preprocessor.replies", "post_processor.replies")

        super().__init__(self._pipeline)

    def run(
        self,
        query: str,
    ):
        logger.info("Ask QueryUnderstanding pipeline is running...")
        return self._pipeline.run(
            {
                "query_preprocess_prompt_builder": {
                    "query": query,
                },
            }
        )


if __name__ == "__main__":
    query_understanding_pipeline = QueryUnderstanding(
        generator=init_generator(),
    )

    print("generating query_understanding_pipeline.jpg to outputs/pipelines/ask...")
    query_understanding_pipeline.draw(
        "./outputs/pipelines/ask/query_understanding_pipeline.jpg"
    )
