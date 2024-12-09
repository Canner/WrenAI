import json
from unittest.mock import AsyncMock

import pytest
from haystack import Document
from pytest_mock import MockFixture

from src.pipelines.indexing.historical_question import HistoricalQuestion, ViewChunker


def test_empty_views():
    chunker = ViewChunker()
    mdl = {"views": []}

    document = chunker.run(mdl)
    assert document == {"documents": []}


def test_single_view():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "summary": "Retrieve the number of books",
                    "viewId": "fake-id-1",
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-1",
    }
    assert document.content == "How many books are there?"


def test_view_missing_properties():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "",
        "statement": "SELECT * FROM book",
        "viewId": "",
    }
    assert document.content == ""


def test_view_missing_question():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
                "properties": {
                    "summary": "Retrieve the number of books",
                    "viewId": "fake-id-1",
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-1",
    }
    assert document.content == ""


def test_view_missing_summary():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "viewId": "fake-id-1",
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-1",
    }
    assert document.content == "How many books are there?"


def test_view_missing_id():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "summary": "Retrieve the number of books",
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "",
    }
    assert document.content == "How many books are there?"


def test_multi_views():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book-1",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "summary": "Retrieve the number of books",
                    "viewId": "fake-id-1",
                },
            },
            {
                "name": "book-2",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "summary": "Retrieve the number of books",
                    "viewId": "fake-id-2",
                },
            },
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 2

    document_1: Document = actual["documents"][0]
    assert document_1.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-1",
    }
    assert document_1.content == "How many books are there?"

    document_2: Document = actual["documents"][1]
    assert document_2.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-2",
    }
    assert document_2.content == "How many books are there?"


def test_view_with_historical_query():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book where created_at = 2020",
                "properties": {
                    "question": "in 2020",
                    "summary": "Retrieve the number of books in 2020",
                    "viewId": "fake-id-1",
                    "historical_queries": ["Retrieve the number of books"],
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books in 2020",
        "statement": "SELECT * FROM book where created_at = 2020",
        "viewId": "fake-id-1",
    }
    assert document.content == "Retrieve the number of books in 2020"


def test_view_with_historical_queries():
    chunker = ViewChunker()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book where city = 'taipei' and created_at = 2020",
                "properties": {
                    "question": "in 2020",
                    "summary": "Retrieve the number of books in taipei in 2020",
                    "viewId": "fake-id-1",
                    "historical_queries": ["Retrieve the number of books", "in taipei"],
                },
            }
        ]
    }

    actual = chunker.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books in taipei in 2020",
        "statement": "SELECT * FROM book where city = 'taipei' and created_at = 2020",
        "viewId": "fake-id-1",
    }
    assert document.content == "Retrieve the number of books in taipei in 2020"


def test_view_with_project_id():
    chunker = ViewChunker()
    project_id = "test-project"
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
                "properties": {
                    "question": "How many books are there?",
                    "summary": "Retrieve the number of books",
                    "viewId": "fake-id-1",
                },
            }
        ]
    }

    actual = chunker.run(mdl, project_id=project_id)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {
        "summary": "Retrieve the number of books",
        "statement": "SELECT * FROM book",
        "viewId": "fake-id-1",
        "project_id": project_id,
    }
    assert document.content == "How many books are there?"


@pytest.mark.asyncio
async def test_pipeline_run(mocker: MockFixture):
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

    pipeline = HistoricalQuestion(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    test_mdl = {
        "models": [],
        "views": [
            {
                "name": "test_view",
                "statement": "SELECT * FROM test",
                "properties": {
                    "question": "Test question?",
                    "summary": "Test summary",
                    "viewId": "test-id",
                },
            }
        ],
        "relationships": [],
        "metrics": [],
    }

    result = await pipeline.run(json.dumps(test_mdl), project_id="test-project")
    assert result is not None
    assert result == {"write": {"documents_written": 1}}


@pytest.mark.asyncio
async def test_pipeline_run_embedder_error(mocker: MockFixture):
    # Mock embedder provider
    embedder_provider = mocker.patch("src.core.provider.EmbedderProvider")
    embedder = mocker.Mock()
    mocker.patch.object(
        embedder, "run", new_callable=AsyncMock, side_effect=Exception("Embedder error")
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

    pipeline = HistoricalQuestion(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )

    with pytest.raises(Exception) as excinfo:
        await pipeline.run(json.dumps({}), project_id="test-project")

    assert str(excinfo.value) == "Embedder error"
