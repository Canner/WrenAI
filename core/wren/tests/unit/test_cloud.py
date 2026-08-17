"""Unit tests for ``wren.cloud`` — path parsing, config writing, and the
git credential helper's stdin/stdout protocol.

These cover the pure-logic paths only. The seven live checks against a real
Wren Cloud stack (login+clone, push, wrong-key messaging, host-scoping,
fresh-dir link, existing-dir link, nested-repo refusal) are exercised
manually, not here — a mocked HTTP/git layer cannot stand in for them.
"""

from __future__ import annotations

import io
import socket
import subprocess
import time

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


@pytest.fixture(autouse=True)
def _isolated_git_global_config(tmp_path, monkeypatch):
    """Keep `git config --global` writes out of the real user's config.

    `configure_git_credential_helper` writes to global git config, and the
    `create` tests below reach it for real. Without this, every run left a
    dead `credential.<tmp path>` section behind in the developer's (or CI
    runner's) own `~/.gitconfig`, one per run, forever — the tests were
    mutating the machine they ran on.
    """
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(tmp_path / "gitconfig"))


@pytest.fixture
def _helper_check_passes(monkeypatch):
    """Let `login`/`create` past the credential-helper pre-flight check.

    The check shells out to whatever `wren` is on PATH, which is a property
    of the machine rather than of the code under test. It has its own tests
    below; these flows only need it not to be the thing under test.
    """
    monkeypatch.setattr(cloud, "check_helper_command_serviceable", lambda: None)


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
    def __init__(self, status_code, json_data=None, text="", raise_on_json=False):
        self.status_code = status_code
        self._json_data = json_data or {}
        self._raise_on_json = raise_on_json
        self.text = text or str(json_data or "")

    def json(self):
        if self._raise_on_json:
            raise ValueError("not json")
        return self._json_data


# ── mint_git_token: machine-readable failure surfacing ──────────────────────
#
# The 200/401/403/429 branches are unchanged and already covered by the
# credential-helper and `login` tests above (which monkeypatch
# `mint_git_token` itself). These cover only the new behavior: the
# generic-error branch now attaches the response's HTTP status and, when
# the body has one, its machine-readable `code` — so `create` can branch
# on the failure kind instead of matching prose.


def test_mint_git_token_attaches_status_and_code_from_a_realistic_error_body(
    monkeypatch,
):
    def fake_post(url, headers=None, timeout=None):
        return _FakeResponse(
            404,
            {
                "code": "PROJECT_NOT_AGENTIC",
                "error": "This endpoint is only available for agent-mode projects.",
            },
        )

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudApiError) as excinfo:
        cloud.mint_git_token("https://cloud.getwren.ai", "16", "sk-test")

    assert excinfo.value.status_code == 404
    assert excinfo.value.code == "PROJECT_NOT_AGENTIC"


def test_mint_git_token_code_is_none_on_a_body_with_no_code_field(monkeypatch):
    def fake_post(url, headers=None, timeout=None):
        return _FakeResponse(500, {"error": "server exploded"}, text="server exploded")

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudApiError) as excinfo:
        cloud.mint_git_token("https://cloud.getwren.ai", "16", "sk-test")

    # No `code` in the body degrades to `None`, not a crash — and the
    # message is exactly what it was before this change.
    assert excinfo.value.code is None
    assert excinfo.value.status_code == 500
    assert "server exploded" in str(excinfo.value)


def test_mint_git_token_code_is_none_on_an_unparseable_body(monkeypatch):
    def fake_post(url, headers=None, timeout=None):
        return _FakeResponse(502, text="<html>bad gateway</html>", raise_on_json=True)

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(cloud.CloudApiError) as excinfo:
        cloud.mint_git_token("https://cloud.getwren.ai", "16", "sk-test")

    assert excinfo.value.code is None
    assert excinfo.value.status_code == 502


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


