from haystack import Document

from src.pipelines.indexing.indexing import ViewConverter


def test_empty_views():
    converter = ViewConverter()
    mdl = {"views": []}

    document = converter.run(mdl)
    assert document == {"documents": []}


def test_single_view():
    converter = ViewConverter()
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

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "question": "How many books are there?",
            "summary": "Retrieve the number of books",
            "statement": "SELECT * FROM book",
            "viewId": "fake-id-1",
        }
    )


def test_view_missing_properties():
    converter = ViewConverter()
    mdl = {
        "views": [
            {
                "name": "book",
                "statement": "SELECT * FROM book",
            }
        ]
    }

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "question": "",
            "summary": "",
            "statement": "SELECT * FROM book",
            "viewId": "",
        }
    )


def test_view_missing_question():
    converter = ViewConverter()
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

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "question": "",
            "summary": "Retrieve the number of books",
            "statement": "SELECT * FROM book",
            "viewId": "fake-id-1",
        }
    )


def test_view_missing_summary():
    converter = ViewConverter()
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

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "question": "How many books are there?",
            "summary": "",
            "statement": "SELECT * FROM book",
            "viewId": "fake-id-1",
        }
    )


def test_view_missing_id():
    converter = ViewConverter()
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

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.content == str(
        {
            "question": "How many books are there?",
            "summary": "Retrieve the number of books",
            "statement": "SELECT * FROM book",
            "viewId": "",
        }
    )


def test_multi_views():
    converter = ViewConverter()
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

    actual = converter.run(mdl)
    assert len(actual["documents"]) == 2

    document_1: Document = actual["documents"][0]
    assert document_1.content == str(
        {
            "question": "How many books are there?",
            "summary": "Retrieve the number of books",
            "statement": "SELECT * FROM book",
            "viewId": "fake-id-1",
        }
    )

    document_2: Document = actual["documents"][1]
    assert document_2.content == str(
        {
            "question": "How many books are there?",
            "summary": "Retrieve the number of books",
            "statement": "SELECT * FROM book",
            "viewId": "fake-id-2",
        }
    )
