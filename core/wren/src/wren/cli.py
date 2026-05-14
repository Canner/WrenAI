"""Wren CLI — SQL transform and execution via the Wren semantic layer."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated, Optional

import typer

from wren.context_cli import context_app

app = typer.Typer(name="wren", help="Wren Engine CLI", no_args_is_help=False)

_WREN_HOME = Path(os.environ.get("WREN_HOME", str(Path.home() / ".wren"))).expanduser()
_DEFAULT_CONN = _WREN_HOME / "connection_info.json"


# ── File discovery helpers ─────────────────────────────────────────────────


def _require_mdl(mdl: str | None) -> str:
    """Return mdl path — explicit flag or auto-discovered from project root."""
    if mdl is not None:
        return mdl
    try:
        from wren.context import discover_project_path  # noqa: PLC0415

        project_path = discover_project_path()
        target = project_path / "target" / "mdl.json"
        if target.exists():
            return str(target)
        typer.echo(
            f"Error: project found at {project_path} but target/mdl.json missing.\n"
            "  Hint: run `wren context build` first.",
            err=True,
        )
    except SystemExit as e:
        typer.echo(str(e), err=True)
    except Exception as e:
        typer.echo(f"Error discovering project: {e}", err=True)
    raise typer.Exit(1)


def _load_manifest(mdl: str) -> str:
    """Load MDL from a file path or treat as base64 string directly."""
    path = Path(mdl).expanduser()
    if path.suffix.lower() == ".json" and not path.exists():
        typer.echo(f"Error: MDL file not found: {path}", err=True)
        raise typer.Exit(1)
    if path.exists():
        import base64  # noqa: PLC0415

        content = path.read_bytes()
        if path.suffix.lower() == ".json":
            # Raw JSON file — base64-encode it for WrenEngine
            return base64.b64encode(content).decode()
        # Non-.json file — assume it already contains a base64-encoded MDL string
        return content.decode().strip()
    # Not a file path — treat as a raw base64 string passed directly
    return mdl


def _normalize_conn(conn: dict) -> dict:
    """Flatten the ``{"datasource": ..., "properties": {...}}`` envelope.

    MCP / web connection files wrap connection fields under a ``properties``
    key.  This normalises both formats into ``{"datasource": ..., **fields}``.
    """
    if "properties" in conn and isinstance(conn["properties"], dict):
        props = conn["properties"]
        props["datasource"] = conn.get("datasource", props.get("datasource"))
        return props
    return conn


def _load_conn(
    connection_info: str | None,
    connection_file: str | None,
    *,
    required: bool = True,
) -> dict:
    """Load connection dict from inline JSON or file, with ~/.wren auto-discovery.

    If neither --connection-info nor --connection-file is given, looks for
    connection_info.json in ~/.wren.  Raises typer.Exit(1) if required=True and nothing
    is found.
    """
    if connection_info:
        try:
            conn = json.loads(connection_info)
        except json.JSONDecodeError as e:
            typer.echo(f"Error: invalid JSON in --connection-info: {e}", err=True)
            raise typer.Exit(1)
        if not isinstance(conn, dict):
            typer.echo(
                "Error: --connection-info must decode to a JSON object.", err=True
            )
            raise typer.Exit(1)
        return _normalize_conn(conn)

    path_str = connection_file or (
        str(_DEFAULT_CONN) if _DEFAULT_CONN.exists() else None
    )
    if path_str:
        path = Path(path_str).expanduser()
        if not path.exists():
            typer.echo(f"Error: connection file not found: {path_str}", err=True)
            raise typer.Exit(1)
        try:
            conn = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            typer.echo(f"Error: invalid JSON in {path_str}: {e}", err=True)
            raise typer.Exit(1)
        if not isinstance(conn, dict):
            typer.echo(f"Error: {path_str} must contain a JSON object.", err=True)
            raise typer.Exit(1)
        return _normalize_conn(conn)

    if required:
        typer.echo(
            f"Error: --connection-file not specified and '{_DEFAULT_CONN}' not found.",
            err=True,
        )
        raise typer.Exit(1)
    return {}


def _resolve_engine_profile(mdl: str | None) -> tuple[str | None, dict]:
    """Resolve the connection profile for project-context CLI commands.

    Project detection is decoupled from ``--mdl`` shape: ``--mdl`` is a pure
    "which MDL artifact to load" override, project context is determined
    independently by walking up from the MDL path (when it's a real file)
    AND from cwd. Active profile is reserved for the case where neither
    discovery finds a project — preventing ``--mdl <base64>`` or
    ``--mdl /external.json`` from silently bypassing cwd's pin.
    """
    from wren.profile import (  # noqa: PLC0415
        get_active_profile,
        resolve_profile_for_project,
    )

    project_path = _discover_project_for_engine(mdl)
    if project_path is None:
        return get_active_profile()
    return resolve_profile_for_project(project_path)


def _discover_project_for_engine(mdl: str | None) -> Path | None:
    """Find the project root for engine commands. Returns ``None`` if no
    project context exists anywhere (caller should fall back to active).

    Resolution order:
      1. If ``--mdl`` is a real file, walk up its directory tree looking
         for ``wren_project.yml``. ``<project>/target/mdl.json`` is a build
         default, not a contract — users may keep MDL elsewhere.
      2. Otherwise (``--mdl`` is base64, points outside a project, or is
         absent), discover from cwd.
    """
    if mdl is not None:
        mdl_path = Path(mdl).expanduser()
        if mdl_path.exists() and mdl_path.is_file():
            for parent in mdl_path.resolve().parents:
                if (parent / "wren_project.yml").exists():
                    return parent
                if parent == Path.home() or parent == parent.parent:
                    break

    try:
        from wren.context import discover_project_path  # noqa: PLC0415

        return discover_project_path()
    except SystemExit:
        return None


def _resolve_datasource(conn_dict: dict, explicit: str | None = None) -> str:
    """Return datasource from explicit arg or connection dict.

    Falls back to the 'datasource' key in *conn_dict*.  The explicit arg is
    only used by ``dry-plan`` which may not have a connection file.
    """
    if explicit:
        return explicit
    ds = conn_dict.get("datasource")
    if ds:
        return ds
    typer.echo(
        "Error: 'datasource' key not found in connection info.",
        err=True,
    )
    raise typer.Exit(1)


def _build_engine(
    mdl: str | None,
    connection_info: str | None,
    connection_file: str | None,
    *,
    conn_required: bool = True,
    datasource: str | None = None,
):
    from wren.config import load_config  # noqa: PLC0415
    from wren.engine import WrenEngine  # noqa: PLC0415
    from wren.model.data_source import DataSource  # noqa: PLC0415
    from wren.model.error import WrenError  # noqa: PLC0415

    manifest_str = _load_manifest(_require_mdl(mdl))

    # Try project-pinned profile (or fall back to active) when no explicit
    # connection flags given.
    if not connection_info and not connection_file:
        from wren.profile import (  # noqa: PLC0415
            MissingSecretError,
            expand_profile_secrets,
        )

        prof_name, prof_dict = _resolve_engine_profile(mdl)
        if prof_dict:
            prof_ds = prof_dict.pop("datasource", None)
            ds_str = datasource or prof_ds
            if ds_str is None:
                typer.echo("Error: no datasource in profile or --datasource.", err=True)
                raise typer.Exit(1)
            try:
                ds = DataSource(ds_str.lower())
            except ValueError:
                typer.echo(f"Error: unknown datasource '{ds_str}'", err=True)
                raise typer.Exit(1)
            # Resolve ${VAR} references right before handing the connection
            # info to the engine.  Keep the stored profile untouched so
            # debug output never leaks real secrets.
            try:
                prof_dict = expand_profile_secrets(prof_dict)
            except MissingSecretError as e:
                typer.echo(f"Error: {e}", err=True)
                raise typer.Exit(1)
            from pydantic import ValidationError  # noqa: PLC0415

            try:
                config = load_config(_WREN_HOME)
            except (WrenError, OSError) as e:
                typer.echo(f"Error: {e}", err=True)
                raise typer.Exit(1) from e
            try:
                return WrenEngine(
                    manifest_str=manifest_str,
                    data_source=ds,
                    connection_info=prof_dict,
                    config=config,
                )
            except ValidationError as e:
                typer.echo(f"Error: invalid profile connection info: {e}", err=True)
                raise typer.Exit(1)

    # Existing path: explicit flags / legacy connection_info.json
    conn_dict = _load_conn(connection_info, connection_file, required=conn_required)
    ds_str = _resolve_datasource(conn_dict, explicit=datasource)

    try:
        ds = DataSource(ds_str.lower())
    except ValueError:
        typer.echo(f"Error: unknown datasource '{ds_str}'", err=True)
        raise typer.Exit(1)

    try:
        config = load_config(_WREN_HOME)
        return WrenEngine(
            manifest_str=manifest_str,
            data_source=ds,
            connection_info=conn_dict,
            config=config,
        )
    except (WrenError, OSError) as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1) from e


# ── Shared option types ────────────────────────────────────────────────────

MdlOpt = Annotated[
    Optional[str],
    typer.Option(
        "--mdl",
        "-m",
        help="Path to MDL JSON file or base64 string. Defaults to <project>/target/mdl.json.",
    ),
]
ConnInfoOpt = Annotated[
    Optional[str],
    typer.Option("--connection-info", help="Inline JSON connection string"),
]
ConnFileOpt = Annotated[
    Optional[str],
    typer.Option(
        "--connection-file",
        help=f"Path to JSON connection file. Defaults to {_DEFAULT_CONN}.",
    ),
]
LimitOpt = Annotated[
    Optional[int], typer.Option("--limit", "-l", help="Max rows to return")
]
OutputOpt = Annotated[
    str, typer.Option("--output", "-o", help="Output format: json|csv|table")
]
QuietOpt = Annotated[
    bool,
    typer.Option(
        "--quiet",
        "-q",
        help="Suppress informational tips (e.g. store hints after query).",
    ),
]


def _print_store_tip(sql: str) -> None:
    """Print a memory store hint to stderr."""
    escaped = sql.replace("'", "'\\''")
    typer.echo(
        f"\n# To save this query:\n"
        f"# wren memory store --nl '<natural language question>' "
        f"--sql '{escaped}'",
        err=True,
    )


def _maybe_print_store_tip(sql: str, quiet: bool) -> None:
    if quiet:
        return
    from wren.sql_classify import is_exploratory  # noqa: PLC0415

    if not is_exploratory(sql):
        _print_store_tip(sql)


# ── Default command (no subcommand = query) ────────────────────────────────


def _version_callback(value: bool) -> None:
    """Handle ``wren --version`` the idiomatic Typer way.

    ``wren version`` remains for scripts that already use it; ``--version``
    is what most CLI tools expose and what new users try first.
    """
    if not value:
        return
    from wren import __version__  # noqa: PLC0415

    typer.echo(f"wren-engine {__version__}")
    raise typer.Exit()


@app.callback(invoke_without_command=True)
def main(
    ctx: typer.Context,
    sql: Annotated[
        Optional[str],
        typer.Option(
            "--sql", "-s", help="SQL query to execute (runs query by default)"
        ),
    ] = None,
    mdl: MdlOpt = None,
    connection_info: ConnInfoOpt = None,
    connection_file: ConnFileOpt = None,
    limit: LimitOpt = None,
    output: OutputOpt = "table",
    quiet: QuietOpt = False,
    version: Annotated[
        Optional[bool],
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Print the wren-engine version and exit.",
        ),
    ] = None,
) -> None:
    """Wren Engine CLI.

    Run with --sql to execute a query using mdl.json and connection_info.json from
    ~/.wren.  Use a subcommand (query / dry-run / dry-plan)
    for explicit control.

    The data source is always read from the 'datasource' field in
    connection_info.json (or the --connection-info / --connection-file value).

    connection_info.json format (flat):

    \b
      {
        "datasource": "mysql",
        "host": "localhost",
        "port": 3306,
        "database": "mydb",
        "user": "root",
        "password": "secret"
      }

    MCP/web envelope format is also accepted:

    \b
      {
        "datasource": "duckdb",
        "properties": { "url": "/path/to/dir", "format": "duckdb" }
      }
    """
    if ctx.invoked_subcommand is not None:
        return
    if sql is None:
        typer.echo(ctx.get_help())
        return
    with _build_engine(mdl, connection_info, connection_file) as engine:
        try:
            result = engine.query(sql, limit=limit)
        except Exception as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)
    _print_result(result, output)
    _maybe_print_store_tip(sql, quiet)


# ── Subcommands ────────────────────────────────────────────────────────────


@app.command()
def query(
    sql: Annotated[str, typer.Option("--sql", "-s", help="SQL query to execute")],
    mdl: MdlOpt = None,
    connection_info: ConnInfoOpt = None,
    connection_file: ConnFileOpt = None,
    limit: LimitOpt = None,
    output: OutputOpt = "table",
    quiet: QuietOpt = False,
):
    """Execute a SQL query through the Wren semantic layer."""
    with _build_engine(mdl, connection_info, connection_file) as engine:
        try:
            result = engine.query(sql, limit=limit)
        except Exception as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)
    _print_result(result, output)
    _maybe_print_store_tip(sql, quiet)


@app.command(name="dry-plan")
def dry_plan(
    sql: Annotated[str, typer.Option("--sql", "-s", help="SQL query to plan")],
    datasource: Annotated[
        Optional[str],
        typer.Option(
            "--datasource",
            "-d",
            help="Data source dialect (e.g. duckdb, postgres). Falls back to active profile or connection_info.json.",
        ),
    ] = None,
    mdl: MdlOpt = None,
    connection_file: ConnFileOpt = None,
):
    """Plan SQL through MDL and print the expanded SQL (no DB required)."""
    from wren.config import load_config  # noqa: PLC0415
    from wren.engine import WrenEngine  # noqa: PLC0415
    from wren.model.data_source import DataSource  # noqa: PLC0415
    from wren.model.error import WrenError  # noqa: PLC0415

    manifest_str = _load_manifest(_require_mdl(mdl))

    # Try project-pinned profile (or fall back to active) when no explicit
    # connection flags given.
    if datasource is None and connection_file is None:
        _prof_name, prof_dict = _resolve_engine_profile(mdl)
        if prof_dict:
            prof_ds = prof_dict.pop("datasource", None)
            if prof_ds is None:
                typer.echo(
                    "Error: no datasource in resolved profile "
                    "(project-pinned or active).",
                    err=True,
                )
                raise typer.Exit(1)
            try:
                ds = DataSource(prof_ds.lower())
            except ValueError:
                typer.echo(f"Error: unknown datasource '{prof_ds}'", err=True)
                raise typer.Exit(1)
            try:
                config = load_config(_WREN_HOME)
            except (WrenError, OSError) as e:
                typer.echo(f"Error: {e}", err=True)
                raise typer.Exit(1) from e
            with WrenEngine(
                manifest_str=manifest_str,
                data_source=ds,
                connection_info={},
                config=config,
            ) as engine:
                try:
                    result = engine.dry_plan(sql)
                    typer.echo(result)
                except Exception as e:
                    typer.echo(f"Error: {e}", err=True)
                    raise typer.Exit(1)
            return

    conn_dict = (
        _load_conn(None, connection_file, required=False) if datasource is None else {}
    )
    ds_str = _resolve_datasource(conn_dict, explicit=datasource)

    try:
        ds = DataSource(ds_str.lower())
    except ValueError:
        typer.echo(f"Error: unknown datasource '{ds_str}'", err=True)
        raise typer.Exit(1)

    try:
        config = load_config(_WREN_HOME)
    except (WrenError, OSError) as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1) from e

    with WrenEngine(
        manifest_str=manifest_str, data_source=ds, connection_info={}, config=config
    ) as engine:
        try:
            result = engine.dry_plan(sql)
            typer.echo(result)
        except Exception as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)


@app.command(name="dry-run")
def dry_run(
    sql: Annotated[str, typer.Option("--sql", "-s", help="SQL query to dry-run")],
    mdl: MdlOpt = None,
    connection_info: ConnInfoOpt = None,
    connection_file: ConnFileOpt = None,
):
    """Dry-run SQL against the data source (parse + validate, no results returned)."""
    with _build_engine(mdl, connection_info, connection_file) as engine:
        try:
            engine.dry_run(sql)
            typer.echo("OK")
        except Exception as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1)


# ── Output formatting ──────────────────────────────────────────────────────


def _print_result(table, output: str) -> None:
    output = output.lower()
    if output not in {"json", "csv", "table"}:
        typer.echo(
            f"Error: unsupported output format '{output}'. Use json, csv, or table.",
            err=True,
        )
        raise typer.Exit(1)
    if output == "json":
        try:
            df = table.to_pandas()
            typer.echo(df.to_json(orient="records", lines=True))
        except Exception:
            typer.echo(json.dumps(table.to_pydict()))
    elif output == "csv":
        try:
            df = table.to_pandas()
            typer.echo(df.to_csv(index=False))
        except Exception:
            typer.echo(str(table))
    else:
        try:
            df = table.to_pandas()
            typer.echo(df.to_string(index=False))
        except Exception:
            typer.echo(str(table))


@app.command()
def version():
    """Print the wren-engine version."""
    from wren import __version__  # noqa: PLC0415

    typer.echo(f"wren-engine {__version__}")


# ── Docs subcommand ───────────────────────────────────────────────────────

docs_app = typer.Typer(name="docs", help="Generate documentation for Wren Engine")


@docs_app.command(name="connection-info")
def docs_connection_info(
    datasource: Annotated[
        Optional[str],
        typer.Argument(help="Data source name (e.g. postgres, mysql). Omit for all."),
    ] = None,
    format: Annotated[
        str,
        typer.Option("--format", "-f", help="Output format: md or json"),
    ] = "md",
    envelope: Annotated[
        bool,
        typer.Option(
            "--envelope",
            help='Wrap JSON output in {"datasource": ..., "properties": ...} format.',
        ),
    ] = False,
):
    """Show connection info fields for each data source."""
    from wren.docs import generate_json_schema, generate_markdown  # noqa: PLC0415

    fmt = format.lower()
    try:
        if fmt == "md":
            typer.echo(generate_markdown(datasource))
        elif fmt == "json":
            typer.echo(generate_json_schema(datasource, envelope=envelope))
        else:
            typer.echo(
                f"Error: unsupported format '{format}'. Use md or json.", err=True
            )
            raise typer.Exit(1)
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1)


app.add_typer(docs_app)

from wren.cube_cli import cube_app  # noqa: E402, PLC0415
from wren.utils_cli import utils_app  # noqa: E402, PLC0415

app.add_typer(context_app)
app.add_typer(cube_app)
app.add_typer(utils_app)

try:
    import lancedb  # noqa: PLC0415, F401
    import sentence_transformers  # noqa: PLC0415, F401

    from wren.memory.cli import memory_app  # noqa: PLC0415

    app.add_typer(memory_app)
except ImportError:
    # `memory` is installed on demand via `pip install "wren-engine[memory]"`;
    # until then the subcommand group simply isn't registered.
    pass

from wren.profile_cli import profile_app  # noqa: PLC0415, E402

app.add_typer(profile_app)


if __name__ == "__main__":
    app()
