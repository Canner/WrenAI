import pytest
import tiktoken
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.common import build_table_ddl
from src.pipelines.retrieval.db_schema_retrieval import (
    _augment_retrieval_query,
    _build_table_retrieval_context,
    _build_view_ddl,
    _lexical_columns_and_tables_needed,
    _limit_retrieval_results_for_generation,
    _parse_column_selection_response,
    _rank_table_names_by_query,
    check_using_db_schemas_without_pruning,
    construct_db_schemas,
    construct_retrieval_results,
    dbschema_retrieval,
    embedding,
    table_columns_selection_system_prompt,
    table_columns_selection_user_prompt_template,
    table_retrieval,
)
from src.pipelines.retrieval.db_schema_retrieval import (
    prompt as build_column_selection_prompt,
)


@pytest.mark.asyncio
async def test_embedding_uses_current_query_without_history_text():
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
        histories=[{"question": "previous request"}],
    )

    assert result == {"embedding": [1.0]}
    assert embedder.query == "current request"


def test_column_pruning_prompt_uses_current_query_without_history_text():
    result = build_column_selection_prompt(
        query="current request",
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        prompt_builder=PromptBuilder(
            template=table_columns_selection_user_prompt_template
        ),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[{"question": "previous request"}],
    )

    assert "current request" in result["prompt"]
    assert "previous request" not in result["prompt"]


def test_table_selection_prompt_prefers_best_schema_supported_dataset_set():
    assert "same business concept is represented by multiple modeled datasets" in (
        table_columns_selection_system_prompt
    )
    assert "best support the current question" in (
        table_columns_selection_system_prompt
    )


def test_view_schema_context_uses_declared_view_columns_when_available():
    result = _build_view_ddl(
        {
            "type": "VIEW",
            "comment": "Semantic description.",
            "name": "retrieved_view",
            "statement": "NON_EXECUTABLE_DEFINITION_TOKEN",
            "columns": [
                {
                    "name": "visible_attribute",
                    "data_type": "VARCHAR",
                    "comment": "Semantic field.",
                }
            ],
        }
    )

    assert "CREATE TABLE retrieved_view" in result
    assert "visible_attribute VARCHAR" in result
    assert "sql_column_names_use_exactly" in result
    assert "NON_EXECUTABLE_DEFINITION_TOKEN" not in result


def test_view_schema_context_uses_deployed_view_statement_without_declared_columns():
    result = _build_view_ddl(
        {
            "type": "VIEW",
            "comment": "Semantic description.",
            "name": "retrieved_view",
            "statement": "SELECT modeled_column FROM deployed_model",
        }
    )

    assert "CREATE TABLE retrieved_view" in result
    assert "modeled_column VARCHAR" in result
    assert "sql_table_name_use_exactly: retrieved_view" in result


def test_table_schema_context_includes_source_identifier_metadata():
    result, _, _ = _build_table_retrieval_context(
        {
            "type": "TABLE",
            "comment": "",
            "name": "orders_model",
            "properties": {"displayName": "New Orders"},
            "tableReference": {
                "catalog": "warehouse",
                "schema": "dbo",
                "table": "tblOrders",
            },
            "columns": [
                {
                    "type": "COLUMN",
                    "name": "customer_name",
                    "data_type": "VARCHAR",
                    "comment": "",
                    "is_primary_key": False,
                    "properties": {
                        "displayName": "CustName",
                        "sourceColumnName": "CustName",
                    },
                }
            ],
            "primaryKey": "",
        }
    )

    assert '"source_table_name":"dbo.tblOrders"' in result
    assert '"source_table_reference":{"catalog":"warehouse","schema":"dbo","table":"tblOrders"}' in result
    assert '"source_column_name":"CustName"' in result


