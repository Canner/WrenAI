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
                "name": "user",
                "properties": {"description": "A table containing user information."},
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_DESCRIPTION"}
    assert document.content == str(
        {
            "name": "user",
            "mdl_type": "MODEL",
            "description": "A table containing user information.",
        }
    )


def test_multiple_table_descriptions():
    chunker = TableDescriptionChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "properties": {"description": "A table containing user information."},
            },
            {
                "name": "order",
                "properties": {"description": "A table containing order details."},
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
    }
    assert document_1.content == str(
        {
            "name": "user",
            "mdl_type": "MODEL",
            "description": "A table containing user information.",
        }
    )

    document_2: Document = actual["documents"][1]
    assert document_2.meta == {"type": "TABLE_DESCRIPTION"}
    assert document_2.content == str(
        {
            "name": "order",
            "mdl_type": "MODEL",
            "description": "A table containing order details.",
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
        "models": [{"name": "user"}],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_DESCRIPTION"}
    assert document.content == str(
        {"name": "user", "mdl_type": "MODEL", "description": ""}
    )


@pytest.mark.asyncio
async def test_pipeline_run(mocker: MockFixture):
    test_mdl = {
        "models": [
            {
                "name": "user",
                "properties": {"description": "A table containing user information."},
            },
            {
                "name": "order",
                "properties": {"description": "A table containing order details."},
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
