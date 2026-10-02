"""ClickHouse translation of dialect-neutral SQL — no database required.

Every case goes through ``CTERewriter.rewrite`` with a ClickHouse data source, the
path ``WrenEngine.dry_plan`` takes, and asserts on the SQL it returns. Before
``clickhouse_compat`` each of these came back with the construct verbatim
(``lag(...)``, ``CUME_DIST()``, ``EXTRACT(DOW ...)``, ``CAST(NULL AS Float64)``,
a correlated ``EXISTS``, an aggregate alias shadowing its column), which ClickHouse
rejects.
"""

from __future__ import annotations

import base64

import orjson
import pytest
import sqlglot

from wren.mdl import get_session_context
from wren.mdl.clickhouse_compat import translate
from wren.mdl.cte_rewriter import CTERewriter
from wren.model.data_source import DataSource

pytestmark = pytest.mark.unit

_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "orders",
            "tableReference": {"schema": "main", "table": "orders"},
            "columns": [
                {"name": "o_orderkey", "type": "integer"},
                {"name": "o_custkey", "type": "integer"},
                {"name": "o_totalprice", "type": "double"},
                {"name": "o_orderdate", "type": "date"},
            ],
            "primaryKey": "o_orderkey",
        },
        {
            "name": "customer",
            "tableReference": {"schema": "main", "table": "customer"},
            "columns": [
                {"name": "c_custkey", "type": "integer"},
                {"name": "c_name", "type": "varchar"},
            ],
            "primaryKey": "c_custkey",
        },
    ],
}


def _rewrite(sql: str, data_source: DataSource = DataSource.clickhouse) -> str:
    manifest_str = base64.b64encode(orjson.dumps(_MANIFEST)).decode()
    session = get_session_context(manifest_str, None, None, data_source.name)
    rewriter = CTERewriter(manifest_str, session, data_source, fallback=False)
    return " ".join(rewriter.rewrite(sql).split())


def _clickhouse(sql: str) -> str:
    return translate(sqlglot.parse_one(sql, dialect="clickhouse")).sql("clickhouse")


_WHOLE = "ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING"


class TestWindowFunctions:
    def test_lag_reads_the_whole_partition_and_is_nullable(self):
        out = _rewrite(
            "SELECT o_orderkey, LAG(o_totalprice) OVER (ORDER BY o_orderkey) AS prev"
            " FROM orders"
        )
        assert "lag(" not in out
        assert (
            f"lagInFrame(toNullable(o_totalprice)) OVER (ORDER BY o_orderkey {_WHOLE})"
            in out
        )

    def test_lead_keeps_offset_and_default(self):
        out = _rewrite(
            "SELECT LEAD(o_totalprice, 2, 0) OVER (PARTITION BY o_custkey"
            " ORDER BY o_orderkey) AS nxt FROM orders"
        )
        assert (
            "leadInFrame(toNullable(o_totalprice), 2, 0) OVER (PARTITION BY o_custkey"
            f" ORDER BY o_orderkey {_WHOLE})"
        ) in out

    def test_cume_dist_counts_peers_over_the_partition(self):
        out = _rewrite(
            "SELECT CUME_DIST() OVER (PARTITION BY o_custkey ORDER BY o_totalprice)"
            " AS cd FROM orders"
        )
        assert "CUME_DIST" not in out
        assert (
            "(COUNT(*) OVER (PARTITION BY o_custkey ORDER BY o_totalprice)"
            " / COUNT(*) OVER (PARTITION BY o_custkey)) AS cd"
        ) in out

    def test_cume_dist_over_a_named_window_keeps_its_clauses(self):
        out = _rewrite(
            "SELECT CUME_DIST() OVER w AS cd FROM orders"
            " WINDOW w AS (PARTITION BY o_custkey ORDER BY o_totalprice)"
        )
        assert (
            "(COUNT(*) OVER (PARTITION BY o_custkey ORDER BY o_totalprice)"
            " / COUNT(*) OVER (PARTITION BY o_custkey)) AS cd"
        ) in out

    def test_cume_dist_follows_a_chain_of_named_windows(self):
        out = _clickhouse(
            "SELECT CUME_DIST() OVER (w2 ORDER BY b) FROM t"
            " WINDOW w1 AS (PARTITION BY a), w2 AS (w1)"
        )
        assert (
            "(COUNT(*) OVER (PARTITION BY a ORDER BY b)"
            " / COUNT(*) OVER (PARTITION BY a))"
        ) in out

    @pytest.mark.parametrize(
        "sql",
        [
            "SELECT CUME_DIST() OVER missing FROM t",
            "SELECT CUME_DIST() OVER w FROM t WINDOW w AS (v), v AS (w)",
        ],
    )
    def test_cume_dist_over_an_unresolved_window_is_left_alone(self, sql):
        assert "CUME_DIST" in _clickhouse(sql)

    def test_lag_over_a_named_window_is_inlined(self):
        out = _clickhouse(
            "SELECT LAG(x) OVER w FROM t WINDOW w AS (PARTITION BY a ORDER BY b)"
        )
        assert (
            f"lagInFrame(toNullable(x)) OVER (PARTITION BY a ORDER BY b {_WHOLE})"
            in out
        )

    def test_percent_rank_is_left_alone(self):
        sql = "SELECT PERCENT_RANK() OVER (ORDER BY o_totalprice) AS pr FROM t"
        native = sqlglot.parse_one(sql, dialect="clickhouse").sql("clickhouse")
        assert _clickhouse(sql) == native


