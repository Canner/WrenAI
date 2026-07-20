"""Typer sub-app for ``wren serve`` commands."""

from __future__ import annotations

import atexit
import json
import os
import shlex
import shutil
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

serve_app = typer.Typer(
    name="serve",
    help="Serve wren capabilities to external clients (MCP, ...).",
)

_SOURCE_FILES = ("wren_project.yml", "relationships.yml")
_SOURCE_DIRS = ("models", "views", "cubes")


def _mdl_is_stale(project: Path, mdl_path: Path) -> bool:
    """Return True if any project source file is newer than mdl_path."""
    mdl_mtime = mdl_path.stat().st_mtime

    for name in _SOURCE_FILES:
        f = project / name
        if f.exists() and f.stat().st_mtime > mdl_mtime:
            return True

    for dirname in _SOURCE_DIRS:
        d = project / dirname
        if not d.is_dir():
            continue
        for f in d.rglob("*"):
            if f.is_file() and f.stat().st_mtime > mdl_mtime:
                return True

    return False


def _serve_args(
    project: Path, profile: str | None, allow_write: bool, no_connect: bool
) -> list[str]:
    """Reconstruct the stdio `serve mcp` args for a client config."""
    args = ["serve", "mcp", "--project", str(project)]
    if profile:
        args += ["--profile", profile]
    if allow_write:
        args.append("--allow-write")
    if no_connect:
        args.append("--no-connect")
    return args


def _print_connection_help(
    *,
    transport: str,
    host: str,
    port: int,
    project: Path,
    profile: str | None,
    allow_write: bool,
    no_connect: bool,
    api_key: str | None = None,
) -> None:
    """Print client-registration guidance.

    Always to stderr — on stdio transport, stdout is the MCP protocol channel
    and must not be polluted.
    """
    wren_cmd = shutil.which("wren") or sys.argv[0] or "wren"
    wren_home = os.environ.get("WREN_HOME")
    line = "─" * 68

    def echo(msg: str = "") -> None:
        typer.echo(msg, err=True)

    echo(line)
    if transport == "http":
        # A wildcard bind host isn't a connectable client target — show loopback.
        display_host = "127.0.0.1" if host in ("0.0.0.0", "::", "") else host
        url = f"http://{display_host}:{port}/mcp"
        echo(" wren MCP server — Streamable HTTP")
        echo(f"   URL: {url}")
        if api_key:
            echo(f"   Auth: Bearer token (--api-key)")
        echo("")
        echo(" Register with a client:")
        if api_key:
            echo(
                "   Claude Code   claude mcp add --transport http"
                f" wren {url} --bearer-token {api_key}"
            )
            echo(
                f"   Codex         codex mcp add wren --url {url}"
                f" --bearer-token {api_key}"
            )
        else:
            echo(f"   Claude Code   claude mcp add --transport http wren {url}")
            echo(f"   Codex         codex mcp add wren --url {url}")
        echo(
            "   Inspector     npx @modelcontextprotocol/inspector   "
            "(Streamable HTTP → the URL above)"
        )
        echo("")
        echo(" Press Ctrl+C to stop.")
    else:
        args = _serve_args(project, profile, allow_write, no_connect)
        # Shell-quote every token so paths with spaces stay copy-pasteable.
        cmd = " ".join(shlex.quote(t) for t in [wren_cmd, *args])
        env_flag = f" -e {shlex.quote('WREN_HOME=' + wren_home)}" if wren_home else ""
        echo(" wren MCP server — stdio (your MCP client spawns this process)")
        echo("")
        echo(" Register with a client:")
        echo(f"   Claude Code   claude mcp add wren{env_flag} -- {cmd}")
        echo(f"   Codex         codex mcp add wren{env_flag} -- {cmd}")
        echo("")
        echo(" Or add to an IDE MCP config (Claude Desktop / Cursor / VS Code):")
        server: dict = {"command": wren_cmd, "args": args}
        if wren_home:
            server["env"] = {"WREN_HOME": wren_home}
        config = {"mcpServers": {"wren": server}}
        for cfg_line in json.dumps(config, indent=2).splitlines():
            echo(f"   {cfg_line}")
        echo("")
        echo(" Waiting for a client on stdin…")
    echo(line)


