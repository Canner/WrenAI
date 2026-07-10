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
    help="Schema and query memory backed by Qdrant.",
)


@memory_app.callback()
def _load_env_before_memory_commands() -> None:
    """Load .env before any memory command runs.

    Reuses the profile env loader so QDRANT_URL / VOLC_ARK_API_KEY may
    live in .env instead of the shell: $CWD/.env, the project-root .env
    (next to wren_project.yml), and ~/.wren/.env. Shell-exported vars
    still win (override=False).
    """
    from wren.profile import _ensure_env_loaded  # noqa: PLC0415

    _ensure_env_loaded()

# ── Shared option types ───────────────────────────────────────────────────

UrlOpt = Annotated[
    Optional[str],
    typer.Option(
        "--url",
        "-p",
        help="Qdrant server URL. Overrides $QDRANT_URL.",
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


def _default_url() -> str | None:
    """Return the Qdrant URL from the environment, if configured."""
    return os.environ.get("QDRANT_URL")


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
        return json.loads(mdl_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        typer.echo(f"Error: invalid JSON in {mdl_path}: {e}", err=True)
        raise typer.Exit(1)


def _get_store(url: str | None):
    """Lazy-import and construct a MemoryStore."""
    resolved = url or _default_url()
    if not resolved:
        typer.echo(
            "Error: QDRANT_URL is not set. Point it at a Qdrant server, e.g. "
            "export QDRANT_URL=http://localhost:6333, or pass --url.",
            err=True,
        )
        raise typer.Exit(1)
    try:
        from wren.memory.store import MemoryStore  # noqa: PLC0415

        return MemoryStore(url=resolved)
    except ModuleNotFoundError as e:
        if (e.name or "").split(".")[0] not in {"qdrant_client", "openai"}:
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
    url: UrlOpt = None,
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
    """Index the project for recall.

    With the ``memory`` extra: builds the Qdrant semantic index (schema + seed
    + knowledge/sql pairs). Without it: the grep backend reads knowledge/sql/*.md
    directly, so there is nothing to build.
    """
    from wren.memory.index_backend import resolve_backend  # noqa: PLC0415

    if resolve_backend() == "grep":
        from wren.context import discover_project_path  # noqa: PLC0415
        from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

        try:
            project_path = discover_project_path()
        except SystemExit as e:
            typer.echo(str(e), err=True)
            raise typer.Exit(1)
        n = len(load_query_pairs(project_path))
        typer.echo(
            f"grep backend: {n} pair(s) in knowledge/sql/ - no index build needed."
        )
        typer.echo(
            "`wren memory recall` works over grep; semantic schema search "
            "(`wren memory fetch`) needs `wren[memory]`.",
            err=True,
        )
        return

    manifest = _load_manifest(mdl)

    if include_instructions and mdl is None:
        try:
            from wren.context import (  # noqa: I001, PLC0415
                discover_project_path,
                load_rules,
            )

            project_path = discover_project_path()
            instr, _ = load_rules(project_path)
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

    mem_store = _get_store(url)
    result = mem_store.index_schema(manifest, seed_queries=not no_seed)
    typer.echo(
        f"Indexed {result['schema_items']} schema items"
        + (f", {result['seed_queries']} seed queries" if result["seed_queries"] else "")
        + "."
    )

    # ── Rebuild query history from knowledge/sql/*.md (source of truth) ──
    # Legacy queries.yml is still loaded when present, for the transition.
    if not no_queries:
        try:
            from wren.context import discover_project_path  # noqa: PLC0415
            from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

            project_path = discover_project_path(explicit=None)

            md_pairs = load_query_pairs(project_path)
            if md_pairs:
                # upsert -> re-running index converges on the markdown content.
                res = mem_store.load_queries(md_pairs, upsert=True)
                typer.echo(
                    f"Indexed {res['loaded'] + res['updated']} pair(s) from "
                    f"knowledge/sql/.",
                    err=True,
                )

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
                            f"Loaded {loaded} pair(s) from queries.yml (legacy)"
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
    url: UrlOpt = None,
    output: OutputOpt = "table",
) -> None:
    """Get schema context for an LLM.

    Small schemas are returned as full plain text.  Large schemas use
    embedding search with optional --type and --model filters.
    """
    manifest = _load_manifest(mdl)
    store = _get_store(url)
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
    url: UrlOpt = None,
) -> None:
    """Store a NL->SQL pair as knowledge/sql/<slug>.md (source of truth), then index it.

    The markdown file is always written (no extra required). When the ``memory``
    extra is installed, the pair is also indexed into Qdrant for semantic recall.
    """
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.markdown import write_query_markdown  # noqa: PLC0415

    try:
        project_path = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    md_path = write_query_markdown(
        project_path, nl, sql, datasource=datasource, tags=tag_list
    )
    typer.echo(f"Stored: {md_path}")

    # Best-effort: index into Qdrant when the memory extra is available.
    try:
        from wren.memory.store import MemoryStore  # noqa: PLC0415

        resolved = url or _default_url()
        if resolved:
            MemoryStore(url=resolved).store_query(
                nl, sql, datasource=datasource, tags=tags
            )
    except ModuleNotFoundError as e:
        if (e.name or "").split(".")[0] not in {"qdrant_client", "openai"}:
            raise
        # memory extra not installed - markdown-only; run `wren memory index` later.


@memory_app.command()
def recall(
    query: Annotated[str, typer.Option("--query", "-q", help="Search query")],
    limit: Annotated[int, typer.Option("--limit", "-l")] = 3,
    datasource: Annotated[Optional[str], typer.Option("--datasource", "-d")] = None,
    url: UrlOpt = None,
    output: OutputOpt = "table",
) -> None:
    """Search past NL->SQL pairs over knowledge/sql/.

    Uses semantic search with the ``memory`` extra, or dependency-free token
    matching (grep backend) without it.
    """
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.index_backend import get_index  # noqa: PLC0415

    try:
        project = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)
    idx = get_index(project, url=url)
    results = idx.search(query, limit=limit, datasource=datasource)
    _annotate_markdown_paths(results)
    _print_results(results, output)


