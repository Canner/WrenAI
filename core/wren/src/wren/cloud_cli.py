"""Typer sub-app for ``wren cloud`` commands.

``wren cloud auth add`` stores a project's API key and configures git to
authenticate with it — it touches no directory. ``wren cloud link`` then
binds (or adopts) that project's files into a local directory via plain git,
once. After that, ordinary ``git push`` / ``git pull`` / ``git diff`` are the
commands — none of the security depends on going through this CLI again, and
``git pull`` (not a repeated ``link``) is how you get updates.
``wren cloud git-credential`` is the helper ``auth add`` wires into git; it
is not meant to be invoked by hand.

The two are separate because authentication and binding have different
scopes: a credential covers a project on a host, while a binding covers one
directory. That is what makes ``auth add`` on its own useful — configure
authentication, then drive ``git clone`` yourself, in CI or with whatever
flags you want, with no ``wren`` command in the git path.

``wren cloud unlink`` and ``wren cloud auth remove`` undo those two, and the
asymmetry between them follows from where the state lives:

- **The binding is the git remote.** Nothing on this machine records which
  project a directory belongs to; the credential helper reads it back out of
  the path git hands it. So ``unlink`` removes ``origin`` and that is the
  entire unbind — no server call, and the project is untouched.
- **The API key is per host + project**, so ``auth remove`` drops one and touches
  no directory. ``unlink`` leaves it alone by default, because another
  directory may still be bound to the same project.
- **The git credential-helper entry is per host**, shared by every project
  on it. Both commands remove it only once no stored login uses that host.

To move a directory to a *different* project, unbind it and bind a clean
directory. A directory's history belongs to the project it was acquired
from, and ``link`` refuses to merge one project's history into another
rather than silently combining two projects' content.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

# The managed SaaS deployment, used as the default wherever `--host` names the
# *target* of a command. Commands where `--host` instead selects among stored
# credentials (``link``, ``auth remove``) deliberately have no default:
# defaulting a filter would hide a credential the user does have.
DEFAULT_HOST = "https://cloud.getwren.ai"


def _shown(directory: Path) -> Path:
    """Render a directory for a message, never as a bare dot.

    Every one of these commands defaults its directory argument to ``.``, and
    every message that names it ends in a full stop — so the default renders
    as ``into ..``, which reads as the *parent* directory. Resolving gives an
    unambiguous absolute path. Display only: the commands themselves keep
    using the path as given.
    """
    try:
        return directory.resolve()
    except OSError:
        # A path that cannot be resolved is still worth naming; the operation
        # that follows will report the real problem.
        return directory


cloud_app = typer.Typer(
    name="cloud",
    help="Connect a local project to Wren Cloud's git remote.",
)

auth_app = typer.Typer(
    name="auth",
    help="Manage the stored credentials git authenticates to Wren Cloud with.",
)
cloud_app.add_typer(auth_app)

git_credential_app = typer.Typer(
    name="git-credential",
    help="Git credential helper invoked by git itself — not for direct use.",
)
cloud_app.add_typer(git_credential_app)


@auth_app.command("add")
def auth_add(
    project: Annotated[str, typer.Option("--project", help="Project id")],
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help=(
                "Wren Cloud host. Defaults to the managed service; pass a "
                "hostname or a full URL for a self-hosted one. https is "
                "assumed when no scheme is given."
            ),
        ),
    ] = DEFAULT_HOST,
    git_host: Annotated[
        Optional[str],
        typer.Option(
            "--git-host",
            help=(
                "Host git should talk to for this project's repo, if it "
                "differs from --host (e.g. a local setup with no unified "
                "ingress in front of the API and the git server). Defaults "
                "to --host."
            ),
        ),
    ] = None,
) -> None:
    """Store a project API key and configure git to use it automatically.

    Prompts for the API key interactively — never pass it as a command-line
    argument, since that leaves it recoverable from shell history.

    Validates the key against the project, stores it under ``~/.wren/``,
    and writes a git credential helper entry scoped to the git host so that
    ``git clone`` / ``git push`` / ``git pull`` against this project's
    remote just work, with no token ever appearing in the remote URL.

    That helper entry names ``wren``, which git resolves from PATH every time
    it authenticates. So this refuses up front — before validating the key or
    writing anything — when the ``wren`` on PATH cannot serve
    ``wren cloud git-credential``: configuring it anyway would break every
    git operation against the host, with an error from git that names neither
    wren nor a version.
    """
    from wren import cloud  # noqa: PLC0415

    host = cloud.normalize_host(host)
    # Same treatment as --host, and for a sharper reason: this value
    # becomes the git-config section name AND the helper's lookup key. A
    # scheme-less value writes a section git never matches while the
    # helper looks under the scheme-ful form, so both halves silently
    # miss and the command still reports success.
    if git_host is not None:
        git_host = cloud.normalize_host(git_host)
    # Naming the host in the prompt is the one place a defaulted `--host`
    # becomes visible before anything happens — worth it now that omitting the
    # flag targets the managed service rather than erroring.
    api_key = typer.prompt(f"Wren Cloud API key for {host}", hide_input=True)
    if not api_key.strip():
        typer.echo("Error: an API key is required.", err=True)
        raise typer.Exit(1)

    try:
        token = cloud.login(
            host=host, project_id=project, api_key=api_key.strip(), git_host=git_host
        )
    except cloud.CloudError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)

    typer.echo(f"Added credentials for project {project} on {host}.")
    typer.echo(f"Remote repo: {token.repo}")
    typer.echo(
        "git is now configured to authenticate to this project automatically. "
        "Run `wren cloud link` to bind it, or `git clone` the remote directly."
    )


@cloud_app.command()
def link(
    directory: Annotated[
        Path,
        typer.Argument(help="Local directory to bind the project into."),
    ] = Path("."),
    host: Annotated[
        Optional[str],
        typer.Option(
            "--host",
            help=(
                "Wren Cloud host the credential was added for, if you added "
                "credentials for more than one host. Defaults to the only "
                "stored one, or the one matching --project."
            ),
        ),
    ] = None,
    project: Annotated[
        Optional[str],
        typer.Option(
            "--project",
            help="Project id, if you have logins for more than one project.",
        ),
    ] = None,
) -> None:
    """Bind a local directory to a Wren Cloud project's git remote, once.

    This is a one-time bind, not the update command — once linked, use
    ``git pull`` to fetch further changes.

    Into a fresh, empty directory this is a plain clone. Into a directory
    that already contains project files, it initializes git in place,
    fetches the remote, and merges histories — your files stay where they
    are, and any real overlap surfaces as an ordinary git conflict for you
    to resolve. Never force-pushes or force-overwrites.

    Refuses if ``directory`` sits inside another git repository, to avoid
    pushing that repository's own files into the project's remote.

    Refuses, too, when ``directory`` is already bound somewhere else — an
    existing ``origin`` pointing at a different project, or a history that
    came from one. The remote is the binding, so it is never silently
    repointed, and merging a different project's history in would combine
    two projects' content and publish the result on the next push. Run
    ``wren cloud unlink`` and bind a clean directory instead.

    Safe to re-run if a previous attempt failed partway through — that
    recovers cleanly. If the directory is already fully linked, re-running
    reports that and does not merge again; use ``git pull`` for updates
    instead.

    Requires having run ``wren cloud auth add`` for the target project first.
    """
    from wren import cloud  # noqa: PLC0415

    logins = cloud.list_logins()
    if project is not None:
        logins = [entry for entry in logins if entry[1] == str(project)]
    if host is not None:
        # Filtered on the same field the help text promises and the
        # disambiguation candidates below print: `api_host` — the host the
        # user passed to `auth add --host`, not the (possibly different)
        # `--git-host`. Filtering on `git_host` here while displaying
        # `api_host` would silently reject the exact value a user would
        # naturally reach for: the host they logged in with.
        logins = [entry for entry in logins if entry[2]["api_host"] == host]

    if not logins:
        typer.echo(
            "Error: no stored Wren Cloud login found"
            + (f" for project {project}" if project else "")
            + ". Run `wren cloud auth add` first.",
            err=True,
        )
        raise typer.Exit(1)
    if len(logins) > 1:
        typer.echo(
            "Error: more than one stored login matches; disambiguate with "
            "--host and/or --project. Candidates:",
            err=True,
        )
        for git_host, project_id, entry in logins:
            typer.echo(f"  --host {entry['api_host']} --project {project_id}", err=True)
        raise typer.Exit(1)

    git_host, project_id, entry = logins[0]
    try:
        outcome = cloud.link(
            directory,
            git_host=git_host,
            api_host=entry["api_host"],
            project_id=project_id,
            org_id=entry["org_id"],
            # May have been stored before the repo path was known (see
            # `store_key_pending_repo`); this fills it in on first use.
            repo=cloud.resolve_repo(git_host, project_id, entry),
        )
    except cloud.CloudError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)

    if outcome is cloud.LinkOutcome.ALREADY_LINKED:
        typer.echo(
            f"{_shown(directory)} is already linked to project {project_id}. "
            "Run `git pull` to fetch updates."
        )
    else:
        typer.echo(f"Linked project {project_id} into {_shown(directory)}.")


@cloud_app.command()
def create(  # noqa: PLR0913
    org: Annotated[
        str,
        typer.Option("--org", help="Organization id the new project belongs to."),
    ],
    host: Annotated[
        str,
        typer.Option(
            "--host",
            help=(
                "Wren Cloud host. Defaults to the managed service; pass a "
                "hostname or a full URL for a self-hosted one. https is "
                "assumed when no scheme is given."
            ),
        ),
    ] = DEFAULT_HOST,
    directory: Annotated[
        Path,
        typer.Argument(help="Local directory to create the project into."),
    ] = Path("."),
    display_name: Annotated[
        Optional[str],
        typer.Option(
            "--display-name",
            help="Project display name. Defaults to the directory's name.",
        ),
    ] = None,
    git_host: Annotated[
        Optional[str],
        typer.Option(
            "--git-host",
            help=(
                "Host git should talk to for this project's repo, if it "
                "differs from --host. See `wren cloud auth add --help` for "
                "when to pass this; defaults to --host."
            ),
        ),
    ] = None,
    type_: Annotated[
        Optional[str],
        typer.Option(
            "--type",
            help=(
                "Data source type for the connection, e.g. BIG_QUERY, "
                "POSTGRES, SNOWFLAKE. Case-insensitive."
            ),
        ),
    ] = None,
    connection_info: Annotated[
        Optional[str],
        typer.Option(
            "--connection-info",
            help='Connection info as a JSON object, e.g. \'{"host": "..."}\'.',
        ),
    ] = None,
    connection_info_file: Annotated[
        Optional[Path],
        typer.Option(
            "--connection-info-file",
            help="Path to a JSON file with the connection info.",
        ),
    ] = None,
    test_connection: Annotated[
        bool,
        typer.Option(
            "--test-connection",
            help="Ask the server to test the connection before creating the project.",
        ),
    ] = False,
    language: Annotated[Optional[str], typer.Option("--language")] = None,
    timezone: Annotated[Optional[str], typer.Option("--timezone")] = None,
    org_key: Annotated[
        Optional[str],
        typer.Option(
            "--org-key",
            help=(
                "Organization API key (starts with `osk-`). Also read from "
                "the WREN_CLOUD_ORG_KEY environment variable if not passed "
                "here; otherwise prompted for interactively. Prefer the "
                "environment variable or the prompt over this flag — a "
                "command-line argument is recoverable from shell history."
            ),
        ),
    ] = None,
) -> None:
    """Create a new agent-mode Wren Cloud project and bind `directory` to it.

    This is the other half of `wren cloud link`: both bind a directory to a
    project, differing only in whether the project has to be made first.
    Ends in exactly the state `login` + `link` leave a directory in — a
    plain `git push` works afterward, no further `wren` command needed.

    Requires an organization API key (`osk-...`), which is org-wide
    authority valid for every project in the org — unlike a project key, it
    is never written to disk. It is used only to create the project and to
    mint that project's own key; from then on this command (and everything
    after it) uses the project key, exactly like `wren cloud auth add` would.

    Always requests agent mode for the new project — a project created any
    other way has no git repository at all, so there would be nothing here
    to bind a directory to. If the server did not actually grant that, this
    fails with a specific error rather than a bare HTTP error, and reports
    how to recover the project's key.

    `--type` and a connection info are both required. The command connects
    the data source as it creates the project, because a project without one
    is reported by Wren Cloud as still needing setup and nothing here can
    attach one afterwards — the only routes are a REST call or the web UI.

    Refuses up front — before creating anything on the server — if either of
    those is missing, if `directory` is not a Wren project or its YAML does
    not compile, if `directory` sits inside another git repository (the same
    check `link` uses), if the `wren` on PATH cannot serve the git credential
    helper (the same check `login` uses), or if `directory` is already bound
    to a project or holds a history acquired from one.

    That last check has to happen here, not just inside the bind step: a new
    project and its key are created before any git work begins, so a refusal
    discovered later would leave them behind referenced by nothing. Every
    refusal above happens with the server untouched.
    """
    from wren import cloud  # noqa: PLC0415

    host = cloud.normalize_host(host)
    # Same treatment as --host, and for a sharper reason: this value
    # becomes the git-config section name AND the helper's lookup key. A
    # scheme-less value writes a section git never matches while the
    # helper looks under the scheme-ful form, so both halves silently
    # miss and the command still reports success.
    if git_host is not None:
        git_host = cloud.normalize_host(git_host)

    if connection_info and connection_info_file:
        typer.echo(
            "Error: pass at most one of --connection-info / --connection-info-file.",
            err=True,
        )
        raise typer.Exit(1)

    def _read_json_option(raw: str, *, source: str) -> dict:
        import json  # noqa: PLC0415

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            typer.echo(f"Error: {source} is not valid JSON: {exc}", err=True)
            raise typer.Exit(1) from exc
        if not isinstance(parsed, dict):
            typer.echo(f"Error: {source} must be a JSON object.", err=True)
            raise typer.Exit(1)
        return parsed

    parsed_connection_info: Optional[dict] = None
    if connection_info_file is not None:
        try:
            raw = connection_info_file.read_text(encoding="utf-8")
        except OSError as exc:
            typer.echo(f"Error: could not read {connection_info_file}: {exc}", err=True)
            raise typer.Exit(1) from exc
        parsed_connection_info = _read_json_option(raw, source="--connection-info-file")
    elif connection_info is not None:
        parsed_connection_info = _read_json_option(
            connection_info, source="--connection-info"
        )

    # The server matches the type against its enum by exact key lookup, and
    # `POST /api/v1/projects` does not validate it up front: an unrecognized
    # value strips the connection info to `{}` and surfaces as a 207 with a
    # project that exists but has no data source. Case is the one part of that
    # a client can fix without mirroring the server's enum here, and `big_query`
    # for `BIG_QUERY` is the mistake it actually costs people.
    if type_ is not None:
        type_ = type_.strip().upper()

    # Both are required, not merely consistent with each other. A project with
    # no data source is reported by Wren Cloud as still needing setup, and
    # nothing in this CLI can finish it: the only way to attach a connection
    # afterwards is a REST call or the web UI. `create` converts a project you
    # already have into a usable Wren Cloud project, so it refuses rather than
    # producing one that cannot be used — before anything is created.
    missing = []
    if not type_:
        missing.append("--type")
    if parsed_connection_info is None:
        missing.append("--connection-info / --connection-info-file")
    if missing:
        typer.echo(
            f"Error: {' and '.join(missing)} required.\n"
            "`create` connects the project's data source as it creates it; a "
            "project without one is created but unusable, and this CLI cannot "
            "attach one afterwards.\n"
            "See `wren cloud create --help` for the accepted types, or create "
            "the project in the Wren Cloud web UI if you want to pick its data "
            "source there.",
            err=True,
        )
        raise typer.Exit(1)

    resolved_org_key = (org_key or os.environ.get("WREN_CLOUD_ORG_KEY") or "").strip()
    if not resolved_org_key:
        resolved_org_key = typer.prompt(
            f"Wren Cloud organization API key for org {org} on {host}",
            hide_input=True,
        ).strip()
    if not resolved_org_key:
        typer.echo("Error: an organization API key is required.", err=True)
        raise typer.Exit(1)

    resolved_display_name = display_name or directory.resolve().name

    try:
        project, outcome = cloud.create(
            directory,
            host=host,
            org_id=org,
            org_key=resolved_org_key,
            display_name=resolved_display_name,
            git_host=git_host,
            connection_type=type_,
            connection_info=parsed_connection_info,
            test_connection=test_connection,
            language=language,
            timezone=timezone,
        )
    except cloud.CloudError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1) from exc

    typer.echo(f"Created project {project.id} ({project.display_name}) on {host}.")
    if project.status == "partial":
        typer.echo(
            "Warning: the project was created, but not everything finished "
            "successfully:",
            err=True,
        )
        for error in project.errors:
            typer.echo(
                f"  - {error.get('resource', '?')}: {error.get('message', '')}",
                err=True,
            )

    if outcome is cloud.LinkOutcome.ALREADY_LINKED:
        typer.echo(f"{_shown(directory)} is already linked to project {project.id}.")
    else:
        typer.echo(f"Linked project {project.id} into {_shown(directory)}.")


@cloud_app.command()
def unlink(
    directory: Annotated[
        Path, typer.Argument(help="Local directory to unbind.")
    ] = Path("."),
    forget_key: Annotated[
        bool,
        typer.Option(
            "--forget-key",
            help=(
                "Also drop this project's stored API key. Separate from "
                "unbinding, because another directory may still be bound to "
                "the same project and need that key."
            ),
        ),
    ] = False,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Skip the confirmation prompt."),
    ] = False,
) -> None:
    """Unbind ``directory`` from the Wren Cloud project it is bound to.

    The binding *is* the git remote, so this removes ``origin`` and that is
    the whole unbind — there is nothing to tell the server, which never knew
    about the binding, and the project itself is untouched. Re-binding later
    with ``wren cloud link`` works and reports ``already linked``.

    Your stored API key is kept by default: unbinding one directory should
    not revoke a credential another directory may still be using. Pass
    ``--forget-key`` to drop it as well, which additionally removes this
    host's git credential-helper entry — but only once no stored login uses
    that host any more, since that entry is shared by every project on it.

    To move a directory to a *different* project, unbind it and start from a
    clean directory. This directory's history belongs to the project it came
    from, and ``link`` refuses to merge one project's history into another.
    """
    from wren import cloud  # noqa: PLC0415

    if forget_key and not yes:
        confirm = typer.confirm(
            f"Drop the stored API key for the project {_shown(directory)} is bound to?"
        )
        if not confirm:
            raise typer.Abort()

    try:
        outcome = cloud.unlink(directory, forget_key=forget_key)
    except cloud.CloudError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)

    if outcome.project_id is not None:
        typer.echo(f"Unlinked {_shown(directory)} from project {outcome.project_id}.")
    else:
        # `origin` was not a Wren Cloud URL. Still removed — the directory is
        # unbound either way — but naming a project would be a fiction.
        typer.echo(
            f"Removed the `origin` remote ({outcome.remote_url}) from {_shown(directory)}."
        )
    if outcome.key_forgotten:
        typer.echo("Dropped the stored API key for that project.")
    if outcome.helper_removed:
        typer.echo(
            f"Removed the git credential helper for {outcome.git_host} — "
            "no stored logins use that host any more."
        )


@auth_app.command("remove")
def auth_remove(
    host: Annotated[
        Optional[str],
        typer.Option(
            "--host",
            help="Wren Cloud host the credential was added for, if more than one.",
        ),
    ] = None,
    project: Annotated[
        Optional[str],
        typer.Option(
            "--project",
            help="Project id, if you have logins for more than one project.",
        ),
    ] = None,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Skip the confirmation prompt."),
    ] = False,
) -> None:
    """Remove a stored Wren Cloud credential, without touching any directory.

    This is the counterpart to ``auth add``. It removes the stored API key,
    and
    — once that was the last login for its host — that host's git
    credential-helper entry too.

    No working tree is modified. A directory bound to that project keeps its
    git remote and simply stops being able to authenticate, which is the
    honest consequence of discarding the key. Use ``wren cloud unlink`` if
    you want to unbind a directory as well.

    Distinct from ``wren cloud git-credential erase``, which git calls when
    a credential is rejected: that drops only the short-lived token and
    deliberately leaves your API key in place.
    """
    from wren import cloud  # noqa: PLC0415

    logins = cloud.list_logins()
    if project is not None:
        logins = [entry for entry in logins if entry[1] == str(project)]
    if host is not None:
        # Same field as `link` filters on, for the same reason: `api_host` is
        # what the user typed at `login` and what the candidates below print.
        logins = [entry for entry in logins if entry[2]["api_host"] == host]

    if not logins:
        typer.echo(
            "Error: no stored Wren Cloud login found"
            + (f" for project {project}" if project else "")
            + ".",
            err=True,
        )
        raise typer.Exit(1)
    if len(logins) > 1:
        typer.echo(
            "Error: more than one stored login matches; disambiguate with "
            "--host and/or --project. Candidates:",
            err=True,
        )
        for _git_host, project_id, entry in logins:
            typer.echo(f"  --host {entry['api_host']} --project {project_id}", err=True)
        raise typer.Exit(1)

    git_host, project_id, entry = logins[0]

    if not yes:
        confirm = typer.confirm(
            f"Drop the stored API key for project {project_id} on {entry['api_host']}?"
        )
        if not confirm:
            raise typer.Abort()

    login_removed, helper_removed = cloud.logout(git_host, project_id)
    if not login_removed:
        typer.echo(
            f"Error: no stored login for project {project_id} on {git_host}.",
            err=True,
        )
        raise typer.Exit(1)

    typer.echo(f"Logged out of project {project_id} on {entry['api_host']}.")
    if helper_removed:
        typer.echo(
            f"Removed the git credential helper for {git_host} — no stored "
            "logins use that host any more."
        )


@git_credential_app.command("get")
def credential_get() -> None:
    """Handle git's ``get`` operation. Invoked by git, not by hand."""
    from wren.cloud import (  # noqa: PLC0415
        CloudError,
        git_credential_get,
        helper_failure_note,
        read_credential_input,
    )

    input_data = read_credential_input(sys.stdin)
    try:
        output = git_credential_get(input_data)
    except CloudError as exc:
        typer.echo(helper_failure_note(str(exc)), err=True)
        raise typer.Exit(1)
    sys.stdout.write(output)


@git_credential_app.command("store")
def credential_store() -> None:
    """Handle git's ``store`` operation. Invoked by git, not by hand."""
    from wren.cloud import git_credential_store, read_credential_input  # noqa: PLC0415

    git_credential_store(read_credential_input(sys.stdin))


@git_credential_app.command("erase")
def credential_erase() -> None:
    """Handle git's ``erase`` operation. Invoked by git, not by hand."""
    from wren.cloud import git_credential_erase, read_credential_input  # noqa: PLC0415

    git_credential_erase(read_credential_input(sys.stdin))