def test_construct_db_schemas_keeps_deployed_views_for_column_pruning():
    result = construct_db_schemas(
        [
            Document(
                content=str(
                    {
                        "type": "VIEW",
                        "comment": "",
                        "name": "retrieved_view",
                        "statement": "SELECT modeled_column FROM deployed_model",
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": "retrieved_view"},
            )
        ]
    )

    assert result == [
        {
            "type": "VIEW",
            "comment": "",
            "name": "retrieved_view",
            "statement": "SELECT modeled_column FROM deployed_model",
        }
    ]


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
        embedding={},
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
async def test_dbschema_retrieval_expands_declared_relationships():
    selected_model = "model_a"
    related_model = "model_b"
    downstream_model = "model_c"

    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            names = [
                condition["value"]
                for condition in filters["conditions"][1]["conditions"]
            ]
            self.calls.append(names)

            if names == [selected_model]:
                return {
                    "documents": [
                        Document(
                            content=str(
                                {
                                    "type": "TABLE",
                                    "name": selected_model,
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": selected_model},
                        ),
                        Document(
                            content=str(
                                {
                                    "type": "TABLE_COLUMNS",
                                    "columns": [
                                        {
                                            "type": "FOREIGN_KEY",
                                            "tables": [
                                                selected_model,
                                                related_model,
                                            ],
                                            "column": "model_b_id",
                                            "referenced_table": related_model,
                                            "referenced_column": "id",
                                        }
                                    ],
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": selected_model},
                        ),
                    ]
                }

            if names == [related_model]:
                return {
                    "documents": [
                        Document(
                            content=str(
                                {
                                    "type": "TABLE",
                                    "name": related_model,
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": related_model},
                        ),
                        Document(
                            content=str(
                                {
                                    "type": "TABLE_COLUMNS",
                                    "columns": [
                                        {
                                            "type": "FOREIGN_KEY",
                                            "tables": [
                                                related_model,
                                                downstream_model,
                                            ],
                                            "column": "model_c_id",
                                            "referenced_table": downstream_model,
                                            "referenced_column": "id",
                                        }
                                    ],
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": related_model},
                        ),
                    ]
                }

            if names == [downstream_model]:
                return {
                    "documents": [
                        Document(
                            content=str(
                                {
                                    "type": "TABLE",
                                    "name": downstream_model,
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": downstream_model},
                        )
                    ]
                }

            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={
            "documents": [
                Document(
                    content=str({"name": selected_model}),
                    meta={"type": "TABLE_DESCRIPTION", "name": selected_model},
                )
            ]
        },
        project_id="project-1",
        dbschema_retriever=retriever,
        embedding={},
    )

    assert retriever.calls == [[selected_model], [related_model]]
    assert [document.meta["name"] for document in documents] == [
        selected_model,
        selected_model,
        related_model,
        related_model,
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_uses_semantic_schema_hits_when_table_retrieval_misses():
    semantic_model = "semantic_dataset"

    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            self.calls.append(
                {
                    "query_embedding": query_embedding,
                    "filters": filters,
                }
            )

            if query_embedding:
                return {
                    "documents": [
                        Document(
                            content=str(
                                {
                                    "type": "TABLE_COLUMNS",
                                    "columns": [
                                        {
                                            "type": "COLUMN",
                                            "name": "semantic_measure",
                                            "data_type": "DOUBLE",
                                            "comment": "",
                                            "is_primary_key": False,
                                        }
                                    ],
                                }
                            ),
                            meta={"type": "TABLE_SCHEMA", "name": semantic_model},
                        )
                    ]
                }

            return {
                "documents": [
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": semantic_model,
                                "comment": "",
                                "columns": [],
                                "properties": {},
                                "primaryKey": "",
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": semantic_model},
                    )
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
        embedding={"embedding": [0.25]},
    )

    assert retriever.calls[0] == {
        "query_embedding": [0.25],
        "filters": {
            "operator": "AND",
            "conditions": [
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                {"field": "project_id", "operator": "==", "value": "project-1"},
            ],
        },
    }
    assert retriever.calls[1]["query_embedding"] == []
    assert retriever.calls[1]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": semantic_model},
                ],
            },
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }
    assert [document.meta["name"] for document in documents] == [
        semantic_model,
        semantic_model,
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_lexically_recovers_active_project_schema_when_vector_misses():
    recovered_model = "customer_orders"
    unrelated_model = "service_tickets"

    def table_document(name, comment="", properties=None, table_reference=None):
        return Document(
            content=str(
                {
                    "type": "TABLE",
                    "name": name,
                    "comment": comment,
                    "columns": [],
                    "properties": properties or {},
                    "tableReference": table_reference,
                    "primaryKey": "",
                }
            ),
            meta={"type": "TABLE_SCHEMA", "name": name},
        )

    def columns_document(name, columns):
        return Document(
            content=str({"type": "TABLE_COLUMNS", "columns": columns}),
            meta={"type": "TABLE_SCHEMA", "name": name},
        )

    recovered_documents = [
        table_document(
            recovered_model,
            comment="Orders captured from customer purchase activity.",
            properties={"displayName": "Customer Orders"},
            table_reference={"schema": "sales", "table": "tblCustomerOrders"},
        ),
        columns_document(
            recovered_model,
            [
                {
                    "type": "COLUMN",
                    "name": "customer_name",
                    "data_type": "VARCHAR",
                    "comment": "Customer name on the order.",
                    "is_primary_key": False,
                },
                {
                    "type": "COLUMN",
                    "name": "order_total",
                    "data_type": "DOUBLE",
                    "comment": "Order revenue amount.",
                    "is_primary_key": False,
                },
            ],
        ),
    ]
    all_schema_documents = recovered_documents + [
        table_document(unrelated_model, comment="Support case tracking."),
        columns_document(
            unrelated_model,
            [
                {
                    "type": "COLUMN",
                    "name": "ticket_status",
                    "data_type": "VARCHAR",
                    "comment": "Support ticket status.",
                    "is_primary_key": False,
                }
            ],
        ),
    ]

    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            self.calls.append(
                {
                    "query_embedding": query_embedding,
                    "filters": filters,
                }
            )

            if query_embedding:
                return {"documents": []}

            is_exact_fetch = any(
                isinstance(condition, dict)
                and condition.get("operator") == "OR"
                and condition.get("conditions")
                for condition in filters["conditions"]
            )
            if not is_exact_fetch:
                return {"documents": all_schema_documents}

            return {"documents": recovered_documents}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
        query="show orders by customer",
        embedding={"embedding": [0.25]},
    )

    assert [call["query_embedding"] for call in retriever.calls] == [
        [0.25],
        [],
        [],
    ]
    assert retriever.calls[1]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }
    assert [document.meta["name"] for document in documents] == [
        recovered_model,
        recovered_model,
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_prefers_table_description_hits_over_schema_chunk_hits():
    described_model = "described_dataset"

    class Retriever:
        def __init__(self):
            self.calls = []

        async def run(self, query_embedding, filters):
            self.calls.append(
                {
                    "query_embedding": query_embedding,
                    "filters": filters,
                }
            )

            return {
                "documents": [
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": described_model,
                                "comment": "",
                                "columns": [],
                                "properties": {},
                                "primaryKey": "",
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": described_model},
                    )
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={
            "documents": [
                Document(
                    content=str({"name": described_model}),
                    meta={"type": "TABLE_DESCRIPTION", "name": described_model},
                )
            ]
        },
        project_id="project-1",
        dbschema_retriever=retriever,
        embedding={"embedding": [0.25]},
    )

    assert [call["query_embedding"] for call in retriever.calls] == [[0.25], []]
    assert retriever.calls[1]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": described_model},
                ],
            },
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }
    assert [document.meta["name"] for document in documents] == [described_model]


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


def test_construct_retrieval_results_preserves_retrieved_metric_when_pruning():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected for the current request.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["stored_attribute"]
                            }
                        },
                        {
                            "table_name": "semantic_metric",
                            "table_selection_reason": "Selected metric for the current request.",
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
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
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
            )
        ],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "modeled_dataset",
        "semantic_metric",
    ]
    assert result["has_metric"] is True


def test_construct_retrieval_results_skips_retrieved_schema_without_name():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected for the current request.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["stored_attribute"]
                            }
                        },
                        {
                            "table_name": "semantic_metric",
                            "table_selection_reason": "Selected metric for the current request.",
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
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[
            Document(
                content=str(
                    {
                        "type": "METRIC",
                        "comment": "",
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
                meta={"type": "TABLE_SCHEMA"},
            ),
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
        ],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "modeled_dataset",
        "semantic_metric",
    ]
    assert result["has_metric"] is True


def test_construct_retrieval_results_excludes_unselected_metric_when_pruning():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected for the current request.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["stored_attribute"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
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
            )
        ],
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "modeled_dataset"
    ]
    assert result["has_metric"] is False


