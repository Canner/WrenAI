"""FastMCP server exposing WrenEngine query + context/knowledge tools.

Named ``mcp_server.py`` (not a ``mcp/`` package) so it never shadows the
top-level ``mcp`` SDK package on import. This module imports the SDK at
module scope — callers must only import it from inside a command body that
has already verified the ``mcp`` extra is installed (see ``serve_cli.py``).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

from loguru import logger
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

DEFAULT_ROW_LIMIT = 1000
MAX_ROW_LIMIT = 10000


@dataclass
class ServeContext:
    """Shared state captured once at startup and used by every tool handler."""

    project: Path
    engine: Any  # wren.engine.WrenEngine
    allow_write: bool
    no_connect: bool


def _normalize_value(value: Any) -> Any:
    """Recursively coerce a value into a JSON-native type."""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode(errors="replace")
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if hasattr(value, "item"):
        return _normalize_value(value.item())
    if isinstance(value, dict):
        return {k: _normalize_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize_value(v) for v in value]
    return value


def _table_to_result(table, *, truncated: bool) -> dict:
    """Serialize a pyarrow.Table into the MCP result shape."""
    columns = [f.name for f in table.schema]
    rows = [
        {col: _normalize_value(val) for col, val in row.items()}
        for row in table.to_pylist()
    ]
    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
        "truncated": truncated,
    }


def _query_with_limit_probe(ctx: ServeContext, sql: str, limit: int | None) -> dict:
    """Run ``sql`` capped at ``MAX_ROW_LIMIT``, probing one extra row to detect truncation."""
    effective_limit = DEFAULT_ROW_LIMIT if limit is None else limit
    effective_limit = min(effective_limit, MAX_ROW_LIMIT)
    table = ctx.engine.query(sql, effective_limit + 1)
    truncated = table.num_rows > effective_limit
    if truncated:
        table = table.slice(0, effective_limit)
    return _table_to_result(table, truncated=truncated)


def _register_query_tools(mcp: FastMCP, ctx: ServeContext) -> None:
    if not ctx.no_connect:

        @mcp.tool(
            annotations=ToolAnnotations(title="Run SQL", readOnlyHint=True),
        )
        def run_sql(sql: str, limit: int | None = None) -> dict:
            """Execute a SQL query through the Wren semantic layer and return rows.

            SQL is written against MDL model names, not raw database tables.
            Applies a default cap of 1000 rows when ``limit`` is not given, and
            a hard maximum of 10000 rows regardless of the requested limit.
            """
            return _query_with_limit_probe(ctx, sql, limit)

        @mcp.tool(
            annotations=ToolAnnotations(title="Dry Run SQL", readOnlyHint=True),
        )
        def dry_run(sql: str) -> dict:
            """Validate SQL against the connected data source without returning rows.

            Cheap way to check a query is valid before calling ``run_sql``.
            Raises on failure with the engine's error message.
            """
            ctx.engine.dry_run(sql)
            return {"ok": True}

        @mcp.tool(
            annotations=ToolAnnotations(title="Query Cube", readOnlyHint=True),
        )
        def query_cube(
            cube: str | None = None,
            measures: list[str] | None = None,
            dimensions: list[str] | None = None,
            time_dimension: str | None = None,
            filters: list[str] | None = None,
            limit: int | None = None,
            offset: int | None = None,
            sql_only: bool = False,
        ) -> dict:
            """Run a structured cube (metric) query and return aggregated rows.

            Mirrors ``wren cube query``. ``time_dimension`` uses the CLI spec
            format ``name:granularity[:start,end]``; ``filters`` use
            ``dim:op[:value]`` (comma-separated values for ``in``/``not_in``).
            Set ``sql_only=True`` to see the generated SQL without executing it.
            """
            from wren_core import cube_query_to_sql  # noqa: PLC0415

            from wren import context  # noqa: PLC0415
            from wren.cube_cli import _build_cube_query  # noqa: PLC0415

            if not cube or not measures:
                raise ValueError("query_cube requires 'cube' and at least one measure.")

            cube_query = _build_cube_query(
                cube,
                ",".join(measures),
                ",".join(dimensions or []),
                time_dimension,
                filters or [],
                limit,
                offset,
            )
            mdl_json = json.dumps(context.build_json(ctx.project))
            sql = cube_query_to_sql(json.dumps(cube_query), mdl_json)

            if sql_only:
                return {"sql": sql}

            return _query_with_limit_probe(ctx, sql, limit)

    @mcp.tool(
        annotations=ToolAnnotations(title="Dry Plan SQL", readOnlyHint=True),
    )
    def dry_plan(sql: str) -> str:
        """Expand SQL through the MDL semantic layer and return the target-dialect SQL.

        No database connection is used — this only shows what would run.
        """
        return ctx.engine.dry_plan(sql)


def _register_context_tools(mcp: FastMCP, ctx: ServeContext) -> None:
    @mcp.tool(
        annotations=ToolAnnotations(title="Get MDL", readOnlyHint=True),
    )
    def get_mdl() -> dict:
        """Return the full compiled MDL (models, relationships, cubes) as JSON."""
        from wren.context import build_json  # noqa: PLC0415

        return build_json(ctx.project)

    @mcp.tool(
        annotations=ToolAnnotations(title="List Models", readOnlyHint=True),
    )
    def list_models() -> dict:
        """List the semantic models available to query, with column counts.

        Returns ``{"models": [...]}``.
        """
        from wren.context import load_models  # noqa: PLC0415

        models = load_models(ctx.project)
        result = []
        for model in models:
            description = model.get("description")
            if description is None:
                description = (model.get("properties") or {}).get("description")
            result.append(
                {
                    "name": model.get("name"),
                    "description": description,
                    "column_count": len(model.get("columns", []) or []),
                }
            )
        return {"models": result}

    @mcp.tool(
        annotations=ToolAnnotations(title="Describe Model", readOnlyHint=True),
    )
    def describe_model(name: str) -> dict:
        """Describe a model's columns, primary key, ref SQL, and relationships."""
        from wren.context import load_models, load_relationships  # noqa: PLC0415

        models = load_models(ctx.project)
        model = next((m for m in models if m.get("name") == name), None)
        if model is None:
            raise ValueError(f"Model '{name}' not found.")

        columns = [
            {
                "name": col.get("name"),
                "type": col.get("type"),
                "description": col.get("description")
                or (col.get("properties") or {}).get("description"),
            }
            for col in model.get("columns", []) or []
        ]

        relationships = [
            rel
            for rel in load_relationships(ctx.project)
            if name in (rel.get("models") or [])
        ]

        return {
            "name": model.get("name"),
            "columns": columns,
            "primary_key": model.get("primary_key"),
            "ref_sql": model.get("ref_sql"),
            "relationships": relationships,
        }

    @mcp.tool(
        annotations=ToolAnnotations(title="Get Data Source", readOnlyHint=True),
    )
    def get_data_source() -> dict:
        """Return the project's configured data source (SQL dialect)."""
        from wren.context import load_project_config  # noqa: PLC0415

        return {"data_source": load_project_config(ctx.project).get("data_source")}

    @mcp.tool(
        annotations=ToolAnnotations(title="List Cubes", readOnlyHint=True),
    )
    def list_cubes() -> dict:
        """List cubes defined in the project with their measures/dimensions.

        Returns ``{"cubes": [...]}``.
        """
        from wren.context import load_cubes  # noqa: PLC0415

        cubes = load_cubes(ctx.project)
        result = []
        for cube in cubes:
            result.append(
                {
                    "name": cube.get("name"),
                    "base_object": cube.get("base_object"),
                    "measures": [m.get("name") for m in cube.get("measures", []) or []],
                    "dimensions": [
                        d.get("name") for d in cube.get("dimensions", []) or []
                    ],
                    "time_dimensions": [
                        td.get("name") for td in cube.get("time_dimensions", []) or []
                    ],
                }
            )
        return {"cubes": result}

    @mcp.tool(
        annotations=ToolAnnotations(title="Describe Cube", readOnlyHint=True),
    )
    def describe_cube(name: str) -> dict:
        """Return the full definition of a cube (measures, dimensions, etc)."""
        from wren.context import load_cubes  # noqa: PLC0415

        cubes = load_cubes(ctx.project)
        cube = next((c for c in cubes if c.get("name") == name), None)
        if cube is None:
            raise ValueError(f"Cube '{name}' not found.")
        return cube

    @mcp.tool(
        annotations=ToolAnnotations(title="List Functions", readOnlyHint=True),
    )
    def list_functions() -> dict:
        """List SQL functions available for the project's data source.

        No database connection is required — functions are registered per
        data source at session-context construction time. Returns
        ``{"functions": [...]}``.
        """
        from wren.mdl import get_session_context  # noqa: PLC0415

        session = get_session_context(
            ctx.engine.manifest_str,
            ctx.engine.function_path,
            None,
            ctx.engine.data_source.name,
        )
        return {"functions": [f.to_dict() for f in session.get_available_functions()]}