def _annotate_markdown_paths(results: list[dict]) -> None:
    """Best-effort: point each recall result at its knowledge/sql/*.md source.

    Matches on the exact NL (not a derived slug), so collision-suffixed files
    are attributed correctly.
    """
    try:
        from wren.context import discover_project_path  # noqa: PLC0415
        from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

        project = discover_project_path()
    except (SystemExit, Exception):  # noqa: BLE001 - annotation is optional
        return
    nl_to_path = {p["nl"]: p["path"] for p in load_query_pairs(project)}
    for r in results:
        nl = r.get("nl_query") or r.get("nl")
        if nl and nl in nl_to_path:
            r["path"] = nl_to_path[nl]


@memory_app.command()
def status(
    url: UrlOpt = None,
) -> None:
    """Show memory backend and index statistics."""
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.index_backend import get_index  # noqa: PLC0415

    try:
        project = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)
    info = get_index(project, url=url).status()
    typer.echo(f"Backend: {info['backend']}")
    if info["backend"] == "grep":
        typer.echo(f"  knowledge/sql: {info['pairs']} pair(s)")
        return
    server_url = info.get("url")
    if server_url:
        typer.echo(f"  url: {server_url}")
    tables = info.get("tables", {})
    if not tables:
        typer.echo("No collections indexed yet.")
        return
    for name, count in tables.items():
        typer.echo(f"  {name}: {count} rows")


@memory_app.command()
def reset(
    url: UrlOpt = None,
    force: Annotated[
        bool, typer.Option("--force", "-f", help="Skip confirmation")
    ] = False,
) -> None:
    """Drop the derived memory index. knowledge/sql/*.md is preserved.

    The Qdrant index is a derived artifact - after reset, run `wren memory
    index` to rebuild it from the markdown source of truth.
    """
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.index_backend import get_index  # noqa: PLC0415

    try:
        project = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)
    idx = get_index(project, url=url)
    if idx.name == "grep":
        typer.echo("grep backend has no derived index - knowledge/sql/ is the source.")
        return
    if not force:
        confirm = typer.confirm(
            "This drops the derived memory index. Your knowledge/sql/*.md "
            "source files are kept. Continue?"
        )
        if not confirm:
            raise typer.Abort()
    idx.reset()
    typer.echo(
        "Memory index reset. Run `wren memory index` to rebuild from knowledge/sql/."
    )


