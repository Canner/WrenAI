import logging
from typing import List

from haystack import Pipeline

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.utils import init_providers, load_env_vars, timer

load_env_vars()
logger = logging.getLogger("wren-ai-service")


class Retrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
    ):
        self._pipeline = Pipeline()
        self._pipeline.add_component("embedder", llm_provider.get_text_embedder())
        self._pipeline.add_component(
            "retriever",
            document_store_provider.get_retriever(document_store_provider.get_store()),
        )

        self._pipeline.connect("embedder.embedding", "retriever.query_embedding")

        super().__init__(self._pipeline)

    @timer
    def run(self, query: str, include_outputs_from: List[str] | None = None):
        logger.info("Ask Retrieval pipeline is running...")
        return self._pipeline.run(
            {
                "embedder": {
                    "text": query,
                },
            },
            include_outputs_from=(
                set(include_outputs_from) if include_outputs_from else None
            ),
        )


if __name__ == "__main__":
    llm_provider, document_store_provider = init_providers()
    retrieval_pipeline = Retrieval(
        llm_provider=llm_provider,
        document_store_provider=document_store_provider,
    )

    print("generating retrieval_pipeline.jpg to outputs/pipelines/ask...")
    retrieval_pipeline.draw("./outputs/pipelines/ask/retrieval_pipeline.jpg")
