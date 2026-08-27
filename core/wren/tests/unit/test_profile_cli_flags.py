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

import pytest
from typer.testing import CliRunner

from wren import profile_cli

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
