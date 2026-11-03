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
        echo("")
        echo(" Register with a client:")
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
    service_config: Annotated[
        Optional[Path],
        typer.Option(
            "--service-config",
            help="Enable governed stdio mode with this trusted deployment configuration (version 2: config_version, caller, project_id, policy, private_model, optional execution and policy_presets).",
        ),
    ] = None,
    agent_profile: Annotated[
        Optional[Path],
        typer.Option("--agent-profile", help="Capability profile for governed mode."),
    ] = None,
    runtime: Annotated[
        Optional[Path],
        typer.Option("--runtime", help="Installed Warble private service entry."),
    ] = None,
    warble: Annotated[
        str, typer.Option("--warble", help="Warble compiler executable.")
    ] = "warble",
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
    if service_config is not None:
        if (
            transport != "stdio"
            or allow_write
            or no_connect
            or agent_profile is None
            or runtime is None
        ):
            typer.echo(
                "Governed mode requires stdio, --agent-profile and --runtime; writes and no-connect are unsupported.",
                err=True,
            )
            raise typer.Exit(1)
        from wren.agent_service import launch  # noqa: PLC0415

        try:
            launch(
                project, agent_profile, service_config, runtime, warble, "mcp", profile
            )
        except Exception:
            typer.echo(
                "Governed service startup failed. Check profile, project, runtime and deployment configuration.",
                err=True,
            )
            raise typer.Exit(1) from None
        return
    if agent_profile is not None or runtime is not None or warble != "warble":
        typer.echo(
            "--agent-profile, --runtime and --warble require --service-config.",
            err=True,
        )
        raise typer.Exit(1)
    if transport not in {"stdio", "http"}:
        typer.echo(
            f"Error: unsupported --transport '{transport}'. Use stdio or http.",
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
            prof_dict = expand_profile_secrets(prof_dict, project_path=project_path)
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
        )
    run_server(ctx, transport=transport, host=host, port=port)


@serve_app.command("agent")
def serve_agent(
    agent_profile: Annotated[
        Path, typer.Option("--agent-profile", help="Warble profile directory.")
    ],
    service_config: Annotated[
        Path,
        typer.Option(
            "--service-config",
            help="Trusted service deployment configuration, version 2 (config_version: 2; "
            "caller, project_id, policy, private_model, optional execution and policy_presets).",
        ),
    ],
    runtime: Annotated[
        Path, typer.Option("--runtime", help="Installed Warble private service entry.")
    ],
    project: Annotated[Optional[Path], typer.Option("--project")] = None,
    profile: Annotated[
        Optional[str], typer.Option("--profile", help="Data connection profile.")
    ] = None,
    warble: Annotated[str, typer.Option("--warble")] = "warble",
    transport: Annotated[
        str, typer.Option("--transport", help="stdio (default) or http (loopback).")
    ] = "stdio",
    host: Annotated[
        str, typer.Option("--host", help="Loopback bind host for --transport http.")
    ] = "127.0.0.1",
    port: Annotated[
        int, typer.Option("--port", help="Bind port for --transport http; 0 = any.")
    ] = 0,
    policy_preset: Annotated[
        Optional[str],
        typer.Option(
            "--policy-preset",
            help="Named preset from service.yml policy_presets (hidden, structure, rules or full in the example); default_preset when omitted.",
        ),
    ] = None,
) -> None:
    """Serve one project-bound Warble profile through a private pi runtime."""
    if transport not in ("stdio", "http"):
        typer.echo("Agent service supports --transport stdio or http.", err=True)
        raise typer.Exit(1)
    from wren.agent_service import LOCAL_TOKEN_ENV, launch  # noqa: PLC0415

    if transport == "http" and not os.environ.get(LOCAL_TOKEN_ENV):
        typer.echo(f"--transport http requires {LOCAL_TOKEN_ENV}.", err=True)
        raise typer.Exit(1)
    try:
        launch(
            project,
            agent_profile,
            service_config,
            runtime,
            warble,
            "agent",
            profile,
            policy_preset,
            transport=transport,
            host=host,
            port=port,
        )
    except (ValueError, RuntimeError) as exc:
        typer.echo(f"Agent startup failed: {exc}.", err=True)
        raise typer.Exit(1) from None
    except Exception:
        typer.echo(
            "Agent startup failed. Check profile, project, runtime, model credentials and deployment configuration.",
            err=True,
        )
        raise typer.Exit(1) from None


@serve_app.command("agent-presets")
def serve_agent_presets(
    service_config: Annotated[
        Path,
        typer.Option(
            "--service-config",
            help="Trusted service deployment configuration, version 2 (config_version: 2; "
            "caller, project_id, policy, private_model, optional execution and policy_presets).",
        ),
    ],
) -> None:
    """Print the named policy presets of a service configuration as JSON."""
    import yaml  # noqa: PLC0415

    from wren.agent_service import read_policy_presets  # noqa: PLC0415

    try:
        config = yaml.safe_load(
            service_config.expanduser().resolve(strict=True).read_text()
        )
        default, presets = read_policy_presets(config)
    except yaml.YAMLError:
        typer.echo("Cannot parse service config YAML.", err=True)
        raise typer.Exit(1) from None
    except OSError as exc:
        typer.echo(f"Cannot read service config: {exc}.", err=True)
        raise typer.Exit(1) from None
    except ValueError as exc:
        typer.echo(f"Invalid presets: {exc}.", err=True)
        raise typer.Exit(1) from None
    typer.echo(json.dumps({"default": default, "presets": sorted(presets)}))
