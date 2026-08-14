"""`wren cloud` — connect a local directory to a Wren Cloud project's git remote.

Two credentials, two lifetimes:

- The **project API key** is the durable credential. It is prompted for once
  by ``login``, stored locally (0600, keyed by git host + project id), and
  never leaves this machine except in the ``Authorization`` header of the
  git-token request below.
- The **git token** is a short-TTL JWT minted from the API key on every git
  operation by the credential helper (``get``). It is never written to disk
  and never reused across operations — each ``get`` call mints a fresh one,
  which is also what makes an expired token a non-event: nothing on this
  machine ever holds one long enough to present it after it has expired.

``login`` writes a URL-scoped credential helper entry (plus ``useHttpPath``)
into the user's *global* git config, not local config — at login time there
is no clone yet, so there is no local config to write into. Because the
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
import subprocess
import tempfile
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

_WREN_HOME = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))
_CLOUD_FILE = _WREN_HOME / "cloud.yml"

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
            f"Fix or remove {_CLOUD_FILE} and run `wren cloud login` again."
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

    Our helper value (2) must be `!`-prefixed: git only runs a helper string
    through a shell (and appends the `get`/`store`/`erase` argument
    correctly) when it starts with `!`. A bare multi-word value like
    `wren cloud git-credential` would instead have `git-credential-`
    prepended to just its first word, which is not what we want.

    Re-running this (e.g. a second `wren cloud login`) stays idempotent:
    `--replace-all` first collapses the `helper` key back down to the single
    empty value before `--add` appends our helper again, so the section
    never accumulates duplicate entries across repeated logins.
    """
    section = f"credential.{git_host}"
    _git_config_set_global(f"{section}.helper", "")
    _git_config_add_global(f"{section}.helper", "!wren cloud git-credential")
    _git_config_set_global(f"{section}.useHttpPath", "true")


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
    """
    api_host = host.rstrip("/")
    resolved_git_host = (git_host or host).rstrip("/")

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
            "host? Run `wren cloud login` again to fix the git configuration."
        )
    org_id, project_id, _repo_name = parse_repo_path(path)
    git_host = f"{protocol}://{host}" if protocol and host else host

    entry = get_login(git_host, project_id)
    if entry is None or entry.get("org_id") != org_id:
        raise CloudError(
            f"No stored Wren Cloud login for project {project_id} on "
            f"{git_host}. Run `wren cloud login` first."
        )

    token = mint_git_token(entry["api_host"], project_id, entry["api_key"])
    return format_credential_output("x-access-token", token.token)


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

    remotes = run_git(["remote"], cwd=target).stdout.split()
    if "origin" not in remotes:
        run_git(["remote", "add", "origin", remote_url], cwd=target)

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
        return LinkOutcome.ALREADY_LINKED

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

    # A plain `git clone` leaves the local branch tracking its remote
    # automatically; `git init` + `merge` does not. Without this, the
    # first `git push` after adopting an existing directory fails with
    # "no upstream branch" even though the merge itself succeeded.
    current_branch = run_git(
        ["rev-parse", "--abbrev-ref", "HEAD"], cwd=target
    ).stdout.strip()
    run_git(
        ["branch", f"--set-upstream-to=origin/{branch}", current_branch],
        cwd=target,
        check=False,
    )
    return LinkOutcome.LINKED


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
            raise InvalidApiKeyError(
                f"This org key was rejected creating a project on {api_host}. "
                "`wren cloud create` needs an org API key (starts with "
                "`osk-`), not a project key."
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

    Checks `target` is not nested inside a foreign git repository *before*
    creating anything server-side, so a refusal here (unlike a refusal
    partway through) never leaves an orphaned project behind.

    Ends in exactly the state `login` + `link` leave a directory in: a
    stored project key, a configured git credential helper, and a bound
    working tree with upstream tracking set — because this calls `login`
    and `link` to get there, rather than reimplementing either.

    If the server did not actually grant the AGENTIC opt-in requested above
    (so the project has no git repository at all), that surfaces right here
    as a clear, specific error — not as a bare 404 — while `target` is left
    untouched: `check_not_nested` already ran, but git has not been touched
    yet. The freshly minted project key is included in the error so the
    project is not orphaned key-less; recover with `wren cloud login` using
    that key once the AGENTIC opt-in issue is resolved (e.g. by deleting the
    project and re-running `create`).

    If the project is created and confirmed AGENTIC but the local `link`
    step then fails (e.g. a merge conflict), the same recovery applies:
    `wren cloud login` followed by `wren cloud link` completes the bind by
    hand — nothing about the project itself needs to be redone.
    """
    target = target.resolve()
    check_not_nested(target)

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
        hint = f"  wren cloud login --host {host} --project {project.id}"
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
