"""Governed SQL admission never opens a real connection."""

import base64
import json
from unittest.mock import Mock

import pytest

from wren.engine import WrenEngine
from wren.model.error import ErrorCode, ErrorPhase, WrenError
from wren.read_only import validate_read_only_query

pytestmark = pytest.mark.unit


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
