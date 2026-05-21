"""Typer sub-app for ``wren memory`` commands."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Optional

import typer
import yaml

memory_app = typer.Typer(
    name="memory",
    help="Schema and query memory backed by LanceDB.",
)

_WREN_HOME = Path(os.environ.get("WREN_HOME", Path.home() / ".wren"))

# ── Shared option types ───────────────────────────────────────────────────

PathOpt = Annotated[
    Optional[str],
    typer.Option(
        "--path",
        "-p",
        help="LanceDB storage directory. Defaults to <project>/.wren/memory/.",
    ),
]
MdlOpt = Annotated[
    Optional[str],
    typer.Option(
        "--mdl",
        "-m",
        help="Path to MDL JSON file. Defaults to <project>/target/mdl.json.",
    ),
]
OutputOpt = Annotated[
    str, typer.Option("--output", "-o", help="Output format: json|table")
]


# ── Helpers ───────────────────────────────────────────────────────────────


def _default_memory_path() -> Path:
    """Return the project-local memory path, or ~/.wren/memory/ as fallback."""
    try:
        from wren.context import discover_project_path  # noqa: PLC0415

        return discover_project_path() / ".wren" / "memory"
    except (SystemExit, Exception):
        return _WREN_HOME / "memory"


def _load_manifest(mdl: str | None) -> dict:
    """Load and return the MDL manifest as a dict."""
    if mdl:
        mdl_path = Path(mdl).expanduser()
    else:
        try:
            from wren.context import discover_project_path  # noqa: PLC0415

            mdl_path = discover_project_path() / "target" / "mdl.json"
        except SystemExit:
            typer.echo(
                "Error: no wren project found and --mdl not specified.\n"
                "  Run this command from a directory containing wren_project.yml,\n"
                "  set WREN_PROJECT_HOME to the project path, or pass --mdl explicitly.",
                err=True,
            )
            raise typer.Exit(1)
    if not mdl_path.exists():
        typer.echo(
            f"Error: MDL file not found: {mdl_path}",
            err=True,
        )
        raise typer.Exit(1)
    try:
        return json.loads(mdl_path.read_text())
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid JSON in {mdl_path}: {e}", err=True)
        raise typer.Exit(1)


def _get_store(path: str | None):
    """Lazy-import and construct a MemoryStore."""
    resolved = path or str(_default_memory_path())
    try:
        from wren.memory.store import MemoryStore  # noqa: PLC0415

        return MemoryStore(path=resolved)
    except ModuleNotFoundError as e:
        if (e.name or "").split(".")[0] not in {
            "lancedb",
            "sentence_transformers",
            "pyarrow",
        }:
            raise
        typer.echo(
            "Error: wren[memory] extras not installed. "
            "Run: pip install 'wrenai[memory]'",
            err=True,
        )
        raise typer.Exit(1)


def _print_results(results: list[dict], output: str) -> None:
    """Format and print search results."""
    if not results:
        typer.echo("No results found.")
        return

    output = output.lower()
    if output not in {"json", "table"}:
        typer.echo(
            f"Error: unsupported output format '{output}'. Use json or table.",
            err=True,
        )
        raise typer.Exit(1)
    if output == "json":
        serializable = []
        for r in results:
            row = dict(r)
            # Convert datetime objects to ISO strings for JSON serialization
            for k, v in row.items():
                if hasattr(v, "isoformat"):
                    row[k] = v.isoformat()
            serializable.append(row)
        typer.echo(json.dumps(serializable, indent=2, ensure_ascii=False))
    else:
        try:
            import pandas as pd  # noqa: PLC0415

            df = pd.DataFrame(results)
            # Drop noisy columns for table display
            for col in ("vector", "_rowid", "_row_id"):
                if col in df.columns:
                    df = df.drop(columns=[col])
            typer.echo(df.to_string(index=False))
        except Exception:
            for r in results:
                typer.echo(str(r))


# ── Commands ──────────────────────────────────────────────────────────────


@memory_app.command()
def index(
    mdl: MdlOpt = None,
    path: PathOpt = None,
    include_instructions: Annotated[
        bool,
        typer.Option(
            "--instructions/--no-instructions",
            help="Also index user instructions from project directory.",
        ),
    ] = True,
    no_seed: Annotated[
        bool,
        typer.Option("--no-seed", help="Skip generating seed NL-SQL examples."),
    ] = False,
    no_queries: Annotated[
        bool,
        typer.Option("--no-queries", help="Skip auto-loading project queries.yml."),
    ] = False,
) -> None:
    """Index MDL schema into LanceDB (and optionally seed example queries)."""
    manifest = _load_manifest(mdl)

    if include_instructions and mdl is None:
        try:
            from wren.context import (  # noqa: I001, PLC0415
                discover_project_path,
                load_instructions,
            )

            project_path = discover_project_path()
            instr = load_instructions(project_path)
            if instr:
                manifest["_instructions"] = instr
        except (
            SystemExit,
            FileNotFoundError,
            PermissionError,
            IsADirectoryError,
            UnicodeDecodeError,
            ImportError,
            ModuleNotFoundError,
        ):
            pass  # instructions are optional; never fail index because of them

    mem_store = _get_store(path)
    result = mem_store.index_schema(manifest, seed_queries=not no_seed)
    typer.echo(
        f"Indexed {result['schema_items']} schema items"
        + (f", {result['seed_queries']} seed queries" if result["seed_queries"] else "")
        + "."
    )

    # ── Auto-load project queries.yml ──
    if not no_queries:
        try:
            from wren.context import discover_project_path  # noqa: PLC0415

            project_path = discover_project_path(explicit=None)
            queries_file = project_path / "queries.yml"
            if queries_file.exists():
                raw = queries_file.read_text(encoding="utf-8")
                doc = yaml.safe_load(raw)
                if doc and isinstance(doc, dict) and doc.get("pairs"):
                    load_result = mem_store.load_queries(doc["pairs"], upsert=False)
                    loaded = load_result["loaded"]
                    skipped = load_result["skipped"]
                    if loaded:
                        typer.echo(
                            f"Loaded {loaded} pair(s) from queries.yml"
                            f" ({skipped} skipped).",
                            err=True,
                        )
        except (
            SystemExit,
            FileNotFoundError,
            PermissionError,
            IsADirectoryError,
            UnicodeDecodeError,
            ImportError,
            ModuleNotFoundError,
            yaml.YAMLError,
            KeyError,
            TypeError,
            ValueError,
        ) as e:
            if not isinstance(e, (SystemExit, ImportError, ModuleNotFoundError)):
                typer.echo(
                    f"Warning: failed to load queries.yml: {e}",
                    err=True,
                )


@memory_app.command()
def describe(
    mdl: MdlOpt = None,
) -> None:
    """Print the full schema as structured plain text (no embedding needed)."""
    from wren.memory.schema_indexer import describe_schema  # noqa: PLC0415

    manifest = _load_manifest(mdl)
    text = describe_schema(manifest)
    typer.echo(text)


@memory_app.command()
def fetch(
    query: Annotated[str, typer.Option("--query", "-q", help="Search query")],
    mdl: MdlOpt = None,
    limit: Annotated[int, typer.Option("--limit", "-l")] = 5,
    item_type: Annotated[
        Optional[str],
        typer.Option(
            "--type",
            "-t",
            help="Filter: model|column|relationship|view (search strategy only)",
        ),
    ] = None,
    model_name: Annotated[
        Optional[str],
        typer.Option("--model", help="Filter by model name (search strategy only)"),
    ] = None,
    threshold: Annotated[
        Optional[int],
        typer.Option(
            "--threshold", help="Character threshold for full vs search strategy"
        ),
    ] = None,
    path: PathOpt = None,
    output: OutputOpt = "table",
) -> None:
    """Get schema context for an LLM.

    Small schemas are returned as full plain text.  Large schemas use
    embedding search with optional --type and --model filters.
    """
    manifest = _load_manifest(mdl)
    store = _get_store(path)
    kwargs: dict = {"limit": limit, "item_type": item_type, "model_name": model_name}
    if threshold is not None:
        kwargs["threshold"] = threshold
    result = store.get_context(manifest, query, **kwargs)
    strategy = result["strategy"]
    if output.lower() == "json":
        payload = dict(result)
        if "results" in payload:
            payload["results"] = [
                {
                    k: (v.isoformat() if hasattr(v, "isoformat") else v)
                    for k, v in row.items()
                }
                for row in payload["results"]
            ]
        typer.echo(json.dumps(payload, indent=2, ensure_ascii=False))
        return
    typer.echo(f"Strategy: {strategy}")
    if strategy == "full":
        typer.echo(result["schema"])
    else:
        _print_results(result["results"], output)


@memory_app.command()
def store(
    nl: Annotated[str, typer.Option("--nl", help="Natural language query")],
    sql: Annotated[str, typer.Option("--sql", help="Corresponding SQL query")],
    datasource: Annotated[Optional[str], typer.Option("--datasource", "-d")] = None,
    tags: Annotated[Optional[str], typer.Option("--tags")] = None,
    path: PathOpt = None,
) -> None:
    """Store a NL→SQL pair for future few-shot retrieval."""
    mem_store = _get_store(path)
    mem_store.store_query(nl, sql, datasource=datasource, tags=tags)
    typer.echo("Query stored.")


@memory_app.command()
def recall(
    query: Annotated[str, typer.Option("--query", "-q", help="Search query")],
    limit: Annotated[int, typer.Option("--limit", "-l")] = 3,
    datasource: Annotated[Optional[str], typer.Option("--datasource", "-d")] = None,
    path: PathOpt = None,
    output: OutputOpt = "table",
) -> None:
    """Search past NL→SQL pairs by semantic similarity."""
    mem_store = _get_store(path)
    results = mem_store.recall_queries(query, limit=limit, datasource=datasource)
    _print_results(results, output)


@memory_app.command()
def status(
    path: PathOpt = None,
) -> None:
    """Show memory index statistics."""
    mem_store = _get_store(path)
    info = mem_store.status()
    typer.echo(f"Path: {info['path']}")
    tables = info.get("tables", {})
    if not tables:
        typer.echo("No tables indexed yet.")
        return
    for name, count in tables.items():
        typer.echo(f"  {name}: {count} rows")


@memory_app.command()
def reset(
    path: PathOpt = None,
    force: Annotated[
        bool, typer.Option("--force", "-f", help="Skip confirmation")
    ] = False,
) -> None:
    """Drop all memory tables and start fresh."""
    if not force:
        confirm = typer.confirm("This will delete all indexed memory. Continue?")
        if not confirm:
            raise typer.Abort()
    mem_store = _get_store(path)
    mem_store.reset()
    typer.echo("Memory reset.")


# ── List / Forget / Dump / Load ──────────────────────────────────────────


@memory_app.command("list")
def list_queries(
    source: Annotated[
        Optional[str],
        typer.Option("--source", "-s", help="Filter by source: seed, user, view"),
    ] = None,
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max rows to show")] = 20,
    offset: Annotated[int, typer.Option("--offset", help="Skip first N rows")] = 0,
    output: OutputOpt = "table",
    path: PathOpt = None,
) -> None:
    """Browse stored NL-SQL pairs."""
    mem_store = _get_store(path)
    rows, total = mem_store.list_queries(source=source, limit=limit, offset=offset)
    if not rows:
        typer.echo("No pairs found.")
        raise typer.Exit()
    _print_results(rows, output)
    end = min(offset + limit, total)
    typer.echo(f"\nShowing {offset + 1}-{end} of {total} pairs.", err=True)


# ── Forget helpers ───────────────────────────────────────────────────────


def _format_choice_label(row: dict, max_nl: int = 40, max_sql: int = 50) -> str:
    """Format a row as a human-readable choice label."""
    source = "user"
    tags = row.get("tags", "")
    if "source:seed" in tags:
        source = "seed"
    elif "source:view" in tags:
        source = "view"
    nl = row.get("nl_query", "")[:max_nl]
    sql = row.get("sql_query", "").replace("\n", " ")[:max_sql]
    return f'[{source}] "{nl}" → {sql}'


def _interactive_forget(mem_store, source: str | None, limit: int) -> None:
    """Launch interactive checkbox UI for selecting pairs to forget."""
    try:
        from InquirerPy import inquirer  # noqa: PLC0415
        from InquirerPy.base.control import Choice  # noqa: PLC0415
    except ImportError:
        typer.echo(
            "Interactive mode requires InquirerPy.\n"
            "Install with: pip install wrenai[interactive]\n"
            "Or use: wren memory forget --id <ID> [--id <ID> ...]",
            err=True,
        )
        raise typer.Exit(1)

    rows, total = mem_store.list_queries(source=source, limit=limit, offset=0)
    if not rows:
        typer.echo("No pairs found.")
        raise typer.Exit()

    choices = [
        Choice(value=row["_row_id"], name=_format_choice_label(row)) for row in rows
    ]

    selected = inquirer.checkbox(
        message=f"Select pairs to forget ({total} total, showing {len(rows)}):",
        choices=choices,
        validate=lambda r: len(r) >= 1,
        invalid_message="Select at least 1 pair.",
        instruction="(↑↓ move, Space toggle, Enter confirm, Ctrl+C cancel)",
    ).execute()

    if not selected:
        typer.echo("Nothing selected.")
        raise typer.Exit()

    typer.confirm(f"Forget {len(selected)} pair(s)?", abort=True)
    deleted = mem_store.forget_queries_by_ids(selected)
    typer.echo(f"Forgot {deleted} pair(s).")


@memory_app.command("forget")
def forget(
    ids: Annotated[
        Optional[list[int]],
        typer.Option("--id", help="Row IDs to forget (non-interactive)"),
    ] = None,
    source: Annotated[
        Optional[str],
        typer.Option("--source", "-s", help="Filter by source: seed, user, view"),
    ] = None,
    force: Annotated[
        bool,
        typer.Option("--force", "-f", help="Skip interactive UI / confirmation"),
    ] = False,
    limit: Annotated[
        int,
        typer.Option("--limit", "-n", help="Max rows to load in interactive mode"),
    ] = 50,
    path: PathOpt = None,
) -> None:
    """Remove NL-SQL pairs from memory.

    Default: interactive checkbox UI.
    With --id or --force: non-interactive mode for scripts and agents.
    """
    mem_store = _get_store(path)

    # ── Non-interactive: --id specified ──
    if ids:
        if source:
            typer.echo("Error: --id and --source cannot be used together.", err=True)
            raise typer.Exit(1)
        if not force:
            typer.confirm(f"Forget {len(ids)} pair(s) by ID?", abort=True)
        deleted = mem_store.forget_queries_by_ids(ids)
        typer.echo(f"Forgot {deleted} pair(s).")
        return

    # ── Non-interactive: --source + --force (batch delete) ──
    if source and force:
        count = mem_store.count_queries_by_source(source)
        if count == 0:
            typer.echo("Nothing to forget.")
            raise typer.Exit()
        deleted = mem_store.forget_queries_by_source(source)
        typer.echo(f"Forgot {deleted} pair(s) with source:{source}.")
        return

    # ── Interactive: default or --source (filter only) ──
    _interactive_forget(mem_store, source=source, limit=limit)


# ── Dump / Load helpers ──────────────────────────────────────────────────


def _parse_source(tags: str) -> str:
    """Extract source value from tags string."""
    for part in tags.split():
        if part.startswith("source:"):
            return part[len("source:") :]
    return "user"


def _pairs_to_yaml(rows: list[dict]) -> str:
    """Convert query rows to YAML dump format."""
    pairs = []
    for r in rows:
        pair: dict = {
            "nl": r["nl_query"],
            "sql": r["sql_query"],
            "source": _parse_source(r.get("tags", "")),
        }
        if r.get("datasource"):
            pair["datasource"] = r["datasource"]
        if r.get("created_at"):
            ts = r["created_at"]
            pair["created_at"] = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        pairs.append(pair)

    doc = {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "pairs": pairs,
    }
    return yaml.dump(doc, allow_unicode=True, sort_keys=False, default_flow_style=False)


def _discover_project_queries_path() -> Path | None:
    """Return ``<project>/queries.yml`` if inside a wren project, else None."""
    try:
        from wren.context import discover_project_path  # noqa: PLC0415

        return discover_project_path() / "queries.yml"
    except (SystemExit, Exception):
        return None


@memory_app.command("dump")
def dump(
    source: Annotated[
        Optional[str],
        typer.Option("--source", "-s", help="Filter by source: seed, user, view"),
    ] = None,
    output: Annotated[
        Optional[str],
        typer.Option(
            "--output",
            "-o",
            help="Output file ('-' for stdout). Default: project queries.yml or stdout.",
        ),
    ] = None,
    path: PathOpt = None,
) -> None:
    """Export NL-SQL pairs to YAML."""
    mem_store = _get_store(path)
    rows = mem_store.dump_queries(source=source)
    if not rows:
        typer.echo("No pairs to dump.", err=True)
        raise typer.Exit()

    content = _pairs_to_yaml(rows)

    if output == "-":
        # Explicit stdout
        typer.echo(content)
    elif output:
        Path(output).write_text(content, encoding="utf-8")
        typer.echo(f"Dumped {len(rows)} pair(s) to {output}", err=True)
    else:
        # Default: try project queries.yml, fall back to stdout
        project_file = _discover_project_queries_path()
        if project_file:
            project_file.write_text(content, encoding="utf-8")
            typer.echo(f"Dumped {len(rows)} pair(s) to {project_file}", err=True)
        else:
            typer.echo(content)


@memory_app.command("load")
def load(
    file: Annotated[str, typer.Argument(help="YAML file to load")],
    upsert: Annotated[
        bool,
        typer.Option("--upsert", help="Update sql if same nl_query exists"),
    ] = False,
    overwrite: Annotated[
        bool,
        typer.Option(
            "--overwrite",
            help="Clear existing pairs of same source before loading",
        ),
    ] = False,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Validate and count only, don't write"),
    ] = False,
    path: PathOpt = None,
) -> None:
    """Import NL-SQL pairs from YAML.

    Default: skip duplicates (idempotent).
    --upsert: update sql for existing nl_query.
    --overwrite: clear all pairs of same source first.
    """
    if upsert and overwrite:
        typer.echo("Error: --upsert and --overwrite cannot be used together.", err=True)
        raise typer.Exit(1)

    file_path = Path(file).expanduser()
    if not file_path.exists():
        typer.echo(f"Error: file not found: {file_path}", err=True)
        raise typer.Exit(1)

    try:
        raw = file_path.read_text(encoding="utf-8")
        doc = yaml.safe_load(raw)
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as e:
        typer.echo(f"Error: unable to read YAML from {file_path}: {e}", err=True)
        raise typer.Exit(1)

    # ── Validate ──
    if not isinstance(doc, dict) or "pairs" not in doc:
        typer.echo("Error: invalid YAML — missing 'pairs' key.", err=True)
        raise typer.Exit(1)
    version = doc.get("version", 1)
    if version != 1:
        typer.echo(f"Error: unsupported version {version}.", err=True)
        raise typer.Exit(1)

    pairs = doc["pairs"]
    if not isinstance(pairs, list) or not all(isinstance(p, dict) for p in pairs):
        typer.echo("Error: 'pairs' must be a list of objects.", err=True)
        raise typer.Exit(1)
    if not pairs:
        typer.echo("No pairs to load.")
        raise typer.Exit()

    for i, p in enumerate(pairs):
        if "nl" not in p or "sql" not in p:
            typer.echo(f"Error: pair #{i + 1} missing 'nl' or 'sql'.", err=True)
            raise typer.Exit(1)

    # ── Summary ──
    from collections import Counter  # noqa: PLC0415

    sources = Counter(p.get("source", "user") for p in pairs)
    summary = ", ".join(f"{s}: {c}" for s, c in sources.items())
    mode = "upsert" if upsert else "overwrite" if overwrite else "skip-duplicates"
    typer.echo(
        f"{'Would load' if dry_run else 'Loading'} {len(pairs)} pair(s)"
        f" ({summary}) [{mode}]",
        err=True,
    )

    if dry_run:
        raise typer.Exit()

    # ── Load ──
    mem_store = _get_store(path)
    result = mem_store.load_queries(pairs, overwrite=overwrite, upsert=upsert)

    # ── Report ──
    parts = []
    if result["loaded"]:
        parts.append(f"{result['loaded']} new")
    if result["updated"]:
        parts.append(f"{result['updated']} updated")
    if result["skipped"]:
        parts.append(f"{result['skipped']} skipped")
    total = result["loaded"] + result["updated"]
    typer.echo(f"Loaded {total} pair(s) ({', '.join(parts)}).")
