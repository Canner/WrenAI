from typing import Any

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask_details.components.generator import (
    init_generator,
)
from src.pipelines.ask_details.components.post_processors import (
    init_generation_post_processor,
)
from src.utils import load_env_vars

load_env_vars()


class Generation(BasicPipeline):
    def __init__(
        self,
        sql_details_generator: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("generator", sql_details_generator)
        self._pipeline.add_component("post_processor", init_generation_post_processor())
        self._pipeline.connect("generator.replies", "post_processor.replies")
        self._pipeline.connect("generator.meta", "post_processor.meta")

        super().__init__(self._pipeline)

    def run(self, sql: str):
        return self._pipeline.run(
            {
                "sql_details_generator": {
                    "prompt": sql,
                },
            }
        )


if __name__ == "__main__":
    generation_pipeline = Generation(
        generator=init_generator(),
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask_details...")
    generation_pipeline.draw("./outputs/pipelines/ask_details/generation_pipeline.jpg")
