"""Unit tests for ``wren.cloud`` — path parsing, config writing, the git
credential helper's stdin/stdout protocol, and the binding lifecycle.

Two kinds of test live here. Most cover pure-logic paths with HTTP mocked.
The ``link`` / ``unlink`` / guard sections instead drive **real git**, with a
local filesystem path standing in for the project's remote — those failure
modes (an `origin` that points somewhere else, a history acquired from
another project) only exist in git's behaviour, so a mock could not detect
them.

Still exercised manually against a real Wren Cloud stack, not here, because
a mocked HTTP layer cannot stand in for them: auth add + clone, push,
wrong-key messaging, host-scoping of the credential helper, and the
nested-repo refusal against a real nested layout.
"""

from __future__ import annotations

import io
import socket
import subprocess
import time
from pathlib import Path

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
    """Let `auth add`/`create` past the credential-helper pre-flight check.

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
    """`tmp_path` itself has no `.git`, but a parent might on some CI layouts,
    so the assertion is scoped to the part that is knowable: whatever it finds
    is never inside `tmp_path`, and it does not raise on a path that is not
    there. (The previous form, `... is None or True`, could not fail.)"""

    found = cloud.find_git_root(tmp_path / "nope" / "deeper")

    assert found is None or tmp_path not in found.parents
    assert found != tmp_path


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


def _make_wren_project(path: Path, *, model: str = "t") -> Path:
    """Turn `path` into the smallest Wren project that compiles.

    `create` converts an existing local project, so every test that drives it
    needs one here. `schema_version: 5` is required: without it the loader
    uses the legacy layout and finds no models, which would make these tests
    pass for the wrong reason.
    """
    path.mkdir(parents=True, exist_ok=True)
    (path / "wren_project.yml").write_text(
        "schema_version: 5\n"
        "name: proj\n"
        'version: "1.0"\n'
        "catalog: wren\n"
        "schema: public\n"
        "data_source: bigquery\n"
    )
    model_dir = path / "models" / model
    model_dir.mkdir(parents=True, exist_ok=True)
    (model_dir / "metadata.yml").write_text(
        f"name: {model}\n"
        "table_reference:\n"
        "  schema: public\n"
        f"  table: {model}\n"
        "columns:\n"
        "  - name: id\n"
        "    type: INTEGER\n"
    )
    return path


def _seed_remote(remote_dir):
    """A real local git repo standing in for the project's remote, with one
    commit — like a freshly created Wren Cloud project seeding its own
    `.hooks/deploy-modeling.yaml` before the user ever links to it."""
    remote_dir.mkdir(parents=True)
    cloud.run_git(["init", "-b", "main"], cwd=remote_dir)
    (remote_dir / "seed.txt").write_text("seeded by project creation")
    cloud.run_git(["add", "-A"], cwd=remote_dir)
    cloud.run_git(["commit", "-m", "seed"], cwd=remote_dir)
    # `create` pushes, and git refuses to push into the checked-out branch of
    # a non-bare repo. A real remote is bare; this makes the stand-in behave
    # like one without losing the seeded worktree the link tests read.
    cloud.run_git(["config", "receive.denyCurrentBranch", "updateInstead"], cwd=remote_dir)


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

    target = _make_wren_project(tmp_path / "project")
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

    target = _make_wren_project(tmp_path / "project")
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

    target = _make_wren_project(tmp_path / "project")

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

    target = _make_wren_project(tmp_path / "project")

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
    assert "sk-fresh-project-key" not in message, (
        "a live credential must not reach stderr — it lands in CI logs and in "
        "bug reports pasted verbatim"
    )
    assert "already stored" in message
    # The key was the one thing that could not be fetched again, which is why
    # it used to be printed. Asserting only its absence would pass just as
    # well if it had been dropped.
    stored = [entry for _host, pid, entry in cloud.list_logins() if pid == "16"]
    assert stored and stored[0]["api_key"] == "sk-fresh-project-key"
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

    target = _make_wren_project(tmp_path / "project")

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
    assert "sk-fresh-project-key" not in message, (
        "a live credential must not reach stderr — it lands in CI logs and in "
        "bug reports pasted verbatim"
    )
    assert "already stored" in message
    # The key was the one thing that could not be fetched again, which is why
    # it used to be printed. Asserting only its absence would pass just as
    # well if it had been dropped.
    stored = [entry for _host, pid, entry in cloud.list_logins() if pid == "16"]
    assert stored and stored[0]["api_key"] == "sk-fresh-project-key"
    assert not (target / ".git").exists()


def test_create_reports_bind_failure_with_recovery_hint(
    tmp_path, monkeypatch, _helper_check_passes
):
    _patch_create_http(monkeypatch)

    def fake_login(*, host, project_id, api_key, git_host):
        raise cloud.CloudError("network blip")

    monkeypatch.setattr(cloud, "login", fake_login)

    target = _make_wren_project(tmp_path / "project")

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
    assert "sk-fresh-project-key" not in message, (
        "a live credential must not reach stderr — it lands in CI logs and in "
        "bug reports pasted verbatim"
    )
    assert "already stored" in message
    # The key was the one thing that could not be fetched again, which is why
    # it used to be printed. Asserting only its absence would pass just as
    # well if it had been dropped.
    stored = [entry for _host, pid, entry in cloud.list_logins() if pid == "16"]
    assert stored and stored[0]["api_key"] == "sk-fresh-project-key"
    assert "wren cloud link" in message


def test_link_reports_already_linked_on_rerun_with_nothing_new(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")

    target = _make_wren_project(tmp_path / "project")
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

    target = _make_wren_project(tmp_path / "project")

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

    target = _make_wren_project(tmp_path / "project")
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


# ── Reading the binding back out of a directory ────────────────────────────
#
# The binding is the git remote and nothing else, so these are the only way
# to answer "what is this directory bound to?". They drive real git.


def _seed_hooked_remote(remote_dir, *, marker="a"):
    """A seeded remote that also carries `.hooks/deploy-modeling.yaml`.

    The real server seeds that file when a project is created, and it is the
    marker `head_has_seeded_hooks` keys off. `_seed_remote` above deliberately
    does not write it, so tests that need "this history came from a project"
    ask for it explicitly rather than every existing link test acquiring one.

    `marker` must differ between two remotes standing in for two different
    projects. Without it both seed commits get identical content, message and
    author within the same second, so git assigns them the *same SHA* — and
    each then looks like an ancestor of the other, which silently turns an
    unrelated-history test into a no-op fast-forward.

    It varies only the commit *message*, deliberately. The real server seeds
    a hook file with no project-specific content, so two projects' hook files
    are byte-identical — and a duplicate merge therefore has nothing to
    conflict over. Putting the marker in the file instead would manufacture a
    conflict that real projects never produce.
    """
    remote_dir.mkdir(parents=True)
    cloud.run_git(["init", "-b", "main"], cwd=remote_dir)
    # Same reason as `_seed_remote`: `create` pushes, and a non-bare stand-in
    # would refuse the push into its checked-out branch.
    cloud.run_git(
        ["config", "receive.denyCurrentBranch", "updateInstead"], cwd=remote_dir
    )
    (remote_dir / ".hooks").mkdir()
    (remote_dir / ".hooks" / "deploy-modeling.yaml").write_text(
        "version: '1'\nactions:\n  - name: deploy-modeling\n"
    )
    cloud.run_git(["add", "-A"], cwd=remote_dir)
    cloud.run_git(["commit", "-m", f"Initialize hooks ({marker})"], cwd=remote_dir)


def test_current_remote_url_is_none_without_an_origin(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    assert cloud.current_remote_url(target) is None


def test_current_remote_url_returns_the_origin_it_was_given(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    cloud.run_git(
        [
            "remote",
            "add",
            "origin",
            "https://wren.example/git/org/2/16/shared-data.git",
        ],
        cwd=target,
    )
    assert (
        cloud.current_remote_url(target)
        == "https://wren.example/git/org/2/16/shared-data.git"
    )


def test_binding_from_remote_url_parses_a_wren_remote():
    assert cloud.binding_from_remote_url(
        "https://wren.example/git/org/2/16/shared-data.git"
    ) == ("https://wren.example", "2", "16", "shared-data.git")


def test_binding_from_remote_url_keeps_a_port_in_the_host():
    # git_host must round-trip to the same string `credentials` is keyed by,
    # which for a local setup includes the port.
    assert cloud.binding_from_remote_url(
        "http://localhost:8081/git/org/2/16/shared-data.git"
    ) == ("http://localhost:8081", "2", "16", "shared-data.git")


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/acme/analytics.git",
        "git@github.com:acme/analytics.git",
        "https://wren.example/not/a/project/path",
        "",
    ],
)
def test_binding_from_remote_url_is_none_for_a_non_wren_remote(url):
    # A directory pointing at GitHub is bound to something, just not to us;
    # callers must be able to tell that apart from "bound to project X".
    assert cloud.binding_from_remote_url(url) is None


def test_head_has_seeded_hooks_is_false_for_a_local_only_history(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    (target / "model.yml").write_text("name: orders\n")
    cloud.run_git(["add", "-A"], cwd=target)
    cloud.run_git(["commit", "-m", "local"], cwd=target)
    assert cloud.head_has_seeded_hooks(target) is False


def test_head_has_seeded_hooks_is_true_after_acquiring_a_project(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_hooked_remote(tmp_path / "host" / "git" / "shared-data.git")
    target = tmp_path / "proj"
    _link(target, git_host=git_host)
    assert cloud.head_has_seeded_hooks(target) is True


# ── remove_login ───────────────────────────────────────────────────────────


def _store(git_host, project_id, *, api_host="https://api.example"):
    cloud.store_login(
        git_host=git_host,
        api_host=api_host,
        project_id=project_id,
        org_id="2",
        repo=f"org/2/{project_id}/shared-data.git",
        api_key=f"sk-{project_id}",
    )


def test_remove_login_drops_the_entry_and_prunes_the_emptied_host():
    _store("https://wren.example", "16")
    assert cloud.remove_login("https://wren.example", "16") is True
    assert cloud.list_logins() == []
    # The host key must go too, or "does any login still use this host?" —
    # which gates removing the shared credential-helper entry — answers wrongly.
    assert "https://wren.example" not in cloud._load_store()["credentials"]


def test_remove_login_keeps_other_projects_on_the_same_host():
    _store("https://wren.example", "16")
    _store("https://wren.example", "17")
    cloud.remove_login("https://wren.example", "16")
    remaining = [(host, pid) for host, pid, _entry in cloud.list_logins()]
    assert remaining == [("https://wren.example", "17")]


def test_remove_login_accepts_an_int_project_id():
    # store_login coerces with str(); a delete that did not would silently
    # fail to match its own entry.
    _store("https://wren.example", "16")
    assert cloud.remove_login("https://wren.example", 16) is True


def test_remove_login_returns_false_when_nothing_matches():
    _store("https://wren.example", "16")
    assert cloud.remove_login("https://wren.example", "999") is False
    assert cloud.remove_login("https://other.example", "16") is False
    assert len(cloud.list_logins()) == 1, "a miss must not remove anything"


# ── link and create: the binding-lifecycle guards ──────────────────────────
#
# `link` used to only ever *add* `origin`, never check an existing one, so a
# directory bound to project A could be handed project B and silently stay on
# A while the caller reported success for B. Via `create` that also left B
# orphaned server-side.


def test_link_refuses_when_origin_points_at_a_different_project(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")
    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    cloud.run_git(
        ["remote", "add", "origin", f"{git_host}/git/org/2/99/other.git"], cwd=target
    )

    with pytest.raises(cloud.CloudError) as exc:
        _link(target, git_host=git_host)

    message = str(exc.value)
    assert "99" in message, "must name the project the directory is actually on"
    assert "unlink" in message, "must say how to proceed"
    # And the remote must be left exactly as it was, not half-repointed.
    assert cloud.current_remote_url(target) == f"{git_host}/git/org/2/99/other.git"


def test_link_accepts_an_existing_origin_that_already_matches(tmp_path):
    # The re-bind-to-the-same-project path must keep working: this is how a
    # user recovers a directory whose upstream was never set.
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")
    target = tmp_path / "proj"
    assert _link(target, git_host=git_host) is cloud.LinkOutcome.LINKED
    assert _link(target, git_host=git_host) is cloud.LinkOutcome.ALREADY_LINKED


def test_link_refuses_to_merge_a_history_acquired_from_another_project(tmp_path):
    """The F2 path: even with `origin` correctly removed first, the local
    history still belongs to the old project, and merging would combine two
    projects' content and publish it on the next push."""
    git_host = str(tmp_path / "host")
    _seed_hooked_remote(tmp_path / "host" / "git" / "shared-data.git", marker="16")
    _seed_hooked_remote(
        tmp_path / "host" / "git" / "org" / "2" / "99" / "other.git", marker="99"
    )

    target = tmp_path / "proj"
    _link(target, git_host=git_host)
    # Unbind by hand, exactly as a user would before re-binding elsewhere.
    cloud.run_git(["remote", "remove", "origin"], cwd=target)

    with pytest.raises(cloud.CloudError) as exc:
        _link(target, git_host=git_host, repo="org/2/99/other.git")

    message = str(exc.value)
    assert "clean directory" in message
    # No merge may have happened.
    assert cloud.run_git(["log", "--oneline"], cwd=target).stdout.count("\n") == 1


