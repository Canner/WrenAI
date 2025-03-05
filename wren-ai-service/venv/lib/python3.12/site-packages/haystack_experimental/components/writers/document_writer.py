# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import List, Optional

from haystack import Document, component, logging
from haystack.components.writers import DocumentWriter as DocumentWriterBase
from haystack.document_stores.types import DuplicatePolicy

from haystack_experimental.document_stores.types import DocumentStore

logger = logging.getLogger(__name__)


@component
class DocumentWriter(DocumentWriterBase):
    """
    Writes documents to a DocumentStore.

    ### Usage example
    ```python
    from haystack import Document
    from haystack_experimental.components.writers import DocumentWriter
    from haystack_experimental.document_stores.in_memory import InMemoryDocumentStore

    docs = [
        Document(content="Python is a popular programming language"),
    ]
    doc_store = InMemoryDocumentStore()
    writer = DocumentWriter(document_store=doc_store)
    writer.run(docs)
    ```
    """

    def __init__(
        self,
        document_store: DocumentStore,
        policy: DuplicatePolicy = DuplicatePolicy.NONE,
    ):
        """
        Create a DocumentWriter component.

        :param document_store:
            The instance of the document store where you want to store your documents.
        :param policy:
            The policy to apply when a Document with the same ID already exists in the DocumentStore.
            - `DuplicatePolicy.NONE`: Default policy, relies on the DocumentStore settings.
            - `DuplicatePolicy.SKIP`: Skips documents with the same ID and doesn't write them to the DocumentStore.
            - `DuplicatePolicy.OVERWRITE`: Overwrites documents with the same ID.
            - `DuplicatePolicy.FAIL`: Raises an error if a Document with the same ID is already in the DocumentStore.
        """
        super(DocumentWriter, self).__init__(document_store=document_store, policy=policy)

    @component.output_types(documents_written=int)
    async def run_async(self, documents: List[Document], policy: Optional[DuplicatePolicy] = None):
        """
        Run the DocumentWriter on the given input data.

        :param documents:
            A list of documents to write to the document store.
        :param policy:
            The policy to use when encountering duplicate documents.
        :returns:
            Number of documents written to the document store.

        :raises ValueError:
            If the specified document store is not found.
        """
        if policy is None:
            policy = self.policy

        if not hasattr(self.document_store, "write_documents_async"):
            raise TypeError(f"Document store {type(self.document_store).__name__} does not provide async support.")

        documents_written = await self.document_store.write_documents_async(  # type: ignore
            documents=documents, policy=policy
        )
        return {"documents_written": documents_written}