@serve_app.command("mcp")
def serve_mcp(
    transport: Annotated[
        str,
        typer.Option("--transport", help="Transport: stdio or http."),
    ] = "stdio",
    host: Annotated[
        str, typer.Option("--host", help="Bind host for --transport http.")
    ] = "127.0.0.1",
    port: Annotated[
        int, typer.Option("--port", help="Bind port for --transport http.")
    ] = 8080,
    project: Annotated[
        Optional[Path],
        typer.Option("--project", help="Override project root."),
    ] = None,
    profile: Annotated[
        Optional[str],
        typer.Option("--profile", help="Connection profile name."),
    ] = None,
    api_key: Annotated[
        Optional[str],
        typer.Option(
            "--api-key",
            help="Require this bearer token on every HTTP request (--transport http only).",
        ),
    ] = None,
    allow_write: Annotated[
        bool,
        typer.Option("--allow-write", help="Enable the store_query write tool."),
    ] = False,
    no_connect: Annotated[
        bool,
        typer.Option(
            "--no-connect",
            help="Transpile-only mode: disable run_sql, dry_run, and query_cube.",
        ),
    ] = False,
    quiet: Annotated[
        bool,
        typer.Option(
            "--quiet",
            "-q",
            help="Suppress the client-registration help banner.",
        ),
    ] = False,
) -> None:
    """Serve wren's query + context/knowledge tools as an MCP server.

    Backed by an in-process WrenEngine — no ibis-server, no HTTP engine.
    """
    if transport not in {"stdio", "http"}:
        typer.echo(
            f"Error: unsupported --transport '{transport}'. Use stdio or http.",
            err=True,
        )
        raise typer.Exit(1)

    if api_key and transport != "http":
        typer.echo(
            "Error: --api-key requires --transport http.",
            err=True,
        )
        raise typer.Exit(1)

    try:
        import mcp  # noqa: F401, PLC0415
    except ImportError:
        typer.echo(
            "Install the MCP extra: pip install 'wrenai[mcp]'",
            err=True,
        )
        raise typer.Exit(1)

    from loguru import logger  # noqa: PLC0415

    from wren.cli import _build_engine  # noqa: PLC0415
    from wren.context import discover_project_path  # noqa: PLC0415

    try:
        project_path = discover_project_path(str(project) if project else None)
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    # Resolve the MDL path from the already-discovered project root rather
    # than delegating to cli._require_mdl(None), which re-discovers the
    # project from cwd and would silently ignore --project.
    mdl_path = project_path / "target" / "mdl.json"
    if not mdl_path.exists():
        typer.echo(
            f"Error: project found at {project_path} but target/mdl.json missing.\n"
            "  Hint: run `wren context build` first.",
            err=True,
        )
        raise typer.Exit(1)

    if _mdl_is_stale(project_path, mdl_path):
        logger.warning(
            "MDL may be stale — re-run `wren context build`",
        )

    connection_info = None
    if profile is not None:
        import json  # noqa: PLC0415

        from wren.profile import (  # noqa: PLC0415
            MissingSecretError,
            expand_profile_secrets,
            list_profiles,
        )

        profiles = list_profiles()
        if profile not in profiles:
            typer.echo(f"Error: profile '{profile}' not found.", err=True)
            raise typer.Exit(1)
        prof_dict = dict(profiles[profile])
        ds = prof_dict.pop("datasource", None)
        if ds is None:
            typer.echo(f"Error: profile '{profile}' has no datasource.", err=True)
            raise typer.Exit(1)
        try:
            prof_dict = expand_profile_secrets(prof_dict)
        except MissingSecretError as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)
        connection_info = json.dumps({"datasource": ds, **prof_dict})

    engine = _build_engine(
        str(mdl_path), connection_info, None, conn_required=not no_connect
    )
    atexit.register(lambda: engine.close() if hasattr(engine, "close") else None)

    from wren.mcp_server import ServeContext, run_server  # noqa: PLC0415

    ctx = ServeContext(
        project=project_path,
        engine=engine,
        allow_write=allow_write,
        no_connect=no_connect,
        api_key=api_key,
    )
    if not quiet:
        _print_connection_help(
            transport=transport,
            host=host,
            port=port,
            project=project_path,
            profile=profile,
            allow_write=allow_write,
            no_connect=no_connect,
            api_key=api_key,
        )
    run_server(ctx, transport=transport, host=host, port=port)