def _register_knowledge_tools(mcp: FastMCP, ctx: ServeContext) -> None:
    @mcp.tool(
        annotations=ToolAnnotations(title="Get Instructions", readOnlyHint=True),
    )
    def get_instructions() -> dict:
        """Return business rules and instructions from knowledge/rules/*.md."""
        from wren.context import load_rules  # noqa: PLC0415

        content, used_legacy = load_rules(ctx.project)
        return {"instructions": content or "", "used_legacy": used_legacy}

    @mcp.tool(
        annotations=ToolAnnotations(title="Recall Queries", readOnlyHint=True),
    )
    def recall_queries(question: str, limit: int = 3) -> dict:
        """Recall confirmed NL->SQL examples similar to the given question.

        Works with the ``memory`` extra (semantic search) or falls back to a
        dependency-free token-overlap search over knowledge/sql/*.md. Returns
        ``{"matches": [...]}``.
        """
        from wren.memory.index_backend import get_index  # noqa: PLC0415

        try:
            from wren.memory.cli import _default_memory_path  # noqa: PLC0415

            mem_path = str(_default_memory_path())
        except ImportError:
            mem_path = str(ctx.project / ".wren" / "memory")

        idx = get_index(ctx.project, mem_path)
        return {"matches": idx.search(question, limit=limit)}

    @mcp.tool(
        annotations=ToolAnnotations(title="Get Context", readOnlyHint=True),
    )
    def get_context(
        question: str,
        limit: int = 5,
        item_type: str | None = None,
        model_name: str | None = None,
    ) -> dict:
        """Semantic retrieval of the schema fragments relevant to a question.

        The schema-axis twin of ``recall_queries``: instead of NL->SQL
        exemplars, this returns models/columns/cubes ranked by relevance.
        Uses embedding search when the ``memory`` extra is installed and the
        schema has been indexed (``wren memory index``); otherwise falls back
        to the full plain-text schema description (same content as
        ``describe_schema``).
        """
        from wren.context import build_json  # noqa: PLC0415
        from wren.memory import schema_indexer  # noqa: PLC0415

        manifest = build_json(ctx.project)
        try:
            from wren.memory.cli import _default_memory_path  # noqa: PLC0415
            from wren.memory.store import MemoryStore  # noqa: PLC0415

            store = MemoryStore(path=str(_default_memory_path()))
            return store.get_context(
                manifest,
                question,
                limit=limit,
                item_type=item_type,
                model_name=model_name,
            )
        except ImportError:
            # Only the missing `memory` extra falls back to full-text; real
            # index/embedding errors from an installed store surface as-is.
            return {
                "strategy": "full",
                "schema": schema_indexer.describe_schema(manifest),
                "note": (
                    "Install wrenai[memory] and run `wren memory index` for "
                    "embedding-based schema search on large schemas."
                ),
            }

    @mcp.tool(
        annotations=ToolAnnotations(title="Describe Schema", readOnlyHint=True),
    )
    def describe_schema() -> dict:
        """Return the full MDL schema as a structured plain-text description.

        The human-readable counterpart to ``get_mdl`` (JSON) — suitable for
        pasting directly into an LLM prompt. No optional dependencies
        required.
        """
        from wren.context import build_json  # noqa: PLC0415
        from wren.memory import schema_indexer  # noqa: PLC0415

        return {"schema": schema_indexer.describe_schema(build_json(ctx.project))}

    @mcp.tool(
        annotations=ToolAnnotations(title="List Stored Queries", readOnlyHint=True),
    )
    def list_stored_queries(
        source: str | None = None, limit: int | None = None
    ) -> dict:
        """Enumerate stored NL->SQL pairs from knowledge/sql/.

        Unlike ``recall_queries`` (semantic top-k for a question), this lists
        every stored pair, optionally filtered by ``source`` tag (e.g.
        "user", "seed"). Returns ``{"queries": [...]}``.
        """
        try:
            from wren.memory.cli import _default_memory_path  # noqa: PLC0415
            from wren.memory.store import MemoryStore  # noqa: PLC0415

            store = MemoryStore(path=str(_default_memory_path()))
            rows, _total = store.list_queries(
                source=source,
                limit=limit if limit is not None else MAX_ROW_LIMIT,
            )
            return {"queries": [_normalize_value(row) for row in rows]}
        except Exception:
            from wren.memory.markdown import load_query_pairs  # noqa: PLC0415

            pairs = load_query_pairs(ctx.project)
            if source:
                pairs = [p for p in pairs if p.get("source", "user") == source]
            if limit is not None:
                pairs = pairs[:limit]
            queries = [
                {
                    "nl_query": p["nl"],
                    "sql_query": p["sql"],
                    "datasource": p.get("datasource", ""),
                    "tags": p.get("tags", ""),
                    "source": p.get("source", "user"),
                    "path": p.get("path"),
                }
                for p in pairs
            ]
            return {"queries": queries}

    @mcp.tool(
        annotations=ToolAnnotations(title="List Knowledge", readOnlyHint=True),
    )
    def list_knowledge() -> dict:
        """List knowledge files readable via the wren://knowledge/{path} resource.

        Walks knowledge/ recursively (knowledge.yml, rules/*.md, sql/*.md) and
        reports whether AGENTS.md exists at the project root.
        """
        knowledge_dir = ctx.project / "knowledge"
        files: list[str] = []
        if knowledge_dir.is_dir():
            # Only list what the wren://knowledge/{name} and
            # wren://knowledge/{subdir}/{name} templates can serve: top-level
            # files and one directory level down. Deeper files aren't readable.
            candidates = [*knowledge_dir.glob("*"), *knowledge_dir.glob("*/*")]
            files = sorted(
                str(p.relative_to(knowledge_dir)) for p in candidates if p.is_file()
            )
        return {
            "files": files,
            "agents": (ctx.project / "AGENTS.md").exists(),
        }


