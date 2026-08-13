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

PROJECT_ID = "project-id"
MDL_HASH = "deployment-hash"
CURRENT_QUERY = "current request"
PREVIOUS_QUERY = "previous request"
MODEL_A = "model_a"
MODEL_B = "model_b"
COLUMN_ID = "id"
COLUMN_TEXT = "text_value"
COLUMN_MEASURE = "measure_value"
METRIC_MODEL = "metric_model"
VIEW_MODEL = "view_model"
SOURCE_MODEL = "source_model"


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
        query=CURRENT_QUERY,
        embedder=embedder,
        histories=[AskHistory(question=PREVIOUS_QUERY, sql="SELECT 1")],
    )

    assert result == {"embedding": [1.0]}
    assert embedder.query == f"{PREVIOUS_QUERY}\n{CURRENT_QUERY}"


def test_column_pruning_prompt_uses_legacy_history_context():
    result = build_column_selection_prompt(
        query=CURRENT_QUERY,
        construct_db_schemas=[table_schema(MODEL_A, [column(COLUMN_TEXT)])],
        prompt_builder=PromptBuilder(
            template=table_columns_selection_user_prompt_template
        ),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[AskHistory(question=PREVIOUS_QUERY, sql="SELECT 1")],
    )

    assert PREVIOUS_QUERY in result["prompt"]
    assert CURRENT_QUERY in result["prompt"]
    assert f"CREATE TABLE {MODEL_A}" in result["prompt"]


@pytest.mark.asyncio
async def test_table_retrieval_uses_deployment_scope_when_mdl_hash_is_present():
    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            self.calls.append({"query_embedding": query_embedding, "filters": filters})
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
        embedding={"embedding": [0.25]},
        project_id=PROJECT_ID,
        mdl_hash=MDL_HASH,
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
                    {"field": "project_id", "operator": "==", "value": PROJECT_ID},
                    {"field": "mdl_hash", "operator": "==", "value": MDL_HASH},
                ],
            },
        }
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_resolves_retrieved_tables_with_deployment_scope():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {
                "documents": [
                    Document(
                        content=str(table_schema(MODEL_A, [column(COLUMN_ID)])),
                        meta={"type": "TABLE_SCHEMA", "name": MODEL_A},
                    )
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={
            "documents": [
                Document(
                    content=str({"name": MODEL_A}),
                    meta={"type": "TABLE_DESCRIPTION", "name": MODEL_A},
                )
            ]
        },
        project_id=PROJECT_ID,
        mdl_hash=MDL_HASH,
        dbschema_retriever=retriever,
    )

    assert [document.meta["name"] for document in documents] == [MODEL_A]
    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": MODEL_A},
                ],
            },
            {"field": "project_id", "operator": "==", "value": PROJECT_ID},
            {"field": "mdl_hash", "operator": "==", "value": MDL_HASH},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_does_not_use_non_legacy_empty_result_fallback():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id=PROJECT_ID,
        mdl_hash=MDL_HASH,
        dbschema_retriever=retriever,
    )

    assert documents == []
    assert retriever.called is False


def test_view_schema_context_uses_legacy_view_definition():
    result = _build_view_ddl(
        {
            "type": "VIEW",
            "comment": "",
            "name": VIEW_MODEL,
            "statement": f"SELECT {COLUMN_TEXT} FROM {SOURCE_MODEL}",
            "columns": [
                {
                    "name": COLUMN_TEXT,
                    "data_type": "VARCHAR",
                    "comment": "",
                }
            ],
        }
    )

    assert result == f"CREATE VIEW {VIEW_MODEL}\nAS SELECT {COLUMN_TEXT} FROM {SOURCE_MODEL}"


def test_check_using_db_schemas_without_pruning_returns_legacy_result_shape():
    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            table_schema(MODEL_A, [column(COLUMN_ID, "INTEGER")]),
            table_schema(MODEL_B, [column(COLUMN_TEXT)]),
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    assert [schema["table_name"] for schema in result["db_schemas"]] == [
        MODEL_A,
        MODEL_B,
    ]
    assert f"CREATE TABLE {MODEL_A}" in result["db_schemas"][0]["table_ddl"]
    assert result["db_schemas"][0]["unpruned_table_ddl"] == result["db_schemas"][0]["table_ddl"]
    assert result["db_schemas"][0]["manifest_column_names"] == [COLUMN_ID]


def test_check_using_db_schemas_without_pruning_triggers_legacy_column_pruning():
    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[table_schema(MODEL_A, [column(COLUMN_MEASURE, "DOUBLE")])],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=True,
        context_window_size=1000,
    )

    assert result["db_schemas"] == []
    assert result["tokens"] > 0


def test_question_queries_keep_unpruned_schema_context_like_legacy():
    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[table_schema(MODEL_A, [column(COLUMN_MEASURE, "DOUBLE")])],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    assert [schema["table_name"] for schema in result["db_schemas"]] == [MODEL_A]
    assert f"{COLUMN_MEASURE} DOUBLE" in result["db_schemas"][0]["table_ddl"]
    assert result["tokens"] > 0


