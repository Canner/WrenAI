"""Tests for `wren skills` content delivery (tracer bullet: infra + usage)."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren import skills_delivery
from wren.cli import app

runner = CliRunner()


def test_skills_list_includes_usage_with_references():
    result = runner.invoke(app, ["skills", "list"])
    assert result.exit_code == 0
    assert "usage" in result.output
    # usage ships two references; list should surface them
    assert "memory" in result.output
    assert "wren-sql" in result.output


def test_skills_get_usage_returns_guide():
    result = runner.invoke(app, ["skills", "get", "usage"])
    assert result.exit_code == 0
    assert result.output.strip().startswith("---")  # markdown frontmatter
    assert "Wren Engine CLI" in result.output


def test_skills_get_usage_is_trimmed():
    """Lifted content drops the version-drift hack and the version field."""
    content = skills_delivery.get_skill("usage")
    assert "versions.json" not in content
    assert "## Version check" not in content
    assert 'version: "2.4"' not in content


def test_skills_get_unknown_errors_with_hint():
    result = runner.invoke(app, ["skills", "get", "does-not-exist"])
    assert result.exit_code != 0
    assert "wren skills list" in result.output


def test_skills_list_api_reports_usage():
    skills = {s.name: s for s in skills_delivery.list_skills()}
    assert "usage" in skills
    assert set(skills["usage"].references) == {"memory", "wren-sql"}
    assert skills["usage"].summary


def test_skills_get_unknown_raises():
    with pytest.raises(skills_delivery.SkillNotFoundError):
        skills_delivery.get_skill("nope")
