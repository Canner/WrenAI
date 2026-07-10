"""End-to-end tests for refSql model support.

Uses DuckDB with TPCH data to verify that models defined via ``refSql``
(a raw SQL query instead of a table reference) work through the full
WrenEngine pipeline: dry_plan → query → result.
"""

from __future__ import annotations

import base64

import duckdb
import orjson
import pyarrow as pa
import pytest

from wren import WrenEngine
from wren.model.data_source import DataSource

pytestmark = pytest.mark.duckdb


def _make_ref_sql_manifest() -> dict:
    """Manifest with one table_reference model and two refSql models.

    - ``orders``: standard TPCH orders table (table_reference)
    - ``high_value_orders``: refSql model filtering orders > $100k
    - ``order_summary``: refSql model aggregating orders by status
    """
    return {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "catalog": "tpch",
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
            },
            {
                "name": "high_value_orders",
                "refSql": (
                    "SELECT o_orderkey, o_custkey, o_totalprice "
                    "FROM tpch.main.orders WHERE o_totalprice > 100000"
                ),
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_totalprice", "type": "double"},
                ],
            },
            {
                "name": "order_summary",
                "refSql": (
                    "SELECT o_orderstatus, COUNT(*) AS order_count, "
                    "SUM(o_totalprice) AS total_amount "
                    "FROM tpch.main.orders GROUP BY o_orderstatus"
                ),
                "columns": [
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "order_count", "type": "bigint"},
                    {"name": "total_amount", "type": "double"},
                ],
            },
        ],
    }


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    """WrenEngine backed by DuckDB with TPCH sf=0.01 data."""
    db_dir = tmp_path_factory.mktemp("refsql_duckdb")
    db_path = db_dir / "tpch.duckdb"

    con = duckdb.connect(str(db_path))
    con.execute("INSTALL tpch; LOAD tpch; CALL dbgen(sf=0.01)")
    con.close()

    manifest = _make_ref_sql_manifest()
    manifest_str = base64.b64encode(orjson.dumps(manifest)).decode()
    conn_info = {"url": str(db_dir), "format": "duckdb"}
    with WrenEngine(manifest_str, DataSource.duckdb, conn_info, fallback=False) as e:
        yield e


# ------------------------------------------------------------------
# dry_plan — verify SQL transpilation (no execution)
# ------------------------------------------------------------------


class TestRefSqlDryPlan:
    """dry_plan should expand refSql models into subqueries."""

    def test_dry_plan_ref_sql_model(self, engine: WrenEngine) -> None:
        planned = engine.dry_plan('SELECT o_orderkey FROM "high_value_orders" LIMIT 1')
        assert isinstance(planned, str)
        # The refSql should appear as a subquery in the planned output
        assert "100000" in planned, f"Expected refSql content in planned SQL: {planned}"

    def test_dry_plan_ref_sql_aggregate_model(self, engine: WrenEngine) -> None:
        planned = engine.dry_plan(
            'SELECT o_orderstatus, order_count FROM "order_summary"'
        )
        assert isinstance(planned, str)
        assert "o_orderstatus" in planned.lower()
        assert "group by" in planned.lower()

    def test_dry_plan_table_ref_model_still_works(self, engine: WrenEngine) -> None:
        planned = engine.dry_plan('SELECT o_orderkey FROM "orders" LIMIT 1')
        assert isinstance(planned, str)
        assert "orders" in planned.lower()


# ------------------------------------------------------------------
# Query execution — end-to-end with real data
# ------------------------------------------------------------------


class TestRefSqlQuery:
    """Full query execution against refSql models backed by real DuckDB data."""

    def test_query_ref_sql_returns_rows(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT o_orderkey, o_totalprice FROM "high_value_orders" LIMIT 5'
        )
        assert isinstance(result, pa.Table)
        assert result.num_rows == 5
        assert "o_orderkey" in result.column_names
        assert "o_totalprice" in result.column_names
        # All rows should have totalprice > 100000 (filter in refSql)
        for i in range(result.num_rows):
            assert result["o_totalprice"][i].as_py() > 100000

    def test_query_ref_sql_aggregate(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT o_orderstatus, order_count, total_amount FROM "order_summary"'
        )
        assert isinstance(result, pa.Table)
        # TPCH has 3 order statuses: F, O, P
        assert result.num_rows > 0
        statuses = {result["o_orderstatus"][i].as_py() for i in range(result.num_rows)}
        assert statuses.issubset({"F", "O", "P"})
        # Each count should be positive
        for i in range(result.num_rows):
            assert result["order_count"][i].as_py() > 0
            assert result["total_amount"][i].as_py() > 0

    def test_query_ref_sql_with_where(self, engine: WrenEngine) -> None:
        """WHERE clause on top of a refSql model should compose correctly."""
        result = engine.query(
            'SELECT o_orderkey, o_totalprice FROM "high_value_orders" '
            "WHERE o_totalprice > 200000 LIMIT 10"
        )
        assert isinstance(result, pa.Table)
        # All rows must satisfy both the refSql filter (>100k) and query filter (>200k)
        for i in range(result.num_rows):
            assert result["o_totalprice"][i].as_py() > 200000

    def test_query_ref_sql_count(self, engine: WrenEngine) -> None:
        """COUNT(*) on a refSql model."""
        result = engine.query('SELECT COUNT(*) AS cnt FROM "high_value_orders"')
        count = result["cnt"][0].as_py()
        # The refSql filters orders > 100k, so count should be less than total (15000)
        assert 0 < count < 15000

    def test_query_table_ref_model_coexists(self, engine: WrenEngine) -> None:
        """Table-reference models should still work alongside refSql models."""
        result = engine.query('SELECT COUNT(*) AS cnt FROM "orders"')
        assert result["cnt"][0].as_py() == 15000  # TPCH sf=0.01

    def test_query_ref_sql_with_order_by(self, engine: WrenEngine) -> None:
        result = engine.query(
            'SELECT o_orderkey, o_totalprice FROM "high_value_orders" '
            "ORDER BY o_totalprice DESC LIMIT 3"
        )
        assert result.num_rows == 3
        prices = [result["o_totalprice"][i].as_py() for i in range(3)]
        assert prices == sorted(prices, reverse=True)
