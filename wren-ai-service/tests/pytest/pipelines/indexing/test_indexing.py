from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from haystack import Document
from haystack.document_stores.types import DocumentStore

from src.pipelines.common import build_runtime_scope_filters
from src.pipelines.indexing.db_schema import DBSchema
from src.pipelines.indexing.historical_question import HistoricalQuestion
from src.pipelines.indexing import AsyncDocumentWriter, DocumentCleaner, MDLValidator
from src.pipelines.indexing.instructions import (
    Instruction,
    Instructions,
    InstructionsCleaner,
    InstructionsConverter,
)
from src.pipelines.indexing.project_meta import ProjectMeta, chunk as chunk_project_meta
from src.pipelines.indexing.sql_pairs import SqlPair, SqlPairs, SqlPairsCleaner, SqlPairsConverter
from src.pipelines.indexing.table_description import TableDescription


class MockDocumentStore(DocumentStore):
    """Mock document store for testing"""

    def __init__(self, documents=None):
        self.documents = documents or []
        self.deleted = False
        self.deleted_filters = []

    async def write_documents(self, documents, policy):
        self.documents.extend(documents)
        return len(documents)

    async def delete_documents(self, filters=None):
        self.deleted = True
        self.deleted_filters.append(filters)
        self.documents = []

    def to_dict(self):
        return {}


@pytest.mark.asyncio
async def test_document_cleaner():
    store1 = MockDocumentStore(["document 1", "document 2"])
    store2 = MockDocumentStore(["document 1", "document 2"])
    cleaner = DocumentCleaner(stores=[store1, store2])

    # Test without runtime_scope_id
    await cleaner.run()
    assert store1.deleted
    assert store2.deleted
    assert store1.deleted_filters[-1] is None
    assert store2.deleted_filters[-1] is None

    # Test with runtime_scope_id
    await cleaner.run(runtime_scope_id="123")
    assert store1.deleted
    assert store2.deleted
    assert store1.deleted_filters[-1] == build_runtime_scope_filters("123")
    assert store2.deleted_filters[-1] == build_runtime_scope_filters("123")


@pytest.mark.asyncio
async def test_instructions_cleaner_reuses_scope_filter_helper():
    store = MockDocumentStore()
    cleaner = InstructionsCleaner(store)

    await cleaner.run(
        instruction_ids=["instruction-1"], runtime_scope_id=" deploy-1 "
    )

    assert store.deleted_filters[-1] == build_runtime_scope_filters(
        "deploy-1",
        conditions=[
            {"field": "instruction_id", "operator": "in", "value": ["instruction-1"]}
        ],
    )


@pytest.mark.asyncio
async def test_instructions_cleaner_requires_runtime_scope_id():
    store = MockDocumentStore()
    cleaner = InstructionsCleaner(store)

    with pytest.raises(
        ValueError,
        match="InstructionsCleaner requires runtime_scope_id",
    ):
        await cleaner.run(instruction_ids=[])


@pytest.mark.asyncio
async def test_sql_pairs_cleaner_reuses_scope_filter_helper():
    store = MockDocumentStore()
    cleaner = SqlPairsCleaner(store)

    await cleaner.run(sql_pair_ids=["pair-1"], runtime_scope_id=" deploy-1 ")

    assert store.deleted_filters[-1] == build_runtime_scope_filters(
        "deploy-1",
        conditions=[
            {"field": "sql_pair_id", "operator": "in", "value": ["pair-1"]}
        ],
    )


def test_instructions_converter_normalizes_runtime_scope_before_meta_write():
    converter = InstructionsConverter()

    result = converter.run(
        instructions=[Instruction(id="instruction-1", instruction="i", question="q")],
        runtime_scope_id=" deploy-1 ",
    )

    assert result["documents"][0].meta["project_id"] == "deploy-1"


def test_sql_pairs_converter_normalizes_runtime_scope_before_meta_write():
    converter = SqlPairsConverter()

    result = converter.run(
        sql_pairs=[SqlPair(id="pair-1", sql="select 1", question="q")],
        runtime_scope_id=" deploy-1 ",
    )

    assert result["documents"][0].meta["project_id"] == "deploy-1"


def test_project_meta_chunk_normalizes_runtime_scope_before_writing_meta():
    result = chunk_project_meta(
        {"dataSource": "postgres"}, runtime_scope_id=" deploy-1 "
    )

    assert result["documents"][0].meta == {
        "data_source": "postgres",
        "project_id": "deploy-1",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pipeline_cls", "run_args", "run_kwargs"),
    [
        (ProjectMeta, ["{}"], {"runtime_scope_id": " deploy-1 "}),
        (TableDescription, ["{}"], {"runtime_scope_id": " deploy-1 "}),
        (HistoricalQuestion, ["{}"], {"runtime_scope_id": " deploy-1 "}),
        (DBSchema, ["{}"], {"runtime_scope_id": " deploy-1 "}),
        (
            Instructions,
            [],
            {
                "instructions": [Instruction(id="instruction-1")],
                "runtime_scope_id": " deploy-1 ",
            },
        ),
        (
            SqlPairs,
            ["{}"],
            {"runtime_scope_id": " deploy-1 "},
        ),
    ],
)
async def test_indexing_pipeline_run_normalizes_runtime_scope_before_execute(
    pipeline_cls,
    run_args,
    run_kwargs,
):
    pipeline = pipeline_cls.__new__(pipeline_cls)
    pipeline._components = {}
    pipeline._configs = {}
    pipeline._final = "write"
    if pipeline_cls is SqlPairs:
        pipeline._external_pairs = {}
    pipeline._pipe = SimpleNamespace(execute=AsyncMock(return_value={"ok": True}))

    await pipeline.run(*run_args, **run_kwargs)

    assert (
        pipeline._pipe.execute.await_args.kwargs["inputs"]["runtime_scope_id"]
        == "deploy-1"
    )


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
