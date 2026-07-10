import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    construct_retrieval_results,
    dbschema_retrieval,
    expand_business_terms_for_retrieval,
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


def test_construct_retrieval_results_preserves_semantic_analysis():
    result = construct_retrieval_results(
        check_using_db_schemas_without_pruning={"db_schemas": []},
        filter_columns_in_tables={
            "replies": [
                """
                {
                  "semantic_analysis": {
                    "analytical_intent": "summary",
                    "entities": ["invoice"],
                    "metrics": ["invoice amount"],
                    "dimensions": ["customer"],
                    "is_fully_supported": true
                  },
                  "results": [
                    {
                      "table_name": "invoices",
                      "table_selection_reason": "Contains invoice facts.",
                      "table_contents": {
                        "chain_of_thought_reasoning": [
                          "Needed to group by customer.",
                          "Needed to sum invoice amount."
                        ],
                        "columns": ["customer_id", "invoice_amount"]
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
                "name": "invoices",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "customer_id",
                        "data_type": "varchar",
                        "comment": "",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "invoice_amount",
                        "data_type": "double",
                        "comment": "",
                        "is_primary_key": False,
                    },
                    {
                        "type": "COLUMN",
                        "name": "internal_note",
                        "data_type": "varchar",
                        "comment": "",
                        "is_primary_key": False,
                    },
                ],
            }
        ],
        dbschema_retrieval=[],
    )

    assert result["semantic_analysis"]["metrics"] == ["invoice amount"]
    assert result["retrieval_results"][0]["table_name"] == "invoices"
    assert "invoice_amount" in result["retrieval_results"][0]["table_ddl"]
    assert "internal_note" not in result["retrieval_results"][0]["table_ddl"]