def test_link_still_adopts_a_pristine_local_project(tmp_path):
    """The negative case for the guard above — the whole reason `link`
    exists is adopting a local project, and that must be unaffected."""
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")
    target = tmp_path / "proj"
    target.mkdir()
    (target / "model.yml").write_text("name: orders\n")

    assert _link(target, git_host=git_host) is cloud.LinkOutcome.LINKED
    assert (target / "model.yml").exists(), "the user's own files must survive"
    assert (target / "seed.txt").exists(), "the remote's content must arrive"


def test_create_refuses_a_bound_directory_without_creating_anything(
    tmp_path, monkeypatch, _helper_check_passes
):
    """AC: the refusal must happen before the server is touched. This is the
    defect that produced a real orphaned project on staging."""

    def fail_if_called(*args, **kwargs):
        raise AssertionError(
            "create_project must not be reached: the guard exists precisely so "
            "that a refusal leaves no project behind"
        )

    monkeypatch.setattr(cloud, "create_project", fail_if_called)
    monkeypatch.setattr(cloud, "mint_project_key", fail_if_called)

    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    cloud.run_git(
        [
            "remote",
            "add",
            "origin",
            "https://wren.example/git/org/2/16/shared-data.git",
        ],
        cwd=target,
    )

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host="https://wren.example",
            org_id="2",
            org_key="osk-key",
            display_name="proj",
        )

    message = str(exc.value)
    assert "16" in message, "must name the project the directory is bound to"
    assert "Nothing has been created on the server." in message


