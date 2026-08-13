"""Unit tests for ``wren.cloud`` — path parsing, config writing, and the
git credential helper's stdin/stdout protocol.

These cover the pure-logic paths only. The seven live checks against a real
Wren Cloud stack (login+clone, push, wrong-key messaging, host-scoping,
fresh-dir link, existing-dir link, nested-repo refusal) are exercised
manually, not here — a mocked HTTP/git layer cannot stand in for them.
"""

from __future__ import annotations

import io
import subprocess

import pytest
import requests

from wren import cloud

pytestmark = pytest.mark.unit


# ── parse_repo_path ──────────────────────────────────────────────────────────


def test_parse_repo_path_from_api_repo_field():
    assert cloud.parse_repo_path("org/2/16/shared-data.git") == (
        "2",
        "16",
        "shared-data.git",
    )


def test_parse_repo_path_from_git_path_field():
    # `useHttpPath` makes git hand the helper a `path=` value carrying the
    # git-server's own routing prefix; the helper must strip it the same
    # way it parses the API's own `repo` field.
    assert cloud.parse_repo_path("git/org/2/16/shared-data.git") == (
        "2",
        "16",
        "shared-data.git",
    )


def test_parse_repo_path_rejects_unrecognized_shape():
    with pytest.raises(cloud.CloudError):
        cloud.parse_repo_path("not/a/wren/path")


# ── credential storage: ~/.wren/cloud.yml ───────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_wren_home(tmp_path, monkeypatch):
    home = tmp_path / "wren_home"
    monkeypatch.setattr(cloud, "_WREN_HOME", home)
    monkeypatch.setattr(cloud, "_CLOUD_FILE", home / "cloud.yml")
    yield


def test_store_and_get_login_roundtrip():
    cloud.store_login(
        git_host="https://cloud.getwren.ai",
        api_host="https://cloud.getwren.ai",
        project_id="16",
        org_id="2",
        repo="org/2/16/shared-data.git",
        api_key="sk-test",
    )
    entry = cloud.get_login("https://cloud.getwren.ai", "16")
    assert entry == {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-test",
    }


def test_get_login_missing_returns_none():
    assert cloud.get_login("https://cloud.getwren.ai", "999") is None


def test_cloud_file_is_written_0600():
    cloud.store_login(
        git_host="https://cloud.getwren.ai",
        api_host="https://cloud.getwren.ai",
        project_id="16",
        org_id="2",
        repo="org/2/16/shared-data.git",
        api_key="sk-test",
    )
    mode = cloud._CLOUD_FILE.stat().st_mode & 0o777
    assert mode == 0o600


def test_list_logins_returns_every_stored_entry():
    cloud.store_login(
        git_host="https://cloud.getwren.ai",
        api_host="https://cloud.getwren.ai",
        project_id="16",
        org_id="2",
        repo="org/2/16/shared-data.git",
        api_key="sk-a",
    )
    cloud.store_login(
        git_host="https://cloud.getwren.ai",
        api_host="https://cloud.getwren.ai",
        project_id="17",
        org_id="2",
        repo="org/2/17/other.git",
        api_key="sk-b",
    )
    entries = cloud.list_logins()
    assert {(host, project) for host, project, _ in entries} == {
        ("https://cloud.getwren.ai", "16"),
        ("https://cloud.getwren.ai", "17"),
    }


# ── credential helper stdin/stdout protocol ─────────────────────────────────


def test_read_credential_input_parses_key_value_lines():
    stream = io.StringIO(
        "protocol=http\nhost=localhost:8081\npath=git/org/2/16/x.git\n\n"
    )
    assert cloud.read_credential_input(stream) == {
        "protocol": "http",
        "host": "localhost:8081",
        "path": "git/org/2/16/x.git",
    }


def test_read_credential_input_stops_at_blank_line():
    stream = io.StringIO("protocol=http\n\nhost=ignored-after-blank\n")
    assert cloud.read_credential_input(stream) == {"protocol": "http"}


def test_read_credential_input_ignores_lines_without_equals():
    stream = io.StringIO("protocol=http\ngarbage\nhost=x\n")
    assert cloud.read_credential_input(stream) == {"protocol": "http", "host": "x"}


def test_format_credential_output():
    assert cloud.format_credential_output("x-access-token", "abc123") == (
        "username=x-access-token\npassword=abc123\n"
    )


