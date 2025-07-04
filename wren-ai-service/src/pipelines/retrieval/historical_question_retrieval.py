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
from src.pipelines.common import ScoreFilter

logger = logging.getLogger("wren-ai-service")


@component
class OutputFormatter:
    @component.output_types(
        documents=List[Optional[Dict]],
    )
    def run(self, documents: List[Document]):
        list = [
            {
                "question": doc.content,
                "summary": doc.meta.get("summary", ""),
                "statement": doc.meta.get("statement") or doc.meta.get("sql"),
                "viewId": doc.meta.get("viewId", ""),
            }
            for doc in documents
        ]

        return {"documents": list}


## Start of Pipeline
@observe(capture_input=False)
async def count_documents(
    view_questions_store: QdrantDocumentStore,
    project_id: Optional[str] = None,
) -> int:
    filters = (
        {
            "operator": "AND",
            "conditions": [
                {"field": "project_id", "operator": "==", "value": project_id},
            ],
        }
        if project_id
        else None
    )

    return await view_questions_store.count_documents(filters=filters)


@observe(capture_input=False, capture_output=False)
async def embedding(count_documents: int, query: str, embedder: Any) -> dict:
    if count_documents:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def retrieval(
    embedding: dict,
    project_id: str,
    view_questions_retriever: Any,
) -> dict:
    if embedding:
        filters = (
            {
                "operator": "AND",
                "conditions": [
                    {"field": "project_id", "operator": "==", "value": project_id},
                ],
            }
            if project_id
            else None
        )

        view_question_res = await view_questions_retriever.run(
            query_embedding=embedding.get("embedding"),
            filters=filters,
        )
        return dict(documents=view_question_res.get("documents"))

    return {}


@observe(capture_input=False)
def filtered_documents(
    retrieval: dict,
    score_filter: ScoreFilter,
    historical_question_retrieval_similarity_threshold: float,
) -> dict:
    if retrieval:
        return score_filter.run(
            documents=retrieval.get("documents"),
            score=historical_question_retrieval_similarity_threshold,
        )

    return {}


@observe(capture_input=False)
def formatted_output(
    filtered_documents: dict, output_formatter: OutputFormatter
) -> dict:
    if filtered_documents:
        return output_formatter.run(documents=filtered_documents.get("documents"))

    return {"documents": []}


## End of Pipeline


class HistoricalQuestionRetrieval(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        historical_question_retrieval_similarity_threshold: float = 0.9,
        **kwargs,
    ) -> None:
        view_questions_store = document_store_provider.get_store(
            dataset_name="view_questions"
        )
        self._components = {
            "view_questions_store": view_questions_store,
            "embedder": embedder_provider.get_text_embedder(),
            "view_questions_retriever": document_store_provider.get_retriever(
                document_store=view_questions_store,
            ),
            "score_filter": ScoreFilter(),
            # TODO: add a llm filter to filter out low scoring document, in case ScoreFilter is not accurate enough
            "output_formatter": OutputFormatter(),
        }

        self._configs = {
            "historical_question_retrieval_similarity_threshold": historical_question_retrieval_similarity_threshold,
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    @observe(name="Historical Question")
    async def run(self, query: str, project_id: Optional[str] = None):
        logger.info("HistoricalQuestion Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "project_id": project_id or "",
                **self._components,
                **self._configs,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        HistoricalQuestionRetrieval,
        "historical_question_retrieval",
        query="this is a test query",
    )
