import pytest
from haystack import Document

from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    construct_retrieval_results,
    dbschema_retrieval,
    expand_business_terms_for_retrieval,
    prompt,
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
                    "candidate_schema_scores": [
                      {
                        "candidate_id": "candidate-1",
                        "schema_objects": ["invoices.customer_id", "invoices.invoice_amount"],
                        "covered_concepts": ["invoice amount", "customer"],
                        "missing_concepts": [],
                        "confidence": 0.95,
                        "is_complete": true,
                        "selection_reason": "Complete invoice amount by customer mapping."
                      }
                    ],
                    "concept_mappings": [
                      {
                        "request_concept": "invoice amount",
                        "concept_type": "metric",
                        "schema_objects": ["invoices.invoice_amount"],
                        "required_in_sql": true,
                        "confidence": 0.95,
                        "mapping_reason": "invoice_amount stores invoice value"
                      }
                    ],
                    "interpretations": [
                      {
                        "description": "Summarize invoice amount by customer",
                        "schema_objects": ["invoices.customer_id", "invoices.invoice_amount"],
                        "confidence": 0.9,
                        "is_selected": true
                      }
                    ],
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
    assert result["semantic_analysis"]["concept_mappings"][0]["schema_objects"] == [
        "invoices.invoice_amount"
    ]
    assert result["semantic_analysis"]["candidate_schema_scores"][0]["is_complete"]
    assert result["semantic_analysis"]["interpretations"][0]["is_selected"] is True
    assert result["retrieval_results"][0]["table_name"] == "invoices"
    assert "invoice_amount" in result["retrieval_results"][0]["table_ddl"]
    assert "internal_note" not in result["retrieval_results"][0]["table_ddl"]


def test_prompt_includes_semantic_retry_context():
    class PromptBuilder:
        def run(self, **kwargs):
            retry_context = kwargs["semantic_retry_context"]
            return {
                "prompt": (
                    f"retry={retry_context['retry_attempt']} "
                    f"error={retry_context['validation_error']} "
                    f"rejected={','.join(retry_context['rejected_schema_objects'])}"
                )
            }

    result = prompt(
        query="Top customers by invoice amount",
        construct_db_schemas=[
            {
                "type": "TABLE",
                "name": "invoices",
                "comment": "",
                "columns": [
                    {
                        "type": "COLUMN",
                        "name": "invoice_amount",
                        "data_type": "double",
                        "comment": "",
                        "is_primary_key": False,
                    }
                ],
            }
        ],
        prompt_builder=PromptBuilder(),
        check_using_db_schemas_without_pruning={"db_schemas": []},
        histories=[],
        semantic_retry_context={
            "validation_error": "Generic count did not answer invoice amount",
            "retry_attempt": 2,
            "rejected_schema_objects": ["dbo_ytblES002_1.Name_of_Reported_Received"],
        },
    )

    assert "retry=2" in result["prompt"]
    assert "Generic count" in result["prompt"]
    assert "dbo_ytblES002_1.Name_of_Reported_Received" in result["prompt"]