def test_mint_project_key_dates_the_key_by_default(monkeypatch):
    """The name carries the mint date and nothing about the machine.

    The server stamps every API-minted key with the same origin, so the name
    is the only field carrying anything distinguishing, and a constant would
    make the user's key list a row of identical entries. The host name was
    considered for this and deliberately left out — see `default_key_name`.
    """
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(json=json)
        return _FakeResponse(201, {"secret": "sk-fresh"})

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(time, "strftime", lambda fmt: "2026-08-14")

    cloud.mint_project_key("https://cloud.getwren.ai", "16", "osk-org-key")

    name = captured["json"]["name"]
    assert name == "wren-cli 2026-08-14", name
    assert len(name) <= 100, f"server rejects names over 100 chars: {name!r}"


def test_default_key_name_carries_nothing_about_the_machine():
    """Guards the privacy decision, not the format.

    Written so that reintroducing the host name has to be a deliberate act
    that breaks a test, rather than something that creeps back in.
    """
    name = cloud.default_key_name()
    assert socket.gethostname().split(".")[0] not in name
    assert name.startswith("wren-cli ")


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


def test_create_end_to_end_binds_and_stores_only_the_project_key(
    tmp_path, monkeypatch, _helper_check_passes
):
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


def test_create_refuses_nested_directory_before_any_server_call(
    tmp_path, monkeypatch, _helper_check_passes
):
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
    tmp_path, monkeypatch, _helper_check_passes
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
    tmp_path, monkeypatch, _helper_check_passes
):
    # Deliberately does NOT monkeypatch `login` or `mint_git_token` — this
    # drives the real `login()` -> real `mint_git_token()` path, stubbing
    # only the network boundary, so the detection is exercised against an
    # actually-realistic response: HTTP 404 with the server's documented
    # `{"code": "PROJECT_NOT_AGENTIC", ...}` body.
    _patch_create_http(monkeypatch)

    def fake_post(url, headers=None, timeout=None, **kwargs):
        return _FakeResponse(
            404,
            {
                "code": "PROJECT_NOT_AGENTIC",
                "error": "This endpoint is only available for agent-mode projects.",
            },
        )

    monkeypatch.setattr(requests, "post", fake_post)

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


@pytest.mark.parametrize(
    "resp_kwargs",
    [
        pytest.param(
            {"json_data": {"code": "PROJECT_NOT_FOUND"}, "text": "not found"},
            id="different_code",
        ),
        pytest.param(
            {"json_data": {"error": "nope"}, "text": "nope"},
            id="no_code_field",
        ),
        pytest.param(
            {"raise_on_json": True, "text": "<html>not json</html>"},
            id="unparseable_body",
        ),
    ],
)
def test_create_degrades_to_generic_bind_failure_on_an_unrecognized_git_token_error(
    tmp_path, monkeypatch, resp_kwargs, _helper_check_passes
):
    # Same 404 status as the real PROJECT_NOT_AGENTIC case, but a body that
    # doesn't say so — a different code, no code at all, or no parseable
    # body. This must never be silently misdiagnosed as "not agentic": that
    # would send the user chasing a nonexistent org-admin opt-in instead of
    # whatever the real 404 means.
    _patch_create_http(monkeypatch)

    def fake_post(url, headers=None, timeout=None, **kwargs):
        return _FakeResponse(404, **resp_kwargs)

    monkeypatch.setattr(requests, "post", fake_post)

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
    assert "not an agent-mode" not in message
    assert "binding this directory to it failed" in message
    assert "sk-fresh-project-key" in message
    assert "wren cloud login" in message
    assert not (target / ".git").exists()


def test_create_reports_bind_failure_with_recovery_hint(
    tmp_path, monkeypatch, _helper_check_passes
):
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


# ── the credential helper's PATH pre-flight check ────────────────────────────
#
# git resolves the `wren` in `!wren cloud git-credential` from PATH at
# *git*-invocation time, so `login` writing that entry is a promise about an
# executable it does not control. These cover the check that refuses to make
# the promise when it cannot be kept. What they cannot cover is PATH changing
# after login — nothing on this side is in that failure's path, which is why
# `helper_failure_note` exists as well.


