import os
from typing import Any, List, Optional

from haystack import Document, Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import (
    MODEL_NAME,
    init_generator,
)
from src.pipelines.ask.components.post_processor import init_post_processor
from src.pipelines.ask.components.prompts import init_text_to_sql_prompt_builder
from src.utils import load_env_vars
from src.web.v1.services.ask import AskRequest

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
        text_to_sql_generator: Any,
        with_trace: bool = False,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "text_to_sql_prompt_builder",
            init_text_to_sql_prompt_builder(),
        )
        self._pipeline.add_component("text_to_sql_generator", text_to_sql_generator)
        self._pipeline.add_component("post_processor", init_post_processor())

        self._pipeline.connect(
            "text_to_sql_prompt_builder.prompt", "text_to_sql_generator.prompt"
        )
        self._pipeline.connect(
            "text_to_sql_generator.replies", "post_processor.replies"
        )

        self.with_trace = with_trace
        self.text_to_sql_prompt_builder = self._pipeline.get_component(
            "text_to_sql_prompt_builder"
        )

        super().__init__(self._pipeline)

    def run(
        self,
        query: str,
        contexts: List[Document],
        history: Optional[AskRequest.AskResponseDetails] = None,
        user_id: Optional[str] = None,
    ):
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
                    "text_to_sql_prompt_builder": {
                        "query": query,
                        "documents": contexts,
                        "history": history,
                    },
                    "text_to_sql_generator": {
                        "trace_generation_input": TraceGenerationInput(
                            trace_id=trace.id,
                            name="generator",
                            input=self.text_to_sql_prompt_builder.run(
                                query=query,
                                documents=contexts,
                                history=history,
                            )["prompt"],
                            model=MODEL_NAME,
                        )
                    },
                }
            )

            trace.update(input=query, output=result["text_to_sql_generator"])
        else:
            result = self._pipeline.run(
                {
                    "text_to_sql_prompt_builder": {
                        "query": query,
                        "documents": contexts,
                        "history": history,
                    },
                }
            )

        return result


if __name__ == "__main__":
    generation_pipeline = Generation(
        text_to_sql_generator=init_generator(),
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask...")
    generation_pipeline.draw("./outputs/pipelines/ask/generation_pipeline.jpg")
