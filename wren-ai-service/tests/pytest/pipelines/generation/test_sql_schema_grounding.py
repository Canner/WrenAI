from src.pipelines.generation.utils.sql import (
    normalize_sql_with_schema_identifiers,
    validate_sql_against_contexts,
)

SCHEMA_CONTEXTS = [
    """
    CREATE TABLE valid_invoice_comments (
        invoice_id VARCHAR,
        comment_id VARCHAR
    );
    """,
    """
    CREATE TABLE "valid-order-lines" (
        order_id VARCHAR,
        line_amount DECIMAL
    );
    """,
]


def test_schema_grounding_rejects_unretrieved_table_name():
    error = validate_sql_against_contexts(
        "SELECT invoice_id, COUNT(comment_id) FROM comments GROUP BY invoice_id",
        SCHEMA_CONTEXTS,
    )

    assert error is not None
    assert "comments" in error
    assert "valid_invoice_comments" in error


def test_schema_grounding_accepts_retrieved_table_name():
    error = validate_sql_against_contexts(
        """
        SELECT invoice_id, COUNT(comment_id)
        FROM valid_invoice_comments
        GROUP BY invoice_id
        """,
        SCHEMA_CONTEXTS,
    )

    assert error is None


def test_schema_grounding_rejects_invalid_qualified_column():
    error = validate_sql_against_contexts(
        """
        SELECT c.invoice_number
        FROM valid_invoice_comments c
        """,
        SCHEMA_CONTEXTS,
    )

    assert error is not None
    assert "c.invoice_number" in error


def test_schema_identifier_normalization_quotes_special_identifiers():
    sql = normalize_sql_with_schema_identifiers(
        "SELECT order_id FROM [valid-order-lines]",
        SCHEMA_CONTEXTS,
    )

    assert 'FROM "valid-order-lines"' in sql
