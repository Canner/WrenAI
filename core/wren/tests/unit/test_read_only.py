"""Governed SQL admission never opens a real connection."""

import base64
import json
from unittest.mock import Mock

import pyarrow as pa
import pytest
from sqlglot import parse_one

from wren.engine import WrenEngine
from wren.model.error import ErrorCode, ErrorPhase, WrenError
from wren.read_only import (
    NoSourceTablesError,
    require_source_tables,
    validate_read_only_query,
)

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT id FROM orders WHERE id IN (WITH orders AS (SELECT 1 AS id) SELECT id FROM orders)",
        "WITH orders AS (SELECT id FROM orders) SELECT id FROM orders",
        "WITH orders AS (SELECT 1 AS id) SELECT id FROM main.orders",
    ],
)
def test_only_a_cte_visible_at_the_reference_can_hide_a_stored_source(sql):
    assert require_source_tables(parse_one(sql, dialect="duckdb")) == ["orders"]


@pytest.mark.parametrize(
    "sql",
    [
        'WITH Orders AS (SELECT 1 AS id) SELECT id FROM "orders"',
        "WITH Orders AS (SELECT 1 AS id), x AS (SELECT id FROM orders) SELECT id FROM x",
        "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<2) SELECT n FROM x",
    ],
)
def test_visible_casefolded_cte_references_still_read_no_stored_source(sql):
    with pytest.raises(NoSourceTablesError):
        require_source_tables(parse_one(sql, dialect="duckdb"))


def test_postgres_quoted_cte_does_not_shadow_a_differently_cased_model():
    ast = parse_one(
        'WITH "Orders" AS (SELECT 1 AS id) SELECT id FROM orders', dialect="postgres"
    )
    assert require_source_tables(ast, "postgres") == ["orders"]

    exact = parse_one(
        'WITH "Orders" AS (SELECT 1 AS id) SELECT id FROM "Orders"',
        dialect="postgres",
    )
    with pytest.raises(NoSourceTablesError):
        require_source_tables(exact, "postgres")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "SELECT sum(amount) FROM orders",
        "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
        "SELECT 1 UNION ALL SELECT 2",
        "SELECT date_trunc('month', d) FROM orders",
        # Boolean connectors and EXISTS are syntax that sqlglot models as Func
        # nodes; they must never trip the function allow-list.
        "SELECT count(*) FROM customers WHERE n >= 1 AND (ltv = 0 OR ltv IS NULL)",
        "SELECT count(*) FROM customers WHERE coalesce(ltv, 0) = 0 AND n > 0",
        "SELECT count(*) FROM customers c WHERE EXISTS "
        "(SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id)",
        "SELECT sum(CASE WHEN ltv = 0 OR ltv IS NULL THEN 1 ELSE 0 END) FROM customers",
        "SELECT count_if(ltv = 0) FROM customers",
        "SELECT status, any_value(amount), median(amount) FROM orders GROUP BY status",
    ],
)
def test_read_only_accepts_analytical_query(sql):
    validate_read_only_query(sql, "duckdb")


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM orders",
        "DROP TABLE orders",
        "UPDATE orders SET n=1",
        "SELECT 1; DELETE FROM orders",
        "COPY orders TO '/tmp/out'",
        "SELECT * INTO stolen FROM orders",
        "SELECT * FROM orders FOR UPDATE",
        "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x",
        "SELECT read_csv('/etc/passwd')",
        "SELECT nextval('seq')",
        "SELECT pg_sleep(99)",
        "SELECT evil.do_write()",
        "SELECT sys.sum(1)",
        "SELECT unknown_udf(1)",
        "CALL do_write()",
        "SELECT set_config('x','y',true)",
    ],
)
def test_read_only_rejects_side_effects(sql):
    with pytest.raises(WrenError):
        validate_read_only_query(sql, "postgres")