@memory_app.command()
def check(
    url: UrlOpt = None,
) -> None:
    """Report drift between knowledge/sql/*.md (source) and the derived index."""
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.index_backend import get_index  # noqa: PLC0415
    from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

    try:
        project = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    idx = get_index(project, url=url)
    if idx.name == "grep":
        n = len(load_query_pairs(project))
        typer.echo(
            f"grep backend: knowledge/sql/ is the index ({n} pair(s)) - always in sync."
        )
        return

    md_nls = {p["nl"] for p in load_query_pairs(project)}
    mem_store = idx.store
    indexed, _ = mem_store.list_queries(limit=1_000_000)
    indexed_nls = {r.get("nl_query") for r in indexed}
    # Only user-sourced pairs come from markdown; seeds/views are derived from
    # the manifest and are not expected to have a knowledge/sql/ file.
    indexed_user = {
        r.get("nl_query")
        for r in indexed
        if _parse_source(r.get("tags")) not in ("seed", "view")
    }

    # Compare user pairs only - seed/view rows aren't markdown-backed.
    missing = md_nls - indexed_user  # in markdown but not indexed as a user pair
    stale = indexed_user - md_nls  # user-indexed but no longer in markdown

    typer.echo(
        f"knowledge/sql: {len(md_nls)} pair(s); index: {len(indexed_nls)} pair(s)"
    )
    if not missing and not stale:
        typer.echo("In sync.")
        return
    if missing:
        typer.echo(f"  {len(missing)} not indexed - run `wren memory index`.")
    if stale:
        typer.echo(
            f"  {len(stale)} user pair(s) indexed without markdown - "
            "stale index, run `wren memory index`."
        )


@memory_app.command()
def watch(
    mdl: MdlOpt = None,
    url: UrlOpt = None,
    interval: Annotated[
        float,
        typer.Option(
            "--interval",
            "-i",
            help="Seconds between polls (min 1).",
        ),
    ] = 5.0,
    reindex_on_start: Annotated[
        bool,
        typer.Option(
            "--reindex-on-start/--no-reindex-on-start",
            help="Reindex once on startup before watching.",
        ),
    ] = False,
    max_polls: Annotated[
        Optional[int],
        typer.Option(
            "--max-polls",
            help="Stop after N polls (mainly for scripting/testing). "
            "Default: run until Ctrl+C.",
        ),
    ] = None,
) -> None:
    """Watch project sources and auto-reindex memory on change.

    Polls ``target/mdl.json`` and ``knowledge/sql/*.md`` on an interval; when
    their content fingerprint changes, runs the equivalent of
    ``wren memory index`` so semantic recall never serves a stale schema while
    you are actively modelling. A reindex that fails leaves the change pending
    and is retried on the next poll - an update is never silently dropped.

    Requires the ``memory`` extra (the index it maintains is Qdrant-backed).
    With the grep backend there is no derived index to keep fresh.
    """
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.index_backend import resolve_backend  # noqa: PLC0415
    from wren.memory.watch import watch_loop  # noqa: PLC0415

    if resolve_backend() == "grep":
        typer.echo(
            "grep backend: knowledge/sql/ IS the index - nothing to watch. "
            "Install `wrenai[memory]` for a derived index to keep fresh.",
            err=True,
        )
        raise typer.Exit(1)

    try:
        project_path = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    # The watcher polls <project_path>/target/mdl.json + <project_path>/knowledge/sql,
    # but the reindex reads --mdl and load_query_pairs(project_path). If an explicit
    # --mdl points outside the watched project root we'd watch one tree and index a
    # mixed one - fail fast instead of silently building a cross-project index.
    if mdl:
        mdl_path = Path(mdl).expanduser().resolve()
        root = project_path.resolve()
        if root != mdl_path and root not in mdl_path.parents:
            typer.echo(
                f"Error: --mdl ({mdl_path}) is outside the watched project "
                f"root ({root}).\n"
                "  `watch` monitors target/mdl.json + knowledge/sql/ under the "
                "project root and reindexes from that same tree, so an --mdl "
                "from another project would watch and index mismatched files.\n"
                "  Run from the project that owns this MDL, or point --mdl at a "
                "file under this root.",
                err=True,
            )
            raise typer.Exit(1)

    def _reindex() -> None:
        manifest = _load_manifest(mdl)
        mem_store = _get_store(url)
        result = mem_store.index_schema(manifest, seed_queries=True)
        from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

        md_pairs = load_query_pairs(project_path)
        loaded = 0
        if md_pairs:
            res = mem_store.load_queries(md_pairs, upsert=True)
            loaded = res["loaded"] + res["updated"]
        typer.echo(
            f"Reindexed {result['schema_items']} schema item(s)"
            + (f", {loaded} pair(s)" if loaded else "")
            + "."
        )

    def _on_event(event: str) -> None:
        if event == "change-detected":
            typer.echo("Change detected - reindexing...", err=True)
        elif event == "reindex-error":
            typer.echo(
                "Reindex failed; change kept pending, will retry next poll.",
                err=True,
            )
        elif event == "stopped":
            typer.echo("Stopped watching.", err=True)

    typer.echo(
        f"Watching {project_path} every {max(interval, 1.0):g}s "
        "(target/mdl.json + knowledge/sql/). Ctrl+C to stop.",
        err=True,
    )
    state = watch_loop(
        project_path,
        _reindex,
        interval=interval,
        max_polls=max_polls,
        reindex_on_start=reindex_on_start,
        on_event=_on_event,
    )
    if max_polls is not None:
        typer.echo(
            f"Polled {state.polls} time(s), {state.reindexes} reindex(es), "
            f"{state.errors} error(s).",
            err=True,
        )


