"""Unit tests for the `wren cube` CLI sub-app."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_mdl(tmp_path: Path) -> Path:
    """Write a minimal target/mdl.json with one model + one cube."""
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {"schema": "main", "table": "orders"},
                "columns": [
                    {"name": "o_totalprice", "type": "double"},
                    {"name": "o_orderstatus", "type": "varchar"},
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
            }
        ],
    }
    out = target / "mdl.json"
    out.write_text(json.dumps(mdl))
    return out


# ── list ────────────────────────────────────────────────────────────────────


def test_cube_list(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl)])
    assert result.exit_code == 0, result.output
    assert "order_metrics" in result.output
    assert "base: orders" in result.output
    assert "revenue" in result.output
    assert "status" in result.output


def test_cube_list_empty(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"catalog": "c", "schema": "s", "cubes": []}))
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 0
    assert "No cubes defined" in result.output


# ── describe ────────────────────────────────────────────────────────────────


def test_cube_describe(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app, ["cube", "describe", "order_metrics", "--mdl", str(mdl)]
    )
    assert result.exit_code == 0, result.output
    schema = json.loads(result.output)
    assert schema["name"] == "order_metrics"
    assert schema["baseObject"] == "orders"
    assert len(schema["measures"]) == 2


def test_cube_describe_unknown(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(app, ["cube", "describe", "nosuch", "--mdl", str(mdl)])
    assert result.exit_code == 1
    assert "not found" in result.output


# ── query --sql-only ────────────────────────────────────────────────────────


def test_cube_query_sql_only(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--cube",
            "order_metrics",
            "--measures",
            "revenue",
            "--dimensions",
            "status",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "SUM(o_totalprice) AS revenue" in result.output
    assert "o_orderstatus AS status" in result.output
    assert "FROM orders" in result.output
    assert "GROUP BY" in result.output


def test_cube_query_sql_only_filter(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--cube",
            "order_metrics",
            "--measures",
            "revenue",
            "--filter",
            "status:eq:completed",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "WHERE o_orderstatus = 'completed'" in result.output


def test_cube_query_sql_only_in_filter(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--cube",
            "order_metrics",
            "--measures",
            "revenue",
            "--filter",
            "status:in:a,b,c",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "o_orderstatus IN ('a', 'b', 'c')" in result.output


def test_cube_query_from_json_file(tmp_path):
    mdl = _make_mdl(tmp_path)
    qfile = tmp_path / "q.json"
    qfile.write_text(
        json.dumps(
            {
                "cube": "order_metrics",
                "measures": ["revenue", "order_count"],
                "limit": 10,
            }
        )
    )
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--from",
            str(qfile),
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "SUM(o_totalprice) AS revenue" in result.output
    assert "COUNT(*) AS order_count" in result.output
    assert result.output.rstrip().endswith("LIMIT 10")


def test_cube_query_unknown_cube(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--cube",
            "nosuch",
            "--measures",
            "revenue",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "not found" in result.output


def test_cube_query_missing_required(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        ["cube", "query", "--measures", "revenue", "--mdl", str(mdl)],
    )
    assert result.exit_code == 1
    assert "required" in result.output.lower()
