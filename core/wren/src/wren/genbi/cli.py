"""Typer sub-app for ``wren genbi`` commands."""

from __future__ import annotations

import re
from typing import Annotated, Optional

import typer

genbi_app = typer.Typer(
    name="genbi",
    help="Build and deploy GenBI apps from this project's context layer.",
)

# App names become a path segment under <project>/apps/. Constrain them to a
# simple slug so a crafted name (e.g. "../../etc") can't escape apps/ when
# joined in build/register/verify/open/deploy.
_APP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def _resolve_app_dir(project_path, name: str):
    """Validate ``name`` as a slug and return the ``apps/<name>`` directory.

    The slug rule rejects path separators, ``..`` and a leading dot, so the
    returned path is always contained in ``<project>/apps/``.
    """
    if not _APP_NAME_RE.fullmatch(name):
        typer.echo(
            "Error: invalid app name. Use letters, numbers, '_' or '-' "
            "(no path separators, and not starting with a dot).",
            err=True,
        )
        raise typer.Exit(1)
    return project_path / "apps" / name


def _resolve_prompt(prompt: str | None, prompt_file: str | None) -> str | None:
    """Resolve the user prompt from flag, file, or stdin ('-')."""
    import sys  # noqa: PLC0415
    from pathlib import Path  # noqa: PLC0415

    if prompt_file is not None:
        p = Path(prompt_file).expanduser()
        if not p.exists():
            typer.echo(f"Error: prompt file not found: {p}", err=True)
            raise typer.Exit(1)
        return p.read_text().strip() or None
    if prompt == "-":
        return sys.stdin.read().strip() or None
    return prompt


ProjectPathOpt = Annotated[
    Optional[str],
    typer.Option(
        "--path",
        "-p",
        help="Project directory. Auto-detected via WREN_PROJECT_HOME, cwd walk, or ~/.wren/config.yml.",
    ),
]


@genbi_app.command()
def build(
    name: Annotated[str, typer.Argument(help="App name — written to apps/<name>/.")],
    prompt: Annotated[
        Optional[str],
        typer.Option(
            "--prompt", help="The user's request for the app. Use '-' to read stdin."
        ),
    ] = None,
    prompt_file: Annotated[
        Optional[str],
        typer.Option(
            "--prompt-file",
            help="Read the user's request from a file (for long/multi-line prompts).",
        ),
    ] = None,
    data_mode: Annotated[
        str,
        typer.Option("--data-mode", help="snapshot (bundled data) or live."),
    ] = "snapshot",
    path: ProjectPathOpt = None,
) -> None:
    """Print a project-hydrated build instruction for an agent.

    Writes no app files; only compiles target/mdl.json if it's missing.
    """
    from wren.context import (  # noqa: PLC0415
        discover_project_path,
        load_models,
        load_project_config,
    )
    from wren.genbi.composer import compose_build_instruction  # noqa: PLC0415

    try:
        project_path = discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    user_prompt = _resolve_prompt(prompt, prompt_file)
    if user_prompt is None:
        typer.echo(
            "Error: a prompt is required — pass --prompt, --prompt-file, "
            "or --prompt - to read stdin.",
            err=True,
        )
        raise typer.Exit(1)

    from wren.genbi.composer import DATA_MODES  # noqa: PLC0415

    if data_mode not in DATA_MODES:
        typer.echo(
            f"Error: invalid --data-mode {data_mode!r}. Expected one of: "
            f"{', '.join(DATA_MODES)}.",
            err=True,
        )
        raise typer.Exit(1)

    app_dir = _resolve_app_dir(project_path, name)

    mdl_path = project_path / "target" / "mdl.json"
    if not mdl_path.exists():
        # Hydrating the instruction needs a current MDL — compile implicitly
        # (PRD risk #6) so the agent always sees an up-to-date context layer.
        from wren.context import build_json, save_target  # noqa: PLC0415

        try:
            save_target(build_json(project_path), project_path)
            typer.echo(f"(compiled {mdl_path} first)", err=True)
        except Exception as e:
            typer.echo(f"Error: could not compile MDL: {e}", err=True)
            raise typer.Exit(1)

    config = load_project_config(project_path)
    instruction = compose_build_instruction(
        app_name=name,
        data_mode=data_mode,
        user_prompt=user_prompt,
        mdl_path=mdl_path,
        app_dir=app_dir,
        models=load_models(project_path),
        data_source=config.get("data_source", "unknown"),
    )
    typer.echo(instruction)