def test_create_duplicates_a_project_from_a_directory_that_came_from_one(
    tmp_path, monkeypatch, _helper_check_passes
):
    """Unlink then create is how a project gets duplicated, so a history that
    came from another project must NOT be refused here.

    The refusal that does exist protects a remote which already has content
    from being merged with an unrelated history. A project created moments
    ago holds only its seed commit, so there is nothing to protect — and
    refusing would also do it *after* the project exists, orphaning it.
    """
    git_host = str(tmp_path / "host")
    # The directory's history comes from project 16...
    _seed_hooked_remote(tmp_path / "host" / "git" / "shared-data.git", marker="16")
    target = tmp_path / "project"
    _link(target, git_host=git_host)
    (target / "mine.txt").write_text("content worth duplicating")
    # The duplicate is still a Wren project being converted, so it carries one.
    _make_wren_project(target)
    cloud.run_git(["add", "-A"], cwd=target)
    cloud.run_git(["commit", "-m", "my work"], cwd=target)
    assert cloud.head_has_seeded_hooks(target), "precondition: history from a project"

    # ...the user unlinks, then creates project 99 to duplicate it into.
    cloud.unlink(target)
    _seed_hooked_remote(
        tmp_path / "host" / "git" / "org" / "2" / "99" / "shared-data.git", marker="99"
    )
    created, calls = _patch_create_http(monkeypatch)
    monkeypatch.setattr(
        cloud,
        "mint_git_token",
        lambda *a, **k: cloud.GitToken(
            repo="org/2/99/shared-data.git",
            token="t",
            expires_in=600,
            expires_at="",
        ),
    )

    project, outcome = cloud.create(
        target,
        host=git_host,
        org_id="2",
        org_key="osk-key",
        display_name="dup",
        git_host=git_host,
    )

    assert outcome is cloud.LinkOutcome.LINKED
    assert calls["create_project"] == 1, "the project must actually be created"
    assert (target / "mine.txt").exists(), "the content being duplicated survives"
    assert cloud.current_remote_url(target).endswith("org/2/99/shared-data.git")


