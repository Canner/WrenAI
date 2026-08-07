"""Validation tests for ``wren memory load`` YAML input."""

from __future__ import annotations

import pytest
import yaml
from typer.testing import CliRunner

from wren.cli import app

runner = CliRunner()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("nl", ["not", "text"]),
        ("sql", ["not", "text"]),
        ("source", {"bad": "value"}),
        ("datasource", {"bad": "value"}),
    ],
)
def test_dry_run_rejects_non_string_pair_fields(tmp_path, field, value) -> None:
    pair = {"nl": "hello", "sql": "SELECT 1", field: value}
    input_file = tmp_path / "queries.yml"
    input_file.write_text(
        yaml.safe_dump({"version": 1, "pairs": [pair]}),
        encoding="utf-8",
    )

    result = runner.invoke(
        app,
        ["memory", "load", str(input_file), "--dry-run"],
    )

    assert result.exit_code == 1
    assert f"pair #1 field '{field}' must be a string" in result.output
    assert "Would load" not in result.output


def test_dry_run_accepts_string_pair_fields(tmp_path) -> None:
    pair = {
        "nl": "hello",
        "sql": "SELECT 1",
        "source": "user",
        "datasource": "postgres",
    }
    input_file = tmp_path / "queries.yml"
    input_file.write_text(
        yaml.safe_dump({"version": 1, "pairs": [pair]}),
        encoding="utf-8",
    )

    result = runner.invoke(
        app,
        ["memory", "load", str(input_file), "--dry-run"],
    )

    assert result.exit_code == 0
    assert "Would load 1 pair(s) (user: 1)" in result.output
