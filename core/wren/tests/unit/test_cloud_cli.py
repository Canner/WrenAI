"""Tests for the `wren cloud` Typer sub-app: option wiring and the
git-credential helper's CLI-level stdin/stdout wrapping.

The seven required live checks (real login against a running Wren Cloud
stack, real git clone/push, real nested-directory refusal, ...) are
exercised manually — mocking `wren.cloud.login`/`link` here only proves the
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


# ── link ─────────────────────────────────────────────────────────────────


def test_link_errors_when_no_login_is_stored(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])
    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])
    assert result.exit_code != 0
    assert "wren cloud login" in result.output


def test_link_disambiguates_multiple_stored_logins(monkeypatch, tmp_path):
    monkeypatch.setattr(
        cloud,
        "list_logins",
        lambda: [
            ("https://a.example.com", "16", {"api_host": "https://a.example.com"}),
            ("https://b.example.com", "17", {"api_host": "https://b.example.com"}),
        ],
    )
    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])
    assert result.exit_code != 0
    assert "disambiguate" in result.output.lower()


def test_link_host_filters_on_api_host_not_git_host(monkeypatch, tmp_path):
    """`--host` must match what `login --host` was given and what the
    disambiguation candidates print (`api_host`), not the internal storage
    key (`git_host`) — a login stored under a differing `--git-host` must
    still be reachable by the host the user actually typed at login."""
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud,
        "list_logins",
        lambda: [("https://internal-git.example.com", "16", entry)],
    )

    captured = {}

    def fake_link(directory, *, git_host, api_host, project_id, org_id, repo):
        captured.update(git_host=git_host, api_host=api_host)
        return cloud.LinkOutcome.LINKED

    monkeypatch.setattr(cloud, "link", fake_link)

    result = runner.invoke(
        app,
        ["cloud", "link", str(tmp_path), "--host", "https://cloud.getwren.ai"],
    )
    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "https://internal-git.example.com"
    assert captured["api_host"] == "https://cloud.getwren.ai"


def test_link_host_still_disambiguates_when_api_hosts_collide(monkeypatch, tmp_path):
    """Two logins that share an `api_host` but differ only by `--git-host`
    (e.g. a corrected re-login after a wrong `--git-host`) must not be
    silently missed — `--host <api_host>` still leaves both candidates and
    the command must ask the user to disambiguate, not report either a
    false "not found" or pick one arbitrarily."""
    monkeypatch.setattr(
        cloud,
        "list_logins",
        lambda: [
            (
                "https://wrong-git.example.com",
                "16",
                {"api_host": "https://cloud.getwren.ai"},
            ),
            (
                "https://right-git.example.com",
                "16",
                {"api_host": "https://cloud.getwren.ai"},
            ),
        ],
    )
    result = runner.invoke(
        app,
        ["cloud", "link", str(tmp_path), "--host", "https://cloud.getwren.ai"],
    )
    assert result.exit_code != 0
    assert "disambiguate" in result.output.lower()


def test_link_invokes_cloud_link_with_the_single_stored_login(monkeypatch, tmp_path):
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

    def fake_link(directory, *, git_host, api_host, project_id, org_id, repo):
        captured.update(
            directory=directory,
            git_host=git_host,
            api_host=api_host,
            project_id=project_id,
            org_id=org_id,
            repo=repo,
        )
        return cloud.LinkOutcome.LINKED

    monkeypatch.setattr(cloud, "link", fake_link)
    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "https://cloud.getwren.ai"
    assert captured["project_id"] == "16"
    assert captured["repo"] == "org/2/16/shared-data.git"
    assert "Linked project 16" in result.output


def test_link_reports_already_linked_without_implying_a_fresh_merge(
    monkeypatch, tmp_path
):
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )
    monkeypatch.setattr(
        cloud, "link", lambda *args, **kwargs: cloud.LinkOutcome.ALREADY_LINKED
    )

    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])

    assert result.exit_code == 0, result.output
    assert "already linked" in result.output.lower()
    assert "git pull" in result.output


def test_link_reports_cloud_error_without_traceback(monkeypatch, tmp_path):
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )

    def fake_link(*args, **kwargs):
        raise cloud.NestedRepoError(tmp_path, tmp_path.parent)

    monkeypatch.setattr(cloud, "link", fake_link)
    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])
    assert result.exit_code != 0
    assert "inside an existing git repository" in result.output


# ── create ───────────────────────────────────────────────────────────────


def test_create_reads_org_key_from_env_and_passes_options_through(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("WREN_CLOUD_ORG_KEY", "osk-from-env")
    captured = {}

    def fake_create(directory, **kwargs):
        captured.update(directory=directory, **kwargs)
        return (
            cloud.CreatedProject(
                id="16", org_id="2", display_name="proj", status="succeeded", errors=[]
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "create", fake_create)

    result = runner.invoke(
        app,
        [
            "cloud",
            "create",
            str(tmp_path),
            "--host",
            "https://cloud.getwren.ai",
            "--org",
            "2",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured["org_key"] == "osk-from-env"
    assert captured["org_id"] == "2"
    assert captured["display_name"] == tmp_path.resolve().name
    assert "Created project 16" in result.output
    assert "Linked project 16" in result.output


def test_create_prompts_for_org_key_when_not_given(monkeypatch, tmp_path):
    captured = {}

    def fake_create(directory, **kwargs):
        captured.update(kwargs)
        return (
            cloud.CreatedProject(
                id="16", org_id="2", display_name="proj", status="succeeded", errors=[]
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "create", fake_create)

    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2"],
        input="osk-typed-in\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["org_key"] == "osk-typed-in"


def test_create_rejects_a_project_key_instead_of_an_org_key(tmp_path):
    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2"],
        input="sk-project-key\n",
    )
    assert result.exit_code != 0
    assert "organization API key" in result.output


def test_create_rejects_both_connection_info_flags_together(tmp_path):
    result = runner.invoke(
        app,
        [
            "cloud",
            "create",
            str(tmp_path),
            "--host",
            "h",
            "--org",
            "2",
            "--connection-info",
            "{}",
            "--connection-info-file",
            str(tmp_path / "x.json"),
        ],
    )
    assert result.exit_code != 0
    assert "at most one of" in result.output


def test_create_requires_type_when_connection_info_is_given(tmp_path):
    result = runner.invoke(
        app,
        [
            "cloud",
            "create",
            str(tmp_path),
            "--host",
            "h",
            "--org",
            "2",
            "--connection-info",
            '{"host": "db"}',
        ],
        input="osk-x\n",
    )
    assert result.exit_code != 0
    assert "--type is required" in result.output


def test_create_passes_parsed_connection_info_and_type_through(monkeypatch, tmp_path):
    captured = {}

    def fake_create(directory, **kwargs):
        captured.update(kwargs)
        return (
            cloud.CreatedProject(
                id="16", org_id="2", display_name="proj", status="succeeded", errors=[]
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "create", fake_create)

    result = runner.invoke(
        app,
        [
            "cloud",
            "create",
            str(tmp_path),
            "--host",
            "h",
            "--org",
            "2",
            "--type",
            "POSTGRES",
            "--connection-info",
            '{"host": "db"}',
            "--test-connection",
        ],
        input="osk-x\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["connection_type"] == "POSTGRES"
    assert captured["connection_info"] == {"host": "db"}
    assert captured["test_connection"] is True


def test_create_reports_partial_status_errors_but_still_succeeds(monkeypatch, tmp_path):
    def fake_create(directory, **kwargs):
        return (
            cloud.CreatedProject(
                id="16",
                org_id="2",
                display_name="proj",
                status="partial",
                errors=[{"resource": "mdl", "message": "bad mdl"}],
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "create", fake_create)

    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2"],
        input="osk-x\n",
    )
    assert result.exit_code == 0, result.output
    assert "mdl" in result.output
    assert "bad mdl" in result.output


def test_create_reports_cloud_error_without_traceback(monkeypatch, tmp_path):
    def fake_create(directory, **kwargs):
        raise cloud.CloudError("boom")

    monkeypatch.setattr(cloud, "create", fake_create)

    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2"],
        input="osk-x\n",
    )
    assert result.exit_code != 0
    assert "boom" in result.output


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
