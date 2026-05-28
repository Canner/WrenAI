"""Tests for `wren ask` prompt shaping."""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren import ask as ask_mod
from wren.cli import app

runner = CliRunner()


def test_no_mode_flag_rejected():
    result = runner.invoke(app, ["ask", "show me revenue"])
    assert result.exit_code != 0
    out = result.output + (result.stderr if result.stderr_bytes else "")
    assert "--guided" in out and "--direct" in out


def test_both_mode_flags_rejected():
    result = runner.invoke(app, ["ask", "show me revenue", "--guided", "--direct"])
    assert result.exit_code != 0


def test_guided_includes_task_flow_and_substitutes_prompt():
    result = runner.invoke(app, ["ask", "top 5 customers by revenue", "--guided"])
    assert result.exit_code == 0
    assert "TASK TYPE A" in result.output
    assert "TASK TYPE B" in result.output
    assert "wren context show" in result.output
    assert "top 5 customers by revenue" in result.output
    assert "<USER_PROMPT>" not in result.output  # placeholder substituted


def test_direct_minimal_and_substitutes_prompt():
    result = runner.invoke(app, ["ask", "monthly orders trend", "--direct"])
    assert result.exit_code == 0
    assert "wren skills list" in result.output
    assert "wren --help" in result.output
    assert "monthly orders trend" in result.output
    assert "<USER_PROMPT>" not in result.output
    # direct mode should NOT include the guided TASK TYPE structure
    assert "TASK TYPE A" not in result.output


def test_render_api_known_modes():
    for mode in ask_mod.MODES:
        out = ask_mod.render(mode, "hello world")
        assert "hello world" in out
        assert "<USER_PROMPT>" not in out


def test_render_unknown_mode_raises():
    with pytest.raises(ask_mod.UnknownAskModeError):
        ask_mod.render("auto", "anything")


def test_user_prompt_with_template_placeholder_substring_is_safe():
    # Prompt containing the literal placeholder shouldn't break rendering;
    # we only do one replacement of the bundled-template placeholder.
    prompt = "Show literal <USER_PROMPT> usage examples"
    out = ask_mod.render("direct", prompt)
    # the bundled placeholder is gone and the prompt is present (verbatim)
    assert prompt in out