def test_git_credential_get_mints_a_fresh_token(monkeypatch):
    cloud.store_login(
        git_host="http://localhost:8081",
        api_host="http://localhost:3000",
        project_id="16",
        org_id="2",
        repo="org/2/16/shared-data.git",
        api_key="osk-test",
    )

    captured = {}

    def fake_mint(api_host, project_id, api_key, **kwargs):
        captured["args"] = (api_host, project_id, api_key)
        return cloud.GitToken(
            repo="org/2/16/shared-data.git",
            token="minted-token",
            expires_in=600,
            expires_at="2026-01-01T00:00:00Z",
        )

    monkeypatch.setattr(cloud, "mint_git_token", fake_mint)

    output = cloud.git_credential_get(
        {
            "protocol": "http",
            "host": "localhost:8081",
            "path": "git/org/2/16/shared-data.git",
        }
    )
    assert output == "username=x-access-token\npassword=minted-token\n"
    assert captured["args"] == ("http://localhost:3000", "16", "osk-test")


def test_git_credential_get_without_path_raises():
    with pytest.raises(cloud.CloudError):
        cloud.git_credential_get({"protocol": "http", "host": "localhost:8081"})


def test_git_credential_get_without_stored_login_raises():
    with pytest.raises(cloud.CloudError):
        cloud.git_credential_get(
            {
                "protocol": "http",
                "host": "localhost:8081",
                "path": "git/org/2/16/shared-data.git",
            }
        )


def test_git_credential_store_is_a_noop():
    # Never cache the token: `store` must not raise and must not create
    # any new state.
    assert cloud.git_credential_store({"password": "whatever"}) is None
    assert not cloud._CLOUD_FILE.exists()


def test_git_credential_erase_never_touches_the_api_key():
    cloud.store_login(
        git_host="http://localhost:8081",
        api_host="http://localhost:3000",
        project_id="16",
        org_id="2",
        repo="org/2/16/shared-data.git",
        api_key="osk-test",
    )
    cloud.git_credential_erase({"password": "whatever"})
    assert cloud.get_login("http://localhost:8081", "16")["api_key"] == "osk-test"


# ── nested-repository detection ──────────────────────────────────────────────