# ── unlink / logout ────────────────────────────────────────────────────────


def _helper_section_exists(git_host):
    return (
        cloud.run_git(
            ["config", "--global", "--get-all", f"credential.{git_host}.helper"],
            check=False,
        ).returncode
        == 0
    )


def test_unlink_removes_the_remote_and_names_the_project(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    target = tmp_path / "proj"
    _link(target, git_host=git_host, repo="org/2/16/shared-data.git")

    outcome = cloud.unlink(target)

    assert outcome.project_id == "16"
    assert cloud.current_remote_url(target) is None, "the binding must be gone"


def test_unlink_keeps_the_stored_key_by_default(tmp_path):
    """Another directory may still be bound to the same project, so
    unbinding one must not revoke the credential."""
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    _store(git_host, "16")
    target = tmp_path / "proj"
    _link(target, git_host=git_host, repo="org/2/16/shared-data.git")

    outcome = cloud.unlink(target)

    assert outcome.key_forgotten is False
    assert len(cloud.list_logins()) == 1


def test_unlink_forget_key_drops_the_key_and_the_last_helper(tmp_path):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    _store(git_host, "16")
    cloud.configure_git_credential_helper(git_host)
    assert _helper_section_exists(git_host), "precondition: helper configured"
    target = tmp_path / "proj"
    _link(target, git_host=git_host, repo="org/2/16/shared-data.git")

    outcome = cloud.unlink(target, forget_key=True)

    assert outcome.key_forgotten is True
    assert outcome.helper_removed is True
    assert cloud.list_logins() == []
    assert not _helper_section_exists(git_host)


def test_unlink_forget_key_keeps_the_helper_while_the_host_is_still_used(tmp_path):
    """The helper entry is host-scoped, so removing it while another project
    on the same host is still bound would break that project's auth too."""
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    _store(git_host, "16")
    _store(git_host, "17")
    cloud.configure_git_credential_helper(git_host)
    target = tmp_path / "proj"
    _link(target, git_host=git_host, repo="org/2/16/shared-data.git")

    outcome = cloud.unlink(target, forget_key=True)

    assert outcome.key_forgotten is True
    assert outcome.helper_removed is False
    assert _helper_section_exists(git_host), "project 17 still needs this helper"


def test_unlink_refuses_a_directory_that_is_not_bound(tmp_path):
    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init"], cwd=target)
    with pytest.raises(cloud.CloudError, match="not bound"):
        cloud.unlink(target)


def test_unlink_then_link_rebinds_the_same_project_cleanly(tmp_path):
    """Unbind/re-bind must round-trip, or the guards would leave users stuck."""
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "shared-data.git")
    target = tmp_path / "proj"
    _link(target, git_host=git_host)

    cloud.unlink(target)
    assert _link(target, git_host=git_host) is cloud.LinkOutcome.ALREADY_LINKED
    assert cloud._has_upstream(target), "upstream must be restored"


