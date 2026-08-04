import pytest
from haystack import Document
from haystack.components.builders.prompt_builder import PromptBuilder

from src.pipelines.common import build_table_ddl
from src.pipelines.retrieval.db_schema_retrieval import (
    active_mdl_hash,
    _build_view_ddl,
    _tables_matching_query_terms,
    check_using_db_schemas_without_pruning,
    construct_retrieval_results,
    dbschema_retrieval,
    embedding,
    prompt as build_column_selection_prompt,
    table_retrieval,
    table_columns_selection_system_prompt,
    table_columns_selection_user_prompt_template,
)


class StoreCounter:
    def __init__(self, count):
        self.count = count
        self.filters = []

    async def count_documents(self, filters=None):
        self.filters.append(filters)
        return self.count


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


@pytest.mark.asyncio
async def test_embedding_skips_semantic_search_when_deployed_schema_exists():
    class Embedder:
        def __init__(self):
            self.called = False

        async def run(self, query):
            self.called = True
            return {"embedding": [1.0]}

    schema_store = StoreCounter(count=1)
    embedder = Embedder()

    result = await embedding(
        query="current request",
        embedder=embedder,
        histories=[],
        project_id="project-1",
        mdl_hash="deploy-1",
        dbschema_store=schema_store,
    )

    assert result == {}
    assert embedder.called is False
    assert schema_store.filters == [
        {
            "operator": "AND",
            "conditions": [
                {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                {"field": "project_id", "operator": "==", "value": "project-1"},
                {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
            ],
        }
    ]


@pytest.mark.asyncio
async def test_embedding_uses_table_description_search_when_deploy_descriptions_exist():
    class Embedder:
        def __init__(self):
            self.query = None

        async def run(self, query):
            self.query = query
            return {"embedding": [1.0]}

    schema_store = StoreCounter(count=1)
    table_description_store = StoreCounter(count=1)
    embedder = Embedder()

    result = await embedding(
        query="show orders from last month",
        embedder=embedder,
        histories=[],
        project_id="project-1",
        mdl_hash="deploy-1",
        dbschema_store=schema_store,
        table_description_store=table_description_store,
    )

    assert result == {"embedding": [1.0]}
    assert embedder.query == "show orders from last month"
    assert table_description_store.filters == [
        {
            "operator": "AND",
            "conditions": [
                {"field": "type", "operator": "==", "value": "TABLE_DESCRIPTION"},
                {"field": "project_id", "operator": "==", "value": "project-1"},
                {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
            ],
        }
    ]


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


def test_table_selection_prompt_keeps_multiple_relevant_datasets():
    assert "same business concept is represented by multiple modeled datasets" in (
        table_columns_selection_system_prompt
    )
    assert "compatible fields for the same requested result shape" in (
        table_columns_selection_system_prompt
    )


def test_table_term_matching_uses_semantic_columns_and_relationships():
    matched = _tables_matching_query_terms(
        "summarize lifecycle value by segment",
        [
            {
                "type": "TABLE",
                "name": "model_alpha",
                "comment": "",
                "properties": {},
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "metric_col",
                        "data_type": "DOUBLE",
                        "comment": "Lifecycle value used for analysis.",
                    },
                    {
                        "type": "FOREIGN_KEY",
                        "constraint": "FOREIGN KEY (segment_id) REFERENCES model_beta(id)",
                        "tables": ["model_alpha", "model_beta"],
                        "referenced_table": "model_beta",
                        "referenced_column": "id",
                    },
                ],
            },
            {
                "type": "TABLE",
                "name": "model_gamma",
                "comment": "",
                "properties": {},
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "other_col",
                        "data_type": "VARCHAR",
                        "comment": "Unrelated text.",
                    }
                ],
            },
        ],
    )

    assert matched == {"model_alpha"}


@pytest.mark.asyncio
async def test_active_mdl_hash_keeps_hash_when_deploy_documents_are_indexed():
    table_store = StoreCounter(count=1)
    schema_store = StoreCounter(count=0)

    result = await active_mdl_hash(
        project_id="project-1",
        mdl_hash="deploy-1",
        table_description_store=table_store,
        dbschema_store=schema_store,
    )

    expected_filters = {
        "operator": "AND",
        "conditions": [
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
        ],
    }
    assert result == "deploy-1"
    assert table_store.filters == [expected_filters]
    assert schema_store.filters == [expected_filters]


