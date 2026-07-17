"""CLI utilities subcommand group."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

utils_app = typer.Typer(name="utils", help="Utility commands")


@utils_app.command(name="parse-type")
def parse_type_cmd(
    type_str: Annotated[str, typer.Option("--type", "-t", help="Raw SQL type string")],
    dialect: Annotated[
        str,
        typer.Option("--dialect", "-d", help="SQL dialect (e.g. postgres, bigquery)"),
    ],
):
    """Normalize a single SQL type string."""
    from wren.type_mapping import parse_type  # noqa: PLC0415

    typer.echo(parse_type(type_str, dialect))


@utils_app.command(name="parse-types")
def parse_types_cmd(
    dialect: Annotated[str, typer.Option("--dialect", "-d", help="SQL dialect")],
    type_field: Annotated[
        str,
        typer.Option("--type-field", help="Key name for raw type in input JSON"),
    ] = "raw_type",
    input_file: Annotated[
        Optional[str],
        typer.Option("--input", "-i", help="Input JSON file (default: stdin)"),
    ] = None,
):
    """Batch-normalize types. Reads JSON array from stdin or file, writes JSON to stdout.

    Input format:  [{"column": "id", "raw_type": "int8"}, ...]
    Output format: [{"column": "id", "raw_type": "int8", "type": "BIGINT"}, ...]
    """
    from wren.type_mapping import parse_types  # noqa: PLC0415

    try:
        if input_file:
            path = Path(input_file)
            if not path.exists():
                typer.echo(f"Error: file not found: {input_file}", err=True)
                raise typer.Exit(1)
            try:
                raw = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                typer.echo(f"Error: could not read file {input_file}: {e}", err=True)
                raise typer.Exit(1)
            data = json.loads(raw)
        else:
            data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid JSON input: {e}", err=True)
        raise typer.Exit(1)

    results = parse_types(data, dialect, type_field=type_field)
    if isinstance(data, list) and len(results) < len(data):
        typer.echo(
            f"Note: skipped {len(data) - len(results)} non-mapping row(s)",
            err=True,
        )
    typer.echo(json.dumps(results, indent=2))


@utils_app.command(name="translate-type")
def translate_type_cmd(
    type_str: Annotated[str, typer.Option("--type", "-t", help="Raw SQL type string")],
    source: Annotated[
        str,
        typer.Option("--source", "-s", help="Source SQL dialect (e.g. postgres)"),
    ],
    target: Annotated[
        str,
        typer.Option("--target", help="Target SQL dialect (e.g. bigquery)"),
    ],
):
    """Translate a single SQL type string from one dialect to another."""
    from wren.type_mapping import translate_type  # noqa: PLC0415

    typer.echo(translate_type(type_str, source, target))


@utils_app.command(name="translate-types")
def translate_types_cmd(
    source: Annotated[str, typer.Option("--source", "-s", help="Source SQL dialect")],
    target: Annotated[str, typer.Option("--target", help="Target SQL dialect")],
    type_field: Annotated[
        str,
        typer.Option("--type-field", help="Key name for raw type in input JSON"),
    ] = "raw_type",
    input_file: Annotated[
        Optional[str],
        typer.Option("--input", "-i", help="Input JSON file (default: stdin)"),
    ] = None,
):
    """Batch-translate types between dialects. Reads/writes JSON.

    Input format:  [{"column": "id", "raw_type": "int8"}, ...]
    Output format: [{"column": "id", "raw_type": "int8", "type": "INT64"}, ...]
    """
    from wren.type_mapping import translate_types  # noqa: PLC0415

    try:
        if input_file:
            path = Path(input_file)
            if not path.exists():
                typer.echo(f"Error: file not found: {input_file}", err=True)
                raise typer.Exit(1)
            try:
                raw = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError) as e:
                typer.echo(f"Error: could not read file {input_file}: {e}", err=True)
                raise typer.Exit(1)
            data = json.loads(raw)
        else:
            data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid JSON input: {e}", err=True)
        raise typer.Exit(1)

    results = translate_types(data, source, target, type_field=type_field)
    if isinstance(data, list) and len(results) < len(data):
        typer.echo(
            f"Note: skipped {len(data) - len(results)} non-mapping row(s)",
            err=True,
        )
    typer.echo(json.dumps(results, indent=2))
