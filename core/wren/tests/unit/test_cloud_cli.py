"""Tests for the `wren cloud` Typer sub-app: option wiring and the
git-credential helper's CLI-level stdin/stdout wrapping.

The required live checks (real login against a running Wren Cloud stack,
real git clone/push, real nested-directory refusal, ...) are exercised
manually — mocking the `wren.cloud` functions here only
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
        [
            "cloud",
            "auth",
            "add",
            "--host",
            "https://cloud.getwren.ai",
            "--project",
            "16",
        ],
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
            "auth",
            "add",
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
        [
            "cloud",
            "auth",
            "add",
            "--host",
            "https://cloud.getwren.ai",
            "--project",
            "16",
        ],
        input="\n",
    )
    assert result.exit_code != 0


def test_login_reports_cloud_error_without_traceback(monkeypatch):
    def fake_login(**kwargs):
        raise cloud.InvalidApiKeyError("This key is not valid for project 16.")

    monkeypatch.setattr(cloud, "login", fake_login)
    result = runner.invoke(
        app,
        [
            "cloud",
            "auth",
            "add",
            "--host",
            "https://cloud.getwren.ai",
            "--project",
            "16",
        ],
        input="sk-wrong\n",
    )
    assert result.exit_code != 0
    assert "not valid for project 16" in result.output


# ── link ─────────────────────────────────────────────────────────────────


def test_link_errors_when_no_login_is_stored(monkeypatch, tmp_path):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])
    result = runner.invoke(app, ["cloud", "link", str(tmp_path)])
    assert result.exit_code != 0
    assert "wren cloud auth add" in result.output


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
    # Asserts the behaviour, not the wording: it must refuse rather than pick,
    # and it must print the flags that would narrow the choice.
    assert "--host" in result.output and "--project" in result.output


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
    # Asserts the behaviour, not the wording: it must refuse rather than pick,
    # and it must print the flags that would narrow the choice.
    assert "--host" in result.output and "--project" in result.output


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


def test_link_names_a_real_path_when_the_directory_argument_is_defaulted(
    monkeypatch, tmp_path
):
    """The directory argument defaults to `.` and every message naming it ends
    in a full stop, so an unresolved default renders as `into ..` — which reads
    as the parent directory. Observed live against staging."""

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
        cloud, "link", lambda *a, **k: cloud.LinkOutcome.LINKED
    )
    monkeypatch.chdir(tmp_path)

    # No directory argument: exercises the `Path(".")` default.
    result = runner.invoke(app, ["cloud", "link"])

    assert result.exit_code == 0, result.output
    assert "into .." not in result.output, (
        "the defaulted directory must not render as a bare dot before the "
        f"sentence's full stop: {result.output!r}"
    )
    assert str(tmp_path.resolve()) in result.output


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


# `create` requires a type and a connection info, so every invocation carries
# them. Kept in one place: they are a precondition of the command, not the
# subject of most of these tests.
CONN_ARGS = ["--type", "BIG_QUERY", "--connection-info", '{"projectId": "p"}']


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
            *CONN_ARGS,
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
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2", *CONN_ARGS],
        input="osk-typed-in\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["org_key"] == "osk-typed-in"


def test_create_rejects_a_project_key_instead_of_an_org_key(tmp_path):
    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2", *CONN_ARGS],
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


@pytest.mark.parametrize(
    "args,expected",
    [
        pytest.param([], ["--type", "--connection-info"], id="neither"),
        pytest.param(
            ["--connection-info", '{"host": "db"}'], ["--type"], id="no_type"
        ),
        pytest.param(["--type", "POSTGRES"], ["--connection-info"], id="no_conn"),
    ],
)
def test_create_requires_both_a_type_and_a_connection_info(
    args, expected, monkeypatch, tmp_path
):
    """A project created without a data source is reported by Wren Cloud as
    still needing setup, and this CLI cannot attach one afterwards — so the
    command refuses rather than producing one that cannot be used."""

    def fail_if_called(*a, **k):
        raise AssertionError("nothing may be created without a data source")

    monkeypatch.setattr(cloud, "create", fail_if_called)

    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2", *args],
        input="osk-x\n",
    )

    assert result.exit_code != 0
    for flag in expected:
        assert flag in result.output, f"{flag} must be named as missing"


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
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2", *CONN_ARGS],
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
        ["cloud", "create", str(tmp_path), "--host", "h", "--org", "2", *CONN_ARGS],
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
    """`get`'s stdout is parsed by git as credential fields, so an error
    written there is fed to git as credential data. The assertion has to
    separate the streams: `result.output` combines them, so checking it
    proves the message exists somewhere, not that it stayed off stdout.
    """

    def raise_it(input_data):
        raise cloud.CloudError("No stored Wren Cloud login for project 16.")

    monkeypatch.setattr(cloud, "git_credential_get", raise_it)
    result = runner.invoke(
        app,
        ["cloud", "git-credential", "get"],
        input="protocol=http\nhost=localhost:8081\npath=git/org/2/16/x.git\n\n",
    )
    assert result.exit_code != 0
    assert "No stored Wren Cloud login" in result.stderr
    assert "No stored Wren Cloud login" not in result.stdout
    # Nothing at all on stdout: git reads it as `key=value` lines, so even
    # unrelated output there is a malformed credential reply.
    assert result.stdout == ""


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
    # `origin` was not a Wren Cloud URL, so there is no project to name and
    # naming one would be a fiction. Asserts on the concrete strings a
    # regression would produce, rather than slicing the message on a word it
    # happens to contain.
    assert "project 16" not in result.output
    assert "project None" not in result.output


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
    result = runner.invoke(app, ["cloud", "auth", "remove", "--yes"])

    assert result.exit_code == 0, result.output
    assert captured == {"git_host": "https://cloud.getwren.ai", "project_id": "16"}
    assert "Logged out of project 16" in result.output


def test_logout_errors_when_no_login_is_stored(monkeypatch):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])
    result = runner.invoke(app, ["cloud", "auth", "remove", "--yes"])
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
    result = runner.invoke(app, ["cloud", "auth", "remove", "--yes"])
    assert result.exit_code != 0
    # Asserts the behaviour, not the wording: it must refuse rather than pick,
    # and it must print the flags that would narrow the choice.
    assert "--host" in result.output and "--project" in result.output


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
        app, ["cloud", "auth", "remove", "--host", "https://cloud.getwren.ai", "--yes"]
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
    result = runner.invoke(app, ["cloud", "auth", "remove"], input="n\n")
    assert result.exit_code != 0
    assert calls["n"] == 0, "declining the prompt must not drop the key"


# ── --host default and normalization ──────────────────────────────────────


def _fake_created():
    return cloud.CreatedProject(
        id="16", org_id="190", display_name="proj", status="succeeded", errors=[]
    )


def test_auth_add_defaults_to_the_managed_host(monkeypatch):
    captured = {}

    def fake_login(*, host, project_id, api_key, git_host):
        captured.update(host=host)
        return cloud.GitToken(
            repo="org/2/16/x.git", token="t", expires_in=1, expires_at=""
        )

    monkeypatch.setattr(cloud, "login", fake_login)
    result = runner.invoke(
        app, ["cloud", "auth", "add", "--project", "16"], input="sk-x\n"
    )
    assert result.exit_code == 0, result.output
    assert captured["host"] == "https://cloud.getwren.ai"


def test_auth_add_gives_a_bare_hostname_a_scheme(monkeypatch):
    """`--host` reads as a hostname, so people type one. Without a scheme it
    reaches requests as a relative URL and fails in a way that looks like a
    bug in the tool."""
    captured = {}

    def fake_login(*, host, project_id, api_key, git_host):
        captured.update(host=host)
        return cloud.GitToken(
            repo="org/2/16/x.git", token="t", expires_in=1, expires_at=""
        )

    monkeypatch.setattr(cloud, "login", fake_login)
    result = runner.invoke(
        app,
        ["cloud", "auth", "add", "--project", "16", "--host", "self.example.com"],
        input="sk-x\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["host"] == "https://self.example.com"


def test_auth_add_names_the_host_in_the_key_prompt(monkeypatch):
    """The only place a defaulted --host is visible before anything happens,
    which matters now that omitting it targets the managed service."""
    monkeypatch.setattr(
        cloud,
        "login",
        lambda **kwargs: cloud.GitToken(
            repo="org/2/16/x.git", token="t", expires_in=1, expires_at=""
        ),
    )
    result = runner.invoke(
        app, ["cloud", "auth", "add", "--project", "16"], input="sk-x\n"
    )
    assert "https://cloud.getwren.ai" in result.output


def test_create_defaults_to_the_managed_host(monkeypatch, tmp_path):
    captured = {}

    def fake_create(directory, **kwargs):
        captured.update(host=kwargs["host"])
        return _fake_created(), cloud.LinkOutcome.LINKED

    monkeypatch.setattr(cloud, "create", fake_create)
    result = runner.invoke(
        app,
        ["cloud", "create", str(tmp_path), "--org", "190", *CONN_ARGS],
        input="osk-x\n",
    )
    assert result.exit_code == 0, result.output
    assert captured["host"] == "https://cloud.getwren.ai"


def test_create_upper_cases_the_data_source_type(monkeypatch, tmp_path):
    """`--type big_query` reached the server verbatim and came back as a 207
    with a project that had no data source: the server looks the type up in
    its enum by exact key and does not validate it on this endpoint, so a
    lowercase value silently produced a half-created project."""

    captured = {}

    def fake_create(directory, **kwargs):
        captured.update(kwargs)
        return (
            cloud.CreatedProject(
                id="16", org_id="2", display_name="p", status="succeeded", errors=[]
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "create", fake_create)
    conn = tmp_path / "conn.json"
    conn.write_text('{"projectId": "p", "datasetId": "d"}')

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
            "--org-key",
            "osk-x",
            "--type",
            "big_query",
            "--connection-info-file",
            str(conn),
        ],
    )

    assert result.exit_code == 0, result.output
    assert captured["connection_type"] == "BIG_QUERY"


def test_create_help_names_a_type_the_server_accepts(monkeypatch):
    """The help used to say `BIGQUERY`, which is not in the server's enum —
    following it produced the same half-created project as the lowercase case."""

    result = runner.invoke(app, ["cloud", "create", "--help"])
    assert result.exit_code == 0
    rendered = " ".join(result.output.split())
    assert "BIG_QUERY" in rendered
    assert "BIGQUERY," not in rendered and "BIGQUERY." not in rendered


@pytest.mark.parametrize(
    "command,extra",
    [
        pytest.param("auth_add", [], id="auth_add"),
        pytest.param("create", ["--org", "2", *["--type", "BIG_QUERY"], "--connection-info", '{"projectId": "p"}'], id="create"),
    ],
)
def test_git_host_is_normalized_like_host(command, extra, monkeypatch, tmp_path):
    """`--git-host` becomes both the git-config section name and the helper's
    lookup key. Left scheme-less, git never matches the section it wrote and
    the helper looks under a different key — while the command still reports
    success. `--host` was already normalized; this is the same treatment."""

    captured = {}

    def fake_login(*, host, project_id, api_key, git_host=None):
        captured["git_host"] = git_host
        return cloud.GitToken(
            repo="org/2/16/shared-data.git", token="t", expires_in=600, expires_at=""
        )

    def fake_create(directory, **kwargs):
        captured["git_host"] = kwargs.get("git_host")
        return (
            cloud.CreatedProject(
                id="16", org_id="2", display_name="p", status="succeeded", errors=[]
            ),
            cloud.LinkOutcome.LINKED,
        )

    monkeypatch.setattr(cloud, "login", fake_login)
    monkeypatch.setattr(cloud, "create", fake_create)

    args = ["cloud"]
    args += ["auth", "add"] if command == "auth_add" else ["create", str(tmp_path)]
    args += ["--host", "https://cloud.getwren.ai", "--git-host", "git.example.com"]
    if command == "auth_add":
        args += ["--project", "16"]
    args += extra

    result = runner.invoke(app, args, input="osk-x\n")

    assert result.exit_code == 0, result.output
    assert captured["git_host"] == "https://git.example.com", (
        "a scheme-less --git-host must not reach the credential store raw"
    )


@pytest.mark.parametrize("command", ["link", "auth_remove"])
def test_host_filter_matches_a_scheme_less_value(command, monkeypatch, tmp_path):
    """`auth add` stores the normalized host, so comparing the raw `--host`
    against it made a scheme-less value match nothing — reporting "no stored
    login" for a login that exists. The mirror of the writing-side defect."""

    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    monkeypatch.setattr(
        cloud, "list_logins", lambda: [("https://cloud.getwren.ai", "16", entry)]
    )
    monkeypatch.setattr(cloud, "resolve_repo", lambda *a, **k: entry["repo"])
    monkeypatch.setattr(cloud, "link", lambda *a, **k: cloud.LinkOutcome.LINKED)
    monkeypatch.setattr(cloud, "logout", lambda *a, **k: (True, False))

    args = (
        ["cloud", "link", str(tmp_path)]
        if command == "link"
        else ["cloud", "auth", "remove"]
    )
    # No scheme — what a person types when asked for a host.
    args += ["--host", "cloud.getwren.ai", "--project", "16"]
    if command == "auth_remove":
        args += ["--yes"]

    result = runner.invoke(app, args)

    assert result.exit_code == 0, result.output
    assert "no stored login" not in result.output


