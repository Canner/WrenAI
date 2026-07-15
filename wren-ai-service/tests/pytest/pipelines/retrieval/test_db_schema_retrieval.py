import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    _rerank_table_documents,
    _select_relevant_table_documents,
    check_using_db_schemas_without_pruning,
    dbschema_retrieval,
    expand_business_terms_for_retrieval,
    table_retrieval,
)


def test_project_wide_analysis_query_includes_broad_ranking_questions():
    assert _is_project_wide_analysis_query(
        "Which projects have the highest number of completed questions?"
    )


def test_project_wide_analysis_query_ignores_empty_query():
    assert not _is_project_wide_analysis_query("")


def test_expand_business_terms_for_retrieval_adds_generic_sales_order_terms():
    query = "Show top customers by invoice amount"

    expanded_query = expand_business_terms_for_retrieval(query)

    assert query in expanded_query
    assert "transaction purchase billing account geography" in expanded_query
    assert "money exchange currency" in expanded_query


def test_expand_business_terms_for_retrieval_adds_generic_currency_market_terms():
    query = "Show invoice distribution by currency across markets"

    expanded_query = expand_business_terms_for_retrieval(query)

    assert query in expanded_query
    assert "money exchange currency" in expanded_query


def test_expand_business_terms_for_retrieval_leaves_query_unchanged():
    query = "Explain what this workspace does"

    assert expand_business_terms_for_retrieval(query) == query


def test_rerank_table_documents_prefers_question_relevant_table_text():
    generic_stage = Document(
        content="Generic imported staging records with product labels.",
        meta={"type": "TABLE_DESCRIPTION", "name": "generic_stage_load"},
        score=0.99,
    )
    order_region_table = Document(
        content="Business transactions grouped by customer geography and amount.",
        meta={"type": "TABLE_DESCRIPTION", "name": "business_transactions"},
        score=0.01,
    )

    documents = _rerank_table_documents(
        "Show order distribution across regions.",
        [generic_stage, order_region_table],
    )

    assert documents[0].meta["name"] == "business_transactions"


def test_rerank_table_documents_penalizes_test_sources_even_when_name_uses_underscores():
    test_load = Document(
        content="Raw test load rows for order market fields.",
        meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageLoad8_Test"},
        score=0.99,
    )
    order_market_table = Document(
        content="New order transaction records with market and customer fields.",
        meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageNewOrders"},
        score=0.45,
    )

    documents = _rerank_table_documents(
        "Show order distribution across markets.",
        [test_load, order_market_table],
    )

    assert documents[0].meta["name"] == "dbo_xStageNewOrders"


def test_select_relevant_table_documents_limits_weak_extra_candidates():
    documents = [
        Document(
            content="Invoice transactions with product, customer, currency, and amount.",
            meta={"type": "TABLE_DESCRIPTION", "name": "invoices"},
            score=0.92,
        ),
        Document(
            content="Product catalog with product names and categories.",
            meta={"type": "TABLE_DESCRIPTION", "name": "products"},
            score=0.86,
        ),
        Document(
            content="Customer account master data.",
            meta={"type": "TABLE_DESCRIPTION", "name": "customers"},
            score=0.82,
        ),
        Document(
            content="Exchange rate lookup by currency.",
            meta={"type": "TABLE_DESCRIPTION", "name": "currency_rates"},
            score=0.78,
        ),
        Document(
            content="Sales regions and market hierarchy.",
            meta={"type": "TABLE_DESCRIPTION", "name": "regions"},
            score=0.74,
        ),
        Document(
            content="Raw staging audit rows with load metadata.",
            meta={"type": "TABLE_DESCRIPTION", "name": "staging_audit"},
            score=0.99,
        ),
    ]

    selected = _select_relevant_table_documents(
        "Show invoice distribution by currency across markets",
        documents,
    )

    assert 1 <= len(selected) <= 5
    assert "staging_audit" not in [document.meta["name"] for document in selected]


def test_select_relevant_table_documents_excludes_unrequested_test_candidate():
    documents = [
        Document(
            content="Raw test load rows with order market fields.",
            meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageLoad8_Test"},
            score=0.99,
        ),
        Document(
            content="New order transaction records with market and customer details.",
            meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageNewOrders"},
            score=0.4,
        ),
    ]

    selected = _select_relevant_table_documents(
        "Show order distribution across markets.",
        documents,
    )

    assert [document.meta["name"] for document in selected] == ["dbo_xStageNewOrders"]


def test_select_relevant_table_documents_keeps_requested_test_candidate():
    documents = [
        Document(
            content="Raw test load rows with order market fields.",
            meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageLoad8_Test"},
            score=0.99,
        ),
        Document(
            content="New order transaction records with market and customer details.",
            meta={"type": "TABLE_DESCRIPTION", "name": "dbo_xStageNewOrders"},
            score=0.4,
        ),
    ]

    selected = _select_relevant_table_documents(
        "Show test load order distribution across markets.",
        documents,
    )

    assert "dbo_xStageLoad8_Test" in [document.meta["name"] for document in selected]


