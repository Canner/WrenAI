"""Tests for the cube_query_to_sql PyO3 binding."""

import json

import pytest

from wren_core import cube_query_to_sql

MANIFEST = json.dumps(
    {
        "catalog": "test",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {"schema": "main", "table": "orders"},
                "columns": [
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderstatus", "type": "varchar"},
                    {"name": "o_orderdate", "type": "date"},
                ],
            }
        ],
        "cubes": [
            {
                "name": "order_metrics",
                "baseObject": "orders",
                "measures": [
                    {
                        "name": "revenue",
                        "expression": "SUM(o_totalprice)",
                        "type": "DOUBLE",
                    },
                    {
                        "name": "order_count",
                        "expression": "COUNT(*)",
                        "type": "BIGINT",
                    },
                ],
                "dimensions": [
                    {
                        "name": "status",
                        "expression": "o_orderstatus",
                        "type": "VARCHAR",
                    }
                ],
                "timeDimensions": [
                    {
                        "name": "created_at",
                        "expression": "o_orderdate",
                        "type": "DATE",
                    }
                ],
            }
        ],
    }
)


def test_basic_cube_query():
    query = json.dumps(
        {
            "cube": "order_metrics",
            "measures": ["revenue"],
            "dimensions": ["status"],
        }
    )
    sql = cube_query_to_sql(query, MANIFEST)
    assert "SUM(o_totalprice) AS revenue" in sql
    assert "o_orderstatus AS status" in sql
    assert "FROM orders" in sql
    assert "GROUP BY" in sql


def test_time_dimension_with_date_range():
    query = json.dumps(
        {
            "cube": "order_metrics",
            "measures": ["revenue"],
            "timeDimensions": [
                {
                    "dimension": "created_at",
                    "granularity": "month",
                    "dateRange": ["2024-01-01", "2025-01-01"],
                }
            ],
        }
    )
    sql = cube_query_to_sql(query, MANIFEST)
    assert "DATE_TRUNC('month', o_orderdate)" in sql
    assert "o_orderdate >= '2024-01-01'" in sql
    assert "o_orderdate < '2025-01-01'" in sql


def test_filter_eq():
    query = json.dumps(
        {
            "cube": "order_metrics",
            "measures": ["revenue"],
            "filters": [
                {"dimension": "status", "operator": "eq", "value": "completed"}
            ],
        }
    )
    sql = cube_query_to_sql(query, MANIFEST)
    assert "WHERE o_orderstatus = 'completed'" in sql


def test_limit_offset():
    query = json.dumps(
        {
            "cube": "order_metrics",
            "measures": ["revenue"],
            "limit": 10,
            "offset": 5,
        }
    )
    sql = cube_query_to_sql(query, MANIFEST)
    assert sql.endswith("LIMIT 10 OFFSET 5")


def test_unknown_cube_error():
    query = json.dumps({"cube": "nonexistent", "measures": ["revenue"]})
    with pytest.raises(ValueError, match="not found"):
        cube_query_to_sql(query, MANIFEST)


def test_unknown_measure_error():
    query = json.dumps({"cube": "order_metrics", "measures": ["no_such"]})
    with pytest.raises(ValueError, match="Unknown measure"):
        cube_query_to_sql(query, MANIFEST)


def test_invalid_cube_query_json():
    with pytest.raises(ValueError, match="Invalid CubeQuery JSON"):
        cube_query_to_sql("not json at all", MANIFEST)


def test_invalid_manifest_json():
    query = json.dumps({"cube": "order_metrics", "measures": ["revenue"]})
    with pytest.raises(ValueError, match="Invalid manifest JSON"):
        cube_query_to_sql(query, "not json")
