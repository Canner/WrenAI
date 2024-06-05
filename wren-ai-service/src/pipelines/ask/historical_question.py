import ast
import logging
import sys
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.experimental.h_async import AsyncDriver
from haystack import Document, component

from src.core.pipeline import BasicPipeline, async_validate
from src.core.provider import DocumentStoreProvider, LLMProvider
from src.utils import (
    async_timer,
    init_providers,
    load_env_vars,
    timer,
)

load_env_vars()
logger = logging.getLogger("wren-ai-service")


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
                "question": content.get("question"),
                "summary": content.get("summary"),
                "statement": content.get("statement"),
                "viewId": content.get("viewId"),
            }
            list.append(formatted)

        return {"documents": list}


## Start of Pipeline
@async_timer
async def embedding(query: str, embedder: Any) -> dict:
    logger.debug(f"query: {query}")
    return await embedder.run(query)


@async_timer
async def retrieval(embedding: dict, retriever: Any) -> dict:
    res = await retriever.run(query_embedding=embedding.get("embedding"))
    documents = res.get("documents")
    return dict(documents=documents)


@timer
def filtered_documents(retrieval: dict, score_filter: ScoreFilter) -> dict:
    logger.debug(f"retrieval: {retrieval}")
    return score_filter.run(documents=retrieval.get("documents"))


@timer
def formatted_output(
    filtered_documents: dict, output_formatter: OutputFormatter
) -> dict:
    logger.debug(f"filtered_documents: {filtered_documents}")
    return output_formatter.run(documents=filtered_documents.get("documents"))


## End of Pipeline


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self, llm_provider: LLMProvider, store_provider: DocumentStoreProvider
    ) -> None:
        self._embedder = llm_provider.get_text_embedder()
        self._retriever = store_provider.get_retriever(
            document_store=store_provider.get_store(dataset_name="view_questions"),
        )
        self._score_filter = ScoreFilter()
        # todo: add a llm filter to filter out low scoring document
        self._output_formatter = OutputFormatter()

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @async_timer
    async def run(self, query: str):
        logger.info("Try to extract historical question")
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
    pipeline = HistoricalQuestion(*init_providers())

    async_validate(lambda: pipeline.run("this is a query"))
