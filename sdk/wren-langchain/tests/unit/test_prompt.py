"""Tests for the system_prompt builder."""

from unittest.mock import MagicMock, patch

import pytest
from wren.context import (
    build_json,
    convert_mdl_to_project,
    save_target,
    write_project_files,
)

from wren_langchain import WrenToolkit


def _enable_memory(tmp_project):
    (tmp_project / ".wren" / "memory").mkdir(parents=True)
    return tmp_project


def test_system_prompt_returns_str(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()
    assert isinstance(prompt, str)
    assert len(prompt) > 0


def test_system_prompt_includes_workflow_section(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()
    assert "Wren" in prompt
    # Workflow rule about Wren model names being preferred over raw tables.
    assert "model" in prompt.lower()


def test_system_prompt_lists_enabled_tools_in_summary(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()
    assert "wren_query" in prompt
    assert "wren_dry_plan" in prompt
    assert "wren_list_models" in prompt


def test_system_prompt_omits_memory_tools_when_disabled(
    tmp_project, fake_active_profile
):
    """When memory is off, prompt should not reference memory tools."""
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()
    assert "wren_fetch_context" not in prompt
    assert "wren_recall_queries" not in prompt
    assert "wren_store_query" not in prompt


def test_system_prompt_includes_memory_tools_when_enabled(
    tmp_project, fake_active_profile
):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.system_prompt()

    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    assert "wren_store_query" in prompt


def test_system_prompt_appends_project_instructions_when_present(
    tmp_project, fake_active_profile
):
    """Legacy instructions retain their Markdown and existing section heading."""
    (tmp_project / "instructions.md").write_text(
        "# Domain\n\nThis project tracks B2B SaaS revenue.\n"
    )
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()

    assert prompt.endswith(
        "## Project-specific instructions\n\n"
        "# Domain\n\nThis project tracks B2B SaaS revenue."
    )


@pytest.mark.parametrize(
    "relative_path", ["instructions.md", "knowledge/rules/revenue.md"]
)
def test_system_prompt_reads_utf8_instructions_with_non_utf8_locale(
    tmp_project, fake_active_profile, simulate_cp936_default_encoding, relative_path
):
    """Both rule layouts load UTF-8 content even when the default codec is CP936."""
    project_instructions = "Use the 订单📈 café model for revenue questions."
    instructions_file = tmp_project / relative_path
    instructions_file.parent.mkdir(parents=True, exist_ok=True)
    instructions_file.write_text(project_instructions, encoding="utf-8")
    toolkit = WrenToolkit.from_project(tmp_project)
    simulate_cp936_default_encoding()

    assert project_instructions in toolkit.system_prompt()


def test_system_prompt_includes_rules_from_initialized_v5_project(
    tmp_path, fake_active_profile
):
    """Rules written by the v5 project converter reach the toolkit's prompt."""
    rule = "Revenue excludes cancelled orders; amounts are in cents."
    files = convert_mdl_to_project(
        {
            "layoutVersion": 3,
            "catalog": "wren",
            "schema": "public",
            "dataSource": "duckdb",
            "models": [],
            "_instructions": rule,
        },
        default_name="revenue",
    )
    write_project_files(files, tmp_path)
    save_target(build_json(tmp_path), tmp_path)
    assert (tmp_path / "knowledge/rules/general.md").is_file()
    assert not (tmp_path / "instructions.md").exists()

    toolkit = WrenToolkit.from_project(tmp_path)

    assert toolkit.system_prompt().endswith(
        f"## Project-specific instructions\n\n{rule}"
    )


def test_system_prompt_combines_sorted_rules_before_legacy_instructions(
    tmp_project, fake_active_profile
):
    """Sorted, trimmed rules precede legacy content; blank files add no spacing."""
    rules_dir = tmp_project / "knowledge/rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "b.md").write_text("  Report amounts in cents.\n", encoding="utf-8")
    (rules_dir / "a.md").write_text("\nExclude cancelled orders.  ", encoding="utf-8")
    (rules_dir / "empty.md").write_text(" \n", encoding="utf-8")
    (tmp_project / "instructions.md").write_text(" Legacy rule.\n", encoding="utf-8")
    toolkit = WrenToolkit.from_project(tmp_project)

    assert toolkit.system_prompt().endswith(
        "## Project-specific instructions\n\n"
        "Exclude cancelled orders.\n\nReport amounts in cents.\n\nLegacy rule."
    )


def test_system_prompt_omits_empty_rules_and_instructions(
    tmp_project, fake_active_profile
):
    """Whitespace-only files do not produce an empty instructions section."""
    rules_dir = tmp_project / "knowledge/rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "empty.md").write_text(" \n\t", encoding="utf-8")
    (tmp_project / "instructions.md").write_text("\n ", encoding="utf-8")
    toolkit = WrenToolkit.from_project(tmp_project)

    assert "Project-specific instructions" not in toolkit.system_prompt()


def test_system_prompt_silently_skips_instructions_when_absent(
    tmp_project, fake_active_profile
):
    """Projects without either rule layout need no instructions section."""
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()
    # No "Project-specific instructions" section header should appear.
    assert "Project-specific instructions" not in prompt


def test_memory_workflow_uses_strong_default_language(tmp_project, fake_active_profile):
    """Memory-enabled prompt must use 'by default'/'only when' phrasing,
    not hedge words like 'non-trivial' or 'useful', because empirical testing
    showed soft phrasing causes GPT-4o to skip recall/store reliably."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.system_prompt()

    # Strong-default phrasing must appear.
    assert "by default" in prompt.lower()
    assert "only when" in prompt.lower()

    # Hedges that we explicitly removed must NOT appear.
    assert "non-trivial" not in prompt.lower()
    assert "if helpful" not in prompt.lower()
    assert "useful" not in prompt.lower()


def test_error_phase_guidance_present_in_prompt(tmp_project, fake_active_profile):
    """The prompt must instruct the agent how to react to ok=false envelopes
    by phase, so it can fix-and-retry instead of silently abandoning."""
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.system_prompt()

    assert "SQL_PARSING" in prompt
    assert "SQL_EXECUTION" in prompt


def test_system_prompt_respects_include_memory_write_false(
    tmp_project, fake_active_profile
):
    """When the caller passes a tool list with `wren_store_query` filtered out,
    the workflow must drop the persistence step and the tools section must not
    list it. Otherwise the prompt would tell the LLM to call a tool the agent
    doesn't actually have."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tools_no_write = toolkit.get_tools(include_memory_write=False)
        prompt = toolkit.system_prompt(tools=tools_no_write)

    # Read tools (fetch + recall) still mentioned.
    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    # Write tool dropped both from workflow steps and tools listing.
    assert "wren_store_query" not in prompt
    assert "Persist the NL→SQL pair" not in prompt


def test_system_prompt_default_uses_full_tool_set(tmp_project, fake_active_profile):
    """Without an explicit tools= override, the prompt mirrors get_tools()
    defaults — full memory workflow when memory is enabled."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_langchain._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.system_prompt()

    # Default get_tools() includes all 6, so the workflow has all 3 memory steps.
    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    assert "wren_store_query" in prompt