class TestDayOfWeek:
    def test_dow_counts_sunday_as_zero(self):
        out = _rewrite("SELECT EXTRACT(DOW FROM o_orderdate) AS dow FROM orders")
        assert "EXTRACT" not in out
        assert "(toDayOfWeek(o_orderdate) % 7) AS dow" in out

    def test_isodow_is_clickhouse_numbering(self):
        out = _rewrite("SELECT EXTRACT(ISODOW FROM o_orderdate) AS dow FROM orders")
        assert "toDayOfWeek(o_orderdate) AS dow" in out
        assert "% 7" not in out

    def test_other_extract_units_are_left_alone(self):
        assert "EXTRACT(YEAR FROM d)" in _clickhouse(
            "SELECT EXTRACT(YEAR FROM d) FROM t"
        )


class TestNullCast:
    def test_null_cast_targets_a_nullable_type(self):
        out = _rewrite("SELECT o_orderkey, CAST(NULL AS DOUBLE) AS x FROM orders")
        assert "CAST(NULL AS Nullable(Float64)) AS x" in out

    def test_non_null_cast_is_left_alone(self):
        assert _clickhouse("SELECT CAST(x AS DOUBLE) FROM t") == (
            "SELECT CAST(x AS Float64) FROM t"
        )


class TestCorrelatedExists:
    def test_exists_becomes_a_null_safe_in(self):
        out = _rewrite(
            "SELECT c.c_name FROM customer AS c WHERE EXISTS (SELECT 1 FROM orders AS o"
            " WHERE o.o_custkey = c.c_custkey AND o.o_totalprice > 100)"
        )
        assert "EXISTS" not in out
        assert "c.c_custkey IN (SELECT o.o_custkey FROM orders AS o WHERE" in out
        assert "o.o_totalprice > 100" in out
        # Both sides exclude NULL keys, so NOT EXISTS keeps a NULL key unmatched.
        assert out.count("IS NULL") == 2

    def test_not_exists_keeps_a_null_key_unmatched(self):
        out = _clickhouse(
            "SELECT 1 FROM c WHERE NOT EXISTS (SELECT 1 FROM o WHERE o.k = c.k)"
        )
        assert "EXISTS" not in out
        assert out.startswith("SELECT 1 FROM c WHERE NOT (NOT (c.k IS NULL) AND c.k IN")

    def test_two_keys_use_a_tuple(self):
        out = _clickhouse(
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.a = c.a AND o.b = c.b)"
        )
        assert "(c.a, c.b) IN (SELECT o.a, o.b FROM o WHERE" in out

    @pytest.mark.parametrize(
        "sql",
        [
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o JOIN p ON o.k = p.k"
            " WHERE o.k = c.k)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.k > c.k)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.k = c.k OR o.x = 1)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.x = 1)",
        ],
    )
    def test_shapes_it_does_not_understand_are_left_alone(self, sql):
        assert "EXISTS" in _clickhouse(sql)

    @pytest.mark.parametrize(
        "sql",
        [
            # One row whatever WHERE keeps: EXISTS is always true.
            "SELECT 1 FROM c WHERE EXISTS (SELECT COUNT(*) FROM o WHERE o.k = c.k)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.k = c.k"
            " HAVING COUNT(*) > 5)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.k = c.k"
            " QUALIFY ROW_NUMBER() OVER (ORDER BY o.x) > 1)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o WHERE o.k = c.k"
            " LIMIT 1 OFFSET 2)",
            "SELECT 1 FROM c WHERE EXISTS (WITH w AS (SELECT 1) SELECT 1 FROM o"
            " WHERE o.k = c.k)",
            "SELECT 1 FROM c WHERE EXISTS (SELECT 1 FROM o PREWHERE o.x = 1"
            " WHERE o.k = c.k)",
        ],
    )
    def test_clauses_the_rewrite_would_drop_leave_it_alone(self, sql):
        assert "EXISTS" in _clickhouse(sql)

    def test_distinct_does_not_change_existence(self):
        out = _clickhouse(
            "SELECT 1 FROM c WHERE EXISTS (SELECT DISTINCT 1 FROM o WHERE o.k = c.k)"
        )
        assert "EXISTS" not in out


