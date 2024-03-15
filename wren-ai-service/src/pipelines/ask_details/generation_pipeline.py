import os
from typing import Any, Optional

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import MODEL_NAME
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import MODEL_NAME, init_generator
from src.pipelines.ask.components.prompts import init_generation_prompt_builder
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation as AskGeneration
from src.pipelines.ask.retrieval_pipeline import Retrieval as AskRetrieval
from src.pipelines.ask_details.components.generator import (
    init_generator,
)
from src.pipelines.ask_details.components.post_processors import (
    init_generation_post_processor,
)
from src.utils import load_env_vars

load_env_vars()

if with_trace := os.getenv("ENABLE_TRACE", default=False):
    from src.pipelines.trace import (
        TraceGenerationInput,
        TraceInput,
        langfuse,
    )


class Generation(BasicPipeline):
    def __init__(
        self,
        sql_details_generator: Any,
        with_trace: bool = False,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("sql_details_generator", sql_details_generator)
        self._pipeline.add_component(
            "sql_details_post_processor", init_generation_post_processor()
        )
        self._pipeline.connect(
            "sql_details_generator.replies", "sql_details_post_processor.inputs"
        )

        self.with_trace = with_trace

        super().__init__(self._pipeline)

    def run(self, sql: str, user_id: Optional[str] = None):
        if self.with_trace:
            trace = langfuse.trace(
                **TraceInput(
                    name="generation",
                    user_id=user_id,
                ).__dict__,
                public=True,
            )

            result = self._pipeline.run(
                {
                    "sql_details_generator": {
                        "trace_generation_input": TraceGenerationInput(
                            trace_id=trace.id,
                            name="generator",
                            input=sql,
                            model=MODEL_NAME,
                        )
                    },
                }
            )

            trace.update(input=sql, output=result["sql_details_generator"])
            return result
        else:
            return self._pipeline.run(
                {
                    "sql_details_generator": {
                        "prompt": sql,
                    },
                }
            )


if __name__ == "__main__":
    generation_pipeline = Generation(
        sql_details_generator=init_generator(),
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask_details...")
    generation_pipeline.draw("./outputs/pipelines/ask_details/generation_pipeline.jpg")
