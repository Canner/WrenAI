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
                "instruction": doc.meta.get("instruction", ""),
                "question": doc.content,
                "instruction_id": doc.meta.get("instruction_id", ""),
            }
            list.append(formatted)

        return {"documents": list}


@component
class ScopeFilter:
    @component.output_types(
        documents=List[Document],
    )
    def run(
        self,
        documents: List[Document],
        scope: str = "sql",
    ):
        return {
            "documents": list(
                filter(
                    lambda document: document.meta.get("scope", "sql") == scope,
                    documents,
                ),
            )
        }


## Start of Pipeline
@observe(capture_input=False)
async def count_documents(
    store: QdrantDocumentStore, project_id: Optional[str] = None
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
    document_count = await store.count_documents(filters=filters)
    return document_count


@observe(capture_input=False, capture_output=False)
async def embedding(count_documents: int, query: str, embedder: Any) -> dict:
    if count_documents:
        return await embedder.run(query)

    return {}


@observe(capture_input=False)
async def retrieval(embedding: dict, project_id: str, retriever: Any) -> dict:
    if not embedding:
        return {}

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "is_default", "operator": "==", "value": False},
        ],
    }

    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    res = await retriever.run(
        query_embedding=embedding.get("embedding"),
        filters=filters,
    )
    return dict(documents=res.get("documents"))


@observe(capture_input=False)
def filtered_documents(
    retrieval: dict,
    scope: str,
    scope_filter: ScopeFilter,
    score_filter: ScoreFilter,
    similarity_threshold: float,
    top_k: int,
) -> dict:
    if not retrieval:
        return {}

    res = scope_filter.run(
        documents=retrieval.get("documents"),
        scope=scope,
    )

    return score_filter.run(
        documents=res.get("documents"),
        score=similarity_threshold,
        max_size=top_k,
    )


@observe(capture_input=False)
async def default_instructions(
    count_documents: int,
    retriever: Any,
    project_id: str,
    scope_filter: ScopeFilter,
    scope: str,
) -> list[Document]:
    if not count_documents:
        return []

    filters = {
        "operator": "AND",
        "conditions": [
            {"field": "is_default", "operator": "==", "value": True},
        ],
    }

    if project_id:
        filters["conditions"].append(
            {"field": "project_id", "operator": "==", "value": project_id}
        )

    _res = await retriever.run(
        query_embedding=None,
        filters=filters,
    )

    res = scope_filter.run(
        documents=_res.get("documents"),
        scope=scope,
    )

    return dict(documents=res.get("documents"))


@observe(capture_input=False)
def formatted_output(
    default_instructions: list[Document],
    filtered_documents: dict,
    output_formatter: OutputFormatter,
) -> dict:
    if not filtered_documents and not default_instructions:
        return {"documents": []}

    merged = default_instructions.get("documents") + filtered_documents.get("documents")
    documents = output_formatter.run(documents=merged)
    return documents


## End of Pipeline


class Instructions(BasicPipeline):
    def __init__(
        self,
        embedder_provider: EmbedderProvider,
        document_store_provider: DocumentStoreProvider,
        similarity_threshold: float = 0.7,
        top_k: int = 10,
        **kwargs,
    ) -> None:
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

        store = document_store_provider.get_store(dataset_name="instructions")
        self._components = {
            "store": store,
            "embedder": embedder_provider.get_text_embedder(),
            "retriever": document_store_provider.get_retriever(
                document_store=store,
            ),
            "scope_filter": ScopeFilter(),
            "score_filter": ScoreFilter(),
            "output_formatter": OutputFormatter(),
        }
        self._configs = {
            "similarity_threshold": similarity_threshold,
            "top_k": top_k,
        }

    @observe(name="Instructions Retrieval")
    async def run(
        self, query: str, project_id: Optional[str] = None, scope: str = "sql"
    ):
        logger.info("Instructions Retrieval pipeline is running...")
        return await self._pipe.execute(
            ["formatted_output"],
            inputs={
                "query": query,
                "project_id": project_id or "",
                "scope": scope,
                **self._components,
                **self._configs,
            },
        )
