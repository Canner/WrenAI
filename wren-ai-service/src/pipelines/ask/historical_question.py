import ast
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import orjson
from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document, component
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider
from src.utils import (
    async_timer,
    timer,
)

logger = logging.getLogger("wren-ai-service")


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(self, documents: List[Document], score: float = 0.8):
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
                "question": content.get("question"),
                "summary": content.get("summary"),
                "statement": content.get("statement"),
                "viewId": content.get("viewId"),
            }
            list.append(formatted)

        return {"documents": list}


## Start of Pipeline
@async_timer
@observe(capture_input=False, capture_output=False)
async def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return await embedder.run(query)


@async_timer
@observe(capture_input=False)
async def retrieval(embedding: dict, retriever: Any) -> dict:
    res = await retriever.run(query_embedding=embedding.get("embedding"))
    return dict(documents=res.get("documents"))


@timer
@observe(capture_input=False)
def filtered_documents(retrieval: dict, score_filter: ScoreFilter) -> dict:
    logger.debug(
        f"retrieval: {orjson.dumps(retrieval, option=orjson.OPT_INDENT_2).decode()}"
    )
    return score_filter.run(documents=retrieval.get("documents"))


@timer
@observe(capture_input=False)
def formatted_output(
    filtered_documents: dict, output_formatter: OutputFormatter
) -> dict:
    logger.debug(
        f"filtered_documents: {orjson.dumps(filtered_documents, option=orjson.OPT_INDENT_2).decode()}"
    )
    return output_formatter.run(documents=filtered_documents.get("documents"))


## End of Pipeline


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        store_provider: DocumentStoreProvider,
    ) -> None:
        self._embedder = embedder_provider.get_text_embedder()
        self._retriever = store_provider.get_retriever(
            document_store=store_provider.get_store(dataset_name="view_questions"),
        )
        self._score_filter = ScoreFilter()
        # todo: add a llm filter to filter out low scoring document
        self._output_formatter = OutputFormatter()

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
            ["formatted_output"],
            output_file_path=f"{destination}/historical_question.dot",
            inputs={
                "query": query,
                "embedder": self._embedder,
                "retriever": self._retriever,
                "score_filter": self._score_filter,
                "output_formatter": self._output_formatter,
            },
            show_legend=True,
            orient="LR",
        )

    @async_timer
    @observe(name="Ask Historical Question")
    async def run(self, query: str):
        logger.info("Ask HistoricalQuestion pipeline is running...")
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "embedder": self._embedder,
                "retriever": self._retriever,
                "score_filter": self._score_filter,
                "output_formatter": self._output_formatter,
            },
        )


if __name__ == "__main__":
    from langfuse.decorators import langfuse_context

    from src.core.pipeline import async_validate
    from src.utils import EngineConfig, init_langfuse, init_providers, load_env_vars

    load_env_vars()
    init_langfuse()

    _, embedder_provider, document_store_provider, _ = init_providers(
        engine_config=EngineConfig(provider="wren_ui", config={})
    )

    pipeline = HistoricalQuestion(
        embedder_provider=embedder_provider, store_provider=document_store_provider
    )

    pipeline.visualize("this is a query")
    async_validate(lambda: pipeline.run("this is a query"))

    langfuse_context.flush()
