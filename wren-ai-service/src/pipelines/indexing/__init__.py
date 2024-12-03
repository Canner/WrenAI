from typing import List, Optional

from haystack import Document, component
from haystack.components.writers import DocumentWriter
from haystack.document_stores.types import DuplicatePolicy


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