def _discover(path: str | None):
    from wren.context import discover_project_path  # noqa: PLC0415

    try:
        return discover_project_path(path)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)


@genbi_app.command()
def register(
    name: Annotated[str, typer.Argument(help="App name under apps/<name>/.")],
    data_mode: Annotated[
        str,
        typer.Option("--data-mode", help="snapshot (bundled data) or live."),
    ] = "snapshot",
    path: ProjectPathOpt = None,
) -> None:
    """Record an agent-authored app in the project index (.wren/apps.yml)."""
    from wren.genbi.composer import DATA_MODES  # noqa: PLC0415
    from wren.genbi.index import register_app  # noqa: PLC0415

    project_path = _discover(path)

    if data_mode not in DATA_MODES:
        typer.echo(
            f"Error: invalid --data-mode {data_mode!r}. Expected one of: "
            f"{', '.join(DATA_MODES)}.",
            err=True,
        )
        raise typer.Exit(1)

    app_dir = _resolve_app_dir(project_path, name)
    if not app_dir.is_dir():
        typer.echo(
            f"Error: no app found at {app_dir}.\n"
            "  Write the app there first (see `wren genbi build`).",
            err=True,
        )
        raise typer.Exit(1)

    entry = register_app(project_path, name, data_mode=data_mode)
    typer.echo(f"Registered {name} ({entry['data_mode']}, {entry['status']}).")


@genbi_app.command(name="list")
def list_apps(path: ProjectPathOpt = None) -> None:
    """List registered apps with data mode, status, and deploy state."""
    from wren.genbi.index import load_index  # noqa: PLC0415

    project_path = _discover(path)
    apps = load_index(project_path)["apps"]
    if not apps:
        typer.echo("No apps registered. See `wren genbi build` to create one.")
        return

    for name, entry in apps.items():
        deploy = entry.get("deploy") or {}
        suffix = f" → {deploy['last_url']}" if deploy.get("last_url") else ""
        typer.echo(
            f"{name}  [{entry.get('data_mode', '?')}, {entry.get('status', '?')}]"
            f"{suffix}"
        )


@genbi_app.command()
def remove(
    name: Annotated[str, typer.Argument(help="Registered app name.")],
    path: ProjectPathOpt = None,
) -> None:
    """Remove an app's entry from the project index."""
    from wren.genbi.index import remove_app  # noqa: PLC0415

    project_path = _discover(path)
    if not remove_app(project_path, name):
        typer.echo(f"Error: app {name!r} is not registered.", err=True)
        raise typer.Exit(1)
    typer.echo(f"Removed {name} from the index (files under apps/{name}/ kept).")


def _require_registered(project_path, name: str) -> dict:
    from wren.genbi.index import get_app  # noqa: PLC0415

    entry = get_app(project_path, name)
    if entry is None:
        typer.echo(
            f"Error: app {name!r} is not registered.\n"
            f"  Run `wren genbi register {name}` first.",
            err=True,
        )
        raise typer.Exit(1)
    return entry


