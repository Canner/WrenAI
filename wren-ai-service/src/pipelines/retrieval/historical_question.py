import logging
import sys
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import Document, component
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider, EmbedderProvider

logger = logging.getLogger("wren-ai-service")


@component
class ScoreFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(self, documents: List[Document], score: float = 0.9):
        return {
            "documents": sorted(
                filter(lambda document: document.score >= score, documents),
                key=lambda document: document.score,
                reverse=True,
            )
        }


@component
class OutputFormatter:
    @component.output_types(
        documents=List[Optional[Dict]],
    )
    def run(self, documents: List[Document]):
        list = []

        for doc in documents:
            formatted = {
                "question": doc.content,
                "summary": doc.meta.get("summary"),
                "statement": doc.meta.get("statement"),
                "viewId": doc.meta.get("viewId"),
            }
            list.append(formatted)

        return {"documents": list}


## Start of Pipeline
@observe(capture_input=False)
async def count_documents(store: QdrantDocumentStore, id: Optional[str] = None) -> int:
    filters = (
        {
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": id},
            ],
        }
        if id
        else None
    )
    document_count = await store.count_documents(filters=filters)
    return document_count


@observe(capture_input=False, capture_output=False)
async def embedding(count_documents: int, query: str, embedder: Any) -> dict:
    if count_documents:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def retrieval(embedding: dict, id: str, retriever: Any) -> dict:
    if embedding:
        filters = (
            {
                "operator": "AND",
                "conditions": [
                    {"field": "project_id", "operator": "==", "value": id},
                ],
            }
            if id
            else None
        )

        res = await retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=filters,
        )
        return dict(documents=res.get("documents"))

    return {}


@observe(capture_input=False)
def filtered_documents(retrieval: dict, score_filter: ScoreFilter) -> dict:
    if retrieval:
        return score_filter.run(documents=retrieval.get("documents"))

    return {}


@observe(capture_input=False)
def formatted_output(
    filtered_documents: dict, output_formatter: OutputFormatter
) -> dict:
    if filtered_documents:
        return output_formatter.run(documents=filtered_documents.get("documents"))

    return {"documents": []}


## End of Pipeline


class HistoricalQuestion(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        store = document_store_provider.get_store(dataset_name="view_questions")
        self._components = {
            "store": store,
            "embedder": embedder_provider.get_text_embedder(),
            "retriever": document_store_provider.get_retriever(
                document_store=store,
            ),
            "score_filter": ScoreFilter(),
            # TODO: add a llm filter to filter out low scoring document, in case ScoreFilter is not accurate enough
            "output_formatter": OutputFormatter(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Historical Question")
    async def run(self, query: str, id: Optional[str] = None):
        logger.info("HistoricalQuestion pipeline is running...")
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "id": id or "",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        HistoricalQuestion,
        "historical_question_retrieval",
        query="this is a test query",
    )
