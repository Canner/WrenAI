from haystack import Document
from haystack.document_stores.types import DocumentStore

from src.pipelines.indexing.indexing import DocumentCleaner
from src.utils import EngineConfig, init_providers


def _mock_store(name: str = "default") -> DocumentStore:
    _, _, document_store_provider, _ = init_providers(
        EngineConfig(provider="wren_ui", config={})
    )
    store = document_store_provider.get_store(
        embedding_model_dim=5,
        dataset_name=name,
        recreate_index=True,
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
