from unittest.mock import AsyncMock

import orjson
import pytest
from haystack import Document
from pytest_mock import MockFixture

from src.pipelines.indexing.table_description import (
    TableDescription,
    TableDescriptionChunker,
)


def test_empty_table_descriptions():
    chunker = TableDescriptionChunker()
    mdl = {"models": [], "views": [], "relationships": [], "metrics": []}

    document = chunker.run(mdl)
    assert document == {"documents": []}


def test_single_table_description():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "name": "entity",
                "properties": {"description": "A generic entity resource."},
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_DESCRIPTION", "name": "entity"}
    assert document.content == str(
        {
            "name": "entity",
            "resource_type": "MODEL",
            "description": "A generic entity resource.",
            "columns": "",
        }
    )


def test_multiple_table_descriptions():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "name": "entity",
                "properties": {"description": "A generic entity resource."},
            },
            {
                "name": "activity",
                "properties": {"description": "A generic activity resource."},
            },
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 2

    document_1: Document = actual["documents"][0]
    assert document_1.meta == {
        "type": "TABLE_DESCRIPTION",
        "name": "entity",
    }
    assert document_1.content == str(
        {
            "name": "entity",
            "resource_type": "MODEL",
            "description": "A generic entity resource.",
            "columns": "",
        }
    )

    document_2: Document = actual["documents"][1]
    assert document_2.meta == {"type": "TABLE_DESCRIPTION", "name": "activity"}
    assert document_2.content == str(
        {
            "name": "activity",
            "resource_type": "MODEL",
            "description": "A generic activity resource.",
            "columns": "",
        }
    )


def test_table_description_missing_name():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "properties": {"description": "A table without a name."},
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 0


def test_table_description_missing_description():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [{"name": "entity"}],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_DESCRIPTION", "name": "entity"}
    assert document.content == str(
        {"name": "entity", "resource_type": "MODEL", "description": "", "columns": ""}
    )


def test_table_description_null_description():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "name": "entity",
                "properties": {"description": None, "displayName": None},
                "columns": [{"name": "id"}, {"name": None}],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_DESCRIPTION", "name": "entity"}
    assert document.content == str(
        {
            "name": "entity",
            "resource_type": "MODEL",
            "description": "",
            "columns": "id, ",
        }
    )


def test_table_description_includes_column_semantic_context():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "name": "resource",
                "properties": {
                    "description": "A generic described resource.",
                    "displayName": "Resource",
                },
                "columns": [
                    {
                        "name": "AttributeOne",
                        "type": "varchar",
                        "properties": {
                            "description": "Generic generated attribute description."
                        },
                    },
                    {
                        "name": "MeasureOne",
                        "type": "float",
                        "properties": {
                            "description": "Generic generated measure description."
                        },
                    },
                ],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "name": "resource",
            "resource_type": "MODEL",
            "description": "A generic described resource.",
            "columns": "AttributeOne, MeasureOne",
            "displayName": "Resource",
            "column_context": (
                "AttributeOne varchar Generic generated attribute description.; "
                "MeasureOne float Generic generated measure description."
            ),
            "semantic_context": (
                "Resource; "
                "AttributeOne varchar Generic generated attribute description.; "
                "MeasureOne float Generic generated measure description."
            ),
        }
    )


def test_table_description_includes_relationship_context():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {"name": "source", "columns": [{"name": "source_id"}]},
            {"name": "target", "columns": [{"name": "source_id"}]},
        ],
        "views": [],
        "relationships": [
            {
                "name": "source_to_target",
                "models": ["source", "target"],
                "joinType": "ONE_TO_MANY",
                "condition": "source.source_id = target.source_id",
            }
        ],
        "metrics": [],
    }

    actual = chunker.run(mdl)

    assert len(actual["documents"]) == 2
    for document in actual["documents"]:
        assert document.meta["type"] == "TABLE_DESCRIPTION"
        assert (
            "source_to_target ONE_TO_MANY source.source_id = target.source_id"
            in document.content
        )


def test_table_description_keeps_complete_column_lists():
    chunker = TableDescriptionChunker()
    columns = [{"name": f"column_{index}"} for index in range(205)]
    mdl = {
        "models": [
            {
                "name": "entity",
                "columns": columns,
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)

    assert len(actual["documents"]) == 1
    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "name": "entity",
            "resource_type": "MODEL",
            "description": "",
            "columns": ", ".join(column["name"] for column in columns),
        }
    )


@pytest.mark.asyncio
async def test_pipeline_run(mocker: MockFixture):
    test_mdl = {
        "models": [
            {
                "name": "entity",
                "properties": {"description": "A generic entity resource."},
            },
            {
                "name": "activity",
                "properties": {"description": "A generic activity resource."},
            },
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    # Mock embedder provider
    embedder_provider = mocker.patch("src.core.provider.EmbedderProvider")
    embedder = mocker.Mock()
    mocker.patch.object(
        embedder,
        "run",
        new_callable=AsyncMock,
        side_effect=lambda documents: {"documents": documents},
    )
    embedder_provider.get_document_embedder.return_value = embedder

    # Mock document store provider
    document_store = mocker.Mock()
    mocker.patch.object(
        document_store, "delete_documents", new_callable=AsyncMock, return_value=None
    )
    mocker.patch.object(
        document_store,
        "write_documents",
        new_callable=AsyncMock,
        side_effect=lambda documents, *_, **__: len(documents),
    )
    document_store_provider = mocker.patch("src.core.provider.DocumentStoreProvider")
    document_store_provider.get_store.return_value = document_store

    pipeline = TableDescription(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    result = await pipeline.run(orjson.dumps(test_mdl), project_id="test-project")
    assert result is not None
    assert result == {"write": {"documents_written": 2}}