@pytest.mark.asyncio
async def test_table_retrieval_caps_embedding_results_before_schema_loading():
    documents = [
        Document(
            content="Raw staging audit rows with load metadata.",
            meta={"type": "TABLE_DESCRIPTION", "name": "staging_audit"},
            score=0.99,
        ),
        Document(
            content="Invoice sales transactions with product categories and sales value.",
            meta={"type": "TABLE_DESCRIPTION", "name": "sales_invoices"},
            score=0.8,
        ),
        Document(
            content="Product catalog with product names and categories.",
            meta={"type": "TABLE_DESCRIPTION", "name": "products"},
            score=0.7,
        ),
        Document(
            content="Customer account master data.",
            meta={"type": "TABLE_DESCRIPTION", "name": "customers"},
            score=0.6,
        ),
        Document(
            content="Sales regions and market hierarchy.",
            meta={"type": "TABLE_DESCRIPTION", "name": "regions"},
            score=0.5,
        ),
        Document(
            content="Exchange rate lookup by currency.",
            meta={"type": "TABLE_DESCRIPTION", "name": "currency_rates"},
            score=0.4,
        ),
    ]

    class Retriever:
        async def run(self, query_embedding, filters):
            return {"documents": documents}

    result = await table_retrieval(
        query="What is the distribution of sales across product categories?",
        embedding={"embedding": [0.1, 0.2]},
        project_id="project-1",
        tables=[],
        table_retriever=Retriever(),
    )

    selected_names = [document.meta["name"] for document in result["documents"]]
    assert 1 <= len(selected_names) <= 5
    assert "staging_audit" not in selected_names


def test_rerank_table_documents_prefers_reference_source_for_entity_listing():
    transaction_source = Document(
        content="Invoice transaction fact rows with customer id and invoice amount.",
        meta={"type": "TABLE_DESCRIPTION", "name": "invoice_fact"},
        score=0.95,
    )
    reference_source = Document(
        content="Customer master reference directory with customer names and accounts.",
        meta={"type": "TABLE_DESCRIPTION", "name": "customer_master"},
        score=0.7,
    )

    documents = _rerank_table_documents(
        "List customer names without duplicates.",
        [transaction_source, reference_source],
    )

    assert documents[0].meta["name"] == "customer_master"


def test_rerank_table_documents_prefers_transaction_source_for_metric_question():
    reference_source = Document(
        content="Product catalog reference table with names and categories.",
        meta={"type": "TABLE_DESCRIPTION", "name": "product_master"},
        score=0.95,
    )
    transaction_source = Document(
        content="Sales transaction fact table with product, amount, and revenue.",
        meta={"type": "TABLE_DESCRIPTION", "name": "sales_fact"},
        score=0.7,
    )

    documents = _rerank_table_documents(
        "Show total sales amount by product.",
        [reference_source, transaction_source],
    )

    assert documents[0].meta["name"] == "sales_fact"


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
        query="show rows",
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
        query="total orders",
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
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {"field": "name", "operator": "in", "value": ["orders"]},
        ],
    }


@pytest.mark.asyncio
async def test_dbschema_retrieval_filters_unrequested_noisy_full_schema():
    class Retriever:
        async def run(self, query_embedding, filters):
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
                                "name": "orders_test_duplicate",
                                "columns": [],
                            }
                        ),
                        meta={"type": "TABLE_SCHEMA", "name": "orders_test_duplicate"},
                    ),
                ]
            }

    documents = await dbschema_retrieval(
        query="",
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=Retriever(),
    )

    assert [document.meta["name"] for document in documents] == ["orders"]


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
        query="show top customers by invoice amount",
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


@pytest.mark.asyncio
async def test_dbschema_retrieval_uses_explicit_tables_as_scope():
    class Retriever:
        def __init__(self):
            self.filters = None

        async def run(self, query_embedding, filters):
            self.filters = filters
            return {"documents": []}

    retriever = Retriever()

    await dbschema_retrieval(
        query="show failed repairs",
        table_retrieval={"documents": []},
        project_id="project-1",
        dbschema_retriever=retriever,
        tables=["dbo.failure_patterns", "dbo_failure_patterns"],
    )

    assert retriever.filters == {
        "operator": "AND",
        "conditions": [
            {"field": "type", "operator": "==", "value": "TABLE_SCHEMA"},
            {"field": "project_id", "operator": "==", "value": "project-1"},
            {
                "field": "name",
                "operator": "in",
                "value": ["dbo.failure_patterns", "dbo_failure_patterns"],
            },
        ],
    }