@pytest.mark.asyncio
async def test_active_mdl_hash_keeps_hash_when_deploy_documents_are_absent():
    table_store = StoreCounter(count=0)
    schema_store = StoreCounter(count=0)

    result = await active_mdl_hash(
        project_id="project-1",
        mdl_hash="deploy-1",
        table_description_store=table_store,
        dbschema_store=schema_store,
    )

    assert result == "deploy-1"


def test_view_schema_context_uses_declared_view_columns_not_view_definition():
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
    assert "definition_omitted_from_executable_schema" in result
    assert "NON_EXECUTABLE_DEFINITION_TOKEN" not in result


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
async def test_table_retrieval_skips_candidate_search_without_embedding_or_tables():
    class Retriever:
        def __init__(self):
            self.called = False

        async def run(self, query_embedding, filters):
            self.called = True
            return {"documents": []}

    retriever = Retriever()

    result = await table_retrieval(
        embedding={},
        project_id="project-1",
        tables=[],
        table_retriever=retriever,
        mdl_hash="deploy-1",
    )

    assert result == {"documents": []}
    assert retriever.called is False


@pytest.mark.asyncio
async def test_table_retrieval_keeps_deploy_scope_when_no_documents_match():
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
async def test_table_retrieval_falls_back_to_request_hash_when_active_hash_is_absent():
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
            return {"documents": []}

    retriever = Retriever()

    await table_retrieval(
        embedding={"embedding": [0.25]},
        project_id="project-1",
        mdl_hash="deploy-1",
        active_mdl_hash="",
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
async def test_dbschema_retrieval_keeps_deploy_scope_when_no_documents_match():
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
            return {"documents": []}

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        mdl_hash="deploy-1",
        dbschema_retriever=retriever,
        embedding={"embedding": [0.25]},
    )

    assert documents == []
    assert retriever.calls == [
        {
            "query_embedding": [0.25],
            "filters": {
                "operator": "AND",
                "conditions": [
                    {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                    {"field": "project_id", "operator": "==", "value": "project-1"},
                    {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
                ],
            },
        }
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_loads_exact_deployed_schema_without_candidates():
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
                                "name": "orders",
                                "comment": "",
                                "columns": [],
                                "properties": {},
                                "primaryKey": "",
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "orders"},
                    ),
                    Document(
                        content=str(
                            {
                                "type": "TABLE_COLUMNS",
                                "columns": [
                                    {
                                        "type": "COLUMN",
                                        "name": "order_id",
                                        "data_type": "VARCHAR",
                                        "comment": "",
                                        "is_primary_key": True,
                                    }
                                ],
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "orders"},
                    ),
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        mdl_hash="deploy-1",
        dbschema_retriever=retriever,
        embedding={},
    )

    assert [document.meta["name"] for document in documents] == ["orders", "orders"]
    assert retriever.calls == [
        {
            "query_embedding": [],
            "filters": {
                "operator": "AND",
                "conditions": [
                    {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
                    {"field": "project_id", "operator": "==", "value": "project-1"},
                    {"field": "mdl_hash", "operator": "==", "value": "deploy-1"},
                ],
            },
        }
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_expands_direct_declared_relationships():
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
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_combines_description_and_schema_semantic_hits():
    described_model = "described_dataset"
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
                                            "name": "semantic_value",
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

            names = [
                condition["value"]
                for condition in filters["conditions"][1]["conditions"]
            ]
            documents = [
                Document(
                    content=str(
                        {
                            "type": "TABLE",
                            "name": name,
                            "comment": "",
                            "columns": [],
                            "properties": {},
                            "primaryKey": "",
                        }
                    ),
                    meta={"type": "TABLE_SCHEMA", "name": name},
                )
                for name in names
            ]
            return {
                "documents": documents
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
    assert retriever.calls[0]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }
    assert retriever.calls[1]["filters"] == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {
                "operator": "OR",
                "conditions": [
                    {"field": "name", "operator": "==", "value": described_model},
                    {"field": "name", "operator": "==", "value": semantic_model},
                ],
            },
            {"field": "project_id", "operator": "==", "value": "project-1"},
        ],
    }
    assert [document.meta["name"] for document in documents] == [
        described_model,
        semantic_model,
    ]


@pytest.mark.asyncio
async def test_dbschema_retrieval_caps_schema_semantic_table_rescue():
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
                                            "name": "semantic_value",
                                            "data_type": "DOUBLE",
                                            "comment": "",
                                            "is_primary_key": False,
                                        }
                                    ],
                                }
                            ),
                            meta={
                                "type": "TABLE_SCHEMA",
                                "name": f"semantic_model_{index}",
                            },
                        )
                        for index in range(25)
                    ]
                }

            selected_names = [
                condition["value"]
                for condition in filters["conditions"][1]["conditions"]
            ]
            return {
                "documents": [
                    Document(
                        content=str(
                            {
                                "type": "TABLE",
                                "name": name,
                                "comment": "",
                                "columns": [],
                                "properties": {},
                                "primaryKey": "",
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": name},
                    )
                    for name in selected_names
                ]
            }

    retriever = Retriever()

    documents = await dbschema_retrieval(
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
        embedding={"embedding": [0.25]},
    )

    selected_names = [
        condition["value"]
        for condition in retriever.calls[1]["filters"]["conditions"][1]["conditions"]
    ]

    assert len(selected_names) == 5
    assert selected_names == [f"semantic_model_{index}" for index in range(5)]
    assert [document.meta["name"] for document in documents] == selected_names


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
    assert result["retrieval_results"][1]["column_names"] == ["metric_value"]
    assert result["retrieval_results"][1]["manifest_column_names"] == ["metric_value"]
    assert result["has_metric"] is True


def test_construct_retrieval_results_preserves_retrieved_view_columns_when_pruning():
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
                        "type": "VIEW",
                        "comment": "",
                        "name": "semantic_view",
                        "columns": [
                            {
                                "name": "view_attribute",
                                "data_type": "VARCHAR",
                                "comment": "",
                            }
                        ],
                    }
                ),
                meta={"type": "TABLE_SCHEMA", "name": "semantic_view"},
            )
        ],
    )

    assert result["retrieval_results"][1]["table_name"] == "semantic_view"
    assert result["retrieval_results"][1]["column_names"] == ["view_attribute"]
    assert result["retrieval_results"][1]["manifest_column_names"] == [
        "view_attribute"
    ]


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
    assert "columns:\n- stored_dimension\n- stored_measure" in table_ddl


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
    assert "stored_dimension VARCHAR" in table_ddl
    assert "stored_measure DOUBLE" in table_ddl
    assert "columns:\n- stored_dimension\n- stored_measure" in table_ddl


