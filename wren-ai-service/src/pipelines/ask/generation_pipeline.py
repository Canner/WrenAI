from typing import Any, List

from haystack import Document, Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.post_processors import init_generation_post_processor
from src.pipelines.ask.components.prompts import init_text_to_sql_prompt_builder
from src.utils import load_env_vars

load_env_vars()


class Generation(BasicPipeline):
    def __init__(
        self,
        generator: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "text_to_sql_prompt_builder",
            init_text_to_sql_prompt_builder(),
        )
        self._pipeline.add_component("text_to_sql_generator", generator)
        self._pipeline.add_component("post_processor", init_generation_post_processor())

        self._pipeline.connect(
            "text_to_sql_prompt_builder.prompt", "text_to_sql_generator.prompt"
        )
        self._pipeline.connect(
            "text_to_sql_generator.replies", "post_processor.replies"
        )
        super().__init__(self._pipeline)

    def run(
        self,
        query: str,
        contexts: List[Document],
    ):
        return self._pipeline.run(
            {
                "text_to_sql_prompt_builder": {
                    "query": query,
                    "documents": contexts,
                },
            }
        )


if __name__ == "__main__":
    generation_pipeline = Generation(
        generator=init_generator(),
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask...")
    generation_pipeline.draw("./outputs/pipelines/ask/generation_pipeline.jpg")
