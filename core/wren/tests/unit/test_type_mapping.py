"""Tests for wren.type_mapping — parse_type() and parse_types()."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from wren.type_mapping import (
    parse_type,
    parse_types,
    translate_type,
    translate_types,
)

# ── parse_type unit tests ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "type_str, dialect, expected",
    [
        ("character varying(255)", "postgres", "VARCHAR(255)"),
        ("int8", "postgres", "BIGINT"),
        ("INT64", "bigquery", "BIGINT"),
        ("STRING", "bigquery", "TEXT"),
        ("Nullable(UInt32)", "clickhouse", "UINT"),
        # Nullable(T) regression — Canner/WrenAI#2184
        ("Nullable(String)", "clickhouse", "TEXT"),
        ("Nullable(Int32)", "clickhouse", "INT"),
        ("Nullable(Int64)", "clickhouse", "BIGINT"),
        ("Nullable(Float64)", "clickhouse", "DOUBLE"),
        ("Nullable(DateTime)", "clickhouse", "DATETIME"),
        ("Nullable(Date)", "clickhouse", "DATE"),
        ("Nullable(Decimal(18, 4))", "clickhouse", "DECIMAL(18, 4)"),
        ("Nullable(UUID)", "clickhouse", "UUID"),
        # LowCardinality — storage hint must not change the canonical type string
        ("LowCardinality(String)", "clickhouse", "LOWCARDINALITY<TEXT>"),
        ("LowCardinality(Nullable(String))", "clickhouse", "LOWCARDINALITY<TEXT>"),
        ("TIMESTAMP WITH TIME ZONE", "postgres", "TIMESTAMPTZ"),
        ("DECIMAL(10,2)", "mysql", "DECIMAL(10, 2)"),
        # graceful fallback for unknown types
        ("my_custom_type", "postgres", "my_custom_type"),
        ("my_custom_type", "unknown_dialect", "my_custom_type"),
        # empty string passthrough
        ("", "postgres", ""),
    ],
)
def test_parse_type(type_str: str, dialect: str, expected: str) -> None:
    assert parse_type(type_str, dialect) == expected


# ── parse_types batch tests ────────────────────────────────────────────────


def test_parse_types_adds_type_field() -> None:
    columns = [
        {"column": "id", "raw_type": "int8"},
        {"column": "name", "raw_type": "character varying"},
        {"column": "total", "raw_type": "numeric(10,2)"},
        {"column": "created", "raw_type": "TIMESTAMP WITH TIME ZONE"},
        {"column": "flag", "raw_type": "boolean"},
    ]
    results = parse_types(columns, dialect="postgres")

    assert len(results) == 5
    for result in results:
        assert "type" in result

    assert results[0]["type"] == "BIGINT"
    assert results[1]["type"] == "VARCHAR"
    assert results[2]["type"] == "DECIMAL(10, 2)"
    assert results[3]["type"] == "TIMESTAMPTZ"
    assert results[4]["type"] == "BOOLEAN"


def test_parse_types_does_not_mutate_input() -> None:
    original = {"column": "id", "raw_type": "int8"}
    columns = [original]
    parse_types(columns, dialect="postgres")
    assert "type" not in original


def test_parse_types_custom_type_field() -> None:
    columns = [{"col": "x", "data_type": "INT64"}]
    results = parse_types(columns, dialect="bigquery", type_field="data_type")
    assert results[0]["type"] == "BIGINT"


def test_parse_types_empty_list() -> None:
    assert parse_types([], dialect="postgres") == []


# ── translate_type cross-dialect tests ──────────────────────────


@pytest.mark.parametrize(
    "type_str, source, target, expected",
    [
        # postgres → bigquery
        ("int8", "postgres", "bigquery", "INT64"),
        ("TIMESTAMP WITH TIME ZONE", "postgres", "bigquery", "TIMESTAMP"),
        # bigquery → postgres round-trip
        ("INT64", "bigquery", "postgres", "BIGINT"),
        # mysql → snowflake keeps precision/scale
        ("DECIMAL(10,2)", "mysql", "snowflake", "DECIMAL(10, 2)"),
        # same dialect is an identity-ish normalization
        ("int8", "postgres", "postgres", "BIGINT"),
        # graceful fallback for unknown types
        ("my_custom_type", "postgres", "bigquery", "my_custom_type"),
        # empty string passthrough
        ("", "postgres", "bigquery", ""),
    ],
)
def test_translate_type(
    type_str: str, source: str, target: str, expected: str
) -> None:
    assert translate_type(type_str, source, target) == expected


def test_translate_types_adds_type_field() -> None:
    columns = [
        {"column": "id", "raw_type": "int8"},
        {"column": "total", "raw_type": "numeric(10,2)"},
    ]
    results = translate_types(columns, "postgres", "bigquery")

    assert len(results) == 2
    assert results[0]["type"] == "INT64"
    assert results[1]["type"] == "NUMERIC(10, 2)"


def test_translate_types_does_not_mutate_input() -> None:
    original = {"column": "id", "raw_type": "int8"}
    columns = [original]
    translate_types(columns, "postgres", "bigquery")
    assert "type" not in original


def test_translate_types_custom_type_field() -> None:
    columns = [{"col": "x", "data_type": "int8"}]
    results = translate_types(
        columns, "postgres", "bigquery", type_field="data_type"
    )
    assert results[0]["type"] == "INT64"


def test_translate_types_empty_list() -> None:
    assert translate_types([], "postgres", "bigquery") == []


# ── CLI integration tests ─────────────────────────────────────────────────


def _run_wren(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "wren.cli", *args],
        input=stdin,
        capture_output=True,
        text=True,
    )


def _assert_success(result: subprocess.CompletedProcess) -> None:
    """Assert command succeeded, printing stderr on failure for easier diagnosis."""
    assert result.returncode == 0, f"Command failed with stderr: {result.stderr}"


def test_cli_parse_type_single() -> None:
    result = _run_wren("utils", "parse-type", "--type", "int8", "--dialect", "postgres")
    _assert_success(result)
    assert result.stdout.strip() == "BIGINT"


def test_cli_parse_type_with_precision() -> None:
    result = _run_wren(
        "utils",
        "parse-type",
        "--type",
        "character varying(255)",
        "--dialect",
        "postgres",
    )
    _assert_success(result)
    assert result.stdout.strip() == "VARCHAR(255)"


def test_cli_parse_type_fallback() -> None:
    result = _run_wren(
        "utils", "parse-type", "--type", "my_custom_type", "--dialect", "postgres"
    )
    _assert_success(result)
    assert result.stdout.strip() == "my_custom_type"


def test_cli_parse_types_stdin() -> None:
    payload = json.dumps([{"column": "id", "raw_type": "int8"}])
    result = _run_wren("utils", "parse-types", "--dialect", "postgres", stdin=payload)
    _assert_success(result)
    data = json.loads(result.stdout)
    assert data[0]["type"] == "BIGINT"
    assert data[0]["column"] == "id"
    assert data[0]["raw_type"] == "int8"


def test_cli_parse_types_batch() -> None:
    columns = [
        {"column": "id", "raw_type": "int8"},
        {"column": "name", "raw_type": "character varying"},
    ]
    result = _run_wren(
        "utils", "parse-types", "--dialect", "postgres", stdin=json.dumps(columns)
    )
    _assert_success(result)
    data = json.loads(result.stdout)
    assert len(data) == 2
    assert data[0]["type"] == "BIGINT"
    assert data[1]["type"] == "VARCHAR"


def test_cli_translate_type_single() -> None:
    result = _run_wren(
        "utils",
        "translate-type",
        "--type",
        "int8",
        "--source",
        "postgres",
        "--target",
        "bigquery",
    )
    _assert_success(result)
    assert result.stdout.strip() == "INT64"


def test_cli_translate_type_fallback() -> None:
    result = _run_wren(
        "utils",
        "translate-type",
        "--type",
        "my_custom_type",
        "--source",
        "postgres",
        "--target",
        "bigquery",
    )
    _assert_success(result)
    assert result.stdout.strip() == "my_custom_type"


def test_cli_translate_types_stdin() -> None:
    columns = [
        {"column": "id", "raw_type": "int8"},
        {"column": "name", "raw_type": "character varying"},
    ]
    result = _run_wren(
        "utils",
        "translate-types",
        "--source",
        "postgres",
        "--target",
        "bigquery",
        stdin=json.dumps(columns),
    )
    _assert_success(result)
    data = json.loads(result.stdout)
    assert len(data) == 2
    assert data[0]["type"] == "INT64"
    assert data[0]["column"] == "id"


def test_cli_translate_types_missing_file() -> None:
    result = _run_wren(
        "utils",
        "translate-types",
        "--source",
        "postgres",
        "--target",
        "bigquery",
        "--input",
        "/nonexistent/does_not_exist.json",
    )
    assert result.returncode == 1
    assert "file not found" in result.stderr
    assert "Traceback" not in result.stderr


def test_cli_translate_types_unreadable_file_is_clean(tmp_path) -> None:
    # A directory path is readable-as-path but raises OSError on read_text.
    bad = tmp_path / "a_directory"
    bad.mkdir()
    result = _run_wren(
        "utils",
        "translate-types",
        "--source",
        "postgres",
        "--target",
        "bigquery",
        "--input",
        str(bad),
    )
    assert result.returncode == 1
    assert "could not read file" in result.stderr
    assert "Traceback" not in result.stderr
