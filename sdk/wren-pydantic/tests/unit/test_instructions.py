"""Tests for the instructions builder."""

from unittest.mock import MagicMock, patch

from wren_pydantic import WrenToolkit


def _enable_memory(tmp_project):
    (tmp_project / ".wren" / "memory").mkdir(parents=True)
    return tmp_project


def test_instructions_returns_str(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()
    assert isinstance(prompt, str)
    assert len(prompt) > 0


def test_instructions_includes_workflow_section(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()
    assert "Wren" in prompt
    # Workflow rule about Wren model names being preferred over raw tables.
    assert "model" in prompt.lower()


def test_instructions_lists_enabled_tools_in_summary(tmp_project, fake_active_profile):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()
    assert "wren_query" in prompt
    assert "wren_dry_plan" in prompt
    assert "wren_list_models" in prompt


def test_instructions_omits_memory_tools_when_disabled(
    tmp_project, fake_active_profile
):
    """When memory is off, prompt should not reference memory tools."""
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()
    assert "wren_fetch_context" not in prompt
    assert "wren_recall_queries" not in prompt
    assert "wren_store_query" not in prompt


def test_instructions_includes_memory_tools_when_enabled(
    tmp_project, fake_active_profile
):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.instructions()

    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    assert "wren_store_query" in prompt


def test_instructions_appends_project_instructions_when_present(
    tmp_project, fake_active_profile
):
    (tmp_project / "instructions.md").write_text(
        "# Domain\n\nThis project tracks B2B SaaS revenue.\n"
    )
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()

    assert "B2B SaaS revenue" in prompt
    assert "Project-specific instructions" in prompt


def test_instructions_silently_skips_instructions_when_absent(
    tmp_project, fake_active_profile
):
    toolkit = WrenToolkit.from_project(tmp_project)
    prompt = toolkit.instructions()
    # No "Project-specific instructions" section header should appear.
    assert "Project-specific instructions" not in prompt


def test_memory_workflow_uses_strong_default_language(tmp_project, fake_active_profile):
    """Memory-enabled prompt must use 'by default'/'only when' phrasing,
    not hedge words like 'non-trivial' or 'useful', because empirical testing
    showed soft phrasing causes GPT-4o to skip recall/store reliably."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.instructions()

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
    prompt = toolkit.instructions()

    assert "SQL_PARSING" in prompt
    assert "SQL_EXECUTION" in prompt


def test_instructions_respects_include_memory_write_false(
    tmp_project, fake_active_profile
):
    """When the caller passes a tool list with `wren_store_query` filtered out,
    the workflow must drop the persistence step and the tools section must not
    list it. Otherwise the prompt would tell the LLM to call a tool the agent
    doesn't actually have."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        tools_no_write = toolkit.toolset(include_memory_write=False)
        prompt = toolkit.instructions(toolset=tools_no_write)

    # Read tools (fetch + recall) still mentioned.
    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    # Write tool dropped both from workflow steps and tools listing.
    assert "wren_store_query" not in prompt
    assert "Persist the NL→SQL pair" not in prompt


def test_instructions_default_uses_full_tool_set(tmp_project, fake_active_profile):
    """Without an explicit tools= override, the prompt mirrors toolset()
    defaults — full memory workflow when memory is enabled."""
    project = tmp_project
    (project / ".wren" / "memory").mkdir(parents=True)
    fake_store = MagicMock(name="MemoryStore")

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        toolkit = WrenToolkit.from_project(project)
        prompt = toolkit.instructions()

    # Default toolset() includes all 6, so the workflow has all 3 memory steps.
    assert "wren_fetch_context" in prompt
    assert "wren_recall_queries" in prompt
    assert "wren_store_query" in prompt
