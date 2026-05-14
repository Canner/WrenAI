"""Typer sub-app for ``wren cube`` commands."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

cube_app = typer.Typer(
    name="cube",
    help="Query and inspect cubes — structured measure/dimension queries over the semantic layer.",
)


_MdlOpt = Annotated[
    Optional[str],
    typer.Option(
        "--mdl",
        "-m",
        help="Path to MDL JSON file. Defaults to <project>/target/mdl.json.",
    ),
]


def _load_mdl_json(mdl: str | None) -> str:
    """Return the raw JSON contents of mdl.json (decoded if a path is given)."""
    from wren.cli import _require_mdl  # noqa: PLC0415

    path_str = _require_mdl(mdl)
    path = Path(path_str).expanduser()
    if path.exists():
        return path.read_text()
    typer.echo(f"Error: MDL file not found: {path}", err=True)
    raise typer.Exit(1)


def _parse_filter(spec: str) -> dict:
    """Parse a CLI ``--filter`` spec.

    Format::

        dimension:operator                # e.g. status:is_null
        dimension:operator:value          # e.g. status:eq:completed
        dimension:in:a,b,c                # IN filter, comma-separated values

    Values are kept as strings; numeric operators rely on the engine to
    coerce. ``in`` / ``not_in`` always produce a list value.
    """
    parts = spec.split(":", 2)
    if len(parts) < 2:
        raise typer.BadParameter(f"--filter expects 'dim:op[:value]', got '{spec}'")
    dim, op = parts[0], parts[1]
    f: dict = {"dimension": dim, "operator": op}
    if len(parts) == 3:
        raw = parts[2]
        if op in {"in", "not_in"}:
            values = [v.strip() for v in raw.split(",") if v.strip()]
            if not values:
                raise typer.BadParameter(
                    f"--filter with {op} requires at least one value, got '{spec}'"
                )
            f["value"] = values
        else:
            f["value"] = raw
    elif op in {"in", "not_in"}:
        raise typer.BadParameter(
            f"--filter with {op} expects 'dim:{op}:value1,value2,…', got '{spec}'"
        )
    return f


def _parse_time_dimension(spec: str) -> dict:
    """Parse a ``--time-dimension`` spec ``name:granularity[:start,end]``."""
    parts = spec.split(":", 2)
    if len(parts) < 2:
        raise typer.BadParameter(
            f"--time-dimension expects 'name:granularity[:start,end]', got '{spec}'"
        )
    td: dict = {"dimension": parts[0], "granularity": parts[1]}
    if len(parts) == 3:
        dates = [d.strip() for d in parts[2].split(",")]
        if len(dates) != 2:
            raise typer.BadParameter(
                "--time-dimension dateRange must be 'start,end' (exactly two dates)"
            )
        td["dateRange"] = dates
    return td


def _build_cube_query(
    cube: str,
    measures: str,
    dimensions: str,
    time_dimension: str | None,
    filters: list[str],
    limit: int | None,
    offset: int | None,
) -> dict:
    q: dict = {
        "cube": cube,
        "measures": [m.strip() for m in measures.split(",") if m.strip()],
    }
    if dimensions:
        q["dimensions"] = [d.strip() for d in dimensions.split(",") if d.strip()]
    if time_dimension:
        q["timeDimensions"] = [_parse_time_dimension(time_dimension)]
    if filters:
        q["filters"] = [_parse_filter(f) for f in filters]
    if limit is not None:
        q["limit"] = limit
    if offset is not None:
        q["offset"] = offset
    return q


def _load_cube_query_from(source: str) -> dict:
    """Load a CubeQuery dict from ``-`` (stdin) or a JSON file path."""
    if source == "-":
        raw = sys.stdin.read()
        label = "stdin"
    else:
        p = Path(source).expanduser()
        if not p.exists():
            typer.echo(f"Error: CubeQuery file not found: {p}", err=True)
            raise typer.Exit(1)
        raw = p.read_text()
        label = str(p)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid JSON in {label}: {e}", err=True)
        raise typer.Exit(1) from e
    if not isinstance(data, dict):
        typer.echo(f"Error: CubeQuery in {label} must be a JSON object.", err=True)
        raise typer.Exit(1)
    return data


def _load_manifest_dict(mdl: str | None) -> dict:
    """Read mdl.json, parse, surface clean errors on bad JSON / non-object."""
    mdl_json = _load_mdl_json(mdl)
    try:
        manifest = json.loads(mdl_json)
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid MDL JSON: {e}", err=True)
        raise typer.Exit(1) from e
    if not isinstance(manifest, dict):
        typer.echo("Error: MDL JSON must be an object.", err=True)
        raise typer.Exit(1)
    return manifest


# ── wren cube list ─────────────────────────────────────────────────────────


@cube_app.command(name="list")
def list_cubes(mdl: _MdlOpt = None) -> None:
    """List all cubes defined in the project."""
    manifest = _load_manifest_dict(mdl)
    cubes = manifest.get("cubes", []) or []
    if not cubes:
        typer.echo("No cubes defined.")
        return
    for cube in cubes:
        name = cube.get("name", "<unnamed>")
        base = cube.get("baseObject", "?")
        measures = ", ".join(m.get("name", "") for m in cube.get("measures", []))
        dims = ", ".join(d.get("name", "") for d in cube.get("dimensions", []))
        time_dims = ", ".join(
            td.get("name", "") for td in cube.get("timeDimensions", [])
        )
        typer.echo(f"  {name} (base: {base})")
        if measures:
            typer.echo(f"    measures: {measures}")
        if dims:
            typer.echo(f"    dimensions: {dims}")
        if time_dims:
            typer.echo(f"    time dimensions: {time_dims}")


# ── wren cube describe ─────────────────────────────────────────────────────


@cube_app.command()
def describe(
    name: Annotated[str, typer.Argument(help="Cube name to describe")],
    mdl: _MdlOpt = None,
) -> None:
    """Print the full schema for a cube (JSON)."""
    manifest = _load_manifest_dict(mdl)
    cubes = manifest.get("cubes", []) or []
    cube = next((c for c in cubes if c.get("name") == name), None)
    if cube is None:
        typer.echo(f"Cube '{name}' not found.", err=True)
        raise typer.Exit(1)
    typer.echo(json.dumps(cube, indent=2))


# ── wren cube query ────────────────────────────────────────────────────────


@cube_app.command()
def query(
    cube: Annotated[
        Optional[str],
        typer.Option("--cube", "-c", help="Cube name"),
    ] = None,
    measures: Annotated[
        Optional[str],
        typer.Option("--measures", help="Comma-separated measure names"),
    ] = None,
    dimensions: Annotated[
        Optional[str],
        typer.Option("--dimensions", help="Comma-separated dimension names"),
    ] = None,
    time_dimension: Annotated[
        Optional[str],
        typer.Option(
            "--time-dimension",
            help="Format: name:granularity[:start,end]",
        ),
    ] = None,
    filter_: Annotated[
        Optional[list[str]],
        typer.Option(
            "--filter",
            help=(
                "Repeatable. Format: dim:op[:value]. "
                "For 'in'/'not_in', value is comma-separated."
            ),
        ),
    ] = None,
    limit: Annotated[
        Optional[int], typer.Option("--limit", "-l", help="Max rows to return")
    ] = None,
    offset: Annotated[
        Optional[int], typer.Option("--offset", help="Skip N rows")
    ] = None,
    from_json: Annotated[
        Optional[str],
        typer.Option(
            "--from",
            help="Load CubeQuery from a JSON file (or '-' for stdin).",
        ),
    ] = None,
    sql_only: Annotated[
        bool,
        typer.Option(
            "--sql-only",
            help="Print the generated SQL and exit without executing.",
        ),
    ] = False,
    mdl: _MdlOpt = None,
    connection_info: Annotated[
        Optional[str],
        typer.Option("--connection-info", help="Inline JSON connection string"),
    ] = None,
    connection_file: Annotated[
        Optional[str],
        typer.Option("--connection-file", help="Path to JSON connection file"),
    ] = None,
    output: Annotated[
        str, typer.Option("--output", "-o", help="Output format: json|csv|table")
    ] = "table",
) -> None:
    """Execute a structured cube query.

    Build the query from CLI flags (``--cube`` / ``--measures`` / …) or load
    it from JSON via ``--from <file|->``. The CubeQuery is translated to
    SQL by wren-core, then executed through WrenEngine just like a regular
    ``wren query``.
    """
    if from_json:
        cube_query = _load_cube_query_from(from_json)
    else:
        if not cube or not measures:
            typer.echo(
                "Error: --cube and --measures are required (or use --from).",
                err=True,
            )
            raise typer.Exit(1)
        cube_query = _build_cube_query(
            cube,
            measures,
            dimensions or "",
            time_dimension,
            filter_ or [],
            limit,
            offset,
        )

    mdl_json = _load_mdl_json(mdl)

    from wren_core import cube_query_to_sql  # noqa: PLC0415

    try:
        sql = cube_query_to_sql(json.dumps(cube_query), mdl_json)
    except ValueError as e:
        typer.echo(f"Error: {e}", err=True)
        raise typer.Exit(1) from e

    if sql_only:
        typer.echo(sql)
        return

    from wren.cli import _build_engine, _print_result  # noqa: PLC0415

    with _build_engine(mdl, connection_info, connection_file) as engine:
        try:
            result = engine.query(sql)
        except Exception as e:
            typer.echo(f"Error: {e}", err=True)
            raise typer.Exit(1) from e
    _print_result(result, output)
