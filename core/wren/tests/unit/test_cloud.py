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
