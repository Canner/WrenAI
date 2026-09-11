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
                        "name": "order_date",
                        "expression": "o_orderdate",
                        "type": "DATE",
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


def test_cube_list_missing_cubes_key_is_empty(tmp_path):
    """Absent cubes field is the serde default (empty list), not malformed."""
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"catalog": "c", "schema": "s"}))
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 0
    assert "No cubes defined" in result.output


def test_cube_list_null_cubes_fails_loud(tmp_path):
    """Explicit cubes: null is invalid (Rust Vec rejects null; missing is empty)."""
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"catalog": "c", "schema": "s", "cubes": None}))
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "malformed cubes" in result.output
    assert "null" in result.output


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


def test_cube_query_sql_only_time_dimension(tmp_path):
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
            "--time-dimension",
            "order_date:month",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "DATE_TRUNC('month', o_orderdate)" in result.output
    assert "SUM(o_totalprice) AS revenue" in result.output


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


def test_cube_query_in_filter_requires_values(tmp_path):
    """`status:in:` (empty) should be a clean CLI error, not silent empty IN()."""
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
            "status:in:",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code != 0
    assert "in" in result.output.lower() and "value" in result.output.lower()


def test_cube_query_in_filter_missing_value(tmp_path):
    """`status:in` (no value segment) should also be rejected."""
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
            "status:in",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code != 0
    assert "in" in result.output.lower() and "value" in result.output.lower()


def test_cube_query_invalid_from_json(tmp_path):
    """Malformed JSON file should produce a clean CLI error, not a traceback."""
    mdl = _make_mdl(tmp_path)
    bad = tmp_path / "bad.json"
    bad.write_text("{not valid json")
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--from",
            str(bad),
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "invalid JSON" in result.output


