"""Typer sub-app for ``wren cloud`` commands.

``wren cloud login`` connects a local directory to a Wren Cloud project's
git remote; ``wren cloud pull`` then acquires (or adopts) that project's
files via plain git. After that, ordinary ``git push`` / ``git pull`` /
``git diff`` are the commands — none of the security depends on going
through this CLI again. ``wren cloud git-credential`` is the helper `login`
wires into git; it is not meant to be invoked by hand.
"""

from __future__ import annotations

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
        "Run `wren cloud pull` to fetch it, or `git clone` the remote directly."
    )


@cloud_app.command()
def pull(
    directory: Annotated[
        Path,
        typer.Argument(help="Local directory to pull the project into."),
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
    """Acquire a Wren Cloud project's files into a local directory via git.

    Into a fresh, empty directory this is a plain clone. Into a directory
    that already contains project files, it initializes git in place,
    fetches the remote, and merges histories — your files stay where they
    are, and any real overlap surfaces as an ordinary git conflict for you
    to resolve. Never force-pushes or force-overwrites.

    Refuses if ``directory`` sits inside another git repository, to avoid
    pushing that repository's own files into the project's remote.

    Requires having run ``wren cloud login`` for the target project first.
    """
    from wren import cloud  # noqa: PLC0415

    logins = cloud.list_logins()
    if project is not None:
        logins = [entry for entry in logins if entry[1] == str(project)]
    if host is not None:
        logins = [entry for entry in logins if entry[0] == host]

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
        cloud.pull(
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

    typer.echo(f"Pulled project {project_id} into {directory}.")


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