class TestAggregateAliasShadowing:
    def test_having_reads_the_column_not_the_aggregate_alias(self):
        out = _rewrite(
            "SELECT o_custkey, SUM(o_totalprice) AS o_totalprice FROM orders"
            " GROUP BY o_custkey HAVING SUM(o_totalprice) > 10"
        )
        assert "HAVING SUM(orders.o_totalprice) > 10" in out

    def test_order_by_the_alias_still_means_the_alias(self):
        out = _clickhouse(
            "SELECT k, SUM(c) AS c FROM t GROUP BY k HAVING SUM(c) > 0 ORDER BY c DESC"
        )
        assert out.endswith("HAVING SUM(t.c) > 0 ORDER BY c DESC")

    def test_a_non_aggregate_alias_keeps_clickhouse_semantics(self):
        # ``SUM(c)`` here already runs on ClickHouse (it reads the alias); not ours to change.
        sql = "SELECT a + 1 AS c, SUM(c) AS s FROM t GROUP BY a"
        assert "t.c" not in _clickhouse(sql)

    def test_joins_are_left_alone(self):
        sql = (
            "SELECT SUM(o.x) AS x FROM o JOIN p ON o.k = p.k GROUP BY o.k"
            " HAVING SUM(x) > 0"
        )
        assert "HAVING SUM(x) > 0" in _clickhouse(sql)


class TestOnlyClickHouse:
    def test_other_dialects_are_untouched(self):
        out = _rewrite(
            "SELECT LAG(o_totalprice) OVER (ORDER BY o_orderkey) AS prev,"
            " EXTRACT(DOW FROM o_orderdate) AS dow FROM orders",
            DataSource.duckdb,
        )
        assert "LAG(" in out.upper() and "lagInFrame" not in out
        assert "toDayOfWeek" not in out

    def test_plain_clickhouse_sql_is_unchanged(self):
        out = _rewrite(
            "SELECT o_custkey, SUM(o_totalprice) AS total FROM orders GROUP BY o_custkey"
        )
        # Only the user's statement is checked; the model CTE before it is wren-core's.
        assert out.endswith(
            "SELECT o_custkey, SUM(o_totalprice) AS total FROM orders GROUP BY o_custkey"
        )
