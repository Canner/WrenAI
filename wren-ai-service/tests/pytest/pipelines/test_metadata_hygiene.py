from haystack import Document

from src.pipelines.metadata_hygiene import (
    filter_business_documents,
    filter_business_schema_contexts,
    is_noisy_schema_context,
    query_requests_noisy_metadata,
)


def test_filter_business_documents_excludes_unrequested_noisy_models():
    documents = [
        Document(
            content="Customer order transaction data.",
            meta={"name": "dbo_Orders", "type": "TABLE_DESCRIPTION"},
        ),
        Document(
            content="Raw temporary import rows.",
            meta={"name": "tmp_orders_import", "type": "TABLE_DESCRIPTION"},
        ),
        Document(
            content="Duplicate backup copy of orders.",
            meta={"name": "Orders_Backup_Copy", "type": "TABLE_DESCRIPTION"},
        ),
    ]

    filtered = filter_business_documents("show orders by customer", documents)

    assert [document.meta["name"] for document in filtered] == ["dbo_Orders"]


def test_filter_business_documents_keeps_noisy_models_when_explicitly_requested():
    documents = [
        Document(
            content="Customer order transaction data.",
            meta={"name": "dbo_Orders", "type": "TABLE_DESCRIPTION"},
        ),
        Document(
            content="Raw temporary import rows.",
            meta={"name": "tmp_orders_import", "type": "TABLE_DESCRIPTION"},
        ),
    ]

    filtered = filter_business_documents("show temporary import rows", documents)

    assert [document.meta["name"] for document in filtered] == [
        "dbo_Orders",
        "tmp_orders_import",
    ]


def test_filter_business_schema_contexts_preserves_all_when_only_noisy_context_exists():
    contexts = ["CREATE TABLE stg_orders_load (id INT, order_id INT);"]

    assert filter_business_schema_contexts("show orders", contexts) == contexts


def test_filter_business_schema_contexts_removes_noisy_contexts_when_business_exists():
    contexts = [
        "CREATE TABLE orders (id INT, customer_id INT);",
        "CREATE TABLE orders_test_duplicate (id INT, customer_id INT);",
        "CREATE TABLE debug_order_log (id INT, message TEXT);",
    ]

    assert filter_business_schema_contexts("show orders", contexts) == [
        "CREATE TABLE orders (id INT, customer_id INT);"
    ]


def test_noisy_context_detection_and_explicit_query_terms():
    assert is_noisy_schema_context("CREATE TABLE dbo_xStageLoad8_Test (id INT);")
    assert query_requests_noisy_metadata("compare staging load rows")
