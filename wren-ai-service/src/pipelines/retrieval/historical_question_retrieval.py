import asyncio
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
        list = []

        for doc in documents:
            formatted = {
                "question": doc.content,
                "summary": doc.meta.get("summary", ""),
                "statement": doc.meta.get("statement") or doc.meta.get("sql"),
                "viewId": doc.meta.get("viewId", ""),
            }
            list.append(formatted)

        return {"documents": list}


## Start of Pipeline
@observe(capture_input=False)
async def count_documents(
    view_questions_store: QdrantDocumentStore,
    sql_pair_store: QdrantDocumentStore,
    id: Optional[str] = None,
) -> int:
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
    view_question_count, sql_pair_count = await asyncio.gather(
        view_questions_store.count_documents(filters=filters),
        sql_pair_store.count_documents(filters=filters),
    )
    return view_question_count + sql_pair_count


@observe(capture_input=False, capture_output=False)
async def embedding(count_documents: int, query: str, embedder: Any) -> dict:
    if count_documents:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def retrieval(
    embedding: dict, id: str, view_questions_retriever: Any, sql_pair_retriever: Any
) -> dict:
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

        view_question_res, sql_pair_res = await asyncio.gather(
            view_questions_retriever.run(
                query_embedding=embedding.get("embedding"),
                filters=filters,
            ),
            sql_pair_retriever.run(
                query_embedding=embedding.get("embedding"),
                filters=filters,
            ),
        )
        return dict(
            documents=view_question_res.get("documents") + sql_pair_res.get("documents")
        )

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
        historical_question_retrieval_similarity_threshold: Optional[float] = 0.9,
        **kwargs,
    ) -> None:
        view_questions_store = document_store_provider.get_store(
            dataset_name="view_questions"
        )
        sql_pair_store = document_store_provider.get_store(dataset_name="sql_pairs")
        self._components = {
            "view_questions_store": view_questions_store,
            "sql_pair_store": sql_pair_store,
            "embedder": embedder_provider.get_text_embedder(),
            "view_questions_retriever": document_store_provider.get_retriever(
                document_store=view_questions_store,
            ),
            "sql_pair_retriever": document_store_provider.get_retriever(
                document_store=sql_pair_store,
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
    async def run(self, query: str, id: Optional[str] = None):
        logger.info("HistoricalQuestion Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "id": id or "",
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
