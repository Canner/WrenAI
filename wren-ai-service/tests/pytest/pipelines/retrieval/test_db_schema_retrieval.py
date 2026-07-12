import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    _rerank_table_documents,
    dbschema_retrieval,
    expand_business_terms_for_retrieval,
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
