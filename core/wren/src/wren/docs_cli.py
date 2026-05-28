"""``wren docs`` — connection-info generation + reference doc delivery."""

from __future__ import annotations

from typing import Annotated, Optional

import typer

from wren import docs_delivery

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


@docs_app.command(name="list")
def list_cmd() -> None:
    """List the available reference docs."""
    refs = docs_delivery.list_references()
    typer.echo("Available references (run `wren docs get <reference>`):")
    width = max(len(name) for name, _ in refs)
    for name, summary in refs:
        typer.echo(f"  {name.ljust(width)}  {summary}")


@docs_app.command()
def get(
    reference: str = typer.Argument(..., help="Reference name (see `wren docs list`)."),
) -> None:
    """Print a reference doc to stdout."""
    try:
        content = docs_delivery.get_reference(reference)
    except docs_delivery.ReferenceNotFoundError:
        typer.echo(
            f"Error: unknown reference '{reference}'. "
            "Run `wren docs list` for available references.",
            err=True,
        )
        raise typer.Exit(1)
    typer.echo(content)
