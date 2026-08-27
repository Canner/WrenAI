"""Tests for the `wren cloud` Typer sub-app: option wiring and the
git-credential helper's CLI-level stdin/stdout wrapping.

The required live checks (real login against a running Wren Cloud stack,
real git clone/push, real nested-directory refusal, ...) are exercised
manually — mocking `wren.cloud.login`/`link`/`unlink`/`logout` here only
proves the CLI passes options through correctly and prompts when it should,
not that the underlying git/HTTP behavior is correct. The guard and
unbind behaviour itself is covered against real git in ``test_cloud.py``.
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


def test_git_credential_get_error_says_which_tool_produced_it(monkeypatch):
    """git prints this line in among its own output, then fails with a
    credentials message of its own. Unlabelled, the user cannot tell that
    wren — and which wren — is what needs fixing."""
    from wren import __version__

    def raise_it(input_data):
        raise cloud.CloudError("No stored Wren Cloud login for project 16.")

    monkeypatch.setattr(cloud, "git_credential_get", raise_it)
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "get"],
        input="protocol=http\nhost=localhost:8081\npath=git/org/2/16/x.git\n\n",
    )

    assert result.exit_code != 0
    assert "wren cloud git-credential" in result.output
    assert __version__ in result.output


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


# ── unlink ───────────────────────────────────────────────────────────────


def _unlink_outcome(**overrides):
    defaults = {
        "remote_url": "https://cloud.getwren.ai/git/org/2/16/shared-data.git",
        "git_host": "https://cloud.getwren.ai",
        "project_id": "16",
        "key_forgotten": False,
        "helper_removed": False,
    }
    defaults.update(overrides)
    return cloud.UnlinkOutcome(**defaults)


def test_unlink_defaults_to_keeping_the_key(monkeypatch, tmp_path):
    captured = {}

    def fake_unlink(directory, *, forget_key):
        captured.update(directory=directory, forget_key=forget_key)
        return _unlink_outcome()

    monkeypatch.setattr(cloud, "unlink", fake_unlink)
    result = runner.invoke(app, ["cloud", "unlink", str(tmp_path)])

    assert result.exit_code == 0, result.output
    assert captured["forget_key"] is False, (
        "unbinding one directory must not revoke a key another may still use"
    )
    assert "project 16" in result.output


def test_unlink_forget_key_confirms_before_dropping_the_key(monkeypatch, tmp_path):
    calls = {"n": 0}

    def fake_unlink(directory, *, forget_key):
        calls["n"] += 1
        return _unlink_outcome(key_forgotten=True)

    monkeypatch.setattr(cloud, "unlink", fake_unlink)
    declined = runner.invoke(
        app, ["cloud", "unlink", str(tmp_path), "--forget-key"], input="n\n"
    )
    assert declined.exit_code != 0
    assert calls["n"] == 0, "declining the prompt must not drop anything"

    accepted = runner.invoke(
        app, ["cloud", "unlink", str(tmp_path), "--forget-key"], input="y\n"
    )
    assert accepted.exit_code == 0, accepted.output
    assert calls["n"] == 1


def test_unlink_yes_skips_the_confirmation(monkeypatch, tmp_path):
    monkeypatch.setattr(
        cloud, "unlink", lambda d, *, forget_key: _unlink_outcome(key_forgotten=True)
    )
    result = runner.invoke(
        app, ["cloud", "unlink", str(tmp_path), "--forget-key", "--yes"]
    )
    assert result.exit_code == 0, result.output
    assert "Dropped the stored API key" in result.output


def test_unlink_reports_a_removed_helper(monkeypatch, tmp_path):
    monkeypatch.setattr(
        cloud,
        "unlink",
        lambda d, *, forget_key: _unlink_outcome(
            key_forgotten=True, helper_removed=True
        ),
    )
    result = runner.invoke(
        app, ["cloud", "unlink", str(tmp_path), "--forget-key", "--yes"]
    )
    assert "credential helper" in result.output


def test_unlink_reports_a_non_wren_remote_without_naming_a_project(
    monkeypatch, tmp_path
):
    """`origin` pointing at GitHub is still removed — the directory is
    unbound either way — but naming a project would be a fiction."""
    monkeypatch.setattr(
        cloud,
        "unlink",
        lambda d, *, forget_key: _unlink_outcome(
            remote_url="https://github.com/acme/analytics.git",
            git_host=None,
            project_id=None,
        ),
    )
    result = runner.invoke(app, ["cloud", "unlink", str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert "github.com/acme/analytics.git" in result.output
    assert "project" not in result.output.split("origin")[-1].lower()


def test_unlink_surfaces_a_cloud_error(monkeypatch, tmp_path):
    def fake_unlink(directory, *, forget_key):
        raise cloud.CloudError("not bound to a Wren Cloud project")

    monkeypatch.setattr(cloud, "unlink", fake_unlink)
    result = runner.invoke(app, ["cloud", "unlink", str(tmp_path)])
    assert result.exit_code != 0
    assert "not bound" in result.output


# ── logout ───────────────────────────────────────────────────────────────


def test_logout_drops_the_only_stored_login(monkeypatch):
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

    def fake_logout(git_host, project_id):
        captured.update(git_host=git_host, project_id=project_id)
        return True, False

    monkeypatch.setattr(cloud, "logout", fake_logout)
    result = runner.invoke(app, ["cloud", "logout", "--yes"])

    assert result.exit_code == 0, result.output
    assert captured == {"git_host": "https://cloud.getwren.ai", "project_id": "16"}
    assert "Logged out of project 16" in result.output


def test_logout_errors_when_no_login_is_stored(monkeypatch):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])
    result = runner.invoke(app, ["cloud", "logout", "--yes"])
    assert result.exit_code != 0
    assert "no stored Wren Cloud login" in result.output


def test_logout_disambiguates_multiple_stored_logins(monkeypatch):
    monkeypatch.setattr(
        cloud,
        "list_logins",
        lambda: [
            ("https://a.example.com", "16", {"api_host": "https://a.example.com"}),
            ("https://b.example.com", "17", {"api_host": "https://b.example.com"}),
        ],
    )
    result = runner.invoke(app, ["cloud", "logout", "--yes"])
    assert result.exit_code != 0
    assert "disambiguate" in result.output.lower()


def test_logout_host_filters_on_api_host_not_git_host(monkeypatch):
    """Same contract as `link --host`: the value the user typed at `login`
    (`api_host`) must reach the right login even when it was stored under a
    differing `git_host`."""
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
    monkeypatch.setattr(
        cloud,
        "logout",
        lambda git_host, project_id: (
            captured.update(git_host=git_host) or (True, False)
        ),
    )
    result = runner.invoke(
        app, ["cloud", "logout", "--host", "https://cloud.getwren.ai", "--yes"]
    )
    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "https://internal-git.example.com"


def test_logout_confirms_by_default(monkeypatch):
    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )
    calls = {"n": 0}

    def fake_logout(git_host, project_id):
        calls["n"] += 1
        return True, False

    monkeypatch.setattr(cloud, "logout", fake_logout)
    result = runner.invoke(app, ["cloud", "logout"], input="n\n")
    assert result.exit_code != 0
    assert calls["n"] == 0, "declining the prompt must not drop the key"
