import os
import uuid
from typing import Any, List, Optional

from haystack import Document, Pipeline
from haystack.components.builders.prompt_builder import PromptBuilder

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import (
    MODEL_NAME,
    init_generator,
)
from src.pipelines.ask.components.post_processor import PostProcessor
from src.pipelines.ask.components.prompts import (
    generation_user_prompt_template,
    sql_correction_user_prompt_template,
)
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.retrieval_pipeline import Retrieval
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
        sql_correction_generator: Any,
        with_trace: bool = False,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component(
            "text_to_sql_prompt_builder",
            PromptBuilder(template=generation_user_prompt_template),
        )
        self._pipeline.add_component("text_to_sql_generator", text_to_sql_generator)
        self._pipeline.add_component("post_processor", PostProcessor())
        self._pipeline.add_component(
            "sql_correction_generator", sql_correction_generator
        )
        self._pipeline.add_component(
            "sql_correction_prompt_builder",
            PromptBuilder(template=sql_correction_user_prompt_template),
        )

        self._pipeline.connect(
            "text_to_sql_prompt_builder.prompt", "text_to_sql_generator.prompt"
        )
        self._pipeline.connect(
            "text_to_sql_generator.replies", "post_processor.replies"
        )
        self._pipeline.connect(
            "post_processor.invalid_generation_results",
            "sql_correction_prompt_builder.invalid_generation_results",
        )
        self._pipeline.connect(
            "sql_correction_prompt_builder.prompt", "sql_correction_generator.prompt"
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
                    "sql_correction_prompt_builder": {
                        "documents": contexts,
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
                    "sql_correction_prompt_builder": {
                        "documents": contexts,
                    },
                }
            )

        return result


# this is for quick testing only, please ignore this
if __name__ == "__main__":
    DATASET_NAME = os.getenv("DATASET_NAME")

    document_store = init_document_store()
    embedder = init_embedder(with_trace=with_trace)
    retriever = init_retriever(document_store=document_store, with_trace=with_trace)
    text_to_sql_generator = init_generator(with_trace=with_trace)
    sql_correction_generator = init_generator(with_trace=with_trace)

    retrieval_pipeline = Retrieval(
        embedder=embedder,
        retriever=retriever,
        with_trace=with_trace,
    )

    generation_pipeline = Generation(
        text_to_sql_generator=text_to_sql_generator,
        sql_correction_generator=sql_correction_generator,
        with_trace=with_trace,
    )

    if DATASET_NAME == "book_2":
        query = "How many books are there?"
    elif DATASET_NAME == "college_3":
        query = "Count the number of courses."
    else:
        query = "random query here..."

    retrieval_result = retrieval_pipeline.run(
        query,
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    generation_result = generation_pipeline.run(
        query,
        contexts=retrieval_result["retriever"]["documents"],
        user_id=str(uuid.uuid4()) if with_trace else None,
    )

    print(generation_result)

    # assert AskResultResponse.AskResult(
    #     **generation_result["post_processor"]["results"][0]
    # )

    if with_trace:
        generation_pipeline.draw(
            "./outputs/pipelines/ask/generation_pipeline_with_trace.jpg"
        )
        langfuse.flush()
    else:
        generation_pipeline.draw("./outputs/pipelines/ask/generation_pipeline.jpg")
