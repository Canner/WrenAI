import logging
import sys
from pathlib import Path
from typing import Any

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.utils import async_timer, init_providers

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@async_timer
async def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return await embedder.run(query)


@async_timer
async def retrieval(embedding: dict, retriever: Any) -> dict:
    return await retriever.run(query_embedding=embedding.get("embedding"))


## End of Pipeline


class Retrieval(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
    ):
        self._embedder = embedder_provider.get_text_embedder()
        self._retriever = document_store_provider.get_retriever(
            document_store_provider.get_store()
        )

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(
        self,
        query: str,
    ) -> None:
        destination = "outputs/pipelines/ask"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["retrieval"],
            output_file_path=f"{destination}/retrieval.dot",
            inputs={
                "query": query,
                "embedder": self._embedder,
                "retriever": self._retriever,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
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
    from src.utils import load_env_vars

    load_env_vars()

    _, embedder_provider, document_store_provider, _ = init_providers()
    pipeline = Retrieval(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    pipeline.visualize("this is a query")
    async_validate(lambda: pipeline.run("this is a query"))
