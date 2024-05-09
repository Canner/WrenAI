from haystack import Document
from haystack.document_stores.types import DocumentStore
from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

from src.pipelines.ask.indexing_pipeline import DocumentCleaner


def _mock_store(name: str = "default") -> DocumentStore:
    store = QdrantDocumentStore(
        ":memory:",
        index=name,
        embedding_dim=5,
        recreate_index=True,
        return_embedding=True,
        wait_result_from_api=True,
    )

    store.write_documents(
        [
            Document(id=str(0), content="This is first", embedding=[0.0] * 5),
            Document(id=str(1), content="This is second", embedding=[0.1] * 5),
        ]
    )
    assert store.count_documents() == 2
    return store


def test_clear_document():
    store = _mock_store()

    cleaner = DocumentCleaner([store])
    cleaner.run(mdl="{}")
    assert store.count_documents() == 0


def test_clear_multi_stores():
    foo_store = _mock_store("foo")
    bar_store = _mock_store("bar")

    cleaner = DocumentCleaner([foo_store, bar_store])
    cleaner.run(mdl="{}")
    assert foo_store.count_documents() == 0
    assert bar_store.count_documents() == 0


def test_component_output():
    store = _mock_store()

    cleaner = DocumentCleaner([store])
    res = cleaner.run(mdl="{}")
    assert res == {"mdl": "{}"}
