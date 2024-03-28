import os
from typing import Any, Optional

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.retriever import init_retriever
from src.utils import load_env_vars

load_env_vars()

if with_trace := os.getenv("ENABLE_TRACE", default=False):
    from src.pipelines.trace import (
        TraceInput,
        TraceSpanInput,
        langfuse,
    )


class Retrieval(BasicPipeline):
    def __init__(
        self,
        embedder: Any,
        retriever: Any,
        with_trace: bool = False,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("embedder", embedder)
        self._pipeline.add_component("retriever", retriever)

        self._pipeline.connect("embedder.embedding", "retriever.query_embedding")

        self.with_trace = with_trace

        super().__init__(self._pipeline)

    def run(self, query: str, user_id: Optional[str] = None):
        if self.with_trace:
            trace = langfuse.trace(
                **TraceInput(
                    name="retrieval",
                    user_id=user_id,
                ).__dict__,
                public=True,
            )

            result = self._pipeline.run(
                {
                    "embedder": {
                        "trace_span_input": TraceSpanInput(
                            trace_id=trace.id,
                            name="text_embedder",
                            input=query,
                        ),
                        "text": query,
                    },
                    "retriever": {
                        "trace_span_input": TraceSpanInput(
                            trace_id=trace.id,
                            name="retriever",
                            input="text_embedder.embedding",
                        ),
                    },
                }
            )

            trace.update(input=query, output=result["retriever"])
        else:
            result = self._pipeline.run(
                {
                    "embedder": {
                        "text": query,
                    },
                }
            )

        return result


if __name__ == "__main__":
    retrieval_pipeline = Retrieval(
        embedder=init_embedder(),
        retriever=init_retriever(
            document_store=init_document_store(),
        ),
    )

    print("generating retrieval_pipeline.jpg to outputs/pipelines/ask...")
    retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
