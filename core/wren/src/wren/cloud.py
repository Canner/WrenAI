"""`wren cloud` — connect a local directory to a Wren Cloud project's git remote.

Two credentials, two lifetimes:

- The **project API key** is the durable credential. It is prompted for once
  by ``auth add``, stored locally (0600, keyed by git host + project id), and
  never leaves this machine except in the ``Authorization`` header of the
  git-token request below.
- The **git token** is a short-TTL JWT minted from the API key on every git
  operation by the credential helper (``get``). It is never written to disk
  and never reused across operations — each ``get`` call mints a fresh one,
  which is also what makes an expired token a non-event: nothing on this
  machine ever holds one long enough to present it after it has expired.

``auth add`` writes a URL-scoped credential helper entry (plus
``useHttpPath``) into the user's *global* git config, not local config —
when the credential is added there is no clone yet, so there is no local
config to write into. Because the
helper resolves which project's token to mint from the path git hands it
(``useHttpPath``), no local-directory-to-project binding is stored anywhere;
the binding is the git remote itself, which git already tracks.

Do not reuse ``context.convert_mdl_to_project()`` from this module's callers
— it never reads the manifest's ``cubes``, so anything built on it silently
drops them. ``link`` acquires files via git, not via the manifest, so it
should never need that path at all.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

_WREN_HOME = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
_CLOUD_FILE = _WREN_HOME / "cloud.yml"

# The one definition of the helper: the executable git will resolve from PATH,
# and the sub-command it must be able to serve. The string written into git
# config and the string the pre-flight check probes are both derived from
# these, so a change to one cannot silently leave the other behind — the check
# would then be verifying a command git never runs.
HELPER_EXECUTABLE = "wren"
HELPER_SUBCOMMAND = ("cloud", "git-credential")
HELPER_COMMAND = "!" + " ".join((HELPER_EXECUTABLE, *HELPER_SUBCOMMAND))

# How long to wait for the probe below. Generous: it pays one interpreter
# start-up, and a slow machine must not turn a working install into a refusal.
_HELPER_PROBE_TIMEOUT_S = 30.0

# Matches both the API's own `repo` field ("org/{org}/{project}/name.git")
# and the `path=` field git hands the credential helper, which carries the
# git-server's own routing prefix ("git/org/{org}/{project}/name.git").
_REPO_PATH_RE = re.compile(
    r"^(?:git/)?org/(?P<org>[^/]+)/(?P<project>[^/]+)/(?P<repo>[^/]+\.git)$"
)

_GIT_TOKEN_PATH_TMPL = "/api/v2/projects/{project_id}/git-token"
_PROJECTS_PATH = "/api/v1/projects"
_PROJECT_KEYS_PATH_TMPL = "/api/v1/projects/{project_id}/keys"


class CloudError(Exception):
    """Base class for user-facing `wren cloud` errors."""


class InvalidApiKeyError(CloudError):
    """The API key was rejected for this host + project."""


class NestedRepoError(CloudError):
    """The target directory sits inside a foreign git repository."""

    def __init__(self, target: Path, found_root: Path):
        self.target = target
        self.found_root = found_root
        super().__init__(
            f"{target} is inside an existing git repository rooted at "
            f"{found_root}.\n"
            "Connecting it to Wren Cloud would push that repository's own "
            "files and history into the project's git repository.\n"
            f"Move the project to its own directory (outside {found_root}) "
            "and run `wren cloud link` again."
        )


class GitCommandError(CloudError):
    """A shelled-out `git` command failed unexpectedly."""


class CloudApiError(CloudError):
    """A `CloudError` that also carries the failed response's HTTP status
    and, when the body had one, the server's machine-readable `code`.

    Lets a caller branch on *why* a call failed without parsing prose out
    of the message. `code` is `None` whenever the body was missing,
    unparseable, not a JSON object, or had no string `code` field — a
    caller checking `exc.code == "..."` degrades safely to "unrecognized"
    in every one of those cases rather than raising or matching by luck.
    """

    def __init__(self, message: str, *, status_code: int, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


@dataclass
class GitToken:
    repo: str
    token: str
    expires_in: int
    expires_at: str


# ── HTTP: mint a short-TTL git token from the durable API key ──────────────


def _parse_retry_after(value: str | None, *, default: float = 1.0) -> float:
    if not value:
        return default
    try:
        return max(float(value), 0.0)
    except ValueError:
        return default


def _parse_error_code(resp) -> str | None:
    """Best-effort extraction of the server's `code` field from an error body.

    Returns `None` on anything other than the expected shape — an
    unparseable body, a body that isn't a JSON object, or a missing or
    non-string `code` — rather than raising, so a caller can always fall
    back to today's generic error instead of crashing on a response it
    doesn't recognize.
    """
    try:
        data = resp.json()
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    code = data.get("code")
    return code if isinstance(code, str) else None


def mint_git_token(
    api_host: str,
    project_id: str,
    api_key: str,
    *,
    timeout: float = 15.0,
    max_attempts: int = 4,
) -> GitToken:
    """Mint a fresh git token for `project_id` from the durable API key.

    One call both validates the key (200 vs 401/403) and returns the full
    repo path, so the caller never needs to know its org id separately.

    On 429, backs off using the response's `Retry-After` header rather than
    a hardcoded guess — the endpoint's rate limiter is per-process, so the
    ceiling a client actually observes varies with deployment topology.
    """
    import requests  # noqa: PLC0415

    url = f"{api_host.rstrip('/')}{_GIT_TOKEN_PATH_TMPL.format(project_id=project_id)}"
    headers = {"Authorization": f"Bearer {api_key}"}

    attempt = 0
    while True:
        attempt += 1
        try:
            resp = requests.post(url, headers=headers, timeout=timeout)
        except requests.RequestException as exc:
            raise CloudError(f"Could not reach {api_host}: {exc}") from exc

        if resp.status_code == 200:
            data = resp.json()
            return GitToken(
                repo=data["repo"],
                token=data["token"],
                expires_in=data.get("expiresIn", 0),
                expires_at=data.get("expiresAt", ""),
            )
        if resp.status_code in (401, 403):
            raise InvalidApiKeyError(
                f"This key is not valid for project {project_id} on {api_host}."
            )
        if resp.status_code == 429 and attempt < max_attempts:
            time.sleep(_parse_retry_after(resp.headers.get("Retry-After")))
            continue
        raise CloudApiError(
            f"Wren Cloud API returned {resp.status_code} minting a git token "
            f"for project {project_id} on {api_host}: {resp.text[:300]}",
            status_code=resp.status_code,
            code=_parse_error_code(resp),
        )


# ── Local credential storage: ~/.wren/cloud.yml, 0600, keyed by host+project


def _load_store() -> dict:
    if not _CLOUD_FILE.exists():
        return {"credentials": {}}
    import yaml  # noqa: PLC0415

    try:
        data = yaml.safe_load(_CLOUD_FILE.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise CloudError(
            f"{_CLOUD_FILE} is not valid YAML: {exc}\n"
            f"Fix or remove {_CLOUD_FILE} and run `wren cloud auth add` again."
        ) from exc
    if data is None:
        return {"credentials": {}}
    if not isinstance(data, dict) or not isinstance(data.get("credentials", {}), dict):
        raise CloudError(f"{_CLOUD_FILE} must contain a 'credentials' mapping.")
    data.setdefault("credentials", {})
    return data


def _save_store(data: dict) -> None:
    import yaml  # noqa: PLC0415

    _WREN_HOME.mkdir(parents=True, exist_ok=True)
    payload = yaml.dump(
        data, default_flow_style=False, sort_keys=False, allow_unicode=True
    )
    fd, tmp_path = tempfile.mkstemp(dir=_WREN_HOME, suffix=".yml.tmp")
    try:
        os.chmod(tmp_path, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp_path, _CLOUD_FILE)
    except Exception:
        os.unlink(tmp_path)
        raise
    os.chmod(_CLOUD_FILE, 0o600)


def store_login(
    *,
    git_host: str,
    api_host: str,
    project_id: str,
    org_id: str,
    repo: str,
    api_key: str,
) -> None:
    """Persist the API key and its metadata, keyed by git host + project id.

    Keyed by `git_host` (not `api_host`) because that is what git itself
    hands the credential helper at fetch time (`protocol` + `host`); the
    helper has no other way to look this entry back up.
    """
    data = _load_store()
    creds = data["credentials"]
    creds.setdefault(git_host, {})[str(project_id)] = {
        "api_host": api_host,
        "org_id": str(org_id),
        "repo": repo,
        "api_key": api_key,
    }
    _save_store(data)


def get_login(git_host: str, project_id: str) -> dict | None:
    data = _load_store()
    return data["credentials"].get(git_host, {}).get(str(project_id))


def list_logins() -> list[tuple[str, str, dict]]:
    """Return `[(git_host, project_id, entry), ...]` for every stored login."""
    data = _load_store()
    out: list[tuple[str, str, dict]] = []
    for git_host, projects in data["credentials"].items():
        for project_id, entry in projects.items():
            out.append((git_host, project_id, entry))
    return out


def remove_login(git_host: str, project_id: str) -> bool:
    """Drop one stored login. Returns False when there was nothing to drop.

    Coerces `project_id` with `str()` to match how `store_login` writes it —
    an int-ish id would otherwise never match its own entry.

    Prunes the `git_host` key once its last project is gone. Without that,
    `list_logins` would keep skipping an empty mapping that no longer
    corresponds to anything, and "are there any logins left on this host?"
    — which is what decides whether the host's credential-helper section may
    be removed — would answer wrongly.
    """
    data = _load_store()
    projects = data["credentials"].get(git_host)
    if not projects or str(project_id) not in projects:
        return False
    del projects[str(project_id)]
    if not projects:
        del data["credentials"][git_host]
    _save_store(data)
    return True


# ── Parsing the project out of a git path ───────────────────────────────────


def parse_repo_path(path: str) -> tuple[str, str, str]:
    """Parse a repo path into `(org_id, project_id, repo_name)`.

    Accepts both the API's own `repo` field (`org/{org}/{project}/name.git`)
    and the `path=` field git hands the credential helper when
    `useHttpPath` is set (`git/org/{org}/{project}/name.git`).
    """
    match = _REPO_PATH_RE.match(path.strip("/"))
    if not match:
        raise CloudError(f"Could not parse a Wren Cloud project from path: {path!r}")
    return match.group("org"), match.group("project"), match.group("repo")


# ── Writing the git config `login` is responsible for ───────────────────────


def _git_config_set_global(key: str, value: str) -> None:
    run_git(["config", "--global", "--replace-all", key, value])


def _git_config_add_global(key: str, value: str) -> None:
    run_git(["config", "--global", "--add", key, value])


def check_helper_command_serviceable() -> None:
    """Refuse to write a helper git would not be able to run.

    `configure_git_credential_helper` writes `HELPER_COMMAND`, whose `!`
    prefix makes git run it through a shell — so `wren` is resolved from
    `PATH` at *git*-invocation time, not now, and not pinned to the
    interpreter running this command. A `wren` on `PATH` that predates the
    `cloud` command group therefore breaks **every** git operation against
    that host: clone, fetch and push alike, since the entry lives in global
    config. The error the user sees comes from git, talks about credentials,
    and names neither `wren` nor a version, so there is no path from the
    symptom back to the cause — and `login` would have reported success,
    because when the credential is added the CLI *is* the capable one and the breakage only
    appears later, in a different tool.

    Probing the resolved executable turns that into an immediate refusal that
    names the real cause, before anything is written.

    What this cannot cover: `PATH` changing *after* login. Once a different
    `wren` is what git runs, nothing on this side is in the path of the
    failure — that executable's output is not ours to shape. That residual is
    why the helper's own failures identify themselves (`helper_failure_note`).
    """
    resolved = shutil.which(HELPER_EXECUTABLE)
    if resolved is None:
        raise CloudError(
            f"No `{HELPER_EXECUTABLE}` found on PATH, so the git credential "
            f"helper this command is about to configure "
            f"(`{HELPER_COMMAND.lstrip('!')}`) would not be runnable: git "
            f"resolves it from PATH every time it authenticates, not from "
            f"the interpreter running this command. Install wren so that "
            f"`{HELPER_EXECUTABLE}` is on PATH (e.g. `uv tool install "
            f"wrenai` or `pipx install wrenai`), then run this again."
        )

    probe = [resolved, *HELPER_SUBCOMMAND, "--help"]
    try:
        completed = subprocess.run(  # noqa: S603
            probe,
            capture_output=True,
            text=True,
            timeout=_HELPER_PROBE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise CloudError(
            f"`{' '.join(probe)}` did not respond within "
            f"{_HELPER_PROBE_TIMEOUT_S:.0f}s, so whether the `"
            f"{HELPER_EXECUTABLE}` on PATH ({resolved}) can serve git's "
            f"credential requests could not be established. Nothing was "
            f"written. Try running that command by hand to see what it does."
        ) from exc
    except OSError as exc:
        raise CloudError(
            f"Could not run `{' '.join(probe)}` ({exc}), so whether the "
            f"`{HELPER_EXECUTABLE}` on PATH ({resolved}) can serve git's "
            f"credential requests could not be established. Nothing was "
            f"written."
        ) from exc

    if completed.returncode != 0:
        raise CloudError(
            f"The `{HELPER_EXECUTABLE}` on PATH ({resolved}) cannot serve "
            f"`{' '.join((HELPER_EXECUTABLE, *HELPER_SUBCOMMAND))}` — it "
            f"exited {completed.returncode} when asked. That is the exact "
            f"executable git would run to authenticate, every time, for "
            f"every clone / fetch / push against this host, so configuring "
            f"it now would break them all with an error that comes from git "
            f"and mentions neither wren nor a version.\n"
            f"Nothing was written. Most likely this PATH entry is an older "
            f"wren without the `cloud` commands: upgrade it (e.g. `uv tool "
            f"install --force wrenai`), or put the wren you are running now "
            f"first on PATH, then run this again."
        )


def configure_git_credential_helper(git_host: str) -> None:
    """Write a URL-scoped credential-helper entry into the global git config.

    Three settings are written into the `credential.<git_host>` section, and
    the order matters:

    1. An **empty** `helper =` value, written first.
    2. Our own helper, `!wren cloud git-credential`.
    3. `useHttpPath = true`.

    The empty entry (1) exists because of a helper the user did not put
    there: macOS's git ships `credential.helper = osxkeychain` in the
    Command Line Tools' own gitconfig file (visible via `git config
    --show-origin --get-all credential.helper`, but invisible to `git config
    --system` — it is a *different* file git still reads before global
    config). Because system config is consulted before global config, that
    helper would otherwise answer `get` before ours does, handing git a
    stale cached credential instead of a freshly minted one. Worse, because
    this design deliberately never caches a token, git's `store` call fires
    on every single operation, and *that* helper caches the ephemeral token
    into the keychain anyway — the exact thing not-caching exists to avoid.
    An empty `helper` value resets the helper chain accumulated so far,
    scoped to this section, so it clears only the chain for this specific
    host; a clone of some other host is unaffected and still gets its
    keychain helper.

    `useHttpPath` (3) makes git additionally hand the helper the request
    path (`git/org/{org}/{project}/name.git`); without it git only passes
    `protocol` + `host`, and the helper has no way to know which project's
    token to mint. This is why `login` needs no separate per-directory
    state — the binding lives in the git remote, which git already manages.

    Our helper value (2) is `HELPER_COMMAND`, and must be `!`-prefixed: git
    only runs a helper string through a shell (and appends the
    `get`/`store`/`erase` argument correctly) when it starts with `!`. A bare
    multi-word value like `wren cloud git-credential` would instead have
    `git-credential-` prepended to just its first word, which is not what we
    want. That `!` is also what makes `wren` PATH-resolved at git-invocation
    time, which is what `check_helper_command_serviceable` exists to guard.

    Re-running this (e.g. a second `wren cloud auth add`) stays idempotent:
    `--replace-all` first collapses the `helper` key back down to the single
    empty value before `--add` appends our helper again, so the section
    never accumulates duplicate entries across repeated logins.
    """
    section = f"credential.{git_host}"
    _git_config_set_global(f"{section}.helper", "")
    _git_config_add_global(f"{section}.helper", HELPER_COMMAND)
    _git_config_set_global(f"{section}.useHttpPath", "true")


def remove_git_credential_helper(git_host: str) -> None:
    """Undo `configure_git_credential_helper` for one host.

    Removes the whole section rather than unsetting our own `helper` line.
    That function writes *three* things, and the first is an empty `helper`
    whose only job is to reset the inherited chain for this host. Removing
    just our entry would leave that reset in place — a section that still
    suppresses the user's own helper (on macOS, the `osxkeychain` one git
    ships in the Command Line Tools' gitconfig) with nothing put back in its
    place, so git would have no credential source for the host at all.

    Best-effort: `--remove-section` exits non-zero when the section is not
    there, which is the normal state for a host that was never logged in to.
    """
    run_git(
        ["config", "--global", "--remove-section", f"credential.{git_host}"],
        check=False,
    )


def login(
    *,
    host: str,
    project_id: str,
    api_key: str,
    git_host: str | None = None,
) -> GitToken:
    """Validate `api_key` against `project_id`, store it, and configure git.

    `git_host` is the host git will actually talk to for this project's
    repo. It defaults to `host`, which is correct whenever the git remote
    and the Wren Cloud API share one host (the shipped-product shape, where
    a single ingress routes both under one domain). Pass it explicitly only
    when they differ — e.g. a local/self-hosted setup with no such unified
    ingress in front, where the API and the git server sit on separate
    hosts or ports.

    The credential helper is checked for serviceability first, before the key
    is validated or anything is stored: a login that cannot produce working
    git authentication has not achieved what it claims, and refusing before
    any write leaves nothing behind to undo.
    """
    api_host = host.rstrip("/")
    resolved_git_host = (git_host or host).rstrip("/")

    check_helper_command_serviceable()

    token = mint_git_token(api_host, project_id, api_key)
    org_id, parsed_project_id, _repo_name = parse_repo_path(token.repo)

    store_login(
        git_host=resolved_git_host,
        api_host=api_host,
        project_id=parsed_project_id,
        org_id=org_id,
        repo=token.repo,
        api_key=api_key,
    )
    configure_git_credential_helper(resolved_git_host)
    return token


# ── The credential helper itself: get / store / erase ───────────────────────


def read_credential_input(stream) -> dict[str, str]:
    """Parse the `key=value` lines git feeds a credential helper on stdin."""
    data: dict[str, str] = {}
    for line in stream:
        line = line.rstrip("\n")
        if not line:
            break
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        data[key] = value
    return data


def format_credential_output(username: str, password: str) -> str:
    return f"username={username}\npassword={password}\n"


def git_credential_get(input_data: dict[str, str]) -> str:
    """Handle git's `get` call: mint a fresh token and return it.

    Always mints fresh — never caches — so a stale token is never handed to
    git in the first place. Combined with git's own credential retry (erase
    then get again on a 401/403 from the remote), this is what keeps an
    expired token from ever surfacing as a user-visible failure: there is
    no code path where this helper hands out a token old enough to have
    expired.
    """
    protocol = input_data.get("protocol", "")
    host = input_data.get("host", "")
    path = input_data.get("path", "")
    if not path:
        raise CloudError(
            "git did not send a project path — is `useHttpPath` set for this "
            "host? Run `wren cloud auth add` again to fix the git configuration."
        )
    org_id, project_id, _repo_name = parse_repo_path(path)
    git_host = f"{protocol}://{host}" if protocol and host else host

    entry = get_login(git_host, project_id)
    if entry is None or entry.get("org_id") != org_id:
        raise CloudError(
            f"No stored Wren Cloud login for project {project_id} on "
            f"{git_host}. Run `wren cloud auth add` first."
        )

    token = mint_git_token(entry["api_host"], project_id, entry["api_key"])
    return format_credential_output("x-access-token", token.token)


def helper_failure_note(message: str) -> str:
    """Label a credential-helper failure with what produced it.

    git prints a helper's stderr in the middle of its own output and then
    fails with a credentials message of its own. Unlabelled, our line reads as
    if git produced it, and the user is left with no way to tell which of
    their tools is at fault — the same illegibility as the version-skew case
    `check_helper_command_serviceable` guards, arriving by a different route.

    So name the tool, the build, and the executable that actually ran. That
    last one is the load-bearing part: git resolves `wren` from PATH at
    invocation time, so the wren serving this request is not necessarily the
    one the user thinks they installed, and printing its path is what makes
    that visible at the only moment it matters.
    """
    import sys  # noqa: PLC0415

    from wren import __version__  # noqa: PLC0415

    ran_as = sys.argv[0] or sys.executable
    return (
        f"wren cloud git-credential (wrenai {__version__}, {ran_as}): "
        f"{message}\n"
        "This is the git credential helper that `wren cloud auth add` "
        "configured for this host. git will report a credential failure of "
        "its own next; the cause is the line above."
    )


def git_credential_store(input_data: dict[str, str]) -> None:  # noqa: ARG001
    """Handle git's `store` call: a deliberate no-op.

    We never cache the git token, so there is nothing to store. `store`
    means "that credential worked"; since we hand out a fresh token per
    operation, there is no cache entry for this to confirm.
    """
    return None


def git_credential_erase(input_data: dict[str, str]) -> None:  # noqa: ARG001
    """Handle git's `erase` call: drop a cached token, never the API key.

    `erase` means "that credential failed" (e.g. git received a 401/403 and
    is about to ask for a fresh one) — it is not "log out". We never cache
    a token, so this is also a no-op, but it is kept as an explicit,
    separate function so that if token caching is ever added, only this
    function needs to change, and the API key stays untouched regardless.
    """
    return None


# ── git subprocess plumbing ─────────────────────────────────────────────────


def run_git(
    args: list[str], *, cwd: Path | None = None, check: bool = True
) -> subprocess.CompletedProcess:
    """Shell out to the system `git` — never a Python git library.

    Keeps the CLI's git operations on the exact same path a user's own
    manual `git` commands take, so there is only one implementation of git
    behavior to keep correct.
    """
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise GitCommandError(
            f"git {' '.join(args)} failed:\n{(result.stderr or result.stdout).strip()}"
        )
    return result


# ── Nested-repository detection ─────────────────────────────────────────────


def find_git_root(path: Path) -> Path | None:
    """Walk up from `path` looking for a `.git` entry.

    Returns the first directory (possibly `path` itself) that has one, or
    `None` if none is found.
    """
    current = path.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def check_not_nested(target: Path) -> None:
    """Refuse when `target` sits inside a foreign git repository.

    A `.git` found AT `target` itself is fine — an already-tracked local
    project, or one `link` is about to create. A `.git` found in an
    ANCESTOR is the trap this exists for: continuing would push that
    repository's entire contents and history into the project's git
    repository. This is the most important error path in `link` — missed,
    it is silent data leakage, not a failure anyone would notice.
    """
    target = target.resolve()
    found = find_git_root(target)
    if found is not None and found != target:
        raise NestedRepoError(target, found)


# ── Reading the binding back out of a directory ─────────────────────────────
#
# The binding is the git remote and nothing else is stored (see the module
# docstring), so every question of the form "what is this directory bound
# to?" has to be answered by asking git, at the time it is asked. These are
# the inverse of the `remote_url` construction in `link`.


def current_remote_url(target: Path) -> str | None:
    """Return `target`'s `origin` URL, or `None` when it has no `origin`."""
    result = run_git(["remote", "get-url", "origin"], cwd=target, check=False)
    if result.returncode != 0:
        return None
    url = result.stdout.strip()
    return url or None


def binding_from_remote_url(url: str) -> tuple[str, str, str, str] | None:
    """Split a remote URL into `(git_host, org_id, project_id, repo_name)`.

    Returns `None` when the URL is not a Wren Cloud repo — a directory whose
    `origin` points at GitHub is bound to something, just not to us, and
    callers need to tell those two cases apart to say anything useful.

    Split at the `/git/` routing prefix rather than by URL structure, so
    this is a true inverse of the `f"{git_host}/git/{repo}"` that `link`
    writes — for whatever `git_host` was passed, including a scheme-less
    one. `git_host` therefore comes back as exactly the string `credentials`
    is keyed by, which is what makes a stored login findable from a
    directory.
    """
    marker = "/git/"
    index = url.rfind(marker)
    if index == -1:
        return None
    git_host = url[:index]
    if not git_host:
        return None
    try:
        org_id, project_id, repo_name = parse_repo_path(url[index + 1 :])
    except CloudError:
        return None
    return git_host, org_id, project_id, repo_name


def check_not_already_bound(target: Path) -> None:
    """Refuse a directory that is already bound to, or came from, a project.

    `create` is always making a *new* project, so any existing binding is
    wrong by construction. It has to be checked here rather than left to
    `link`, and specifically *before* the server is touched: `link` runs
    after the project and its key already exist, so a refusal there orphans
    them — which is exactly what happened before this guard existed.

    Two distinct states both mean "not a clean directory":

    - an `origin` remote — the binding itself;
    - a HEAD carrying a seeded hook commit — no `origin` (perhaps removed by
      hand), but the history still belongs to the project it came from, so
      `link` would later refuse to merge it anyway.
    """
    existing = current_remote_url(target)
    if existing is not None:
        bound = binding_from_remote_url(existing)
        where = f"project {bound[2]}" if bound else existing
        raise CloudError(
            f"{target} is already bound to {where}, so a new project cannot "
            "be created for it.\n"
            f"  origin: {existing}\n"
            "Run `wren cloud unlink` here first, or run `create` in a "
            "directory that is not bound to anything. Nothing has been "
            "created on the server."
        )
    if head_has_seeded_hooks(target):
        raise CloudError(
            f"{target} has no `origin`, but its history came from a Wren "
            "Cloud project — its commits carry the "
            "`.hooks/deploy-modeling.yaml` that project creation seeds.\n"
            "Creating a new project for it would produce a directory holding "
            "two projects' content. Use a clean directory, or remove this "
            "one's `.git` if you no longer need its history. Nothing has "
            "been created on the server."
        )


def _same_remote(a: str | None, b: str | None) -> bool:
    """Whether two remote URLs address the same repo.

    Only normalises a trailing slash. Anything cleverer (case, default
    ports, credentials in the URL) would risk calling two genuinely
    different projects equal, and the safe direction here is to refuse.
    """
    if a is None or b is None:
        return False
    return a.rstrip("/") == b.rstrip("/")


def head_has_seeded_hooks(target: Path) -> bool:
    """Whether `target`'s HEAD already carries a project's seeded hook file.

    Project creation seeds `.hooks/deploy-modeling.yaml`, so a local history
    containing it was acquired from *some* Wren Cloud project. A local
    project that has only ever existed on this machine does not have one.
    That is what makes this usable as "this directory already belongs to a
    project" without storing any per-directory state.
    """
    return (
        run_git(
            ["cat-file", "-e", "HEAD:.hooks/deploy-modeling.yaml"],
            cwd=target,
            check=False,
        ).returncode
        == 0
    )


# ── link: bind a directory to a cloud project, exactly once ─────────────────


class LinkOutcome(Enum):
    """What `link` actually did, for the CLI to report accurately."""

    LINKED = "linked"
    """A clone or a reconciling merge was performed."""

    ALREADY_LINKED = "already_linked"
    """`target` was already bound to this project and had nothing new to
    bring in. Still a success — the caller should point at `git pull` for
    updates instead of implying a merge just happened."""


def _default_branch(remote_url: str) -> str:
    """Best-effort discovery of the remote's default branch."""
    result = run_git(["ls-remote", "--symref", remote_url, "HEAD"], check=False)
    for line in result.stdout.splitlines():
        if line.startswith("ref:") and "HEAD" in line:
            ref = line.split()[1]
            if ref.startswith("refs/heads/"):
                return ref[len("refs/heads/") :]
    return "main"


def link(
    target: Path,
    *,
    git_host: str,
    api_host: str,  # noqa: ARG001 — kept for symmetry with login(); not needed here
    project_id: str,  # noqa: ARG001
    org_id: str,  # noqa: ARG001
    repo: str,
) -> LinkOutcome:
    """Bind `target` to `repo`, handling both shapes, and do the reconciling
    merge at most once.

    - Fresh directory: a plain `git clone`.
    - Existing local project (the main case): initialise in place — no
      files are moved — add the remote, fetch, and merge with
      `--allow-unrelated-histories`. Never `--force`, no exceptions.
    - Already-linked directory with nothing new to bring in: reported as
      `ALREADY_LINKED` rather than merged again — see the ancestor check
      below. This is a one-time bind, not the update path; `git pull` is.

    Refuses up front when `target` sits inside another git repository.

    Re-running this after a previous attempt died mid-way (e.g. inside
    `commit`, for lack of a git identity) still completes correctly — see
    the "is HEAD born?" check below — because that failure mode is
    indistinguishable from a fresh directory unless we ask git directly.
    """
    target = target.resolve()
    check_not_nested(target)

    remote_url = f"{git_host.rstrip('/')}/git/{repo}"

    is_repo_here = (target / ".git").exists()
    has_files = target.exists() and any(target.iterdir())

    if not is_repo_here and not has_files:
        target.parent.mkdir(parents=True, exist_ok=True)
        run_git(["clone", remote_url, str(target)])
        return LinkOutcome.LINKED

    if not is_repo_here:
        run_git(["init"], cwd=target)

    # Whether the existing files still need a local commit is decided by
    # asking git directly ("does HEAD resolve to a real commit?"), not by
    # whether `.git` exists. `.git` existing only tells us *some* previous
    # attempt got as far as `init` — if that attempt then failed inside
    # `commit` (e.g. missing git identity) and the caller retries, `.git`
    # is already there but HEAD is still unborn. Keying off `.git` alone
    # would skip straight to the remote merge below against that unborn
    # HEAD, silently turning the unrelated-history merge this command
    # exists to do safely into a trivial fast-forward instead.
    head_is_born = (
        run_git(
            ["rev-parse", "--verify", "-q", "HEAD"], cwd=target, check=False
        ).returncode
        == 0
    )
    if not head_is_born:
        # Give the existing files a local commit so the merge below has an
        # actual history to reconcile against — otherwise an unborn HEAD
        # would just fast-forward onto the remote instead of exercising the
        # unrelated-history path this command exists to handle safely.
        run_git(["add", "-A"], cwd=target)
        run_git(["commit", "-m", "Existing local project", "--allow-empty"], cwd=target)

    # An `origin` that already exists is NOT assumed to be the right one.
    # This function used to only ever *add* the remote, never check it, which
    # meant a directory bound to project A could be handed project B's repo
    # and silently stay on A — while the caller reported success for B. Via
    # `create` that also left B orphaned server-side: created, keyed, and
    # referenced by nothing.
    added_origin = False
    remotes = run_git(["remote"], cwd=target).stdout.split()
    if "origin" in remotes:
        existing = current_remote_url(target)
        if not _same_remote(existing, remote_url):
            bound = binding_from_remote_url(existing or "")
            bound_desc = (
                f"project {bound[2]}" if bound else f"{existing or 'an unknown remote'}"
            )
            raise CloudError(
                f"{target} already has an `origin` pointing at {bound_desc}, "
                f"so it cannot be bound to this one.\n"
                f"  origin:    {existing}\n"
                f"  requested: {remote_url}\n"
                "The git remote *is* the binding, so binding elsewhere means "
                "replacing it. Run `wren cloud unlink` here first if you meant "
                "to move this directory to another project — and note that "
                "switching projects wants a clean directory, because this "
                "directory's history belongs to the project it came from."
            )
    else:
        run_git(["remote", "add", "origin", remote_url], cwd=target)
        added_origin = True

    run_git(["fetch", "origin"], cwd=target)

    branch = _default_branch(remote_url)

    # If `origin/<branch>` is already an ancestor of HEAD, merging it would
    # add nothing: either a previous `link` already did the reconciling
    # merge (HEAD contains it from there), or this directory was a plain
    # clone to begin with. Either way there is nothing to reconcile, and
    # re-merging would misrepresent a no-op as a fresh bind. This is the
    # one case `link` treats as "already done" rather than "do it again" —
    # the merge below still happens exactly once.
    already_linked = (
        run_git(
            ["merge-base", "--is-ancestor", f"origin/{branch}", "HEAD"],
            cwd=target,
            check=False,
        ).returncode
        == 0
    )
    if already_linked:
        # Nothing to merge — but "already linked" must not mean "already
        # working". The reachable case is a user who hit a conflict on the
        # merge below, resolved it and committed as that error tells them
        # to: `origin/<branch>` is then an ancestor of HEAD, yet upstream
        # was never set, because the merge returned non-zero and this
        # function raised before reaching `_set_upstream`. Reporting
        # already-linked and pointing at `git pull` while `git pull` itself
        # cannot run is the failure this whole design keeps trying to avoid.
        #
        # Only when absent: a user who deliberately points the branch
        # somewhere else keeps their choice. No merge happens here either
        # way, so this stays a bind, not the update path.
        if not _has_upstream(target):
            _set_upstream(target, branch)
        return LinkOutcome.ALREADY_LINKED

    # Merging a *different* project's history into this one would combine two
    # projects' content, and the next `git push` would publish the result.
    # Refuse rather than offering a flag: no directory wants two projects at
    # once, and the damage only becomes visible once it is published.
    #
    # "Not an ancestor" (above) is NOT sufficient to detect that: it is also
    # false when the local clone is merely behind, or has diverged from, the
    # *same* project's remote — which is the ordinary re-bind-after-unlink
    # case and must keep working. Ask git whether the histories share any
    # ancestor at all; `merge-base` without `--is-ancestor` fails exactly
    # when they do not.
    unrelated = (
        run_git(
            ["merge-base", f"origin/{branch}", "HEAD"], cwd=target, check=False
        ).returncode
        != 0
    )
    if unrelated and head_has_seeded_hooks(target):
        if added_origin:
            # Leave nothing behind: this refusal must not strand the target
            # pointing at a project it was never bound to.
            run_git(["remote", "remove", "origin"], cwd=target, check=False)
        raise CloudError(
            f"{target} already contains a Wren Cloud project's history — its "
            "commits carry the `.hooks/deploy-modeling.yaml` that project "
            "creation seeds — and it shares no history with the project you "
            "are binding it to, so this would merge one project's content "
            "into the other.\n"
            "Bind a clean directory instead: either clone into a new one, or "
            "remove this directory's `.git` if you no longer need its history. "
            "Re-binding to the *same* project is fine, including when your "
            "copy is behind — that does not reach this point."
        )

    merge = run_git(
        [
            "merge",
            "--allow-unrelated-histories",
            f"origin/{branch}",
            "-m",
            "Merge Wren Cloud project history",
        ],
        cwd=target,
        check=False,
    )
    if merge.returncode != 0:
        detail = (merge.stderr or merge.stdout).strip()
        raise CloudError(
            "The remote already has content the server created when the "
            "project was made, and merging it with your local files hit a "
            "conflict git could not resolve automatically.\n"
            "This is a normal git merge conflict, not a Wren Cloud error: "
            "resolve the conflict markers in the affected files, then "
            "`git add` and `git commit` as usual. Do not pass `--force` on "
            "the eventual push — that would delete content the server "
            "created for this project.\n\n"
            f"{detail}"
        )

    _set_upstream(target, branch)
    return LinkOutcome.LINKED


def _has_upstream(target: Path) -> bool:
    return (
        run_git(
            ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
            cwd=target,
            check=False,
        ).returncode
        == 0
    )


def _set_upstream(target: Path, branch: str) -> None:
    """Make the current branch track `origin/<branch>`.

    A plain `git clone` leaves the local branch tracking its remote
    automatically; `git init` + `merge` does not. Without this, the first
    `git push` after adopting an existing directory fails with "no upstream
    branch" even though the merge itself succeeded.
    """
    current_branch = run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=target
    ).stdout.strip()
    run_git(
        ["branch", f"--set-upstream-to=origin/{branch}", current_branch],
        cwd=target,
        check=False,
    )


# ── unlink / logout: undoing what link and login did ───────────────────────


@dataclass
class UnlinkOutcome:
    """What `unlink` actually removed, for the CLI to report accurately."""

    remote_url: str
    """The `origin` that was removed."""

    git_host: str | None
    """`None` when `origin` was not a Wren Cloud URL."""

    project_id: str | None
    """`None` when `origin` was not a Wren Cloud URL."""

    key_forgotten: bool
    """Whether a stored login was dropped (only ever with `forget_key`)."""

    helper_removed: bool
    """Whether this host's credential-helper section was removed with it."""


def unlink(target: Path, *, forget_key: bool = False) -> UnlinkOutcome:
    """Unbind `target` from its project by removing its `origin`.

    The binding is the git remote, so removing it *is* the unbind — there is
    no server call to make (the server never knew about the binding) and
    nothing else to undo for the directory itself.

    `forget_key` additionally drops the stored login for that project, and
    only then, only if no other stored login still uses the same git host,
    removes that host's credential-helper section. That ordering is the
    point: the helper entry is host-scoped, so removing it while another
    project on the same host is still bound would break authentication for
    that project too.
    """
    target = target.resolve()

    remote_url = current_remote_url(target)
    if remote_url is None:
        raise CloudError(
            f"{target} is not bound to a Wren Cloud project — it has no "
            "`origin` remote. Nothing to unlink."
        )

    bound = binding_from_remote_url(remote_url)
    git_host = bound[0] if bound else None
    project_id = bound[2] if bound else None

    run_git(["remote", "remove", "origin"], cwd=target)

    key_forgotten = False
    helper_removed = False
    if forget_key and git_host is not None and project_id is not None:
        key_forgotten = remove_login(git_host, project_id)
        if not any(host == git_host for host, _pid, _entry in list_logins()):
            remove_git_credential_helper(git_host)
            helper_removed = True

    return UnlinkOutcome(
        remote_url=remote_url,
        git_host=git_host,
        project_id=project_id,
        key_forgotten=key_forgotten,
        helper_removed=helper_removed,
    )


def logout(git_host: str, project_id: str) -> tuple[bool, bool]:
    """Drop a stored login. Returns `(login_removed, helper_removed)`.

    Touches no directory: a bound working tree keeps its remote and simply
    stops being able to authenticate, which is the honest outcome of
    discarding the key it was authenticating with.

    This is deliberately not built on `git_credential_erase`. That function
    drops only a cached token and leaves the API key alone on purpose —
    `erase` means "that credential failed", not "log out" — and a test
    pins that behaviour.

    Removes the host's credential-helper section only once this was its last
    stored login, for the same host-scoping reason as `unlink`.
    """
    login_removed = remove_login(git_host, project_id)
    helper_removed = False
    if not any(host == git_host for host, _pid, _entry in list_logins()):
        remove_git_credential_helper(git_host)
        helper_removed = True
    return login_removed, helper_removed


# ── create: make a new project and bind it, in one step ─────────────────────
#
# `create` is the other half of `link`: both bind a directory to a cloud
# project, differing only in whether the project has to be made first. It
# ends in exactly the state `login` + `link` leave behind, by calling them —
# not by reimplementing what they do.
#
# The org API key (`osk-...`) this needs is org-wide authority, valid for
# every project in the org, not just the one being created here. It is used
# for exactly two calls below — creating the project and minting that
# project's own key — and is never written to disk. Only the project key
# (`sk-...`) that comes back from the mint is stored, exactly as `login`
# would store it.


@dataclass
class CreatedProject:
    id: str
    org_id: str
    display_name: str
    status: str
    """`"succeeded"` or `"partial"` — the server's own project-creation
    status. `"partial"` means the project (and, for AGENTIC projects, its
    git repository) exists, but something about it — most often the data
    connection or the initial MDL deploy — did not finish successfully. See
    `errors` for what failed."""
    errors: list[dict]
    """`[{"resource": ..., "message": ...}, ...]` — populated only when
    `status == "partial"`."""


def create_project(
    api_host: str,
    org_key: str,
    *,
    org_id: str,
    display_name: str,
    connection_type: str | None = None,
    connection_info: dict | None = None,
    test_connection: bool = False,
    mdl: dict | None = None,
    language: str | None = None,
    timezone: str | None = None,
    timeout: float = 60.0,
) -> CreatedProject:
    """Create a new Wren Cloud project, requesting agent mode.

    Always sends `projectType: "AGENTIC"` — `create` exists specifically to
    produce agent-mode projects; a CLASSIC project has no git-backed
    repository at all, so there would be nothing for the caller to bind a
    directory to. The response never echoes back which project type the
    server actually granted, so this alone does not confirm the opt-in was
    honored — that is confirmed later, the same way `login` confirms
    anything about a project: by successfully minting a git token for it.

    The connection (`connection_type` / `connection_info`) is supplied here,
    at creation time, in the same request — not via a separate
    connection-update call afterward.

    `org_key` authenticates this call; the server accepts only an org key
    here, not a project key, because no project exists yet to scope one to.
    """
    import requests  # noqa: PLC0415

    url = f"{api_host.rstrip('/')}{_PROJECTS_PATH}"
    headers = {"Authorization": f"Bearer {org_key}"}
    body: dict = {
        "orgId": int(org_id),
        "displayName": display_name,
        "projectType": "AGENTIC",
    }
    if connection_type is not None:
        body["type"] = connection_type
    if connection_info is not None:
        body["connectionInfo"] = connection_info
    if test_connection:
        body["testConnection"] = True
    if mdl is not None:
        body["mdl"] = mdl
    if language is not None:
        body["language"] = language
    if timezone is not None:
        body["timezone"] = timezone

    try:
        resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise CloudError(f"Could not reach {api_host}: {exc}") from exc

    if resp.status_code not in (201, 207):
        if resp.status_code in (401, 403):
            # Deliberately does not claim the key was a project key. The CLI
            # already refuses a non-`osk-` key before this call, so that is
            # not a reachable cause here — and since the key may have come
            # from storage rather than from something just typed, guessing
            # wrongly sends the user looking for a key they already have.
            raise InvalidApiKeyError(
                f"This key was rejected creating a project in org "
                f"{org_id} on {api_host}.\n"
                "Creating a project needs an organization key. This one may "
                "not be one, or may be revoked, or belong to a different "
                "organization or host. Pass `--org-key` to use a different "
                "one."
            )
        raise CloudError(
            f"Wren Cloud API returned {resp.status_code} creating a project "
            f"on {api_host}: {resp.text[:300]}"
        )

    data = resp.json()
    project = data.get("project") or {}
    project_id = project.get("id")
    if project_id is None:
        raise CloudError(
            "Wren Cloud API accepted the project-creation request on "
            f"{api_host} but did not return a project id: {resp.text[:300]}"
        )
    return CreatedProject(
        id=str(project_id),
        org_id=str(org_id),
        display_name=project.get("displayName", display_name),
        status=data.get("status", "succeeded"),
        errors=list(data.get("errors") or []),
    )


def default_key_name() -> str:
    """Name a minted key with the date it was minted.

    Every key this command mints lands in a list the user manages by hand,
    and the server stamps them all with the same origin, so a bare constant
    would render that list a row of identical entries. The date is the one
    fact carried here: it is enough to correlate a row with something the
    user remembers doing, and it sends nothing about the machine.

    Deliberately *not* the host name: that would distinguish same-day mints
    from different machines, but it would also put the machine's name into
    the account's key list, and that trade was declined.
    """
    return f"wren-cli {time.strftime('%Y-%m-%d')}"


def mint_project_key(
    api_host: str,
    project_id: str,
    org_key: str,
    *,
    name: str | None = None,
    timeout: float = 15.0,
) -> str:
    """Mint a durable project API key (`sk-...`) for `project_id`.

    Authenticates with the org key, used here for the only other thing it is
    needed for: authorizing the mint of the project's own key. The server
    reveals the secret only in this response, never again — the caller must
    capture it now.
    """
    import requests  # noqa: PLC0415

    url = (
        f"{api_host.rstrip('/')}{_PROJECT_KEYS_PATH_TMPL.format(project_id=project_id)}"
    )
    headers = {"Authorization": f"Bearer {org_key}"}
    try:
        resp = requests.post(
            url,
            json={"name": name or default_key_name()},
            headers=headers,
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise CloudError(f"Could not reach {api_host}: {exc}") from exc

    if resp.status_code not in (200, 201):
        if resp.status_code in (401, 403):
            raise InvalidApiKeyError(
                "This org key was rejected minting a project key for "
                f"project {project_id} on {api_host}."
            )
        raise CloudError(
            f"Wren Cloud API returned {resp.status_code} minting a project "
            f"key for project {project_id} on {api_host}: {resp.text[:300]}"
        )

    secret = resp.json().get("secret")
    if not secret:
        raise CloudError(
            "Wren Cloud API did not return a key secret for project "
            f"{project_id} on {api_host}: {resp.text[:300]}"
        )
    return secret


def create(
    target: Path,
    *,
    host: str,
    org_id: str,
    org_key: str,
    display_name: str,
    git_host: str | None = None,
    connection_type: str | None = None,
    connection_info: dict | None = None,
    test_connection: bool = False,
    mdl: dict | None = None,
    language: str | None = None,
    timezone: str | None = None,
) -> tuple[CreatedProject, LinkOutcome]:
    """Create a new agent-mode project on `host` and bind `target` to it.

    Checks `target` is not nested inside a foreign git repository, that the
    git credential helper is serviceable, and that `target` is not already
    bound to (or carrying the history of) another project — all *before*
    creating anything server-side, so a refusal here (unlike a refusal
    partway through) never leaves an orphaned project behind. The helper
    check is repeated inside `login` below, which is where it belongs for a
    bare `login`; running it up front too is what keeps this command's
    failure free of side effects, since by the time `login` runs, a project
    and a key already exist.

    `check_not_already_bound` is here for exactly that reason and not left
    to `link`. `link` runs last, after the project and its key exist, so the
    same refusal raised from there produced a real project that nothing
    referenced — which is the defect this guard closes.

    Ends in exactly the state `login` + `link` leave a directory in: a
    stored project key, a configured git credential helper, and a bound
    working tree with upstream tracking set — because this calls `login`
    and `link` to get there, rather than reimplementing either.

    If the server did not actually grant the AGENTIC opt-in requested above
    (so the project has no git repository at all), that surfaces right here
    as a clear, specific error — not as a bare 404 — while `target` is left
    untouched: `check_not_nested` already ran, but git has not been touched
    yet. The freshly minted project key is included in the error so the
    project is not orphaned key-less; recover with `wren cloud auth add` using
    that key once the AGENTIC opt-in issue is resolved (e.g. by deleting the
    project and re-running `create`).

    If the project is created and confirmed AGENTIC but the local `link`
    step then fails (e.g. a merge conflict), the same recovery applies:
    `wren cloud auth add` followed by `wren cloud link` completes the bind by
    hand — nothing about the project itself needs to be redone.
    """
    target = target.resolve()
    check_not_nested(target)
    check_helper_command_serviceable()
    check_not_already_bound(target)

    api_host = host.rstrip("/")
    resolved_git_host = (git_host or host).rstrip("/")

    project = create_project(
        api_host,
        org_key,
        org_id=org_id,
        display_name=display_name,
        connection_type=connection_type,
        connection_info=connection_info,
        test_connection=test_connection,
        mdl=mdl,
        language=language,
        timezone=timezone,
    )

    project_key = mint_project_key(api_host, project.id, org_key)

    def _recovery_hint() -> str:
        hint = f"  wren cloud auth add --host {host} --project {project.id}"
        if git_host:
            hint += f" --git-host {git_host}"
        return (
            f"The project's key is: {project_key}\n"
            "Recover with:\n"
            f"{hint}\n"
            "then `wren cloud link` in this directory."
        )

    try:
        token = login(
            host=host,
            project_id=project.id,
            api_key=project_key,
            git_host=git_host,
        )
    except CloudError as exc:
        if isinstance(exc, CloudApiError) and exc.code == "PROJECT_NOT_AGENTIC":
            raise CloudError(
                f"Project {project.id} was created on {api_host}, but it is "
                "not an agent-mode (AGENTIC) project — `wren cloud create` "
                "only produces agent-mode projects, which are the only kind "
                "that get a git repository at all. There is nothing to bind "
                "to; this project has no git remote.\n"
                f"{_recovery_hint()}\n"
                "(`wren cloud link` cannot help here either, until the "
                "project is actually AGENTIC — delete this project and "
                "retry `create`, or ask your org admin about the AGENTIC "
                "opt-in.)"
            ) from exc
        raise CloudError(
            f"Project {project.id} was created on {api_host}, but binding "
            f"this directory to it failed: {exc}\n{_recovery_hint()}"
        ) from exc

    outcome = link(
        target,
        git_host=resolved_git_host,
        api_host=api_host,
        project_id=project.id,
        org_id=project.org_id,
        repo=token.repo,
    )
    return project, outcome
