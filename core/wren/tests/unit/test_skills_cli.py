"""Tests for `wren skills` content delivery (tracer bullet: infra + usage)."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren import skills_delivery
from wren.cli import app

pytestmark = pytest.mark.unit

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


# ── Ticket 1b: all bundled skills + --full + --script ───────────────────────

ALL_SKILLS = {
    "onboarding",
    "usage",
    "generate-mdl",
    "dlt-connector",
    "enrich-context",
    "genbi-app",
}


def test_all_skills_bundled():
    names = {s.name for s in skills_delivery.list_skills()}
    assert names == ALL_SKILLS


@pytest.mark.parametrize("name", sorted(ALL_SKILLS))
def test_get_each_skill_nonempty_and_trimmed(name):
    content = skills_delivery.get_skill(name)
    assert content.strip().startswith("---")
    # every lifted skill drops the version-drift hack + version field
    assert "versions.json" not in content
    assert "## Version check" not in content
    assert "version:" not in content.split("---", 2)[1]  # not in frontmatter


def test_get_each_skill_via_cli(name="usage"):
    for n in sorted(ALL_SKILLS):
        result = runner.invoke(app, ["skills", "get", n])
        assert result.exit_code == 0, n
        assert result.output.strip()


def test_full_inlines_references_for_enrich_context():
    plain = skills_delivery.get_skill("enrich-context")
    full = skills_delivery.get_skill("enrich-context", full=True)
    assert len(full) > len(plain)
    assert "# Reference: cube_proposals" in full
    assert "# Reference: gap_catalog" in full


def test_full_is_graceful_when_no_references():
    # onboarding has no references/ dir
    assert skills_delivery.get_skill(
        "onboarding", full=True
    ) == skills_delivery.get_skill("onboarding")


def test_full_does_not_inline_scripts():
    full = skills_delivery.get_skill("dlt-connector", full=True)
    assert "# Reference: dlt_sources" in full
    assert "#!/usr/bin/env python3" not in full  # the script is not inlined by --full


def test_get_script_returns_source():
    src = skills_delivery.get_script("dlt-connector", "introspect_dlt")
    assert src.startswith("#!/usr/bin/env python3")
    assert "introspect" in src


def test_get_script_via_cli():
    result = runner.invoke(
        app, ["skills", "get", "dlt-connector", "--script", "introspect_dlt"]
    )
    assert result.exit_code == 0
    assert "#!/usr/bin/env python3" in result.output


def test_get_unknown_script_errors():
    result = runner.invoke(app, ["skills", "get", "dlt-connector", "--script", "nope"])
    assert result.exit_code != 0
    with pytest.raises(skills_delivery.ScriptNotFoundError):
        skills_delivery.get_script("dlt-connector", "nope")


def test_list_reports_references_and_scripts():
    by_name = {s.name: s for s in skills_delivery.list_skills()}
    assert set(by_name["enrich-context"].references) == {
        "cube_proposals",
        "gap_catalog",
    }
    assert by_name["dlt-connector"].scripts == ["introspect_dlt"]
    assert by_name["onboarding"].references == []
