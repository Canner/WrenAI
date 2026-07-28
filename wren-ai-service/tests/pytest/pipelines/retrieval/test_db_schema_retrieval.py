import pytest
from haystack import Document

from src.pipelines.common import build_table_ddl
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


def test_check_using_db_schemas_without_pruning_keeps_context_when_within_window():
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


def test_check_using_db_schemas_without_pruning_keeps_explicit_table_fast_path():
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


def test_build_table_ddl_preserves_join_columns_when_pruned():
    ddl, _, _ = build_table_ddl(
        {
            "type": "TABLE",
            "name": "detail",
            "comment": "",
            "columns": [
                {
                    "type": "COLUMN",
                    "name": "detail_id",
                    "data_type": "INTEGER",
                    "comment": "",
                    "is_primary_key": True,
                },
                {
                    "type": "COLUMN",
                    "name": "parent_id",
                    "data_type": "INTEGER",
                    "comment": "",
                    "is_primary_key": False,
                },
                {
                    "type": "COLUMN",
                    "name": "amount",
                    "data_type": "DOUBLE",
                    "comment": "",
                    "is_primary_key": False,
                },
                {
                    "type": "FOREIGN_KEY",
                    "comment": "",
                    "constraint": "FOREIGN KEY (parent_id) REFERENCES parent(parent_id)",
                    "tables": ["parent", "detail"],
                    "column": "parent_id",
                    "referenced_table": "parent",
                    "referenced_column": "parent_id",
                },
            ],
        },
        columns={"amount"},
        tables={"parent", "detail"},
    )

    assert "detail_id INTEGER PRIMARY KEY" in ddl
    assert "parent_id INTEGER" in ddl
    assert "amount DOUBLE" in ddl
    assert "FOREIGN KEY (parent_id) REFERENCES parent(parent_id)" in ddl
