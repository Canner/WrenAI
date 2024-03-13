import os
import uuid
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


# this is for quick testing only, please ignore this
if __name__ == "__main__":
    DATASET_NAME = os.getenv("DATASET_NAME")
    document_store = init_document_store()

    retrieval_pipeline = Retrieval(
        embedder=init_embedder(with_trace=with_trace),
        retriever=init_retriever(with_trace=with_trace, document_store=document_store),
        with_trace=with_trace,
    )

    if DATASET_NAME == "book_2":
        query = "How many books are there?"
    elif DATASET_NAME == "baseball_1":
        query = "what is the full name and id of the college with the largest number of baseball players?"
    else:
        query = "random query here..."

    retrieval_result = retrieval_pipeline.run(
        query,
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    print(retrieval_result)

    if with_trace:
        retrieval_pipeline.draw(
            "./outputs/pipelines/ask/retrieval_pipeline_with_trace.jpg"
        )
        langfuse.flush()
    else:
        retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