@genbi_app.command()
def verify(
    name: Annotated[str, typer.Argument(help="Registered app name.")],
    path: ProjectPathOpt = None,
) -> None:
    """Preflight an app: required files, parseable MDL, bundled data."""
    from wren.genbi.index import update_app  # noqa: PLC0415
    from wren.genbi.verify import verify_app  # noqa: PLC0415

    project_path = _discover(path)
    entry = _require_registered(project_path, name)

    result = verify_app(
        _resolve_app_dir(project_path, name),
        data_mode=entry.get("data_mode", "snapshot"),
    )
    if not result.passed:
        typer.echo(f"Verify failed for {name}:", err=True)
        for failure in result.failures:
            typer.echo(f"  - {failure}", err=True)
        raise typer.Exit(1)

    if entry.get("status") == "scaffolded":
        update_app(project_path, name, status="built")
    typer.echo(f"Verify passed for {name}.")


@genbi_app.command(name="open")
def open_app(
    name: Annotated[str, typer.Argument(help="Registered app name.")],
    port: Annotated[
        int, typer.Option("--port", help="Local port (0 = auto-pick).")
    ] = 0,
    path: ProjectPathOpt = None,
) -> None:
    """Serve a built app locally for preview."""
    import http.server  # noqa: PLC0415
    import socketserver  # noqa: PLC0415
    from functools import partial  # noqa: PLC0415

    project_path = _discover(path)
    _require_registered(project_path, name)
    app_dir = _resolve_app_dir(project_path, name)

    handler = partial(http.server.SimpleHTTPRequestHandler, directory=str(app_dir))
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        actual_port = httpd.server_address[1]
        typer.echo(f"Serving {name} at http://127.0.0.1:{actual_port}/ (Ctrl-C stops)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            typer.echo("\nStopped.")


@genbi_app.command()
def deploy(
    name: Annotated[str, typer.Argument(help="Registered app name.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="Deploy target: vercel or cloudflare."),
    ] = "vercel",
    prod: Annotated[
        bool,
        typer.Option("--prod", help="Deploy to production (default: preview)."),
    ] = False,
    path: ProjectPathOpt = None,
) -> None:
    """Verify, then ship a registered app to the user's provider account."""
    from datetime import date  # noqa: PLC0415

    from wren.genbi.index import update_app  # noqa: PLC0415
    from wren.genbi.providers import get_provider  # noqa: PLC0415
    from wren.genbi.providers.base import DeployError  # noqa: PLC0415
    from wren.genbi.tokens import resolve_token  # noqa: PLC0415
    from wren.genbi.verify import verify_app  # noqa: PLC0415

    project_path = _discover(path)
    entry = _require_registered(project_path, name)
    app_dir = _resolve_app_dir(project_path, name)

    try:
        adapter = get_provider(provider)
    except KeyError as e:
        typer.echo(f"Error: {e.args[0]}", err=True)
        raise typer.Exit(1)

    # Preflight — a broken app never reaches a public URL.
    result = verify_app(
        app_dir,
        data_mode=entry.get("data_mode", "snapshot"),
    )
    if not result.passed:
        typer.echo(f"Deploy aborted — verify failed for {name}:", err=True)
        for failure in result.failures:
            typer.echo(f"  - {failure}", err=True)
        raise typer.Exit(1)

    token = resolve_token(adapter.env_token_var, project_path)
    if not token:
        typer.echo(
            f"Error: no {adapter.env_token_var} found.\n"
            f"  Export it (`export {adapter.env_token_var}=...`) or add it to "
            "your project's .env file.\n"
            "  Never pass tokens as CLI flags — they leak into shell history.",
            err=True,
        )
        raise typer.Exit(1)

    try:
        deployment = adapter.deploy(
            app_dir,
            app_name=name,
            token=token,
            prod=prod,
            link=entry.get("deploy"),
        )
    except DeployError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)

    deploy_state = {
        "provider": adapter.name,
        "project_id": deployment.project_id,
        "org_id": deployment.org_id,
        "account_id": deployment.account_id,
        "last_url": deployment.url,
        "last_deployed_at": date.today().isoformat(),
        "environment": deployment.environment,
    }
    update_app(project_path, name, status="deployed", deploy=deploy_state)
    typer.echo(f"Deployed {name} ({deployment.environment}): {deployment.url}")
