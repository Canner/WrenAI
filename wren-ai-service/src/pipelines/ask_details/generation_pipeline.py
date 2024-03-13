import json
import os
import uuid
from typing import Any, Optional

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import MODEL_NAME, init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation as AskGeneration
from src.pipelines.ask.retrieval_pipeline import Retrieval as AskRetrieval
from src.pipelines.ask_details.components.generator import (
    init_generator as init_ask_details_generator,
)
from src.utils import clean_generation_result, load_env_vars
from src.web.v1.services.ask import AskResultResponse
from src.web.v1.services.ask_details import AskDetailsResultResponse

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


# this is for quick testing only, please ignore this
if __name__ == "__main__":
    DATASET_NAME = os.getenv("DATASET_NAME")

    document_store = init_document_store()
    embedder = init_embedder(with_trace=with_trace)
    retriever = init_retriever(with_trace=with_trace, document_store=document_store)
    ask_generator = init_generator(with_trace=with_trace)
    ask_details_generator = init_ask_details_generator(with_trace=with_trace)

    ask_retrieval_pipeline = AskRetrieval(
        embedder=embedder,
        retriever=retriever,
        with_trace=with_trace,
    )
    ask_generation_pipeline = AskGeneration(
        generator=ask_generator,
        with_trace=with_trace,
    )

    if DATASET_NAME == "book_2":
        query = "Show the title and publication dates of books."
    elif DATASET_NAME == "baseball_1":
        query = "what is the full name and id of the college with the largest number of baseball players?"
    else:
        query = "random query here..."

    retrieval_result = ask_retrieval_pipeline.run(
        query,
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    ask_generation_result = ask_generation_pipeline.run(
        query,
        contexts=retrieval_result["retriever"]["documents"],
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    cleaned_ask_generation_result = json.loads(
        clean_generation_result(ask_generation_result["generator"]["replies"][0])
    )
    print(f"cleaned_ask_generation_result: {cleaned_ask_generation_result}")
    assert AskResultResponse.AskResult(**cleaned_ask_generation_result)

    generation_pipeline = Generation(
        generator=ask_details_generator,
        with_trace=with_trace,
    )

    generation_result = generation_pipeline.run(
        cleaned_ask_generation_result["sql"],
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    cleaned_generation_result = json.loads(
        clean_generation_result(generation_result["generator"]["replies"][0])
    )
    print(f"cleaned_generation_result: {cleaned_generation_result}")
    assert AskDetailsResultResponse.AskDetailsResponseDetails(
        **cleaned_generation_result
    )

    if with_trace:
        generation_pipeline.draw(
            "./outputs/pipelines/ask_details/generation_pipeline_with_trace.jpg"
        )
        langfuse.flush()
    else:
        generation_pipeline.draw(
            "./outputs/pipelines/ask_details/generation_pipeline.jpg"
        )
