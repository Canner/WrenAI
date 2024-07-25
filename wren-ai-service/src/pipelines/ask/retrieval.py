import logging
import sys
from pathlib import Path
from typing import Any, Optional

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.utils import async_timer

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@async_timer
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return await embedder.run(query)


@async_timer
@observe(capture_input=False)
async def retrieval(embedding: dict, user_id: str, retriever: Any) -> dict:
    filters = (
        {
            "operator": "AND",
            "conditions": [
                {"field": "user_id", "operator": "==", "value": user_id},
            ],
        }
        if user_id
        else None
    )

    return await retriever.run(
        query_embedding=embedding.get("embedding"), filters=filters
    )


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
        user_id: Optional[str] = None,
    ) -> None:
        destination = "outputs/pipelines/ask"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["retrieval"],
            output_file_path=f"{destination}/retrieval.dot",
            inputs={
                "query": query,
                "user_id": user_id or "",
                "embedder": self._embedder,
                "retriever": self._retriever,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Ask Retrieval")
    async def run(self, query: str, user_id: Optional[str] = None):
        logger.info("Ask Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["retrieval"],
            inputs={
                "query": query,
                "user_id": user_id or "",
                "embedder": self._embedder,
                "retriever": self._retriever,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.engine import EngineConfig
    from src.core.pipeline import async_validate
    from src.utils import init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    _, embedder_provider, document_store_provider, _ = init_providers(
        engine_config=EngineConfig()
    )
    pipeline = Retrieval(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    pipeline.visualize("this is a query")
    async_validate(lambda: pipeline.run("this is a query"))

    langfuse_context.flush()