@memory_app.command()
def export(
    url: UrlOpt = None,
    include_seed: Annotated[
        bool,
        typer.Option(
            "--include-seed",
            help="Also export auto-generated seed pairs (normally regenerated on index).",
        ),
    ] = False,
) -> None:
    """One-time migration: export the Qdrant query_history into knowledge/sql/*.md.

    Reads the existing index (requires the ``memory`` extra) and writes each
    NL->SQL pair to the markdown source of truth, preserving source and
    timestamp. The same NL updates one file (dedup). Qdrant is left intact -
    run `wren memory index` to rebuild, then `wren memory reset` once verified.
    """
    from wren.context import discover_project_path  # noqa: PLC0415
    from wren.memory.markdown import write_query_markdown  # noqa: PLC0415

    try:
        project = discover_project_path()
    except SystemExit as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(1)

    mem_store = _get_store(url)  # requires the memory extra to read Qdrant
    rows = mem_store.dump_queries()
    exported, skipped = 0, 0
    for r in rows:
        source = _parse_source(r.get("tags", "")) or "user"
        nl, sql = r.get("nl_query"), r.get("sql_query")
        if (source == "seed" and not include_seed) or not nl or not sql:
            skipped += 1
            continue
        created = r.get("created_at")
        if hasattr(created, "isoformat"):
            created_at = created.isoformat()
        else:
            created_at = created or None
        write_query_markdown(
            project,
            nl,
            sql,
            datasource=r.get("datasource") or None,
            source=source,
            created_at=created_at,
        )
        exported += 1

    typer.echo(f"Exported {exported} pair(s) to knowledge/sql/ ({skipped} skipped).")
    typer.echo(
        "Run `wren memory index` to rebuild, then `wren memory reset` once verified.",
        err=True,
    )


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
    url: UrlOpt = None,
) -> None:
    """Browse stored NL-SQL pairs."""
    mem_store = _get_store(url)
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
    return f'[{source}] "{nl}" -> {sql}'


def _interactive_forget(mem_store, source: str | None, limit: int) -> None:
    """Launch interactive checkbox UI for selecting pairs to forget."""
    try:
        from InquirerPy import inquirer  # noqa: PLC0415
        from InquirerPy.base.control import Choice  # noqa: PLC0415
    except ImportError:
        typer.echo(
            "Interactive mode requires InquirerPy.\n"
            "Install with: pip install 'wrenai[interactive]'\n"
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
        Optional[list[str]],
        typer.Option("--id", help="Point IDs to forget (non-interactive)"),
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
    url: UrlOpt = None,
) -> None:
    """Remove NL-SQL pairs from memory.

    Default: interactive checkbox UI.
    With --id or --force: non-interactive mode for scripts and agents.

    Note: ``--id`` takes Qdrant point IDs (shown as ``_row_id`` by
    ``wren memory list``), not positional indices.
    """
    mem_store = _get_store(url)

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


def _parse_source(tags: str | None) -> str:
    """Extract source value from a (possibly null/empty) tags string."""
    for part in (tags or "").split():
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
    url: UrlOpt = None,
) -> None:
    """Export NL-SQL pairs to YAML."""
    mem_store = _get_store(url)
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
    url: UrlOpt = None,
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
        typer.echo("Error: invalid YAML - missing 'pairs' key.", err=True)
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
    mem_store = _get_store(url)
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
