import logging
from typing import Any

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.utils import init_providers, load_env_vars, timer

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

    @timer
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
    llm_provider, document_store_provider = init_providers()

    retrieval_pipeline = Retrieval(
        embedder=llm_provider.get_text_embedder(),
        retriever=document_store_provider.get_retriever(
            document_store=document_store_provider.get_store(),
        ),
    )

    print("generating retrieval_pipeline.jpg to outputs/pipelines/ask...")
    retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
