import logging

import pytest
from haystack import Document
from haystack.document_stores.types import DuplicatePolicy
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

LOGGER = logging.getLogger(__name__)


@pytest.fixture
def store():
    return QdrantDocumentStore(
        ":memory:",
        embedding_dim=5,
        recreate_index=True,
        return_embedding=True,
        wait_result_from_api=True,
    )


def test_overwrite(store: QdrantDocumentStore):
    store.write_documents(
        [
            Document(id=str(1), content="This is first", embedding=[0.0] * 5),
            Document(
                id=str(2), content="This is second", embedding=[0.1, 0.2, 0.3, 0.4, 0.5]
            ),
        ]
    )

    LOGGER.info(store.count_documents())

    store.write_documents(
        [
            Document(id=str(1), content="This is first hey", embedding=[0.0] * 5),
        ],
        policy=DuplicatePolicy.OVERWRITE,
    )

    LOGGER.info(store.count_documents())

    doc = store.query_by_embedding([0.0] * 5)
    LOGGER.info(doc)