def test_logout_drops_the_login_and_leaves_the_directory_bound(tmp_path):
    """`logout` is not `unlink`: it discards the credential, and a bound
    directory keeps its remote and simply stops being able to authenticate."""
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    _store(git_host, "16")
    cloud.configure_git_credential_helper(git_host)
    target = tmp_path / "proj"
    _link(target, git_host=git_host, repo="org/2/16/shared-data.git")

    login_removed, helper_removed = cloud.logout(git_host, "16")

    assert (login_removed, helper_removed) == (True, True)
    assert cloud.list_logins() == []
    assert cloud.current_remote_url(target) is not None, "no directory is touched"


def test_logout_keeps_the_helper_while_another_login_uses_the_host():
    git_host = "https://wren.example"
    _store(git_host, "16")
    _store(git_host, "17")
    cloud.configure_git_credential_helper(git_host)

    login_removed, helper_removed = cloud.logout(git_host, "16")

    assert login_removed is True
    assert helper_removed is False
    assert _helper_section_exists(git_host)


def test_link_rebinds_the_same_project_when_the_local_copy_is_behind(tmp_path):
    """Regression: the foreign-history guard must not fire on a re-bind to
    the same project.

    Found by live testing, not by the test above it: "origin/<branch> is not
    an ancestor of HEAD" is false both for unrelated histories *and* for a
    clone that is simply behind. Keying the refusal off that alone refused
    the ordinary unlink/re-bind recovery path, which is the one thing the
    guard had to leave working.
    """
    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "shared-data.git"
    _seed_hooked_remote(remote, marker="16")

    target = tmp_path / "proj"
    _link(target, git_host=git_host)

    # The remote moves on, so the local copy is now strictly behind it.
    (remote / "models.yml").write_text("name: orders\n")
    cloud.run_git(["add", "-A"], cwd=remote)
    cloud.run_git(["commit", "-m", "server-side change"], cwd=remote)

    cloud.unlink(target)
    assert _link(target, git_host=git_host) is cloud.LinkOutcome.LINKED
    assert (target / "models.yml").exists(), "the newer remote content arrived"


def test_link_leaves_no_origin_behind_when_it_refuses_a_foreign_history(tmp_path):
    """A refusal must not strand the directory pointing at a project it was
    never bound to — the module's contract is that refusals leave nothing to
    undo."""
    git_host = str(tmp_path / "host")
    _seed_hooked_remote(tmp_path / "host" / "git" / "shared-data.git", marker="16")
    _seed_hooked_remote(
        tmp_path / "host" / "git" / "org" / "2" / "99" / "other.git", marker="99"
    )
    target = tmp_path / "proj"
    _link(target, git_host=git_host)
    cloud.run_git(["remote", "remove", "origin"], cwd=target)

    with pytest.raises(cloud.CloudError):
        _link(target, git_host=git_host, repo="org/2/99/other.git")

    assert cloud.current_remote_url(target) is None, (
        "the origin added during the attempt must be rolled back"
    )


