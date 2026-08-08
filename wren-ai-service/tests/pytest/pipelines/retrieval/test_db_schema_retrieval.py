import pytest
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.common import build_table_ddl
from src.pipelines.retrieval.db_schema_retrieval import (
    _build_view_ddl,
    check_using_db_schemas_without_pruning,
    construct_retrieval_results,
    dbschema_retrieval,
    embedding,
    table_columns_selection_user_prompt_template,
    table_retrieval,
)
from src.pipelines.retrieval.db_schema_retrieval import (
    prompt as build_column_selection_prompt,
)
from src.web.v1.services.ask import AskHistory


class Encoding:
    def encode(self, value):
        return value.split()


def table_schema(name, columns):
    return {
        "type": "TABLE",
        "name": name,
        "comment": "",
        "columns": columns,
        "properties": {},
        "primaryKey": "",
    }


def column(name, data_type="VARCHAR", is_primary_key=False, comment=""):
    return {
        "type": "COLUMN",
        "name": name,
        "data_type": data_type,
        "comment": comment,
        "is_primary_key": is_primary_key,
    }


@pytest.mark.asyncio
async def test_embedding_uses_legacy_history_context():
    class Embedder:
        def __init__(self):
            self.query = None

        async def run(self, query):
            self.query = query
            return {"embedding": [1.0]}

    embedder = Embedder()

    result = await embedding(
        query="current request",
        embedder=embedder,
        histories=[AskHistory(question="previous request", sql="SELECT 1")],
    )

    assert result == {"embedding": [1.0]}
    assert embedder.query == "previous request\ncurrent request"


def test_column_pruning_prompt_uses_legacy_history_context():
    result = build_column_selection_prompt(
        query="current request",
        construct_db_schemas=[
            table_schema("modeled_dataset", [column("stored_attribute")])
        ],
        prompt_builder=PromptBuilder(
            template=table_columns_selection_user_prompt_template
        ),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[AskHistory(question="previous request", sql="SELECT 1")],
    )

    assert "previous request" in result["prompt"]
    assert "current request" in result["prompt"]
    assert "CREATE TABLE modeled_dataset" in result["prompt"]


@pytest.mark.asyncio
async def test_table_retrieval_keeps_project_and_deploy_scope():
    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            self.calls.append({"query_embedding": query_embedding, "filters": filters})
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
        embedding={"embedding": [0.25]},
        project_id="project-1",
        mdl_hash="deploy-1",
        tables=[],
        table_retriever=retriever,
    )

    assert retriever.calls == [
        {
            "query_embedding": [0.25],
            "filters": {
                "operator": "AND",
                "conditions": [
                    {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
                    {"field": "project_id", "operator": "==", "value": "project-1"},
                    {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
                ],
            },
        }
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_resolves_only_retrieved_table_names_with_deploy_scope():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {
                "documents": [
                    Document(
                        content=str(table_schema("orders", [column("order_id")])),
                        meta={"type": "TABLE_SCHEMA", "name": "orders"},
                    )
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
        mdl_hash="deploy-1",
        dbschema_retriever=retriever,
    )

    assert [document.meta["name"] for document in documents] == ["orders"]
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
            {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_does_not_use_non_legacy_semantic_fallback():
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
        mdl_hash="deploy-1",
        dbschema_retriever=retriever,
    )

    assert documents == []
    assert retriever.called is False


def test_view_schema_context_uses_legacy_view_definition():
    result = _build_view_ddl(
        {
            "type": "VIEW",
            "comment": "",
            "name": "retrieved_view",
            "statement": "SELECT visible_attribute FROM source_model",
            "columns": [
                {
                    "name": "visible_attribute",
                    "data_type": "VARCHAR",
                    "comment": "",
                }
            ],
        }
    )

    assert result == "CREATE VIEW retrieved_view\nAS SELECT visible_attribute FROM source_model"


def test_check_using_db_schemas_without_pruning_returns_legacy_result_shape():
    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            table_schema("activity", [column("id", "INTEGER")]),
            table_schema("account", [column("name")]),
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
    assert "CREATE TABLE activity" in result["db_schemas"][0]["table_ddl"]
    assert "column_names" not in result["db_schemas"][0]
    assert "unpruned_table_ddl" not in result["db_schemas"][0]


def test_check_using_db_schemas_without_pruning_triggers_legacy_column_pruning():
    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            table_schema("orders", [column("amount", "DOUBLE")])
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=True,
        context_window_size=1000,
    )

    assert result["db_schemas"] == []
    assert result["tokens"] > 0


def test_construct_retrieval_results_uses_selected_columns_for_sql_generation():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["stored_measure"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            table_schema(
                "modeled_dataset",
                [
                    column("stored_dimension"),
                    column("stored_measure", "DOUBLE"),
                ],
            )
        ],
        dbschema_retrieval=[],
    )

    retrieved = result["retrieval_results"][0]

    assert retrieved["table_name"] == "modeled_dataset"
    assert "stored_dimension VARCHAR" not in retrieved["table_ddl"]
    assert "stored_measure DOUBLE" in retrieved["table_ddl"]
    assert "column_names" not in retrieved


def test_construct_retrieval_results_keeps_only_selected_metrics_and_views():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "semantic_metric",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed metric."],
                                "columns": ["metric_value"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[],
        dbschema_retrieval=[
            Document(
                content=str(
                    {
                        "type": "METRIC",
                        "comment": "",
                        "name": "semantic_metric",
                        "columns": [
                            {
                                "type": "COLUMN",
                                "name": "metric_value",
                                "data_type": "DOUBLE",
                                "comment": "",
                            }
                        ],
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": "semantic_metric"},
            ),
            Document(
                content=str(
                    {
                        "type": "VIEW",
                        "comment": "",
                        "name": "unselected_view",
                        "statement": "SELECT id FROM source_model",
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": "unselected_view"},
            ),
        ],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "semantic_metric"
    ]
    assert result["has_metric"] is True


def test_construct_retrieval_results_does_not_add_column_only_term_matches():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "regional_orders",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["order_id"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            table_schema("regional_orders", [column("order_id")]),
            table_schema("fact_sales", [column("country")]),
        ],
        dbschema_retrieval=[],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "regional_orders"
    ]


def test_build_table_ddl_keeps_legacy_pruned_relationship_behavior():
    ddl, _, _ = build_table_ddl(
        {
            "type": "TABLE",
            "name": "detail",
            "comment": "",
            "columns": [
                column("detail_id", "INTEGER", is_primary_key=True),
                column("parent_id", "INTEGER"),
                column("amount", "DOUBLE"),
                {
                    "type": "FOREIGN_KEY",
                    "comment": "",
                    "constraint": "FOREIGN KEY (parent_id) REFERENCES parent(parent_id)",
                    "tables": ["parent", "detail"],
                },
            ],
        },
        columns={"amount"},
        tables={"parent", "detail"},
    )

    assert "detail_id INTEGER PRIMARY KEY" not in ddl
    assert "parent_id INTEGER" not in ddl
    assert "amount DOUBLE" in ddl
    assert "FOREIGN KEY (parent_id) REFERENCES parent(parent_id)" in ddl
