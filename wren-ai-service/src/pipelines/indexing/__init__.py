from typing import List, Optional

from haystack import Document, component
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DocumentStore, DuplicatePolicy


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


@component
class SqlPairsCleaner:
    def __init__(self, sql_pairs_store: DocumentStore) -> None:
        self._sql_pairs_store = sql_pairs_store

    @component.output_types(documents=List[Document])
    async def run(self, sql_pair_ids: List[str], id: Optional[str] = None) -> None:
        filters = {
            "operator": "AND",
            "conditions": [
                {"field": "sql_pair_id", "operator": "in", "value": sql_pair_ids},
            ],
        }

        if id:
            filters["conditions"].append(
                {"field": "project_id", "operator": "==", "value": id}
            )

        return await self._sql_pairs_store.delete_documents(filters)


# Put the pipelines imports here to avoid circular imports and make them accessible directly to the rest of packages
from .db_schema import DBSchema  # noqa: E402
from .historical_question import HistoricalQuestion  # noqa: E402
from .table_description import TableDescription  # noqa: E402

__all__ = ["DBSchema", "TableDescription", "HistoricalQuestion"]
