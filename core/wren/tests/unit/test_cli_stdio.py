"""The CLI's console streams when they use a code page other than UTF-8.

On Windows, a piped or redirected stream gets the ANSI code page: cp1252 on
most Western installs, cp932 on Japanese ones. CliRunner's ``charset`` gives
the command streams in that encoding.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren.cli import app

pytestmark = pytest.mark.unit

runner = CliRunner()
# The CLI keeps an encoding named in PYTHONIOENCODING, so unset any the
# environment running the tests has.
cp1252 = CliRunner(charset="cp1252", env={"PYTHONIOENCODING": None})
cp932 = CliRunner(charset="cp932", env={"PYTHONIOENCODING": None})


def test_build_and_validate_write_utf8(tmp_path):
    result = runner.invoke(app, ["context", "init", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.exception

    result = cp1252.invoke(app, ["context", "build", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.exception
    assert " views → " in result.stdout_bytes.decode("utf-8")

    result = cp1252.invoke(app, ["context", "validate", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.exception
    stdout = result.stdout_bytes.decode("utf-8")
    assert "⚠ Model 'example' has no description" in stdout


def test_genbi_build_echoes_a_piped_prompt_intact(tmp_path):
    result = runner.invoke(app, ["context", "init", "--path", str(tmp_path)])
    assert result.exit_code == 0, result.exception

    prompt = "show 訂單 revenue by café"
    result = cp1252.invoke(
        app,
        ["genbi", "build", "myapp", "--prompt", "-", "-p", str(tmp_path)],
        input=prompt.encode("utf-8"),
    )
    assert result.exit_code == 0, result.exception
    assert prompt in result.stdout_bytes.decode("utf-8")


def test_root_help_writes_utf8():
    # cp932 has no "—", which the root help shows in the `context` summary.
    result = cp932.invoke(app, ["--help"])
    assert result.exit_code == 0, result.exception
    assert "Manage MDL context — models" in result.stdout_bytes.decode("utf-8")


def test_encoding_from_pythonioencoding_is_kept(tmp_path):
    result = CliRunner(charset="cp1252").invoke(
        app,
        ["context", "init", "--path", str(tmp_path)],
        env={"PYTHONIOENCODING": "cp1252"},
    )
    assert result.exit_code == 0, result.exception
    assert " — " in result.stdout_bytes.decode("cp1252")