# ── Selecting a stored login ───────────────────────────────────────────────
#
# The same "no stored login" message has now been reported twice for logins
# that exist: once for a scheme-less `--host`, once for `--host` given the
# *git* host. Both times the filter was right and the message was not, so
# these pin the message.


def _two_logins():
    return [
        (
            "https://git.example.com",
            "16",
            {
                "api_host": "https://api.example.com",
                "org_id": "2",
                "repo": "org/2/16/shared-data.git",
                "api_key": "sk-x",
            },
        ),
    ]


@pytest.mark.parametrize("command", ["link", "auth_remove"])
def test_wrong_host_role_says_which_host_is_wanted(command, monkeypatch, tmp_path):
    """The store is keyed by git host; `--host` means the API host. Passing the
    git host must not report the project as absent — it exists."""

    monkeypatch.setattr(cloud, "list_logins", _two_logins)

    args = (
        ["cloud", "link", str(tmp_path)]
        if command == "link"
        else ["cloud", "auth", "remove", "--yes"]
    )
    # The git host, which is what `~/.wren/cloud.yml` is keyed by.
    args += ["--host", "https://git.example.com", "--project", "16"]

    result = runner.invoke(app, args)

    assert result.exit_code != 0
    out = result.output
    assert "not the git host" in out, "must name the field that failed"
    assert "https://api.example.com" in out, "must print what is stored"
    assert "auth list" in out, "must point at the command that shows it"