def test_create_project_rejection_names_what_is_actually_known(monkeypatch):
    """A 401 here has several possible causes — a key of the wrong level, a
    revoked one, or one belonging to another org or host. The message must
    not assert one of them, and in particular must not tell the user they
    passed a project key when they may not have."""

    class _Resp:
        status_code = 401
        text = "unauthorized"

        def json(self):
            return {}

    monkeypatch.setattr(requests, "post", lambda *a, **k: _Resp())

    with pytest.raises(cloud.InvalidApiKeyError) as exc:
        cloud.create_project(
            "https://wren.example",
            "osk-revoked",
            org_id="190",
            display_name="proj",
        )

    message = str(exc.value)
    assert "not a project key" not in message
    assert "190" in message, "must name the org it was rejected for"
    assert "--org-key" in message, "must say how to supply a different key"


def test_create_refuses_without_a_git_identity_before_creating_anything(
    tmp_path, monkeypatch, _helper_check_passes
):
    """Found by live testing, not by this suite: on a machine with no git
    identity, `create` built the project and then failed inside the merge,
    leaving it orphaned. The identity is needed because binding a directory
    with files records commits, so it belongs in the pre-flight."""

    def fail_if_called(*args, **kwargs):
        raise AssertionError(
            "create_project must not be reached: a missing git identity has to "
            "be caught before anything exists server-side"
        )

    monkeypatch.setattr(cloud, "create_project", fail_if_called)
    monkeypatch.setattr(cloud, "mint_project_key", fail_if_called)
    # The autouse fixture sets an identity via env vars; strip it so git has
    # none from any source.
    for var in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "EMAIL",
    ):
        monkeypatch.delenv(var, raising=False)

    target = tmp_path / "proj"
    target.mkdir()
    (target / "model.yml").write_text("name: orders\n")

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host="https://wren.example",
            org_id="2",
            org_key="osk-key",
            display_name="proj",
        )
    assert "identity" in str(exc.value)
    assert "user.email" in str(exc.value), "must say how to fix it"


def test_git_identity_check_exempts_an_empty_directory(tmp_path, monkeypatch):
    """An empty target is cloned, and a clone records no commit — requiring an
    identity there would refuse a case that works fine."""
    for var in (
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "EMAIL",
    ):
        monkeypatch.delenv(var, raising=False)
    empty = tmp_path / "empty"
    empty.mkdir()
    cloud.check_git_identity_usable(empty)  # must not raise
    cloud.check_git_identity_usable(tmp_path / "does-not-exist")  # nor here


# ── normalize_host ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("cloud.getwren.ai", "https://cloud.getwren.ai"),
        ("cloud.getwren.ai/", "https://cloud.getwren.ai"),
        ("  cloud.getwren.ai  ", "https://cloud.getwren.ai"),
        ("https://cloud.getwren.ai", "https://cloud.getwren.ai"),
        # An explicit scheme is never overridden — a local stack is plain http
        # and must stay reachable.
        ("http://localhost:3000", "http://localhost:3000"),
        ("http://localhost:3000/", "http://localhost:3000"),
    ],
)
def test_normalize_host(given, expected):
    assert cloud.normalize_host(given) == expected


def test_create_names_the_project_when_the_bind_fails(
    tmp_path, monkeypatch, _helper_check_passes
):
    """A bind failure after creation must not surface as a bare git error.

    Observed live: a transient fetch failure against a just-created repo
    produced `git fetch origin failed: ...` and nothing else, leaving a real
    project in the org with no indication it had been created, what its id
    was, or how to finish. The pre-flight checks cannot cover every way git
    can fail, so this path has to report rather than be prevented.
    """
    _patch_create_http(monkeypatch)
    monkeypatch.setattr(
        cloud,
        "mint_git_token",
        lambda *a, **k: cloud.GitToken(
            repo="org/2/16/shared-data.git", token="t", expires_in=600, expires_at=""
        ),
    )
    monkeypatch.setattr(cloud, "configure_git_credential_helper", lambda git_host: None)

    def fake_link(*args, **kwargs):
        raise cloud.GitCommandError(
            "git fetch origin failed:\nfatal: protocol error: bad line "
            "length character: PACK"
        )

    monkeypatch.setattr(cloud, "link", fake_link)

    target = _make_wren_project(tmp_path / "proj")
    (target / "model.yml").write_text("name: orders\n")

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host="https://wren.example",
            org_id="2",
            org_key="osk-key",
            display_name="proj",
        )

    message = str(exc.value)
    assert "16" in message, "must name the project that now exists"
    assert "wren cloud link" in message, "must say what completes the bind"
    assert "bad line length character: PACK" in message, (
        "the underlying git error must still be visible"
    )


# ── `create` converts a local project, so there must be one ────────────────
#
# These pin the half of `create` that changed when it stopped being "make an
# empty cloud project" and became "convert the project in this directory".


