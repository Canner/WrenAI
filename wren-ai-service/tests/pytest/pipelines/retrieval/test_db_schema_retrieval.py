import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    dbschema_retrieval,
    expand_business_terms_for_retrieval,
    rank_semantic_schema_candidates,
)


def test_project_wide_analysis_query_includes_broad_ranking_questions():
    assert _is_project_wide_analysis_query(
        "Which projects have the highest number of completed questions?"
    )


def test_project_wide_analysis_query_ignores_empty_query():
    assert not _is_project_wide_analysis_query("")


def test_expand_business_terms_for_retrieval_does_not_add_datasource_specific_aliases():
    query = "Create a SalesPerson performance ranking chart"

    assert expand_business_terms_for_retrieval(query) == query


def test_expand_business_terms_for_retrieval_leaves_query_unchanged():
    query = "Explain what this workspace does"

    assert expand_business_terms_for_retrieval(query) == query


def test_rank_semantic_schema_candidates_prefers_complete_business_concept_coverage():
    schemas = [
        {
            "type": "TABLE",
            "name": "dbo_invoices",
            "columns": [
                {"name": "invoice_amount", "data_type": "decimal"},
                {"name": "customer_name", "data_type": "varchar"},
            ],
        },
        {
            "type": "TABLE",
            "name": "dbo_invoice_ids",
            "columns": [
                {"name": "invoice_id", "data_type": "varchar"},
            ],
        },
    ]

    candidates = rank_semantic_schema_candidates(
        "Show top customers by invoice amount",
        schemas,
    )

    assert candidates[0]["table_name"] == "dbo_invoices"
    assert "customer" in candidates[0]["matched_query_terms"]
    assert "invoice" in candidates[0]["matched_query_terms"]
    assert "amount" in candidates[0]["matched_query_terms"]


def test_rank_semantic_schema_candidates_uses_retry_rejections_as_negative_feedback():
    schemas = [
        {
            "type": "TABLE",
            "name": "dbo_invoices",
            "columns": [
                {"name": "invoice_amount", "data_type": "decimal"},
                {"name": "customer_name", "data_type": "varchar"},
            ],
        },
        {
            "type": "TABLE",
            "name": "dbo_invoice_summary",
            "columns": [
                {"name": "total_invoice_amount", "data_type": "decimal"},
                {"name": "customer_name", "data_type": "varchar"},
            ],
        },
    ]

    candidates = rank_semantic_schema_candidates(
        "Show top customers by invoice amount",
        schemas,
        semantic_retry_context={
            "rejected_schema_objects": [
                "dbo_invoices",
                "dbo_invoices.invoice_amount",
            ]
        },
    )

    assert candidates[0]["table_name"] == "dbo_invoice_summary"
    assert candidates[0]["rejected_by_retry"] is False


@pytest.mark.asyncio
async def test_dbschema_retrieval_loads_complete_active_project_schema():
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
        ],
    }
