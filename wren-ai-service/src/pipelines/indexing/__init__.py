import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

import orjson
from haystack import Document, component
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DocumentStore, DuplicatePolicy

logger = logging.getLogger("wren-ai-service")


@component
class DocumentCleaner:
    """
    This component is used to clear all the documents in the specified document store(s).

    """

    def __init__(self, stores: List[DocumentStore]) -> None:
        self._stores = stores

    @component.output_types()
    async def run(self, project_id: Optional[str] = None) -> None:
        async def _clear_documents(
            store: DocumentStore, project_id: Optional[str] = None
        ) -> None:
            store_name = (
                store.to_dict().get("init_parameters", {}).get("index", "unknown")
            )
            logger.info(f"Project ID: {project_id}, Cleaning documents in {store_name}")
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
            await store.delete_documents(filters)

        await asyncio.gather(
            *[_clear_documents(store, project_id) for store in self._stores]
        )


@component
class MDLValidator:
    """
    Validate the MDL to check if it is a valid JSON and contains the required keys.
    """

    @component.output_types(mdl=Dict[str, Any])
    def run(self, mdl: str) -> str:
        try:
            mdl_json = orjson.loads(mdl)
            logger.info(f"MDL JSON: {mdl_json}")
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON: {e}")
        if "models" not in mdl_json:
            mdl_json["models"] = []
        if "views" not in mdl_json:
            mdl_json["views"] = []
        if "relationships" not in mdl_json:
            mdl_json["relationships"] = []
        if "metrics" not in mdl_json:
            mdl_json["metrics"] = []

        return {"mdl": mdl_json}


@component
class AsyncDocumentWriter(DocumentWriter):
    @component.output_types(documents_written=int)
    async def run(
        self, documents: List[Document], policy: Optional[DuplicatePolicy] = None
    ):
        if policy is None:
            policy = self.policy

        documents_written = await self.document_store.write_documents(
            documents=documents, policy=policy
        )
        return {"documents_written": documents_written}


# Put the pipelines imports here to avoid circular imports and make them accessible directly to the rest of packages
from .db_schema import DBSchema  # noqa: E402
from .historical_question import HistoricalQuestion  # noqa: E402
from .instructions import Instructions  # noqa: E402
from .sql_pairs import SqlPairs  # noqa: E402
from .table_description import TableDescription  # noqa: E402

__all__ = [
    "DBSchema",
    "TableDescription",
    "HistoricalQuestion",
    "SqlPairs",
    "Instructions",
]
