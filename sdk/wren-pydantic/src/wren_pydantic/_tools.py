"""Runtime tools (wren_query, wren_dry_plan, wren_list_models) for Pydantic AI.

Each tool returns a typed Pydantic model (or list of them) for LLM-friendly
serialization. Errors from the underlying toolkit go through the WrenError
→ ModelRetry mapping in _errors.py:

- Retry-class WrenError → ModelRetry(...) with phase-aware message
- Propagate-class WrenError → re-raised as-is (infra errors)
- Limit-validation errors → ModelRetry (LLM picked a bad limit, can fix)

Tools are sync (def, not async def). Pydantic AI auto-bridges sync tools
to its async run loop, so wrapping sync engine I/O in asyncio.to_thread
buys nothing — see plan §3 Commit 2.2 for the design rationale.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic_ai import FunctionToolset, ModelRetry, RunContext
from wren.model.error import WrenError

from wren_pydantic._errors import should_propagate, to_model_retry
from wren_pydantic._models import ModelSummary, WrenQueryResult

if TYPE_CHECKING:
    from wren_pydantic._toolkit import WrenToolkit


# Hard cap for the LLM-facing `wren_query` tool. Bounded payload size so
# a runaway `limit` value (typo or hallucinated huge number) doesn't
# balloon memory. Direct API (toolkit.query) keeps no cap — that's the
# Python-programmer surface and should respect what the caller asks for.
MAX_QUERY_ROWS = 1000


def build_runtime_toolset(
    toolkit: WrenToolkit, *, takes_ctx: bool = False
) -> FunctionToolset:
    """Build a FunctionToolset with the 3 runtime tools bound to *toolkit*.

    ``takes_ctx=True`` registers each tool with ``ctx: RunContext`` as the
    first parameter (the context is ignored internally — the toolkit
    already captures all required state). Use this when mixing wren tools
    with other deps-typed tools in the same agent.
    """
    toolset = FunctionToolset()
    _register_query(toolset, toolkit, takes_ctx=takes_ctx)
    _register_dry_plan(toolset, toolkit, takes_ctx=takes_ctx)
    _register_list_models(toolset, toolkit, takes_ctx=takes_ctx)
    return toolset


def _register_query(toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool):
    if takes_ctx:

        @toolset.tool(retries=2)
        def wren_query(ctx: RunContext, sql: str, limit: int = 100) -> WrenQueryResult:
            """Execute SQL through the Wren semantic layer and return rows.

            Use after wren_dry_plan looks correct. Default limit is 100;
            increase only when needed. Hard cap is 1000 rows — beyond
            that, aggregate in SQL.
            """
            return _run_query(toolkit, sql, limit)

    else:

        @toolset.tool_plain(retries=2)
        def wren_query(sql: str, limit: int = 100) -> WrenQueryResult:
            """Execute SQL through the Wren semantic layer and return rows.

            Use after wren_dry_plan looks correct. Default limit is 100;
            increase only when needed. Hard cap is 1000 rows — beyond
            that, aggregate in SQL.
            """
            return _run_query(toolkit, sql, limit)


def _register_dry_plan(
    toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool
):
    if takes_ctx:

        @toolset.tool(retries=2)
        def wren_dry_plan(ctx: RunContext, sql: str) -> str:
            """Plan SQL through MDL and return the target-dialect SQL.

            Cheap (no DB round-trip). Use this to verify your SQL
            targets Wren models correctly before running wren_query.
            """
            return _run_dry_plan(toolkit, sql)

    else:

        @toolset.tool_plain(retries=2)
        def wren_dry_plan(sql: str) -> str:
            """Plan SQL through MDL and return the target-dialect SQL.

            Cheap (no DB round-trip). Use this to verify your SQL
            targets Wren models correctly before running wren_query.
            """
            return _run_dry_plan(toolkit, sql)


def _register_list_models(
    toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool
):
    if takes_ctx:

        @toolset.tool(retries=2)
        def wren_list_models(ctx: RunContext) -> list[ModelSummary]:
            """List all models in this Wren project with column counts."""
            return _run_list_models(toolkit)

    else:

        @toolset.tool_plain(retries=2)
        def wren_list_models() -> list[ModelSummary]:
            """List all models in this Wren project with column counts."""
            return _run_list_models(toolkit)


# ── Inner helpers ────────────────────────────────────────────────────────


def _run_query(toolkit: WrenToolkit, sql: str, limit: int) -> WrenQueryResult:
    if limit < 1 or limit > MAX_QUERY_ROWS:
        raise ModelRetry(
            f"limit must be between 1 and {MAX_QUERY_ROWS} (got {limit}). "
            "Aggregate in SQL if you need more rows."
        )

    try:
        table = toolkit.query(sql, limit=limit)
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc

    row_count = table.num_rows
    # If the engine returned exactly `limit` rows, we can't tell whether more
    # rows existed upstream — surface as truncated so the LLM knows the
    # answer may be partial.
    truncated = row_count >= limit
    return WrenQueryResult(
        columns=list(table.column_names),
        rows=table.to_pylist(),
        row_count=row_count,
        truncated=truncated,
    )


def _run_dry_plan(toolkit: WrenToolkit, sql: str) -> str:
    try:
        return toolkit.dry_plan(sql)
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc


def _run_list_models(toolkit: WrenToolkit) -> list[ModelSummary]:
    try:
        manifest = toolkit._mdl_source.load_manifest()
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc

    models = manifest.get("models") or []
    return [
        ModelSummary(
            name=m["name"],
            column_count=len(m.get("columns") or []),
            description=(m.get("properties") or {}).get("description"),
        )
        for m in models
    ]
