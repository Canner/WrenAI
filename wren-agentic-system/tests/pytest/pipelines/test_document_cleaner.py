import pytest
from haystack import Document
from haystack.document_stores.types import DocumentStore

from src.core.engine import EngineConfig
from src.pipelines.indexing.indexing import DocumentCleaner
from src.utils import init_providers


@pytest.mark.asyncio
async def _mock_store(name: str = "default") -> DocumentStore:
    _, _, document_store_provider, _ = init_providers(EngineConfig())
    store = document_store_provider.get_store(
        embedding_model_dim=5,
        dataset_name=name,
        recreate_index=True,
    )

    await store.write_documents(
        [
            Document(id=str(0), content="This is first", embedding=[0.0] * 5),
            Document(id=str(1), content="This is second", embedding=[0.1] * 5),
        ]
    )
    assert (await store.count_documents()) == 2
    return store


@pytest.mark.asyncio
async def test_clear_document():
    store = await _mock_store()

    cleaner = DocumentCleaner([store])
    await cleaner.run(mdl="{}")
    assert await store.count_documents() == 0


@pytest.mark.asyncio
async def test_clear_multi_stores():
    foo_store = await _mock_store("foo")
    bar_store = await _mock_store("bar")

    cleaner = DocumentCleaner([foo_store, bar_store])
    await cleaner.run(mdl="{}")
    assert await foo_store.count_documents() == 0
    assert await bar_store.count_documents() == 0


@pytest.mark.asyncio
async def test_component_output():
    store = await _mock_store()

    cleaner = DocumentCleaner([store])
    res = await cleaner.run(mdl="{}")
    assert res == {"mdl": "{}"}
