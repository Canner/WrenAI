"""Semantic proofs use a captured manifest and parsed SQL, never model claims."""

from copy import deepcopy

import pytest
from sqlglot import parse_one

from wren.query_semantics import query_semantics

pytestmark = pytest.mark.unit
MANIFEST = {
    "cubes": [
        {
            "name": "sales",
            "measures": [{"name": "revenue", "expression": "SUM(amount)"}],
            "dimensions": [{"name": "region"}],
            "timeDimensions": [{"name": "day"}],
        }
    ]
}


def prove(sql, manifest=MANIFEST):
    return query_semantics(parse_one(sql), sql, manifest)


def test_resolves_cube_members_and_aliases_without_trusting_output_names():
    sql = "SELECT s.revenue AS money, s.region FROM sales s WHERE s.day > '2026-01-01'"
    assert prove(sql) == {
        "version": "1",
        "sql": sql,
        "metrics": [{"owner": "sales", "name": "revenue"}],
        "dimensions": [{"owner": "sales", "name": "region"}],
        "temporal_dimensions": [{"owner": "sales", "name": "day"}],
    }
    assert prove("SELECT SUM(revenue), region FROM sales GROUP BY region")


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT AVG(revenue) FROM sales",
        "SELECT COUNT(DISTINCT revenue) FROM sales",
        "SELECT revenue / 2 FROM sales",
        "SELECT unknown AS revenue FROM sales",
        "SELECT * FROM sales",
        "SELECT revenue FROM raw_orders",
        "SELECT revenue FROM sales JOIN raw_orders ON TRUE",
        "SELECT revenue FROM (SELECT revenue FROM sales)",
        "WITH x AS (SELECT revenue FROM sales) SELECT revenue FROM x",
        "SELECT revenue FROM sales WHERE revenue > 10",
        "SELECT revenue FROM sales GROUP BY 1",
        "SELECT x.revenue FROM sales",
        "SELECT SUM(revenue) OVER () FROM sales",
        "SELECT DISTINCT revenue FROM sales",
        "SELECT revenue FROM sales WHERE region + 1 = 2",
        "SELECT revenue FROM sales WHERE LOWER(region) = 'x'",
        "SELECT revenue FROM sales ORDER BY region + 1",
        "SELECT revenue FROM sales ORDER BY LOWER(region)",
        "SELECT revenue FROM sales WHERE day > '2026-01-01' AND region + 1 = 2",
        "SELECT revenue FROM sales GROUP BY ROLLUP(region)",
        "SELECT revenue FROM sales QUALIFY region = 'x'",
        "SELECT revenue FROM sales LIMIT 1 + 2",
    ],
)
def test_unsupported_or_ambiguous_queries_cannot_earn_proof(sql):
    assert prove(sql) is None


def test_duplicate_cube_identity_is_not_arbitrarily_resolved():
    assert prove("SELECT revenue FROM sales", {"cubes": MANIFEST["cubes"] * 2}) is None


@pytest.mark.parametrize(
    "expression",
    [
        "AVG(amount)",
        "SUM(amount) + MAX(amount)",
        "COUNT(DISTINCT id)",
        "SUM(amount) / COUNT(*)",
    ],
)
def test_nonadditive_measure_expressions_never_earn_proof(expression):
    manifest = deepcopy(MANIFEST)
    manifest["cubes"][0]["measures"][0]["expression"] = expression
    assert prove("SELECT revenue, region FROM sales", manifest) is None


def test_filter_and_order_dimensions_are_counted_without_projection():
    manifest = deepcopy(MANIFEST)
    manifest["cubes"][0]["dimensions"].append({"name": "product"})
    sql = "SELECT revenue FROM sales WHERE region = 'x' AND product IN ('a', 'b') AND day BETWEEN '2026-01-01' AND '2026-02-01' ORDER BY product DESC LIMIT 5 OFFSET 1"
    proof = prove(sql, manifest)
    assert proof is not None
    assert proof["dimensions"] == [
        {"owner": "sales", "name": "product"},
        {"owner": "sales", "name": "region"},
    ]
    assert proof["temporal_dimensions"] == [{"owner": "sales", "name": "day"}]