def test_construct_retrieval_results_uses_full_columns_for_sql_generation():
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
                                "columns": ["stored_measure"]
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

    retrieved = result["retrieval_results"][0]

    assert "stored_dimension VARCHAR" in retrieved["table_ddl"]
    assert "stored_measure DOUBLE" in retrieved["table_ddl"]
    assert "WREN RETRIEVED SEMANTIC CONTEXT" in retrieved["table_ddl"]
    assert "sql_column_name_use_exactly" in retrieved["table_ddl"]
    assert retrieved["column_names"] == [
        "stored_dimension",
        "stored_measure",
    ]
    assert retrieved["manifest_column_names"] == [
        "stored_dimension",
        "stored_measure",
    ]


def test_construct_retrieval_results_adds_query_matching_tables_after_pruning():
    def order_schema(name):
        return {
            "type": "TABLE",
            "name": name,
            "comment": "",
            "columns": [
                {
                    "type": "COLUMN",
                    "name": "order_id",
                    "data_type": "VARCHAR",
                    "comment": "",
                    "is_primary_key": False,
                }
            ],
            "properties": {},
            "primaryKey": "",
        }

    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={},
        filter_columns_in_tables={
            "replies": [
                """
                {
                    "results": [
                        {
                            "table_name": "regional_orders",
                            "table_selection_reason": "Selected for the current request.",
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
            order_schema("regional_orders"),
            order_schema("archived_orders"),
            {
                "type": "TABLE",
                "name": "customers",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "customer_id",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            },
        ],
        dbschema_retrieval=[],
        query="show orders from last month",
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "regional_orders",
        "archived_orders",
    ]


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
                            "table_selection_reason": "Selected for the current request.",
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
            {
                "type": "TABLE",
                "name": "regional_orders",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "order_id",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            },
            {
                "type": "TABLE",
                "name": "fact_sales",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "country",
                        "data_type": "VARCHAR",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
                "properties": {},
                "primaryKey": "",
            },
        ],
        dbschema_retrieval=[],
        query="show orders from country france",
    )

    assert [item["table_name"] for item in result["retrieval_results"]] == [
        "regional_orders"
    ]


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
        "EXECUTABLE WREN IDENTIFIER CATALOG" in schema["table_ddl"]
        for schema in result["db_schemas"]
    )
    assert all("table: " in schema["table_ddl"] for schema in result["db_schemas"])
    assert all("columns:" in schema["table_ddl"] for schema in result["db_schemas"])
    assert all(
        "WREN RETRIEVED SEMANTIC CONTEXT" in schema["table_ddl"]
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
    assert "EXECUTABLE WREN IDENTIFIER CATALOG" in table_ddl
    assert "table: modeled_dataset" in table_ddl
    assert "columns:\n- stored_attribute" in table_ddl
    assert "Do not create identifiers from user wording" in table_ddl
    assert "Business-facing attribute label." in table_ddl
    assert "Business-facing dataset description." in table_ddl
    assert "WREN RETRIEVED SEMANTIC CONTEXT" in table_ddl
    assert "semantic_context_not_sql_identifier" in table_ddl
    assert "CREATE TABLE modeled_dataset" in table_ddl
    assert "stored_attribute VARCHAR" in table_ddl
    assert "Business-facing attribute label.CREATE TABLE" not in table_ddl
    assert "Business-facing dataset description.CREATE TABLE" not in table_ddl


def test_retrieved_schema_keeps_physical_metadata_out_of_executable_ddl():
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
                "properties": {
                    "tableReference": {
                        "catalog": "physical_catalog",
                        "schema": "physical_schema",
                        "table": "physical_table",
                    }
                },
                "primaryKey": "",
            }
        ],
        dbschema_retrieval=[],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    table_ddl = result["db_schemas"][0]["table_ddl"]
    executable_ddl = table_ddl.split("CREATE TABLE", maxsplit=1)[1]

    assert "CREATE TABLE modeled_dataset" in table_ddl
    assert "physical_catalog" not in table_ddl
    assert "physical_schema" not in table_ddl
    assert "physical_table" not in table_ddl
    assert "Business-facing attribute label." not in executable_ddl


def test_metric_schema_keeps_measure_semantics_outside_executable_ddl():
    class Encoding:
        def encode(self, value):
            return value.split()

    result = check_using_db_schemas_without_pruning(
        construct_db_schemas=[],
        dbschema_retrieval=[
            Document(
                content=str(
                    {
                        "type": "METRIC",
                        "name": "modeled_metric",
                        "comment": "Metric semantic description.",
                        "columns": [
                            {
                                "type": "COLUMN",
                                "comment": "-- This column is a dimension\n  ",
                                "name": "grouping_dimension",
                                "data_type": "VARCHAR",
                            },
                            {
                                "type": "COLUMN",
                                "comment": (
                                    "-- This column is a measure\n  "
                                    "-- expression: SUM(metric_value)\n  "
                                ),
                                "name": "defined_measure",
                                "data_type": "DOUBLE",
                            },
                        ],
                    }
                ),
                meta={"name": "modeled_metric"},
            )
        ],
        encoding=Encoding(),
        enable_column_pruning=False,
        context_window_size=1000,
    )

    table_ddl = result["db_schemas"][0]["table_ddl"]
    executable_ddl = table_ddl.split("CREATE TABLE", maxsplit=1)[1]

    assert "object_type: metric" in table_ddl
    assert "stable analytical aggregation interface" in table_ddl
    assert "SUM(metric_value)" in table_ddl
    assert "CREATE TABLE modeled_metric" in table_ddl
    assert "grouping_dimension VARCHAR" in executable_ddl
    assert "defined_measure DOUBLE" in executable_ddl
    assert "SUM(metric_value)" not in executable_ddl
    assert "-- This column is a measure" not in executable_ddl


def test_retrieved_schema_adds_generic_column_role_hints_without_comments():
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
                        "name": "entity_id",
                        "data_type": "INTEGER",
                        "comment": "Business identifier label.",
                        "is_primary_key": True,
                    },
                    {
                        "type": "COLUMN",
                        "name": "event_date",
                        "data_type": "DATE",
                        "comment": "Business date label.",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "measure_value",
                        "data_type": "DOUBLE",
                        "comment": "Business measure label.",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "category_label",
                        "data_type": "VARCHAR",
                        "comment": "Business category label.",
                        "is_primary_key": False,
                    },
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
    executable_ddl = table_ddl.split("CREATE TABLE", maxsplit=1)[1]

    assert "column_role_hints_not_identifiers" in table_ddl
    assert "- entity_id: identifier_candidate" in table_ddl
    assert "- event_date: date_time_candidate" in table_ddl
    assert "- measure_value: numeric_measure_candidate" in table_ddl
    assert "- category_label: dimension_candidate" in table_ddl
    assert "Business measure label." not in executable_ddl
    assert "Business category label." not in executable_ddl


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