def _register_write_tools(mcp: FastMCP, ctx: ServeContext) -> None:
    @mcp.tool(
        annotations=ToolAnnotations(title="Store Query", readOnlyHint=False),
    )
    def store_query(
        nl_query: str,
        sql_query: str,
        datasource: str | None = None,
        tags: str | None = None,
    ) -> dict:
        """Persist a confirmed NL->SQL pair to knowledge/sql/ for future recall.

        Always writes the markdown source of truth. Also indexes into LanceDB
        when the ``memory`` extra is installed (best-effort).
        """
        from wren.memory.markdown import write_query_markdown  # noqa: PLC0415

        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
        md_path = write_query_markdown(
            ctx.project, nl_query, sql_query, datasource=datasource, tags=tag_list
        )

        try:
            from wren.memory.cli import _default_memory_path  # noqa: PLC0415
            from wren.memory.store import MemoryStore  # noqa: PLC0415

            MemoryStore(path=str(_default_memory_path())).store_query(
                nl_query, sql_query, datasource=datasource, tags=tags
            )
        except Exception as e:
            logger.warning(f"LanceDB indexing failed for stored query (non-fatal): {e}")

        return {"path": str(md_path)}


def _register_resources(mcp: FastMCP, ctx: ServeContext) -> None:
    @mcp.resource("wren://mdl", mime_type="application/json")
    def mdl_resource() -> str:
        """The compiled MDL (models, relationships, cubes) as JSON."""
        from wren.context import build_json  # noqa: PLC0415

        return json.dumps(build_json(ctx.project))

    @mcp.resource("wren://instructions", mime_type="text/markdown")
    def instructions_resource() -> str:
        """Business rules and instructions from knowledge/rules/*.md."""
        from wren.context import load_rules  # noqa: PLC0415

        content, _used_legacy = load_rules(ctx.project)
        return content or ""

    @mcp.resource("wren://project", mime_type="application/json")
    def project_resource() -> str:
        """Summary of wren_project.yml (name, catalog, schema, data source)."""
        from wren.context import (  # noqa: PLC0415
            get_knowledge_schema_version,
            get_schema_version,
            load_project_config,
        )

        config = load_project_config(ctx.project)
        return json.dumps(
            {
                "name": config.get("name"),
                "catalog": config.get("catalog"),
                "schema": config.get("schema"),
                "data_source": config.get("data_source"),
                "schema_version": get_schema_version(ctx.project),
                "knowledge_schema_version": get_knowledge_schema_version(ctx.project),
            }
        )

    @mcp.resource("wren://agents", mime_type="text/markdown")
    def agents_resource() -> str:
        """The project's AGENTS.md, if present."""
        agents_path = ctx.project / "AGENTS.md"
        if not agents_path.exists():
            return ""
        try:
            return agents_path.read_text(encoding="utf-8")
        except UnicodeDecodeError as e:
            raise ValueError("AGENTS.md is not valid UTF-8 text.") from e

    def _read_knowledge_file(rel_path: str) -> str:
        """Read ``<project>/knowledge/<rel_path>``, rejecting escapes.

        Shared by both knowledge resource templates below.
        """
        knowledge_dir = (ctx.project / "knowledge").resolve()
        target = (ctx.project / "knowledge" / rel_path).resolve()
        if not target.is_relative_to(knowledge_dir) or not target.is_file():
            raise ValueError(f"Invalid knowledge path: '{rel_path}'.")
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError as e:
            raise ValueError(
                f"Knowledge file is not valid UTF-8 text: '{rel_path}'."
            ) from e

    # The installed MCP SDK matches each `{param}` against a single path
    # segment (`[^/]+`), so one `{path}` placeholder cannot span a slash
    # (e.g. "rules/general.md"). knowledge/ is only ever one level deep in
    # practice (knowledge.yml at the root; rules/*.md, sql/*.md, ... one
    # directory down), so two templates cover the real layout.
    @mcp.resource("wren://knowledge/{name}")
    def knowledge_root_resource(name: str) -> str:
        """Read a top-level file directly under knowledge/ (e.g. knowledge.yml).

        Rejects any name that escapes the project's knowledge/ directory.
        """
        return _read_knowledge_file(name)

    @mcp.resource("wren://knowledge/{subdir}/{name}")
    def knowledge_nested_resource(subdir: str, name: str) -> str:
        """Read a file under a knowledge/ subdirectory (rules/*.md, sql/*.md, ...).

        Rejects any path that escapes the project's knowledge/ directory.
        """
        return _read_knowledge_file(f"{subdir}/{name}")