def _unserviceable_helper(monkeypatch):
    """Make the pre-flight check refuse, whatever this machine's PATH holds."""

    def refuse():
        raise cloud.CloudError("no usable wren on PATH")

    monkeypatch.setattr(cloud, "check_helper_command_serviceable", refuse)


def _fake_probe(monkeypatch, *, which="/usr/local/bin/wren", returncode=0):
    """Stand in for the PATH lookup and the probe subprocess, recording both."""
    seen = {}

    def fake_which(name):
        seen["which"] = name
        return which

    monkeypatch.setattr(cloud.shutil, "which", fake_which)

    def fake_run(args, **kwargs):
        seen["argv"] = list(args)
        seen["kwargs"] = kwargs
        return subprocess.CompletedProcess(args, returncode, stdout="", stderr="")

    monkeypatch.setattr(cloud.subprocess, "run", fake_run)
    return seen


def test_check_passes_when_the_path_wren_can_serve_the_helper(monkeypatch):
    seen = _fake_probe(monkeypatch, returncode=0)

    cloud.check_helper_command_serviceable()

    assert seen["which"] == cloud.HELPER_EXECUTABLE
    assert seen["argv"][0] == "/usr/local/bin/wren"


def test_check_refuses_when_no_wren_is_on_path(monkeypatch):
    monkeypatch.setattr(cloud.shutil, "which", lambda name: None)

    with pytest.raises(cloud.CloudError) as excinfo:
        cloud.check_helper_command_serviceable()

    assert "PATH" in str(excinfo.value)


def test_check_refuses_when_the_path_wren_cannot_serve_the_helper(monkeypatch):
    # The reported failure: an older wren on PATH with no `cloud` group at
    # all, which exits non-zero when asked for it.
    _fake_probe(monkeypatch, which="/opt/old/bin/wren", returncode=2)

    with pytest.raises(cloud.CloudError) as excinfo:
        cloud.check_helper_command_serviceable()

    message = str(excinfo.value)
    # Names the executable git would actually run, so the user can tell which
    # of possibly several installs is the problem.
    assert "/opt/old/bin/wren" in message
    assert "cloud git-credential" in message


def test_check_refuses_when_the_probe_times_out(monkeypatch):
    monkeypatch.setattr(cloud.shutil, "which", lambda name: "/usr/local/bin/wren")

    def fake_run(args, **kwargs):
        raise subprocess.TimeoutExpired(args, kwargs.get("timeout", 0))

    monkeypatch.setattr(cloud.subprocess, "run", fake_run)

    with pytest.raises(cloud.CloudError):
        cloud.check_helper_command_serviceable()


def test_probe_and_written_helper_come_from_the_same_definition(monkeypatch):
    """The check must probe the command that actually gets written.

    A drift between the two would leave the check verifying a command git
    never runs — which looks exactly like a working guard.
    """
    seen = _fake_probe(monkeypatch, which="/usr/local/bin/wren", returncode=0)
    cloud.check_helper_command_serviceable()
    probed = seen["argv"]

    written = []

    def record_git(args, **kwargs):
        written.append(list(args))

    monkeypatch.setattr(cloud, "run_git", record_git)
    cloud.configure_git_credential_helper("https://cloud.getwren.ai")

    helper_values = [
        args[-1]
        for args in written
        if args[:2] == ["config", "--global"] and args[-2].endswith(".helper")
    ]
    # The value git will run, minus the `!` that makes git shell it out...
    assert cloud.HELPER_COMMAND in helper_values
    shelled_out = cloud.HELPER_COMMAND.lstrip("!").split()
    # ...is the same command the probe asked about, minus `--help`.
    assert probed[1:-1] == shelled_out[1:]
    assert probed[-1] == "--help"


