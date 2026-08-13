"""Typer sub-app for ``wren cloud`` commands.

``wren cloud login`` connects a local directory to a Wren Cloud project's
git remote; ``wren cloud link`` then binds (or adopts) that project's files
into a local directory via plain git, once. After that, ordinary
``git push`` / ``git pull`` / ``git diff`` are the commands — none of the
security depends on going through this CLI again, and ``git pull`` (not a
repeated ``link``) is how you get updates. ``wren cloud git-credential`` is
the helper `login` wires into git; it is not meant to be invoked by hand.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

cloud_app = typer.Typer(
    name="cloud",
    help="Connect a local project to Wren Cloud's git remote.",
)

git_credential_app = typer.Typer(
    name="git-credential",
    help="Git credential helper invoked by git itself — not for direct use.",
)
cloud_app.add_typer(git_credential_app)


@cloud_app.command()
def login(
    host: Annotated[
        str,
        typer.Option("--host", help="Wren Cloud host, e.g. https://cloud.getwren.ai"),
    ],
    project: Annotated[str, typer.Option("--project", help="Project id")],
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
    """
    from wren import cloud  # noqa: PLC0415

    api_key = typer.prompt("Wren Cloud API key", hide_input=True)
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

    typer.echo(f"Logged in to project {project} on {host}.")
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
                "Wren Cloud host used at login, if you logged in to more "
                "than one host. Defaults to the only stored login, or the "
                "one matching --project."
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

    Safe to re-run if a previous attempt failed partway through — that
    recovers cleanly. If the directory is already fully linked, re-running
    reports that and does not merge again; use ``git pull`` for updates
    instead.

    Requires having run ``wren cloud login`` for the target project first.
    """
    from wren import cloud  # noqa: PLC0415

    logins = cloud.list_logins()
    if project is not None:
        logins = [entry for entry in logins if entry[1] == str(project)]
    if host is not None:
        # Filtered on the same field the help text promises and the
        # disambiguation candidates below print: `api_host` — the host the
        # user passed to `login --host`, not the (possibly different)
        # `--git-host`. Filtering on `git_host` here while displaying
        # `api_host` would silently reject the exact value a user would
        # naturally reach for: the host they logged in with.
        logins = [entry for entry in logins if entry[2]["api_host"] == host]

    if not logins:
        typer.echo(
            "Error: no stored Wren Cloud login found"
            + (f" for project {project}" if project else "")
            + ". Run `wren cloud login` first.",
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
            repo=entry["repo"],
        )
    except cloud.CloudError as exc:
        typer.echo(f"Error: {exc}", err=True)
        raise typer.Exit(1)

    if outcome is cloud.LinkOutcome.ALREADY_LINKED:
        typer.echo(
            f"{directory} is already linked to project {project_id}. "
            "Run `git pull` to fetch updates."
        )
    else:
        typer.echo(f"Linked project {project_id} into {directory}.")


@cloud_app.command()
def create(  # noqa: PLR0913
    host: Annotated[
        str,
        typer.Option("--host", help="Wren Cloud host, e.g. https://cloud.getwren.ai"),
    ],
    org: Annotated[
        str,
        typer.Option("--org", help="Organization id the new project belongs to."),
    ],
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
                "differs from --host. See `wren cloud login --help` for "
                "when to pass this; defaults to --host."
            ),
        ),
    ] = None,
    type_: Annotated[
        Optional[str],
        typer.Option(
            "--type",
            help="Data source type for the connection, e.g. POSTGRES, BIGQUERY.",
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
    mdl_file: Annotated[
        Optional[Path],
        typer.Option("--mdl-file", help="Path to a JSON file with an initial MDL."),
    ] = None,
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
    after it) uses the project key, exactly like `wren cloud login` would.

    Always requests agent mode for the new project — a project created any
    other way has no git repository at all, so there would be nothing here
    to bind a directory to. If the server did not actually grant that, this
    fails with a specific error rather than a bare HTTP error, and reports
    how to recover the project's key.

    Refuses up front if `directory` sits inside another git repository,
    before creating anything on the server — the same check `link` uses.
    """
    from wren import cloud  # noqa: PLC0415

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

    if parsed_connection_info is not None and not type_:
        typer.echo(
            "Error: --type is required when a connection info is given.", err=True
        )
        raise typer.Exit(1)

    parsed_mdl: Optional[dict] = None
    if mdl_file is not None:
        try:
            raw = mdl_file.read_text(encoding="utf-8")
        except OSError as exc:
            typer.echo(f"Error: could not read {mdl_file}: {exc}", err=True)
            raise typer.Exit(1) from exc
        parsed_mdl = _read_json_option(raw, source="--mdl-file")

    resolved_org_key = (org_key or os.environ.get("WREN_CLOUD_ORG_KEY") or "").strip()
    if not resolved_org_key:
        resolved_org_key = typer.prompt(
            "Wren Cloud organization API key", hide_input=True
        ).strip()
    if not resolved_org_key:
        typer.echo("Error: an organization API key is required.", err=True)
        raise typer.Exit(1)
    if not resolved_org_key.startswith("osk-"):
        typer.echo(
            "Error: `wren cloud create` needs an organization API key "
            "(starts with `osk-`), not a project key.",
            err=True,
        )
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
            mdl=parsed_mdl,
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
        typer.echo(f"{directory} is already linked to project {project.id}.")
    else:
        typer.echo(f"Linked project {project.id} into {directory}.")


@git_credential_app.command("get")
def credential_get() -> None:
    """Handle git's ``get`` operation. Invoked by git, not by hand."""
    from wren.cloud import (  # noqa: PLC0415
        CloudError,
        git_credential_get,
        read_credential_input,
    )

    input_data = read_credential_input(sys.stdin)
    try:
        output = git_credential_get(input_data)
    except CloudError as exc:
        typer.echo(str(exc), err=True)
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
