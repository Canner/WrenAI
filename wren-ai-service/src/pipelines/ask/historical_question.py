import logging
from typing import List, Optional

from haystack import Document, Pipeline, component

from src.core.document_store_provider import DocumentStoreProvider
from src.core.llm_provider import LLMProvider
from src.core.pipeline import BasicPipeline
from src.utils import (
    init_providers,
    load_env_vars,
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

        pipe.connect("embedder.embedding", "retriever.query_embedding")
        pipe.connect("retriever.documents", "score_filter.documents")

        self._pipeline = pipe
        super().__init__(self._pipeline)

    def run(self, query: str):
        logger.info("Try to extract historical question")
        return self._pipeline.run(
            {
                "embedder": {"text": query},
                "retriever": {"top_k": 1},
                "score_filter": {"score": 0.9},
            }
        )


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Optional[Document]],
    )
    def run(self, documents: List[Document], score: float = 0):
        return {
            "documents": list(
                filter(lambda document: document.score >= score, documents)
            )
        }


if __name__ == "__main__":
    pipeline = HistoricalQuestion(*init_providers())

    print("generating historical_question.jpg to outputs/pipelines/ask...")
    pipeline.draw("./outputs/pipelines/historical_question.jpg")
