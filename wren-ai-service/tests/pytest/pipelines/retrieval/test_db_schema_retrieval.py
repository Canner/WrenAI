import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    check_using_db_schemas_without_pruning,
    dbschema_retrieval,
    table_retrieval,
)


@pytest.mark.asyncio
async def test_table_retrieval_fetches_explicit_table_descriptions():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
        embedding={},
        project_id="project-1",
        tables=["orders"],
        table_retriever=retriever,
    )

    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {"field": "name", "operator": "in", "value": ["orders"]},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_loads_selected_active_project_schema():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {
                "documents": [
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": "orders",
                                "columns": [],
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "orders"},
                    ),
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": "customers",
                                "columns": [],
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "customers"},
                    ),
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={
            "documents": [
                Document(
                    content=str({"name": "orders"}),
                    meta={"type": "TABLE_DESCRIPTION", "name": "orders"},
                )
            ]
        },
        project_id="project-1",
        dbschema_retriever=retriever,
    )

    assert [document.meta["name"] for document in documents] == ["orders", "customers"]
    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": "orders"},
                ],
            },
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_does_not_load_full_schema_for_unmatched_question():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
    )

    assert documents == []
    assert not retriever.called


def test_check_using_db_schemas_without_pruning_triggers_legacy_column_pruning():
    class Encoding:
        def encode(self, value):
            return value.split()

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
                {
                    "type": "TABLE",
                    "name": "orders",
                    "comment": "",
                    "columns": [
                        {
                            "type": "COLUMN",
                            "name": "amount",
                            "data_type": "DOUBLE",
                            "comment": "",
                            "is_primary_key": False,
                        }
                    ],
                    "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=True,
        context_window_size=1000,
    )

    assert result["db_schemas"] == []
    assert result["tokens"] > 0


def test_check_using_db_schemas_without_pruning_keeps_semantic_retrieval_context():
    class Encoding:
        def encode(self, value):
            return value.split()

    def table_schema(name):
        return {
            "type": "TABLE",
            "name": name,
            "comment": "",
            "columns": [
                {
                    "type": "COLUMN",
                    "name": "id",
                    "data_type": "INTEGER",
                    "comment": "",
                    "is_primary_key": False,
                }
            ],
            "properties": {},
            "primaryKey": "",
        }

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            table_schema("activity"),
            table_schema("account"),
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    assert [schema["table_name"] for schema in result["db_schemas"]] == [
        "activity",
        "account",
    ]
    assert result["tokens"] > 0


def test_check_using_db_schemas_without_pruning_keeps_selected_table_context():
    class Encoding:
        def encode(self, value):
            return value.split()

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "activity",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "id",
                        "data_type": "INTEGER",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    assert [schema["table_name"] for schema in result["db_schemas"]] == ["activity"]
