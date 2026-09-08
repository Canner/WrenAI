"""Unit tests for ``wren profile rm``'s confirmation flag.

Lives in ``tests/unit/`` deliberately: ``tests/test_profile_cli.py`` covers
this command far more thoroughly but is not referenced by any CI job (CI runs
``tests/unit/``, ``tests/test_profile_web.py`` and ``tests/test_field_registry.py``),
so a regression in a *shipped* flag would not be caught there.

``rm`` skips its confirmation with ``--yes``/``-y``. ``--force``/``-f`` are
kept as deprecated aliases because the command is already released and
scripts use them; elsewhere in this CLI ``--force`` means "overwrite files"
(``wren context init --force``), which is why the confirmation-skipping
spelling moved.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren import profile_cli
from wren.memory import cli as memory_cli

pytestmark = pytest.mark.unit

runner = CliRunner()


@pytest.mark.parametrize("flag", ["--yes", "-y", "--force", "-f"])
def test_rm_skips_confirmation_for_every_accepted_spelling(flag, monkeypatch):
    removed = []

    def fake_remove(name):
        removed.append(name)
        return True  # `rm` treats a falsy return as "profile not found"

    monkeypatch.setattr("wren.profile.remove_profile", fake_remove)

    result = runner.invoke(profile_cli.profile_app, ["rm", "pg", flag])

    assert result.exit_code == 0, result.output
    assert removed == ["pg"], (
        f"{flag} must skip the prompt and remove the profile; a prompt with no "
        "stdin would abort instead"
    )


def test_rm_without_a_skip_flag_still_prompts(monkeypatch):
    removed = []

    def fake_remove(name):
        removed.append(name)
        return True  # `rm` treats a falsy return as "profile not found"

    monkeypatch.setattr("wren.profile.remove_profile", fake_remove)

    declined = runner.invoke(profile_cli.profile_app, ["rm", "pg"], input="n\n")

    assert declined.exit_code != 0
    assert removed == [], "declining the prompt must not remove the profile"


# ── wren memory reset / forget ─────────────────────────────────────────────
#
# Same rename, and the same CI reasoning: tests/unit/test_memory.py is run by
# its own CI job behind the `memory` extra, so a flag regression there is not
# caught by the default unit job. These assert only on option parsing, which
# needs no extra.


@pytest.mark.parametrize("flag", ["--yes", "-y", "--force", "-f"])
def test_memory_reset_accepts_every_skip_spelling(flag, monkeypatch):
    calls = []
    monkeypatch.setattr("wren.context.discover_project_path", lambda: Path("."))

    class _Idx:
        name = "lancedb"

        def reset(self):
            calls.append("reset")

    monkeypatch.setattr("wren.memory.index_backend.get_index", lambda *a, **k: _Idx())

    result = runner.invoke(memory_cli.memory_app, ["reset", flag])
    assert result.exit_code == 0, result.output
    assert calls == ["reset"], (
        f"{flag} must skip the prompt; with no stdin a prompt would abort"
    )


@pytest.mark.parametrize("flag", ["--force", "-f", "--yes", "-y"])
def test_memory_forget_keeps_force_and_also_accepts_yes(flag):
    """`forget`'s flag selects non-interactive *mode*, so it keeps `--force`
    as its documented name — but `--yes` must still reach it, or the CLI
    would have two vocabularies for the same user intent."""

    # Parsing is what is under test: --id with --source is rejected *after*
    # the flag is parsed, so a bad flag name would fail differently (exit 2,
    # "No such option") than this deliberate usage error.
    result = runner.invoke(
        memory_cli.memory_app,
        ["forget", "--id", "1", "--source", "user", flag],
    )
    assert "No such option" not in result.output, f"{flag} must be an accepted spelling"
