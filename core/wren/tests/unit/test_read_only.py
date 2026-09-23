"""Governed SQL admission never opens a real connection."""

import base64
import json
from unittest.mock import Mock

import pytest

from wren.engine import WrenEngine
from wren.model.error import WrenError
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


def test_governed_query_forces_semantic_policy_before_connector():
    manifest = base64.b64encode(
        json.dumps({"models": [], "views": []}).encode()
    ).decode()
    engine = WrenEngine(manifest, "duckdb", {})
    engine._get_connector = Mock(side_effect=AssertionError("must not connect"))
    with pytest.raises(WrenError):
        engine.query("SELECT * FROM outside_model", read_only=True)
    engine._get_connector.assert_not_called()
