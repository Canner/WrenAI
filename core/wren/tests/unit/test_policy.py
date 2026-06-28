"""Unit tests for wren.policy — SQL policy validation.

These tests use sqlglot parsing only and do not require a database or wren-core.
"""

from __future__ import annotations

import pytest
from sqlglot import exp, parse_one

from wren.config import WrenConfig
from wren.model.error import ErrorCode, WrenError
from wren.policy import validate_sql_policy

pytestmark = pytest.mark.unit

_MODELS = {"orders", "customers"}


# ── Table validation ──────────────────────────────────────────────────────


def test_valid_query_all_tables_in_mdl():
    ast = parse_one('SELECT * FROM "orders"', dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    validate_sql_policy(ast, _MODELS, config)


def test_table_not_in_mdl_raises():
    ast = parse_one("SELECT * FROM pg_shadow", dialect="postgres")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND
    assert "pg_shadow" in str(exc_info.value)


def test_user_cte_not_flagged():
    sql = "WITH foo AS (SELECT 1 AS x) SELECT * FROM foo"
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    validate_sql_policy(ast, _MODELS, config)


def test_mixed_mdl_and_non_mdl_table_raises():
    sql = 'SELECT * FROM "orders" JOIN secret_table ON 1=1'
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND
    assert "secret_table" in str(exc_info.value)


def test_strict_mode_off_allows_unknown_table():
    ast = parse_one("SELECT * FROM unknown_table", dialect="duckdb")
    config = WrenConfig(strict_mode=False)
    validate_sql_policy(ast, _MODELS, config)


def test_subquery_alias_not_flagged():
    sql = "SELECT * FROM (SELECT 1 AS x) AS t"
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    # 't' is a subquery alias, not a real table — but sqlglot doesn't emit
    # an exp.Table for it, so this should pass without error.
    # The only table nodes come from real FROM references.
    validate_sql_policy(ast, _MODELS, config)


def test_multiple_valid_tables():
    sql = 'SELECT * FROM "orders" o JOIN "customers" c ON o.id = c.id'
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    validate_sql_policy(ast, _MODELS, config)


# ── Denied functions ──────────────────────────────────────────────────────


def test_denied_function_raises():
    ast = parse_one("SELECT pg_read_file('/etc/passwd')", dialect="postgres")
    config = WrenConfig(denied_functions=frozenset(["pg_read_file"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION
    assert "pg_read_file" in str(exc_info.value)


def test_denied_function_case_insensitive():
    ast = parse_one("SELECT PG_READ_FILE('/etc/passwd')", dialect="postgres")
    config = WrenConfig(denied_functions=frozenset(["pg_read_file"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION


def test_allowed_function_passes():
    ast = parse_one('SELECT COUNT(*) FROM "orders"', dialect="duckdb")
    config = WrenConfig(denied_functions=frozenset(["pg_read_file"]))
    validate_sql_policy(ast, _MODELS, config)


def test_builtin_function_on_denied_list():
    ast = parse_one('SELECT COUNT(*) FROM "orders"', dialect="duckdb")
    config = WrenConfig(denied_functions=frozenset(["count"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION


def test_denied_function_reclassified_by_sqlglot():
    """A denied name still matches when sqlglot maps it to a concrete subclass.

    sqlglot >=29 parses ``version()`` on postgres into ``exp.CurrentVersion``
    (``type(node).key == "currentversion"``), not ``exp.Anonymous``. Denying
    ``"version"`` must still block it via the canonical-key expansion.
    """
    ast = parse_one("SELECT version()", dialect="postgres")
    # Guard the premise: the test only exercises the canonical-key expansion if
    # sqlglot actually reclassified version() off exp.Anonymous.
    func = next(ast.find_all(exp.Func))
    assert not isinstance(func, exp.Anonymous), (
        "version() should be reclassified to a concrete subclass in this "
        "sqlglot version"
    )
    config = WrenConfig(denied_functions=frozenset(["version"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION


def test_nested_denied_function():
    sql = "SELECT * FROM (SELECT dblink('host=evil', 'SELECT 1') AS x) AS t"
    ast = parse_one(sql, dialect="postgres")
    config = WrenConfig(denied_functions=frozenset(["dblink"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION


def test_no_denied_list_allows_everything():
    ast = parse_one("SELECT pg_read_file('/etc/passwd')", dialect="postgres")
    config = WrenConfig(denied_functions=frozenset())
    validate_sql_policy(ast, _MODELS, config)


def test_empty_denied_list_allows_everything():
    ast = parse_one("SELECT dblink('host=evil', 'SELECT 1')", dialect="postgres")
    config = WrenConfig()
    validate_sql_policy(ast, _MODELS, config)


# ── Combined strict_mode + denied_functions ───────────────────────────────


def test_strict_mode_and_denied_functions_together():
    sql = 'SELECT pg_read_file(o_orderkey) FROM "orders"'
    ast = parse_one(sql, dialect="postgres")
    config = WrenConfig(strict_mode=True, denied_functions=frozenset(["pg_read_file"]))
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    # Either error is acceptable — table check runs first, but orders is valid
    # so function check should fire
    assert exc_info.value.error_code == ErrorCode.BLOCKED_FUNCTION


# ── CTE scope shadowing ──────────────────────────────────────────────────


def test_nested_cte_does_not_shadow_outer_table():
    """A CTE defined inside a subquery must not hide an outer FROM reference."""
    sql = """
    SELECT *
    FROM secret_table
    WHERE EXISTS (
      WITH secret_table AS (SELECT 1)
      SELECT 1 FROM secret_table
    )
    """
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND
    assert "secret_table" in str(exc_info.value)


def test_outer_cte_visible_in_body():
    """A CTE defined at the top level should be visible in the main SELECT."""
    sql = 'WITH tmp AS (SELECT 1 AS x FROM "orders") SELECT * FROM tmp'
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    validate_sql_policy(ast, _MODELS, config)


# ── Table-valued functions ────────────────────────────────────────────────


def test_tvf_read_csv_blocked():
    ast = parse_one("SELECT * FROM read_csv('s3://bucket/file.csv')", dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND


def test_tvf_generate_series_blocked():
    sql = "SELECT * FROM generate_series(1, 10) AS t(x)"
    ast = parse_one(sql, dialect="postgres")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND


def test_tvf_unnest_blocked():
    sql = "SELECT * FROM unnest(ARRAY[1,2,3]) AS t(x)"
    ast = parse_one(sql, dialect="duckdb")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND


def test_tvf_allowed_when_not_strict():
    ast = parse_one("SELECT * FROM read_csv('file.csv')", dialect="duckdb")
    config = WrenConfig(strict_mode=False)
    validate_sql_policy(ast, _MODELS, config)


def test_tvf_unnest_in_join_blocked():
    # Regression: a table-valued function reached via a JOIN (rather than the
    # FROM source) must still be blocked in strict mode. UNNEST parses to an
    # exp.Unnest (an exp.Func subclass) with no exp.Table node, so the table
    # scan misses it and only the FROM/JOIN func scan can catch it.
    sql = "SELECT * FROM orders CROSS JOIN UNNEST(orders.items) AS t(item)"
    ast = parse_one(sql, dialect="trino")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND


def test_tvf_generate_series_in_join_blocked():
    sql = "SELECT * FROM orders JOIN generate_series(1, 10) AS g(x) ON true"
    ast = parse_one(sql, dialect="postgres")
    config = WrenConfig(strict_mode=True)
    with pytest.raises(WrenError) as exc_info:
        validate_sql_policy(ast, _MODELS, config)
    assert exc_info.value.error_code == ErrorCode.MODEL_NOT_FOUND


def test_join_between_two_mdl_models_allowed():
    # Guard against over-blocking: a plain JOIN between two manifest models
    # must still pass.
    sql = "SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id"
    ast = parse_one(sql, dialect="trino")
    config = WrenConfig(strict_mode=True)
    validate_sql_policy(ast, _MODELS, config)