def test_cube_query_from_json_not_object(tmp_path):
    mdl = _make_mdl(tmp_path)
    bad = tmp_path / "list.json"
    bad.write_text('["not", "an", "object"]')
    result = runner.invoke(
        app,
        [
            "cube",
            "query",
            "--from",
            str(bad),
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "must be a JSON object" in result.output


def test_cube_list_bad_mdl_json(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    bad_mdl = target / "mdl.json"
    bad_mdl.write_text("not json at all")
    result = runner.invoke(app, ["cube", "list", "--mdl", str(bad_mdl)])
    assert result.exit_code == 1
    assert "invalid MDL JSON" in result.output


def test_cube_list_malformed_cubes_scalar_fails_loud(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"catalog": "c", "schema": "s", "cubes": "abc"}))
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "malformed cubes" in result.output
    assert "wren context build" in result.output
    assert result.output.strip() != ""


def test_cube_list_malformed_cubes_object_fails_loud(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(
        json.dumps({"catalog": "c", "schema": "s", "cubes": {"name": "orders"}})
    )
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "malformed cubes" in result.output


def test_cube_list_non_object_entry_fails_loud(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(
        json.dumps(
            {
                "catalog": "c",
                "schema": "s",
                "cubes": ["bad", {"name": "orders", "measures": []}],
            }
        )
    )
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "entry 0 is not an object" in result.output
    assert "wren context build" in result.output


def test_cube_describe_malformed_cubes_fails_loud(tmp_path):
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"catalog": "c", "schema": "s", "cubes": "abc"}))
    result = runner.invoke(app, ["cube", "describe", "orders", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "malformed cubes" in result.output


def test_cube_list_non_string_member_names_fail_loud(tmp_path):
    """Numeric member names must fail loud (not TypeError in join)."""
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    for key in ("measures", "dimensions", "timeDimensions"):
        cube = {
            "name": "orders",
            "baseObject": "orders",
            "measures": [],
            "dimensions": [],
            "timeDimensions": [],
        }
        cube[key] = [{"name": 1, "type": "VARCHAR"}]
        mdl_file.write_text(
            json.dumps({"catalog": "c", "schema": "s", "cubes": [cube]})
        )
        result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
        assert result.exit_code == 1, key
        assert "malformed cubes" in result.output, key
        assert "name is not a string" in result.output, key
        assert "wren context build" in result.output, key


def test_cube_query_missing_required(tmp_path):
    mdl = _make_mdl(tmp_path)
    result = runner.invoke(
        app,
        ["cube", "query", "--measures", "revenue", "--mdl", str(mdl)],
    )
    assert result.exit_code == 1
    assert "required" in result.output.lower()


def test_cube_list_null_member_list_fails_loud(tmp_path):
    """Present-but-null dimensions must not TypeError in list join."""
    target = tmp_path / "target"
    target.mkdir(parents=True)
    mdl_file = target / "mdl.json"
    mdl_file.write_text(
        json.dumps(
            {
                "catalog": "c",
                "schema": "s",
                "cubes": [
                    {
                        "name": "orders",
                        "baseObject": "orders",
                        "measures": [],
                        "dimensions": None,
                        "timeDimensions": [],
                    }
                ],
            }
        )
    )
    result = runner.invoke(app, ["cube", "list", "--mdl", str(mdl_file)])
    assert result.exit_code == 1
    assert "malformed cubes" in result.output
    assert "dimensions is null" in result.output
    assert "cubes/*/metadata.yml" in result.output


# ── query --order-by ────────────────────────────────────────────────────────
#
# Ordering is validated in wren-core, so these assert two things Python owns:
# the spec grammar, and that core's errors reach the user unchanged. The SQL
# orders by *output ordinal*, not member name — see wren-core's cube tests.


def test_cube_query_sql_only_order_by(tmp_path):
    """Ordering reaches the generated SQL, keyed by output ordinal."""
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
            "--order-by",
            "revenue:desc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "ORDER BY 2 DESC" in result.output


def test_cube_query_order_by_comma_separated(tmp_path):
    """Comma-separated keys order left to right, like --measures."""
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
            "--order-by",
            "revenue:desc,status:asc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "ORDER BY 2 DESC, 1 ASC" in result.output


def test_cube_query_order_by_repeatable_matches_comma_form(tmp_path):
    """Repeating the flag (like --filter) must produce identical SQL."""
    mdl = _make_mdl(tmp_path)

    def run(*order_by_args):
        return runner.invoke(
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
                *order_by_args,
                "--sql-only",
                "--mdl",
                str(mdl),
            ],
        )

    comma = run("--order-by", "revenue:desc,status:asc")
    repeated = run("--order-by", "revenue:desc", "--order-by", "status:asc")
    assert comma.exit_code == 0, comma.output
    assert repeated.exit_code == 0, repeated.output
    assert repeated.output == comma.output


def test_cube_query_without_order_by_omits_ordering(tmp_path):
    """No --order-by must leave the pre-existing SQL untouched."""
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
    assert "ORDER BY" not in result.output


def test_cube_query_order_by_bad_spec(tmp_path):
    """A spec without a direction is a clean CLI error, not a core error."""
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
            "--order-by",
            "revenue",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code != 0
    assert "member:direction" in result.output


def test_cube_query_order_by_empty_direction_rejected(tmp_path):
    """`revenue:` would send direction="" to core; reject it where it is typed."""
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
            "--order-by",
            "revenue:",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code != 0
    assert "member:direction" in result.output


def test_cube_query_order_by_unselected_member_surfaces_core_error(tmp_path):
    """Validation lives in core; the CLI must pass its message through."""
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
            "--order-by",
            "order_count:desc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "is not selected by the query" in result.output


def test_cube_query_order_by_uppercase_direction_rejected(tmp_path):
    """Direction is a lowercase-only enum in core; the CLI must not normalise."""
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
            "--order-by",
            "revenue:DESC",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "unknown variant" in result.output


def test_cube_query_order_by_duplicate_member_surfaces_core_error(tmp_path):
    """A member listed twice is core's error to raise, not the CLI's."""
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
            "--order-by",
            "revenue:desc,revenue:asc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "more than once" in result.output


def test_cube_query_order_by_time_dimension(tmp_path):
    """Time dimensions are orderable members too — "newest first"."""
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
            "--time-dimension",
            "order_date:month",
            "--order-by",
            "order_date:desc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "ORDER BY 1 DESC" in result.output


def test_cube_query_order_by_time_dimension_rejects_sql_alias(tmp_path):
    """The member is the declared name, not the ``name__granularity`` alias.

    The alias is what shows up in the generated SQL, so copying it back into
    --order-by is the obvious mistake to make; core rejects it.
    """
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
            "--time-dimension",
            "order_date:month",
            "--order-by",
            "order_date__month:desc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 1
    assert "is not selected by the query" in result.output


def test_cube_query_order_by_empty_value_rejected(tmp_path):
    """An --order-by that contributes no spec must not run unordered.

    Dropping it silently would hand back an arbitrary N rows — the exact
    failure ordering exists to prevent — so it is a clean CLI error instead.
    """
    mdl = _make_mdl(tmp_path)
    for empty in ("", ","):
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
                "--order-by",
                empty,
                "--sql-only",
                "--mdl",
                str(mdl),
            ],
        )
        assert result.exit_code != 0, result.output
        assert "member:direction" in result.output


def test_cube_query_order_by_rejects_empty_among_valid_values(tmp_path):
    """One empty value must not be swallowed because another one parses.

    The repeatable form is validated per value, like --filter: dropping the
    blank would silently discard part of the user's ordering intent.
    """
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
            "--order-by",
            "",
            "--order-by",
            "revenue:desc",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code != 0, result.output
    assert "member:direction" in result.output


def test_cube_query_order_by_tolerates_trailing_comma(tmp_path):
    """A blank segment *inside* a value is tolerated, as in --measures.

    Deliberate, and pinned here so it is not mistaken for the bug the test
    above guards: the value still contributes a spec, so it is not empty.
    """
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
            "--order-by",
            "revenue:desc,",
            "--sql-only",
            "--mdl",
            str(mdl),
        ],
    )
    assert result.exit_code == 0, result.output
    assert "ORDER BY 2 DESC" in result.output
