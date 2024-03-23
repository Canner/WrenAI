import os
from typing import Any, Optional

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.generator import MODEL_NAME
from src.pipelines.ask_details.components.generator import (
    init_generator as init_ask_details_generator,
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
        generator: Any,
        with_trace: bool = False,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("generator", generator)

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
                    "generator": {
                        "trace_generation_input": TraceGenerationInput(
                            trace_id=trace.id,
                            name="generator",
                            input=sql,
                            model=MODEL_NAME,
                        )
                    },
                }
            )

            trace.update(input=sql, output=result["generator"])
            return result
        else:
            return self._pipeline.run(
                {
                    "generator": {
                        "prompt": sql,
                    },
                }
            )


if __name__ == "__main__":
    generation_pipeline = Generation(
        generator=init_ask_details_generator(),
    )

    print("generating generation_pipeline.jpg to outputs/pipelines/ask_details...")
    generation_pipeline.draw("./outputs/pipelines/ask_details/generation_pipeline.jpg")
