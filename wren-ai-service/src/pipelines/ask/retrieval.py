import logging
import sys
from typing import Any

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.utils import init_providers, load_env_vars, timer

load_env_vars()
logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return embedder.run(query)


def retrieval(embedding: dict, retriever: Any) -> dict:
    logger.debug(f"embedding: {embedding}")
    return retriever.run(query_embedding=embedding.get("embedding"))


## End of Pipeline


class Retrieval(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        document_store_provider: DocumentStoreProvider,
    ):
        self._embedder = llm_provider.get_text_embedder()
        self._retriever = document_store_provider.get_retriever(
            document_store_provider.get_store()
        )

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @timer
    async def run(self, query: str):
        logger.info("Ask Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["retrieval"],
            inputs={
                "query": query,
                "embedder": self._embedder,
                "retriever": self._retriever,
            },
        )


if __name__ == "__main__":
    llm_provider, document_store_provider = init_providers()
    pipeline = Retrieval(
        llm_provider=llm_provider,
        document_store_provider=document_store_provider,
    )

    async_validate(lambda: pipeline.run("this is a query"))