def test_create_refuses_a_directory_that_is_not_a_wren_project(
    tmp_path, monkeypatch, _helper_check_passes
):
    target = tmp_path / "just-a-folder"
    target.mkdir()

    def fail_if_called(*args, **kwargs):
        raise AssertionError("nothing may be created for a non-project directory")

    monkeypatch.setattr(cloud, "create_project", fail_if_called)

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )

    message = str(exc.value)
    assert "wren_project.yml" in message
    assert "wren context init" in message, "must say how to get one"


def test_create_refuses_a_project_that_does_not_compile(
    tmp_path, monkeypatch, _helper_check_passes
):
    target = _make_wren_project(tmp_path / "proj")
    # Malformed YAML. Chosen after checking what actually fails: the loader
    # deliberately skips non-mapping entries and tolerates a missing `name`,
    # so those inputs would leave the build green and this test passing for
    # no reason.
    (target / "models" / "t" / "metadata.yml").write_text("name: [unclosed\n")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("a project that will not deploy must not be created")

    monkeypatch.setattr(cloud, "create_project", fail_if_called)

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host="https://cloud.getwren.ai",
            org_id="2",
            org_key="osk-x",
            display_name="proj",
        )
    assert "Nothing was created" in str(exc.value)


def test_check_project_builds_leaves_no_build_artifact(tmp_path):
    """`target/mdl.json` is not ignored by the scaffold, so writing it here
    would push a build artifact into the project's repository."""
    target = _make_wren_project(tmp_path / "proj")

    cloud.check_project_builds(target)

    assert not (target / "target").exists()


def test_check_project_builds_does_not_adopt_an_ancestors_project(tmp_path):
    """`context.discover_project_path()` walks up from the cwd. Using it here
    would let a bare subdirectory convert its parent's models into a new cloud
    project — someone else's manifest, silently."""
    _make_wren_project(tmp_path / "outer")
    target = tmp_path / "outer" / "inner"
    target.mkdir()

    with pytest.raises(cloud.CloudError) as exc:
        cloud.check_project_builds(target)
    assert "wren_project.yml" in str(exc.value)


def test_create_pushes_so_the_models_deploy(
    tmp_path, monkeypatch, _helper_check_passes
):
    """The models reach the cloud through git. Without the push the project
    exists, is bound, and is empty — the state this command exists to avoid."""
    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git"
    _seed_remote(remote)
    _patch_create_http(monkeypatch)
    monkeypatch.setattr(
        cloud,
        "mint_git_token",
        lambda *a, **k: cloud.GitToken(
            repo="org/2/16/shared-data.git",
            token="t",
            expires_in=600,
            expires_at="",
        ),
    )

    target = _make_wren_project(tmp_path / "project")

    cloud.create(
        target,
        host=git_host,
        org_id="2",
        org_key="osk-x",
        display_name="proj",
        git_host=git_host,
    )

    # Read the model back out of the *remote*: asserting on the local branch
    # would pass even if nothing had been pushed.
    listed = cloud.run_git(
        ["ls-tree", "-r", "--name-only", "HEAD"], cwd=remote
    ).stdout
    assert "models/t/metadata.yml" in listed
    assert "wren_project.yml" in listed


def test_create_reports_a_push_failure_without_claiming_the_bind_failed(
    tmp_path, monkeypatch, _helper_check_passes
):
    git_host = str(tmp_path / "host")
    _seed_remote(tmp_path / "host" / "git" / "org" / "2" / "16" / "shared-data.git")
    _patch_create_http(monkeypatch)
    monkeypatch.setattr(
        cloud,
        "mint_git_token",
        lambda *a, **k: cloud.GitToken(
            repo="org/2/16/shared-data.git",
            token="t",
            expires_in=600,
            expires_at="",
        ),
    )

    real_run_git = cloud.run_git

    def fail_only_push(args, **kwargs):
        if args[:1] == ["push"]:
            return subprocess.CompletedProcess(args, 1, "", "remote rejected")
        return real_run_git(args, **kwargs)

    monkeypatch.setattr(cloud, "run_git", fail_only_push)

    target = _make_wren_project(tmp_path / "project")

    with pytest.raises(cloud.CloudError) as exc:
        cloud.create(
            target,
            host=git_host,
            org_id="2",
            org_key="osk-x",
            display_name="proj",
            git_host=git_host,
        )

    message = str(exc.value)
    assert "16" in message, "must name the project that now exists"
    assert "bound to it" in message, "the bind succeeded — do not imply otherwise"
    assert "git push" in message, "must say what finishes the job"


