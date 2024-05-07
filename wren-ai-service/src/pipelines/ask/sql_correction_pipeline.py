import logging
from typing import Any, Dict, List

from haystack import Document, Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import (
    init_generator,
)
from src.pipelines.ask.components.post_processors import init_generation_post_processor
from src.pipelines.ask.components.prompts import (
    TEXT_TO_SQL_RULES,
    init_sql_correction_prompt_builder,
)

logger = logging.getLogger("wren-ai-service")


class SQLCorrection(BasicPipeline):
    def __init__(
        self,
        generator: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "sql_correction_prompt_builder",
            init_sql_correction_prompt_builder(),
        )
        self._pipeline.add_component("sql_correction_generator", generator)
        self._pipeline.add_component("post_processor", init_generation_post_processor())

        self._pipeline.connect(
            "sql_correction_prompt_builder.prompt", "sql_correction_generator.prompt"
        )
        self._pipeline.connect(
            "sql_correction_generator.replies", "post_processor.replies"
        )

        super().__init__(self._pipeline)

    def run(
        self,
        contexts: List[Document],
        invalid_generation_results: List[Dict[str, str]],
    ):
        logger.info("Ask SQLCorrection pipeline is running...")
        return self._pipeline.run(
            {
                "sql_correction_prompt_builder": {
                    "invalid_generation_results": invalid_generation_results,
                    "documents": contexts,
                    "alert": TEXT_TO_SQL_RULES,
                },
            }
        )


if __name__ == "__main__":
    sql_correction_pipeline = SQLCorrection(
        generator=init_generator(),
    )

    print("generating sql_correction_pipeline.jpg to outputs/pipelines/ask...")
    sql_correction_pipeline.draw("./outputs/pipelines/ask/sql_correction_pipeline.jpg")
