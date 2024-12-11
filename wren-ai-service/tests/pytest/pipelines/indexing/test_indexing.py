import pytest
from haystack import Document
from haystack.document_stores.types import DocumentStore

from src.pipelines.indexing import AsyncDocumentWriter, DocumentCleaner, MDLValidator


class MockDocumentStore(DocumentStore):
    """Mock document store for testing"""

    def __init__(self, documents=[]):
        self.documents = documents
        self.deleted = False

    async def write_documents(self, documents, policy):
        self.documents.extend(documents)
        return len(documents)

    async def delete_documents(self, filters=None):
        self.deleted = True
        self.documents = []

    def to_dict(self):
        return {}


@pytest.mark.asyncio
async def test_document_cleaner():
    store1 = MockDocumentStore(["document 1", "document 2"])
    store2 = MockDocumentStore(["document 1", "document 2"])
    cleaner = DocumentCleaner(stores=[store1, store2])

    # Test without project_id
    await cleaner.run()
    assert store1.deleted
    assert store2.deleted

    # Test with project_id
    await cleaner.run(project_id="123")
    assert store1.deleted
    assert store2.deleted


def test_mdl_validator():
    validator = MDLValidator()

    # Test valid JSON with all fields
    valid_mdl = """
    {
        "models": [],
        "views": [],
        "relationships": [],
        "metrics": []
    }
    """
    result = validator.run(valid_mdl)
    assert "mdl" in result
    assert all(
        key in result["mdl"] for key in ["models", "views", "relationships", "metrics"]
    )

    # Test JSON missing fields
    minimal_mdl = "{}"
    result = validator.run(minimal_mdl)
    assert "mdl" in result
    assert all(
        key in result["mdl"] for key in ["models", "views", "relationships", "metrics"]
    )

    # Test invalid JSON
    with pytest.raises(ValueError):
        validator.run("invalid json")


@pytest.mark.asyncio
async def test_async_document_writer():
    store = MockDocumentStore()
    writer = AsyncDocumentWriter(document_store=store)

    docs = [Document(content="test1"), Document(content="test2")]

    result = await writer.run(documents=docs)
    assert result["documents_written"] == 2
    assert len(store.documents) == 2
