import ast
import logging
from typing import Dict, List, Optional

from haystack import Document, Pipeline, component

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.utils import (
    init_providers,
    load_env_vars,
    timer,
)

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self, llm_provider: LLMProvider, store_provider: DocumentStoreProvider
    ) -> None:
        pipe = Pipeline()
        pipe.add_component("embedder", llm_provider.get_text_embedder())
        pipe.add_component(
            "retriever",
            store_provider.get_retriever(
                document_store=store_provider.get_store(dataset_name="view_questions"),
            ),
        )
        pipe.add_component("score_filter", ScoreFilter())
        # todo: add a llm filter to filter out low scoring document
        pipe.add_component("output_formatter", OutputFormatter())

        pipe.connect("embedder.embedding", "retriever.query_embedding")
        pipe.connect("retriever", "score_filter")
        pipe.connect("score_filter", "output_formatter")

        self._pipeline = pipe
        super().__init__(self._pipeline)

    @timer
    def run(self, query: str):
        logger.info("Try to extract historical question")
        return self._pipeline.run(
            {
                "embedder": {"text": query},
                "retriever": {"top_k": 1},
                "score_filter": {"score": 0.8},
            }
        )


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(self, documents: List[Document], score: float = 0):
        return {
            "documents": list(
                filter(lambda document: document.score >= score, documents)
            )
        }


@component
class OutputFormatter:
    @component.output_types(
        documents=List[Optional[Dict]],
    )
    def run(self, documents: List[Document]):
        list = []
        logger.debug(f"historical_question_output_formatter: {documents}")

        for doc in documents:
            content = ast.literal_eval(doc.content)
            formatted = {
                "question": content["question"],
                "description": content["description"],
                "statement": content["statement"],
            }
            list.append(formatted)

        return {"documents": list}


if __name__ == "__main__":
    pipeline = HistoricalQuestion(*init_providers())

    print("generating historical_question.jpg to outputs/pipelines/ask...")
    pipeline.draw("./outputs/pipelines/historical_question.jpg")