@pytest.mark.parametrize("command", ["link", "auth_remove"])
def test_absent_project_is_reported_as_absent(command, monkeypatch, tmp_path):
    """The other branch has to stay distinguishable from the one above."""

    monkeypatch.setattr(cloud, "list_logins", _two_logins)

    args = (
        ["cloud", "link", str(tmp_path)]
        if command == "link"
        else ["cloud", "auth", "remove", "--yes"]
    )
    args += ["--project", "99999"]

    result = runner.invoke(app, args)

    assert result.exit_code != 0
    assert "no stored Wren Cloud login for project 99999" in result.output
    assert "not the git host" not in result.output, "wrong diagnosis for this case"


def test_auth_list_shows_both_hosts_and_never_a_key(monkeypatch):
    """The reason anyone opened `cloud.yml` was to find a value for `--host`,
    and that file is keyed by the git host — so the listing has to show both
    columns, labelled."""

    monkeypatch.setattr(cloud, "list_logins", _two_logins)

    result = runner.invoke(app, ["cloud", "auth", "list"])

    assert result.exit_code == 0, result.output
    assert "https://api.example.com" in result.output
    assert "https://git.example.com" in result.output
    assert "--host" in result.output, "must label which column --host means"
    assert "sk-x" not in result.output, "a key must never be printed"


def test_auth_list_says_so_when_nothing_is_stored(monkeypatch):
    monkeypatch.setattr(cloud, "list_logins", lambda: [])

    result = runner.invoke(app, ["cloud", "auth", "list"])

    assert result.exit_code == 0
    assert "No stored" in result.output
    assert "auth add" in result.output, "must say how to add one"