def test_retrieved_schema_context_is_not_pruned_by_question_wording():
    schemas = [
        table_schema(MODEL_A, [column(COLUMN_ID), column(COLUMN_TEXT)]),
        table_schema(MODEL_B, [column(COLUMN_ID), column(COLUMN_MEASURE)]),
    ]

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=schemas,
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    expected_ddls = [build_table_ddl(schema)[0] for schema in schemas]

    assert [schema["table_name"] for schema in result["db_schemas"]] == [
        MODEL_A,
        MODEL_B,
    ]
    assert [schema["table_ddl"] for schema in result["db_schemas"]] == expected_ddls
    assert result["tokens"] > 0


def test_column_selection_prompt_uses_legacy_empty_schema_context():
    result = build_column_selection_prompt(
        query=CURRENT_QUERY,
        construct_db_schemas=[],
        prompt_builder=PromptBuilder(
            template=table_columns_selection_user_prompt_template
        ),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[],
    )

    assert "### Database Schema ###" in result["prompt"]
    assert CURRENT_QUERY in result["prompt"]


def test_column_selection_prompt_uses_legacy_table_schema_context_only():
    result = build_column_selection_prompt(
        query=CURRENT_QUERY,
        construct_db_schemas=[table_schema(MODEL_A, [column(COLUMN_ID)])],
        prompt_builder=PromptBuilder(
            template=table_columns_selection_user_prompt_template
        ),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[],
    )

    assert f"CREATE TABLE {MODEL_A}" in result["prompt"]
    assert f"CREATE TABLE {METRIC_MODEL}" not in result["prompt"]
    assert f"CREATE VIEW {VIEW_MODEL}" not in result["prompt"]


def test_construct_retrieval_results_uses_selected_columns_for_sql_generation():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "model_a",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["measure_value"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            table_schema(
                MODEL_A,
                [
                    column(COLUMN_TEXT),
                    column(COLUMN_MEASURE, "DOUBLE"),
                ],
            )
        ],
        dbschema_retrieval=[],
    )

    retrieved = result["retrieval_results"][0]

    assert retrieved["table_name"] == MODEL_A
    assert f"{COLUMN_TEXT} VARCHAR" not in retrieved["table_ddl"]
    assert f"{COLUMN_MEASURE} DOUBLE" in retrieved["table_ddl"]
    assert retrieved["column_names"] == [COLUMN_MEASURE]
    assert f"{COLUMN_TEXT} VARCHAR" in retrieved["unpruned_table_ddl"]
    assert f"{COLUMN_MEASURE} DOUBLE" in retrieved["unpruned_table_ddl"]
    assert retrieved["manifest_column_names"] == [COLUMN_TEXT, COLUMN_MEASURE]


def test_construct_retrieval_results_keeps_only_selected_metrics_and_views():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "metric_model",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed metric."],
                                "columns": ["measure_value"]
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
                        "name": METRIC_MODEL,
                        "columns": [
                            {
                                "type": "COLUMN",
                                "name": COLUMN_MEASURE,
                                "data_type": "DOUBLE",
                                "comment": "",
                            }
                        ],
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": METRIC_MODEL},
            ),
            Document(
                content=str(
                    {
                        "type": "VIEW",
                        "comment": "",
                        "name": VIEW_MODEL,
                        "statement": f"SELECT {COLUMN_ID} FROM {SOURCE_MODEL}",
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": VIEW_MODEL},
            ),
        ],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        METRIC_MODEL
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
                            "table_name": "model_a",
                            "table_selection_reason": "Selected.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["id"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            table_schema(MODEL_A, [column(COLUMN_ID)]),
            table_schema(MODEL_B, [column(COLUMN_TEXT)]),
        ],
        dbschema_retrieval=[],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        MODEL_A
    ]


def test_build_table_ddl_keeps_legacy_pruned_relationship_behavior():
    ddl, _, _ = build_table_ddl(
        {
            "type": "TABLE",
            "name": MODEL_A,
            "comment": "",
            "columns": [
                column(COLUMN_ID, "INTEGER", is_primary_key=True),
                column(f"{MODEL_B}_id", "INTEGER"),
                column(COLUMN_MEASURE, "DOUBLE"),
                {
                    "type": "FOREIGN_KEY",
                    "comment": "",
                    "constraint": f"FOREIGN KEY ({MODEL_B}_id) REFERENCES {MODEL_B}({COLUMN_ID})",
                    "tables": [MODEL_B, MODEL_A],
                },
            ],
        },
        columns={COLUMN_MEASURE},
        tables={MODEL_B, MODEL_A},
    )

    assert f"{COLUMN_ID} INTEGER PRIMARY KEY" not in ddl
    assert f"{MODEL_B}_id INTEGER" not in ddl
    assert f"{COLUMN_MEASURE} DOUBLE" in ddl
    assert f"FOREIGN KEY ({MODEL_B}_id) REFERENCES {MODEL_B}({COLUMN_ID})" in ddl
