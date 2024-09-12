from haystack import Document

from src.pipelines.indexing.indexing import ViewChunker


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