# ── The local branch must match the remote's default ───────────────────────
#
# Wren Cloud seeds `main`. A client whose git still defaults to `master`
# (upstream git's builtin; this machine's is patched to `main`, which is why
# neither the suite nor live testing saw this) ended up with the branch and
# its upstream disagreeing — and every symptom of that looked like success.


def test_link_renames_the_local_branch_to_the_remotes_default(tmp_path):
    """Forces the mismatch with `git init -b master`, since the ambient
    default cannot be relied on to produce one."""

    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "shared-data.git"
    _seed_remote(remote)

    target = tmp_path / "proj"
    target.mkdir()
    cloud.run_git(["init", "-b", "master"], cwd=target)
    (target / "mine.txt").write_text("mine")

    outcome = _link(target, git_host=git_host)
    assert outcome is cloud.LinkOutcome.LINKED

    branch = cloud.run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=target
    ).stdout.strip()
    upstream = cloud.run_git(
        ["rev-parse", "--abbrev-ref", "@{upstream}"], cwd=target
    ).stdout.strip()
    assert branch == "main", "the local branch must take the remote's name"
    assert upstream == "origin/main"

    # The point of the rename: `git push` with no arguments has to work, and
    # has to land on the branch the remote already has rather than opening a
    # second one. Asserting on the branch name alone would miss both.
    push = cloud.run_git(["push"], cwd=target, check=False)
    assert push.returncode == 0, (push.stderr or push.stdout)
    remote_branches = cloud.run_git(
        ["branch", "--format=%(refname:short)"], cwd=remote
    ).stdout.split()
    assert remote_branches == ["main"], f"a second branch was created: {remote_branches}"


def test_link_leaves_a_deliberate_upstream_and_its_branch_name_alone(tmp_path):
    """The rename must not override a user who pointed the branch elsewhere —
    the same rule the already-linked path follows for upstreams."""

    git_host = str(tmp_path / "host")
    remote = tmp_path / "host" / "git" / "shared-data.git"
    _seed_remote(remote)
    cloud.run_git(["branch", "other"], cwd=remote)

    target = tmp_path / "proj"
    cloud.run_git(["clone", f"{git_host}/git/shared-data.git", str(target)])
    cloud.run_git(["branch", "-m", "mine"], cwd=target)
    cloud.run_git(["branch", "--set-upstream-to=origin/other"], cwd=target)

    _link(target, git_host=git_host)

    branch = cloud.run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=target
    ).stdout.strip()
    assert branch == "mine", "a deliberate upstream keeps its branch name too"


def test_run_git_reports_a_missing_directory_as_a_cloud_error(tmp_path):
    """`subprocess` raises FileNotFoundError for a missing cwd, which the CLI
    does not catch — so this surfaced as a traceback."""

    with pytest.raises(cloud.CloudError) as exc:
        cloud.run_git(["status"], cwd=tmp_path / "nope")
    assert "does not exist" in str(exc.value)


def test_link_fills_in_a_repo_that_was_stored_before_it_was_known(
    tmp_path, monkeypatch, _helper_check_passes
):
    """`create` stores the key before it can know the repo path — only the
    git-token call returns that, and it is the call that can fail. The next
    use has to complete the record rather than build a broken remote URL from
    an empty repo."""

    cloud.store_key_pending_repo(
        git_host="https://cloud.getwren.ai",
        api_host="https://cloud.getwren.ai",
        project_id="16",
        org_id="2",
        api_key="sk-x",
    )
    entry = cloud.get_login("https://cloud.getwren.ai", "16")
    assert entry["repo"] == "", "precondition: the repo is not known yet"

    monkeypatch.setattr(
        cloud,
        "mint_git_token",
        lambda *a, **k: cloud.GitToken(
            repo="org/2/16/shared-data.git", token="t", expires_in=600, expires_at=""
        ),
    )

    resolved = cloud.resolve_repo("https://cloud.getwren.ai", "16", entry)

    assert resolved == "org/2/16/shared-data.git"
    # Written back, so the discovery happens once rather than on every use.
    assert (
        cloud.get_login("https://cloud.getwren.ai", "16")["repo"]
        == "org/2/16/shared-data.git"
    )


def test_resolve_repo_does_not_call_the_api_when_the_repo_is_known(monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("a complete record must not trigger an API call")

    monkeypatch.setattr(cloud, "mint_git_token", fail_if_called)

    entry = {
        "api_host": "https://cloud.getwren.ai",
        "org_id": "2",
        "repo": "org/2/16/shared-data.git",
        "api_key": "sk-x",
    }
    assert (
        cloud.resolve_repo("https://cloud.getwren.ai", "16", entry)
        == "org/2/16/shared-data.git"
    )