def test_construct_retrieval_results_keeps_schema_when_pruner_returns_unknown_columns():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected for the current request.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed field."],
                                "columns": ["semantic_label"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_dimension",
                        "data_type": "VARCHAR",
                        "comment": "Semantic dimension label.",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "stored_measure",
                        "data_type": "DOUBLE",
                        "comment": "Semantic measure label.",
                        "is_primary_key": False,
                    },
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
    )

    table_ddl = result["retrieval_results"][0]["table_ddl"]

    assert "semantic_label" not in table_ddl
    assert "stored_dimension VARCHAR" in table_ddl
    assert "stored_measure DOUBLE" in table_ddl
    assert "sql_column_names_use_exactly:\n- stored_dimension\n- stored_measure" in (
        table_ddl
    )


def test_construct_retrieval_results_falls_back_when_pruner_omits_results():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={"replies": ['{"message":"not structured"}']},
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
    )

    assert result["retrieval_results"] == []
    assert result["has_metric"] is False


def test_construct_retrieval_results_keeps_schema_when_pruner_mixes_known_and_unknown_columns():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "modeled_dataset",
                            "table_selection_reason": "Selected for the current request.",
                            "table_contents": {
                                "chain_of_thought_reasoning": ["Needed fields."],
                                "columns": ["stored_measure", "semantic_label"]
                            }
                        }
                    ]
                }
                """
            ]
        },
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_dimension",
                        "data_type": "VARCHAR",
                        "comment": "Semantic dimension label.",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "stored_measure",
                        "data_type": "DOUBLE",
                        "comment": "Semantic measure label.",
                        "is_primary_key": False,
                    },
                ],
                "properties": {},
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
    )

    table_ddl = result["retrieval_results"][0]["table_ddl"]

    assert "semantic_label" not in table_ddl
    assert "stored_dimension VARCHAR" not in table_ddl
    assert "stored_measure DOUBLE" in table_ddl
    assert "sql_column_names_use_exactly:\n- stored_measure" in table_ddl


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
    assert all(
        "WREN RETRIEVED SEMANTIC CONTEXT" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all(
        "WREN SQL IDENTIFIER CONTRACT" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all(
        "EXECUTABLE WREN IDENTIFIER CATALOG" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all(
        "sql_table_name_use_exactly" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all(
        "sql_column_name_use_exactly" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all(
        "semantic_context_not_sql_identifier" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert result["tokens"] > 0


def test_retrieved_schema_separates_exact_sql_names_from_semantic_context():
    class Encoding:
        def encode(self, value):
            return value.split()

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "modeled_dataset",
                "comment": "Business-facing dataset description.",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "stored_attribute",
                        "data_type": "VARCHAR",
                        "comment": "Business-facing attribute label.",
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

    table_ddl = result["db_schemas"][0]["table_ddl"]
    executable_ddl = table_ddl.split("*/", maxsplit=1)[1]

    assert '"sql_table_name_use_exactly":"modeled_dataset"' in table_ddl
    assert '"sql_column_name_use_exactly":"stored_attribute"' in table_ddl
    assert "WREN SQL IDENTIFIER CONTRACT" in table_ddl
    assert "sql_table_name_use_exactly: modeled_dataset" in table_ddl
    assert "sql_column_names_use_exactly:\n- stored_attribute" in table_ddl
    assert "END WREN SQL IDENTIFIER CONTRACT" in table_ddl
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in table_ddl
    assert "table: modeled_dataset" in table_ddl
    assert "columns:\n- stored_attribute" in table_ddl
    assert "Do not create identifiers from user wording" in table_ddl
    assert (
        '"semantic_context_not_sql_identifier":"Business-facing attribute label."'
        in table_ddl
    )
    assert "Business-facing attribute label." not in executable_ddl
    assert "Business-facing dataset description." not in executable_ddl
    assert "CREATE TABLE modeled_dataset" in executable_ddl
    assert "stored_attribute VARCHAR" in executable_ddl


def test_build_table_ddl_can_render_executable_schema_without_semantic_comments():
    ddl, has_calculated_field, has_json_field = build_table_ddl(
        {
            "comment": "/* semantic table context */\n",
            "name": "modeled_dataset",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "-- semantic field context\n  ",
                    "name": "stored_attribute",
                    "data_type": "VARCHAR",
                    "is_primary_key": False,
                }
            ],
        },
        include_semantic_comments=False,
    )

    assert ddl == "CREATE TABLE modeled_dataset (\n  stored_attribute VARCHAR\n);"
    assert not has_calculated_field
    assert not has_json_field


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


def _schema_document(name: str, columns: list[str]) -> Document:
    return Document(
        content=str(
            {
                "name": name,
                "type": "TABLE",
                "columns": [
                    {"name": column, "type": "COLUMN", "data_type": "VARCHAR"}
                    for column in columns
                ],
            }
        ),
        meta={"name": name, "type": "TABLE"},
    )


def test_column_selection_accepts_alternate_results_shape():
    parsed = _parse_column_selection_response(
        {
            "replies": [
                """
                {
                  "tables": [
                    {
                      "table_name": "SalesOrderFact",
                      "columns": ["USDFXSalesValue", "OrderDate"]
                    }
                  ]
                }
                """
            ]
        }
    )

    assert parsed == {
        "SalesOrderFact": {
            "table_name": "SalesOrderFact",
            "columns": ["USDFXSalesValue", "OrderDate"],
        }
    }


def test_column_selection_returns_empty_dict_for_malformed_reply():
    parsed = _parse_column_selection_response({"replies": ["not-json"]})

    assert parsed == {}


def test_retrieval_query_augmentation_is_schema_neutral():
    query = "show total amount by year"

    assert _augment_retrieval_query(query) == query


def test_table_ranking_prefers_direct_schema_metadata_overlap():
    documents = [
        _schema_document("neutral_records", ["id1", "id2"]),
        _schema_document("amount_snapshots", ["amount_value", "snapshot_year"]),
        _schema_document("event_records", ["event_code", "event_time"]),
    ]

    ranked = _rank_table_names_by_query(
        ["neutral_records", "event_records", "amount_snapshots"],
        documents,
        "show total amount by year",
    )

    assert ranked[0] == "amount_snapshots"


def test_table_ranking_prefers_meaningful_column_coverage_over_generic_overlap():
    documents = [
        _schema_document("year_total_staging", ["FY___Would_invoice_date", "total_cost"]),
        _schema_document("sales_facts", ["Revenue", "Year", "CustomerName"]),
        _schema_document("event_records", ["event_code", "event_time"]),
    ]

    ranked = _rank_table_names_by_query(
        ["year_total_staging", "event_records", "sales_facts"],
        documents,
        "Show total revenue by year.",
    )

    assert ranked[0] == "sales_facts"


def test_generation_context_limiter_skips_large_table_to_keep_later_candidates():
    encoding = tiktoken.get_encoding("cl100k_base")
    retrieval_results = [
        {"table_name": "large_candidate", "table_ddl": "token " * 13_000},
        {
            "table_name": "compact_candidate",
            "table_ddl": "CREATE TABLE compact_candidate (Revenue DOUBLE, Year INTEGER);",
        },
    ]

    limited, _, _, reason = _limit_retrieval_results_for_generation(
        retrieval_results,
        encoding,
    )

    assert [result["table_name"] for result in limited] == ["compact_candidate"]
    assert reason == "ranked_top_k_skipped_token_budget"


def test_table_ranking_keeps_order_as_business_subject_token():
    documents = [
        _schema_document(
            "tariff_missing_documents",
            ["Missing_Document__1_", "Sold_to_Party_Name"],
        ),
        _schema_document("order_records", ["OrdNo", "OrdDate", "CustName"]),
        _schema_document("customer_master", ["CustomerName"]),
    ]

    ranked = _rank_table_names_by_query(
        ["tariff_missing_documents", "customer_master", "order_records"],
        documents,
        "Show order records with missing customer names.",
    )

    assert ranked[0] == "order_records"


def test_table_ranking_splits_compound_schema_identifiers():
    documents = [
        _schema_document("account_groups", ["acctgroup"]),
        _schema_document("balance_snapshots", ["endingbalance"]),
        _schema_document("recon_status", ["glaccount", "acctgroup", "glbalance"]),
    ]

    ranked = _rank_table_names_by_query(
        ["account_groups", "balance_snapshots", "recon_status"],
        documents,
        "show total GL balance by account group",
    )

    assert ranked[0] == "recon_status"


def test_table_ranking_prefers_exact_schema_identifier_mention():
    documents = [
        _schema_document("dbo_AA", ["id", "taskdate"]),
        _schema_document("dbo_View_Open_Invoices", ["invoice_number", "invoice_date"]),
        _schema_document("dbo_Collections_Tickets_History", ["taskdate", "status"]),
    ]

    ranked = _rank_table_names_by_query(
        [
            "dbo_View_Open_Invoices",
            "dbo_Collections_Tickets_History",
            "dbo_AA",
        ],
        documents,
        "How many dbo.AA records are there?",
    )

    assert ranked[0] == "dbo_AA"


def test_lexical_column_selection_splits_compound_schema_identifiers():
    result = _lexical_columns_and_tables_needed(
        [
            {
                "type": "TABLE",
                "name": "account_groups",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "acctgroup",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "tableReference": None,
            },
            {
                "type": "TABLE",
                "name": "recon_status",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "glaccount",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "acctgroup",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "glbalance",
                        "data_type": "DOUBLE",
                        "comment": "",
                        "is_primary_key": False,
                    },
                ],
                "properties": {},
                "tableReference": None,
            },
        ],
        "show total GL balance by account group",
    )

    assert list(result)[0] == "recon_status"
    assert set(result["recon_status"]["columns"]) >= {
        "acctgroup",
        "glbalance",
        "glaccount",
    }