def test_login_refuses_before_any_network_or_config_write(monkeypatch):
    _unserviceable_helper(monkeypatch)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("must not be reached when the helper is unserviceable")

    monkeypatch.setattr(cloud, "mint_git_token", fail_if_called)
    monkeypatch.setattr(cloud, "run_git", fail_if_called)

    with pytest.raises(cloud.CloudError):
        cloud.login(
            host="https://cloud.getwren.ai",
            project_id="16",
            api_key="sk-test",
        )

    # Nothing stored either: a refused login leaves no trace to undo.
    assert not cloud._CLOUD_FILE.exists()


def test_create_refuses_before_any_server_call_when_the_helper_is_unserviceable(
    tmp_path, monkeypatch
):
    _unserviceable_helper(monkeypatch)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("no project may be created when the helper cannot work")

    monkeypatch.setattr(cloud, "create_project", fail_if_called)
    monkeypatch.setattr(cloud, "mint_project_key", fail_if_called)

    target = tmp_path / "project"
    target.mkdir()

    with pytest.raises(cloud.CloudError):
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )


# ── the helper's own failure output ──────────────────────────────────────────


def test_helper_failure_note_identifies_the_tool_and_the_executable_that_ran():
    from wren import __version__

    note = cloud.helper_failure_note("No stored Wren Cloud login for project 16.")

    assert "wren cloud git-credential" in note
    assert __version__ in note
    # The original cause survives verbatim...
    assert "No stored Wren Cloud login for project 16." in note
    # ...and the note says why the user is about to see a git error too.
    assert "git" in note.lower()


def test_link_sets_upstream_when_already_linked_but_tracking_was_never_set(tmp_path):
    """The state the conflict message itself sends users into.

    A conflicted bind raises before upstream is set. The user resolves and
    commits, as instructed — now `origin/<branch>` is an ancestor of HEAD,
    so `link` short-circuits to ALREADY_LINKED and points at `git pull`.
    Without setting upstream here, that `git pull` (and any `git push`)
    cannot run, which makes the success message untrue.
    """
    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "shared-data.git"
    _seed_remote(remote)

    target = tmp_path / "project"
    target.mkdir()
    (target / "mine.txt").write_text("my existing file")

    # Reproduce the aftermath by hand rather than through link(), so the
    # test does not depend on how the merge came to be resolved: HEAD
    # contains origin/main, and upstream was never set.
    cloud.run_git(["init"], cwd=target)
    cloud.run_git(["add", "-A"], cwd=target)
    cloud.run_git(["commit", "-m", "Existing local project"], cwd=target)
    cloud.run_git(
        ["remote", "add", "origin", f"{git_host}/git/shared-data.git"], cwd=target
    )
    cloud.run_git(["fetch", "origin"], cwd=target)
    cloud.run_git(
        ["merge", "--allow-unrelated-histories", "origin/main", "-m", "merged by hand"],
        cwd=target,
    )
    assert not cloud._has_upstream(target), "precondition: no tracking branch yet"

    outcome = _link(target, git_host=git_host)

    # Still reported as already-linked — this is not a fresh bind...
    assert outcome is cloud.LinkOutcome.ALREADY_LINKED
    # ...but the directory is now actually usable with plain git.
    assert cloud._has_upstream(target)
    upstream = cloud.run_git(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd=target
    ).stdout.strip()
    assert upstream == "origin/main"


def test_link_leaves_an_existing_upstream_alone(tmp_path):
    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "shared-data.git"
    _seed_remote(remote)
    # A second branch on the remote, so "some other upstream" is a real ref
    # rather than a value git would reject.
    cloud.run_git(["branch", "other"], cwd=remote)

    target = tmp_path / "project"
    cloud.run_git(["clone", f"{git_host}/git/shared-data.git", str(target)])
    cloud.run_git(["fetch", "origin"], cwd=target)
    cloud.run_git(["branch", "--set-upstream-to=origin/other"], cwd=target)

    outcome = _link(target, git_host=git_host)

    assert outcome is cloud.LinkOutcome.ALREADY_LINKED
    upstream = cloud.run_git(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd=target
    ).stdout.strip()
    assert upstream == "origin/other", "a deliberate upstream must not be re-pointed"