def test_read_only_rejection_is_a_policy_check():
    with pytest.raises(WrenError) as caught:
        validate_read_only_query("SELECT unknown_udf(1)", "duckdb")
    assert caught.value.error_code is ErrorCode.INVALID_SQL
    assert caught.value.phase is ErrorPhase.SQL_POLICY_CHECK


def test_governed_query_forces_semantic_policy_before_connector():
    manifest = base64.b64encode(
        json.dumps({"models": [], "views": []}).encode()
    ).decode()
    engine = WrenEngine(manifest, "duckdb", {})
    engine._get_connector = Mock(side_effect=AssertionError("must not connect"))
    with pytest.raises(WrenError):
        engine.query("SELECT * FROM outside_model", read_only=True)
    engine._get_connector.assert_not_called()


def test_governed_query_runs_an_allowed_read_only_query():
    manifest = base64.b64encode(
        json.dumps({"models": [{"name": "orders"}], "views": []}).encode()
    ).decode()
    engine = WrenEngine(manifest, "duckdb", {})
    connector = Mock()
    expected = pa.table({"id": [1]})
    connector.query.return_value = expected
    engine.dry_plan = Mock(return_value="SELECT id FROM orders")
    engine._get_connector = Mock(return_value=connector)

    assert engine.query(
        "SELECT id FROM orders", limit=5, read_only=True
    ).to_pylist() == [{"id": 1}]
    engine.dry_plan.assert_called_once_with("SELECT id FROM orders", None)
    connector.query.assert_called_once_with("SELECT id FROM orders", 5)


@pytest.mark.parametrize(
    "sql",
    [
        "WITH unused AS (SELECT id FROM orders) SELECT 424 AS total",
        "WITH unused AS (SELECT id FROM orders), literal AS (SELECT 424 AS total) SELECT total FROM literal",
        "WITH live AS (SELECT id FROM orders), outer_cte AS (WITH live AS (SELECT 424 AS id) SELECT id FROM live) SELECT id FROM outer_cte",
        "WITH RECURSIVE unused AS (SELECT id FROM orders UNION ALL SELECT id FROM unused) SELECT 424",
        "WITH nested AS (WITH unused AS (SELECT id FROM orders) SELECT 424 AS total) SELECT total FROM nested",
    ],
)
def test_unused_cte_tables_cannot_ground_literal_results(sql):
    with pytest.raises(NoSourceTablesError):
        require_source_tables(parse_one(sql, dialect="duckdb"))


@pytest.mark.parametrize(
    "sql",
    [
        "WITH unused AS (SELECT id FROM customers), live AS (SELECT id FROM orders) SELECT id FROM live",
        "WITH live AS (SELECT id FROM orders) SELECT id FROM LIVE",
        "WITH RECURSIVE live AS (SELECT id FROM orders UNION ALL SELECT id FROM live) SELECT id FROM live",
        "SELECT (SELECT COUNT(*) FROM orders)",
        "SELECT id FROM (SELECT id FROM orders) s",
    ],
)
def test_only_consumed_lexical_scopes_supply_grounding(sql):
    assert require_source_tables(parse_one(sql, dialect="duckdb")) == ["orders"]


def test_casefolded_inner_cte_shadows_outer_stored_source():
    sql = "WITH named AS (SELECT id FROM orders) SELECT id FROM (WITH NAMED AS (SELECT 424 AS id) SELECT id FROM named) s"
    with pytest.raises(NoSourceTablesError):
        require_source_tables(parse_one(sql, dialect="duckdb"))


def test_casefolded_inner_stored_cte_shadows_outer_literal():
    sql = "WITH named AS (SELECT 424 AS id) SELECT id FROM (WITH NAMED AS (SELECT id FROM orders) SELECT id FROM named) s"
    assert require_source_tables(parse_one(sql, dialect="duckdb")) == ["orders"]


def test_a_later_nonrecursive_cte_does_not_hide_a_stored_source():
    sql = "WITH first_cte AS (SELECT id FROM orders), orders AS (SELECT 424 AS id) SELECT id FROM first_cte"
    assert require_source_tables(parse_one(sql, dialect="duckdb")) == ["orders"]