def _register_prompts(mcp: FastMCP) -> None:
    @mcp.prompt()
    def wren_workflow(question: str | None = None) -> str:
        """SOP for answering a data question with the wren MCP tools."""
        intro = f'The user asked: "{question}"\n\n' if question else ""
        return (
            f"{intro}"
            "Follow this workflow to answer a data question:\n"
            "1. Read the `wren://mdl` resource and use `list_models` / "
            "`describe_model` to understand the schema; for schema, read "
            "`wren://mdl` or use `get_context` / `describe_schema`; browse "
            "project knowledge via `list_knowledge` + the "
            "`wren://knowledge/{path}` resource.\n"
            "2. Call `get_instructions` for business rules that affect how to "
            "interpret the data.\n"
            "3. Call `recall_queries` for proven NL->SQL exemplars similar to "
            "the question, or `list_stored_queries` to browse all of them.\n"
            "4. Write SQL in the project's dialect, validate it with `dry_run`, "
            "then execute it with `run_sql`.\n"
            "5. For named metrics, prefer `query_cube` over hand-written "
            "aggregate SQL.\n"
            "6. Once the answer is confirmed correct, optionally call "
            "`store_query` to persist the NL->SQL pair for future recall."
        )


def build_server(ctx: ServeContext) -> FastMCP:
    """Build and register all tools on a FastMCP server instance."""
    mcp = FastMCP("wren")

    _register_query_tools(mcp, ctx)
    _register_context_tools(mcp, ctx)
    _register_knowledge_tools(mcp, ctx)
    if ctx.allow_write:
        _register_write_tools(mcp, ctx)
    _register_resources(mcp, ctx)
    _register_prompts(mcp)

    return mcp


def run_server(
    ctx: ServeContext,
    *,
    transport: str = "stdio",
    host: str = "127.0.0.1",
    port: int = 8080,
) -> None:
    """Build the FastMCP server and run it on the given transport."""
    mcp = build_server(ctx)

    if transport == "stdio":
        mcp.run(transport="stdio")
    elif transport == "http":
        mcp.settings.host = host
        mcp.settings.port = port
        logger.info(f"Serving wren MCP over streamable-http at {host}:{port}")
        mcp.run(transport="streamable-http")
    else:
        raise ValueError(f"Unsupported transport '{transport}'.")
