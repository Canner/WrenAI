import logging
from typing import Any

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.retriever import init_retriever
from src.utils import load_env_vars

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class Retrieval(BasicPipeline):
    def __init__(
        self,
        embedder: Any,
        retriever: Any,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("embedder", embedder)
        self._pipeline.add_component("retriever", retriever)

        self._pipeline.connect("embedder.embedding", "retriever.query_embedding")

        super().__init__(self._pipeline)

    def run(self, query: str):
        logger.info("Ask Retrieval pipeline is running...")
        return self._pipeline.run(
            {
                "embedder": {
                    "text": query,
                },
            }
        )


if __name__ == "__main__":
    retrieval_pipeline = Retrieval(
        embedder=init_embedder(),
        retriever=init_retriever(
            document_store=init_document_store(),
        ),
    )

    print("generating retrieval_pipeline.jpg to outputs/pipelines/ask...")
    retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
