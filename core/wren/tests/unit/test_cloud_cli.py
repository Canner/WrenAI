"""Tests for the `wren cloud` Typer sub-app: option wiring and the
git-credential helper's CLI-level stdin/stdout wrapping.

The seven required live checks (real login against a running Wren Cloud
stack, real git clone/push, real nested-directory refusal, ...) are
exercised manually — mocking `wren.cloud.login`/`pull` here only proves the
CLI passes options through correctly, not that the underlying git/HTTP
behavior is correct.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wren import cloud
from wren.cli import app

pytestmark = pytest.mark.unit

runner = CliRunner()


# ── login ────────────────────────────────────────────────────────────────


def test_login_prompts_for_key_and_never_takes_it_as_an_argument(monkeypatch):
    captured = {}

    def fake_login(*, host, project_id, api_key, git_host):
        captured.update(
            host=host, project_id=project_id, api_key=api_key, git_host=git_host
        )
        return cloud.GitToken(
            repo="org/2/16/shared-data.git",
            token="t",
            expires_in=600,
            expires_at="",
        )

    monkeypatch.setattr(cloud, "login", fake_login)

    result = runner.invoke(
        app,
        ["cloud", "login", "--host", "https://cloud.getwren.ai", "--project", "16"],
        input="sk-secret\n",
    )
    assert result.exit_code == 0, result.output
    assert captured == {
        "host": "https://cloud.getwren.ai",
        "project_id": "16",
        "api_key": "sk-secret",
        "git_host": None,
    }


def test_login_passes_through_git_host_override(monkeypatch):
    captured = {}

    def fake_login(*, host, project_id, api_key, git_host):
        captured["git_host"] = git_host
        return cloud.GitToken(repo="r", token="t", expires_in=1, expires_at="")

    monkeypatch.setattr(cloud, "login", fake_login)
    result = runner.invoke(
        app,
        [
            "cloud",
            "login",
            "--host",
            "https://api.example.com",
            "--project",
            "16",
            "--git-host",
            "http://localhost:8081",
        ],
        input="sk-secret\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "http://localhost:8081"


def test_login_rejects_empty_key(monkeypatch):
    result = runner.invoke(
        app,
        ["cloud", "login", "--host", "https://cloud.getwren.ai", "--project", "16"],
        input="\n",
    )
    assert result.exit_code != 0


def test_login_reports_cloud_error_without_traceback(monkeypatch):
    def fake_login(**kwargs):
        raise cloud.InvalidApiKeyError("This key is not valid for project 16.")

    monkeypatch.setattr(cloud, "login", fake_login)
    result = runner.invoke(
        app,
        ["cloud", "login", "--host", "https://cloud.getwren.ai", "--project", "16"],
        input="sk-wrong\n",
    )
    assert result.exit_code != 0
    assert "not valid for project 16" in result.output


# ── pull ─────────────────────────────────────────────────────────────────


def test_pull_errors_when_no_login_is_stored(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])
    result = runner.invoke(app, ["cloud", "pull", str(tmp_path)])
    assert result.exit_code != 0
    assert "wren cloud login" in result.output


def test_pull_disambiguates_multiple_stored_logins(monkeypatch, tmp_path):
    monkeypatch.setattr(
        cloud,
        "list_logins",
        lambda: [
            ("https://a.example.com", "16", {"api_host": "https://a.example.com"}),
            ("https://b.example.com", "17", {"api_host": "https://b.example.com"}),
        ],
    )
    result = runner.invoke(app, ["cloud", "pull", str(tmp_path)])
    assert result.exit_code != 0
    assert "disambiguate" in result.output.lower()


def test_pull_invokes_cloud_pull_with_the_single_stored_login(monkeypatch, tmp_path):
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )

    captured = {}

    def fake_pull(directory, *, git_host, api_host, project_id, org_id, repo):
        captured.update(
            directory=directory,
            git_host=git_host,
            api_host=api_host,
            project_id=project_id,
            org_id=org_id,
            repo=repo,
        )

    monkeypatch.setattr(cloud, "pull", fake_pull)
    result = runner.invoke(app, ["cloud", "pull", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "https://cloud.getwren.ai"
    assert captured["project_id"] == "16"
    assert captured["repo"] == "org/2/16/shared-data.git"


def test_pull_reports_cloud_error_without_traceback(monkeypatch, tmp_path):
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )

    def fake_pull(*args, **kwargs):
        raise cloud.NestedRepoError(tmp_path, tmp_path.parent)

    monkeypatch.setattr(cloud, "pull", fake_pull)
    result = runner.invoke(app, ["cloud", "pull", str(tmp_path)])
    assert result.exit_code != 0
    assert "inside an existing git repository" in result.output


# ── git-credential get/store/erase (CLI-level stdin/stdout wrapping) ───────


def test_git_credential_get_writes_credentials_to_stdout(monkeypatch):
    monkeypatch.setattr(
        cloud,
        "git_credential_get",
        lambda input_data: "username=x-access-token\npassword=minted\n",
    )
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "get"],
        input="protocol=http\nhost=localhost:8081\npath=git/org/2/16/x.git\n\n",
    )
    assert result.exit_code == 0, result.output
    assert result.output == "username=x-access-token\npassword=minted\n"


def test_git_credential_get_error_goes_to_stderr_not_stdout(monkeypatch):
    def raise_it(input_data):
        raise cloud.CloudError("No stored Wren Cloud login for project 16.")

    monkeypatch.setattr(cloud, "git_credential_get", raise_it)
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "get"],
        input="protocol=http\nhost=localhost:8081\npath=git/org/2/16/x.git\n\n",
    )
    assert result.exit_code != 0
    assert "No stored Wren Cloud login" in result.output


def test_git_credential_store_produces_no_output(monkeypatch):
    monkeypatch.setattr(cloud, "git_credential_store", lambda input_data: None)
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "store"],
        input="protocol=http\nhost=localhost:8081\npassword=abc\n\n",
    )
    assert result.exit_code == 0, result.output
    assert result.output == ""


def test_git_credential_erase_produces_no_output(monkeypatch):
    monkeypatch.setattr(cloud, "git_credential_erase", lambda input_data: None)
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "erase"],
        input="protocol=http\nhost=localhost:8081\npassword=abc\n\n",
    )
    assert result.exit_code == 0, result.output
    assert result.output == ""
