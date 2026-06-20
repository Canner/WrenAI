from src.pipelines.retrieval.db_schema_retrieval import (
    _is_project_wide_analysis_query,
    expand_business_terms_for_retrieval,
)


def test_project_wide_analysis_query_includes_broad_ranking_questions():
    assert _is_project_wide_analysis_query(
        "Which projects have the highest number of completed questions?"
    )


def test_project_wide_analysis_query_ignores_empty_query():
    assert not _is_project_wide_analysis_query("")


def test_expand_business_terms_for_retrieval_includes_sales_aliases():
    expanded = expand_business_terms_for_retrieval(
        "Create a SalesPerson performance ranking chart"
    )

    assert "salesperson ranking" in expanded
    assert "customer growth" in expanded
    assert "Create a SalesPerson performance ranking chart" in expanded


def test_expand_business_terms_for_retrieval_leaves_non_analytics_query_unchanged():
    query = "Explain what this workspace does"

    assert expand_business_terms_for_retrieval(query) == query