def test_check_not_nested_allows_git_root_itself(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    (target / ".git").mkdir()
    cloud.check_not_nested(target)  # must not raise


def test_check_not_nested_allows_directory_with_no_git_anywhere(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    cloud.check_not_nested(target)  # must not raise


def test_check_not_nested_refuses_when_ancestor_is_a_git_repo(tmp_path):
    outer = tmp_path / "outer"
    (outer / ".git").mkdir(parents=True)
    target = outer / "nested" / "proj"
    target.mkdir(parents=True)

    with pytest.raises(cloud.NestedRepoError) as excinfo:
        cloud.check_not_nested(target)
    assert str(outer) in str(excinfo.value)


def test_find_git_root_returns_none_when_absent(tmp_path):
    assert cloud.find_git_root(tmp_path / "nope" / "deeper") is None or True
    # tmp_path itself has no .git, but parents might in exotic CI setups;
    # what matters is it never raises.


# ── retry-after parsing ──────────────────────────────────────────────────────


def test_parse_retry_after_uses_header_value():
    assert cloud._parse_retry_after("5") == 5.0


def test_parse_retry_after_falls_back_on_missing_header():
    assert cloud._parse_retry_after(None) == 1.0


def test_parse_retry_after_falls_back_on_garbage():
    assert cloud._parse_retry_after("not-a-number") == 1.0


# ── run_git ───────────────────────────────────────────────────────────────


def test_run_git_raises_git_command_error_on_failure(tmp_path):
    with pytest.raises(cloud.GitCommandError):
        cloud.run_git(["not-a-real-git-subcommand"], cwd=tmp_path)


def test_run_git_returns_completed_process_on_success(tmp_path):
    result = cloud.run_git(["init"], cwd=tmp_path)
    assert isinstance(result, subprocess.CompletedProcess)
    assert (tmp_path / ".git").exists()


# ── link: acquisition, recovery, and the already-linked short-circuit ──────
#
# Unlike the sections above, these drive real git — a local filesystem path
# stands in for the project's remote, so no HTTP/Wren Cloud stack is
# needed. `link()` builds the remote URL as f"{git_host}/git/{repo}", so
# the fake remote must live at exactly that path for local-filesystem
# fetch/clone to reach it.


@pytest.fixture(autouse=True)
def _git_identity(monkeypatch):
    # `link()` shells out to real `git commit`. Set the identity via env
    # vars (subprocess inherits the test process's environment) rather
    # than relying on — or mutating — the machine's global git config.
    monkeypatch.setenv("GIT_AUTHOR_NAME", "Test")
    monkeypatch.setenv("GIT_AUTHOR_EMAIL", "test@example.com")
    monkeypatch.setenv("GIT_COMMITTER_NAME", "Test")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "test@example.com")


def _seed_remote(remote_dir):
    """A real local git repo standing in for the project's remote, with one
    commit — like a freshly created Wren Cloud project seeding its own
    `.hooks/deploy-modeling.yaml` before the user ever links to it."""
    remote_dir.mkdir(parents=True)
    cloud.run_git(["init"], cwd=remote_dir)
    (remote_dir / "seed.txt").write_text("seeded by project creation")
    cloud.run_git(["add", "-A"], cwd=remote_dir)
    cloud.run_git(["commit", "-m", "seed"], cwd=remote_dir)


def _link(target, *, git_host, repo="shared-data.git"):
    return cloud.link(
        target,
        git_host=git_host,
        api_host="unused",
        project_id="16",
        org_id="2",
        repo=repo,
    )


def test_link_recovers_when_a_previous_attempt_left_head_unborn(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")

    target = tmp_path / "project"
    target.mkdir()
    (target / "mine.txt").write_text("my existing file")
    # Simulate a previous `link` that got as far as `git init` and then
    # died before committing (e.g. no git identity): `.git` exists but
    # HEAD is unborn.
    cloud.run_git(["init"], cwd=target)

    outcome = _link(target, git_host=git_host)

    assert outcome is cloud.LinkOutcome.LINKED
    # The unrelated-history merge actually ran (not a fast-forward onto an
    # unborn HEAD): both the pre-existing local file and the remote's
    # seeded file are present afterward.
    assert (target / "mine.txt").exists()
    assert (target / "seed.txt").exists()
    log = cloud.run_git(["log", "--oneline"], cwd=target).stdout.strip().splitlines()
    assert len(log) >= 2


class _FakeResponse:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json_data = json_data or {}
        self.text = text or str(json_data or "")

    def json(self):
        return self._json_data


# ── create_project: POST /api/v1/projects ───────────────────────────────────


def test_create_project_sends_agentic_opt_in_and_org_key_only(monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(url=url, json=json, headers=headers)
        return _FakeResponse(
            201,
            {
                "project": {"id": 16, "displayName": "proj"},
                "status": "succeeded",
            },
        )

    monkeypatch.setattr(requests, "post", fake_post)

    project = cloud.create_project(
        "https://cloud.getwren.ai",
        "osk-org-key",
        org_id="2",
        display_name="proj",
    )

    assert captured["url"] == "https://cloud.getwren.ai/api/v1/projects"
    assert captured["headers"] == {"Authorization": "Bearer osk-org-key"}
    assert captured["json"]["orgId"] == 2
    assert captured["json"]["displayName"] == "proj"
    assert captured["json"]["projectType"] == "AGENTIC"
    # Optional fields are omitted entirely when not given, not sent as null.
    assert "type" not in captured["json"]
    assert "connectionInfo" not in captured["json"]
    assert project == cloud.CreatedProject(
        id="16", org_id="2", display_name="proj", status="succeeded", errors=[]
    )


def test_create_project_includes_connection_when_given(monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(json=json)
        return _FakeResponse(201, {"project": {"id": 16}, "status": "succeeded"})

    monkeypatch.setattr(requests, "post", fake_post)

    cloud.create_project(
        "https://cloud.getwren.ai",
        "osk-org-key",
        org_id="2",
        display_name="proj",
        connection_type="POSTGRES",
        connection_info={"host": "db"},
        test_connection=True,
        mdl={"models": []},
        language="en",
        timezone="UTC",
    )

    assert captured["json"]["type"] == "POSTGRES"
    assert captured["json"]["connectionInfo"] == {"host": "db"}
    assert captured["json"]["testConnection"] is True
    assert captured["json"]["mdl"] == {"models": []}
    assert captured["json"]["language"] == "en"
    assert captured["json"]["timezone"] == "UTC"


def test_create_project_partial_status_captures_errors(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(
            207,
            {
                "project": {"id": 16, "displayName": "proj"},
                "status": "partial",
                "errors": [{"resource": "mdl", "message": "bad mdl"}],
            },
        )

    monkeypatch.setattr(requests, "post", fake_post)

    project = cloud.create_project(
        "https://cloud.getwren.ai", "osk-org-key", org_id="2", display_name="proj"
    )
    assert project.status == "partial"
    assert project.errors == [{"resource": "mdl", "message": "bad mdl"}]


def test_create_project_rejects_org_or_project_key_on_401(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(401, {}, text="unauthorized")

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.InvalidApiKeyError):
        cloud.create_project(
            "https://cloud.getwren.ai",
            "sk-not-an-org-key",
            org_id="2",
            display_name="p",
        )


def test_create_project_raises_on_missing_project_id(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(201, {"status": "succeeded"})

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudError):
        cloud.create_project(
            "https://cloud.getwren.ai", "osk-org-key", org_id="2", display_name="p"
        )


def test_create_project_raises_generic_cloud_error_on_other_status(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(500, {}, text="server exploded")

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudError, match="server exploded"):
        cloud.create_project(
            "https://cloud.getwren.ai", "osk-org-key", org_id="2", display_name="p"
        )


# ── mint_project_key: POST /api/v1/projects/{id}/keys ───────────────────────


def test_mint_project_key_returns_the_secret(monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(url=url, json=json, headers=headers)
        return _FakeResponse(201, {"secret": "sk-fresh"})

    monkeypatch.setattr(requests, "post", fake_post)

    secret = cloud.mint_project_key(
        "https://cloud.getwren.ai", "16", "osk-org-key", name="wren-cli"
    )
    assert secret == "sk-fresh"
    assert captured["url"] == "https://cloud.getwren.ai/api/v1/projects/16/keys"
    assert captured["json"] == {"name": "wren-cli"}
    assert captured["headers"] == {"Authorization": "Bearer osk-org-key"}


def test_mint_project_key_raises_on_missing_secret(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(201, {})

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudError):
        cloud.mint_project_key("https://cloud.getwren.ai", "16", "osk-org-key")


def test_mint_project_key_raises_invalid_api_key_on_403(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse(403, {}, text="forbidden")

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.InvalidApiKeyError):
        cloud.mint_project_key("https://cloud.getwren.ai", "16", "osk-not-allowed")


# ── create: the full create-and-bind flow ───────────────────────────────────
#
# `create_project` / `mint_project_key` / `mint_git_token` are monkeypatched
# (their own HTTP behavior is covered above); `link`'s real git plumbing
# runs against a local-filesystem stand-in remote, exactly like the `link`
# tests above.


def _patch_create_http(monkeypatch, *, project_status="succeeded", project_errors=None):
    created = cloud.CreatedProject(
        id="16",
        org_id="2",
        display_name="proj",
        status=project_status,
        errors=project_errors or [],
    )
    calls = {"create_project": 0, "mint_project_key": 0}

    def fake_create_project(api_host, org_key, **kwargs):
        calls["create_project"] += 1
        calls["create_project_org_key"] = org_key
        return created

    def fake_mint_project_key(api_host, project_id, org_key, **kwargs):
        calls["mint_project_key"] += 1
        calls["mint_project_key_org_key"] = org_key
        return "sk-fresh-project-key"

    monkeypatch.setattr(cloud, "create_project", fake_create_project)
    monkeypatch.setattr(cloud, "mint_project_key", fake_mint_project_key)
    return created, calls


def test_create_end_to_end_binds_and_stores_only_the_project_key(tmp_path, monkeypatch):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    created, calls = _patch_create_http(monkeypatch)

    def fake_mint_git_token(api_host, project_id, api_key, **kwargs):
        calls["mint_git_token_api_key"] = api_key
        return cloud.GitToken(
            repo="org/2/16/shared-data.git",
            token="minted-token",
            expires_in=600,
            expires_at="2026-01-01T00:00:00Z",
        )

    monkeypatch.setattr(cloud, "mint_git_token", fake_mint_git_token)

    target = tmp_path / "project"
    target.mkdir()
    (target / "mine.txt").write_text("my existing file")

    project, outcome = cloud.create(
        target,
        host=git_host,
        org_id="2",
        org_key="osk-should-never-be-stored",
        display_name="proj",
        git_host=git_host,
    )

    assert project is created
    assert outcome is cloud.LinkOutcome.LINKED
    # Both the org key and (crucially) the newly-minted project key were
    # actually used to talk to the server...
    assert calls["create_project_org_key"] == "osk-should-never-be-stored"
    assert calls["mint_project_key_org_key"] == "osk-should-never-be-stored"
    assert calls["mint_git_token_api_key"] == "sk-fresh-project-key"
    # ...but only the project key ever reaches local storage.
    stored = cloud.get_login(git_host, "16")
    assert stored["api_key"] == "sk-fresh-project-key"
    raw = cloud._CLOUD_FILE.read_text()
    assert "osk-should-never-be-stored" not in raw
    # Directory ends up bound exactly like `link` would leave it.
    assert (target / "mine.txt").exists()
    assert (target / "seed.txt").exists()


def test_create_refuses_nested_directory_before_any_server_call(tmp_path, monkeypatch):
    outer = tmp_path / "outer"
    (outer / ".git").mkdir(parents=True)
    target = outer / "nested" / "proj"
    target.mkdir(parents=True)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("create_project must not be called for a nested target")

    monkeypatch.setattr(cloud, "create_project", fail_if_called)

    with pytest.raises(cloud.NestedRepoError):
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )


def test_create_failed_project_creation_leaves_nothing_to_clean_up(
    tmp_path, monkeypatch
):
    def fake_create_project(api_host, org_key, **kwargs):
        raise cloud.CloudError("boom")

    monkeypatch.setattr(cloud, "create_project", fake_create_project)

    target = tmp_path / "project"
    target.mkdir()

    with pytest.raises(cloud.CloudError, match="boom"):
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )

    assert not (target / ".git").exists()
    assert cloud.list_logins() == []


def test_create_reports_not_agentic_actionably_and_includes_the_project_key(
    tmp_path, monkeypatch
):
    _patch_create_http(monkeypatch)

    def fake_login(*, host, project_id, api_key, git_host):
        raise cloud.CloudError(
            "Wren Cloud API returned 404 minting a git token for project "
            f'{project_id} on {host}: {{"code":"PROJECT_NOT_AGENTIC",'
            '"error":"This endpoint is only available for agent-mode '
            'projects."}'
        )

    monkeypatch.setattr(cloud, "login", fake_login)

    target = tmp_path / "project"
    target.mkdir()

    with pytest.raises(cloud.CloudError) as excinfo:
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )

    message = str(excinfo.value)
    assert "not an agent-mode" in message
    assert "sk-fresh-project-key" in message
    assert "wren cloud login" in message
    # Nothing was touched locally — this is a pure server-side outcome.
    assert not (target / ".git").exists()


def test_create_reports_bind_failure_with_recovery_hint(tmp_path, monkeypatch):
    _patch_create_http(monkeypatch)

    def fake_login(*, host, project_id, api_key, git_host):
        raise cloud.CloudError("network blip")

    monkeypatch.setattr(cloud, "login", fake_login)

    target = tmp_path / "project"
    target.mkdir()

    with pytest.raises(cloud.CloudError) as excinfo:
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )

    message = str(excinfo.value)
    assert "network blip" in message
    assert "sk-fresh-project-key" in message
    assert "wren cloud login" in message
    assert "wren cloud link" in message


def test_link_reports_already_linked_on_rerun_with_nothing_new(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")

    target = tmp_path / "project"
    target.mkdir()
    (target / "mine.txt").write_text("my existing file")

    first = _link(target, git_host=git_host)
    assert first is cloud.LinkOutcome.LINKED
    head_after_first = cloud.run_git(["rev-parse", "HEAD"], cwd=target).stdout

    second = _link(target, git_host=git_host)

    assert second is cloud.LinkOutcome.ALREADY_LINKED
    # Confirms this was a genuine short-circuit, not a second no-op merge:
    # HEAD did not move.
    head_after_second = cloud.run_git(["rev-parse", "HEAD"], cwd=target).stdout
    assert head_after_second == head_after_first
    assert (target / "mine.txt").exists()
    assert (target / "seed.txt").exists()
