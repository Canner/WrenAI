"""Memory tools (wren_fetch_context, wren_recall_queries, wren_store_query).

Three tools registered into a FunctionToolset when the project has a
``.wren/memory/`` directory. ``include_write=False`` keeps the two
read-only tools and drops ``wren_store_query`` — useful for shared /
curated memory stores.

``wren_store_query`` is registered with ``retries=0``: write failures
generally aren't fixable by retrying the same call, and the LLM has
already done the analytical work — better to surface the failure than
to loop.

Sync tools (def, not async def) — same rationale as the runtime tools.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic_ai import FunctionToolset, RunContext
from wren.model.error import WrenError

from wren_pydantic._errors import should_propagate, to_model_retry
from wren_pydantic._models import FetchContextResult, RecalledPair

if TYPE_CHECKING:
    from wren_pydantic._toolkit import WrenToolkit


def build_memory_toolset(
    toolkit: WrenToolkit,
    *,
    include_write: bool,
    takes_ctx: bool,
    toolset: FunctionToolset | None = None,
) -> FunctionToolset:
    """Build (or extend) a FunctionToolset with the memory tools.

    When *toolset* is supplied, register onto it (composes cleanly with
    the runtime toolset). When None, build a fresh one.
    """
    ts = toolset or FunctionToolset()
    _register_fetch_context(ts, toolkit, takes_ctx=takes_ctx)
    _register_recall_queries(ts, toolkit, takes_ctx=takes_ctx)
    if include_write:
        _register_store_query(ts, toolkit, takes_ctx=takes_ctx)
    return ts


# ── wren_fetch_context ────────────────────────────────────────────────────


def _register_fetch_context(
    toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool
):
    if takes_ctx:

        @toolset.tool(retries=2)
        def wren_fetch_context(
            ctx: RunContext,
            question: str,
            limit: int = 5,
            item_type: (
                Literal["model", "column", "relationship", "view"] | None
            ) = None,
            model: str | None = None,
        ) -> FetchContextResult:
            """Fetch relevant schema and business context for an analytical question.

            Call this BEFORE writing SQL so you query the correct Wren
            models and columns. Use item_type to narrow scope (e.g.
            only columns) and model to narrow to a single model.
            """
            return _run_fetch(toolkit, question, limit, item_type, model)

    else:

        @toolset.tool_plain(retries=2)
        def wren_fetch_context(
            question: str,
            limit: int = 5,
            item_type: (
                Literal["model", "column", "relationship", "view"] | None
            ) = None,
            model: str | None = None,
        ) -> FetchContextResult:
            """Fetch relevant schema and business context for an analytical question.

            Call this BEFORE writing SQL so you query the correct Wren
            models and columns. Use item_type to narrow scope (e.g.
            only columns) and model to narrow to a single model.
            """
            return _run_fetch(toolkit, question, limit, item_type, model)


# ── wren_recall_queries ───────────────────────────────────────────────────


def _register_recall_queries(
    toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool
):
    if takes_ctx:

        @toolset.tool(retries=2)
        def wren_recall_queries(
            ctx: RunContext, question: str, limit: int = 3
        ) -> list[RecalledPair]:
            """Recall up to *limit* past NL→SQL pairs similar to *question*.

            Useful as few-shot examples before writing new SQL. Pairs
            are previously confirmed by users (or seeded for the project).
            """
            return _run_recall(toolkit, question, limit)

    else:

        @toolset.tool_plain(retries=2)
        def wren_recall_queries(question: str, limit: int = 3) -> list[RecalledPair]:
            """Recall up to *limit* past NL→SQL pairs similar to *question*.

            Useful as few-shot examples before writing new SQL. Pairs
            are previously confirmed by users (or seeded for the project).
            """
            return _run_recall(toolkit, question, limit)


# ── wren_store_query (retries=0) ──────────────────────────────────────────


def _register_store_query(
    toolset: FunctionToolset, toolkit: WrenToolkit, *, takes_ctx: bool
):
    if takes_ctx:

        @toolset.tool(retries=0)
        def wren_store_query(
            ctx: RunContext,
            nl: str,
            sql: str,
            tags: list[str] | None = None,
        ) -> str:
            """Save a confirmed natural-language → SQL pair for future recall.

            Call this AFTER wren_query succeeds and the result was
            useful, so future agent runs can recall the example via
            wren_recall_queries.
            """
            return _run_store(toolkit, nl, sql, tags)

    else:

        @toolset.tool_plain(retries=0)
        def wren_store_query(
            nl: str,
            sql: str,
            tags: list[str] | None = None,
        ) -> str:
            """Save a confirmed natural-language → SQL pair for future recall.

            Call this AFTER wren_query succeeds and the result was
            useful, so future agent runs can recall the example via
            wren_recall_queries.
            """
            return _run_store(toolkit, nl, sql, tags)


# ── Inner helpers ────────────────────────────────────────────────────────


def _run_fetch(
    toolkit: WrenToolkit,
    question: str,
    limit: int,
    item_type: str | None,
    model: str | None,
) -> FetchContextResult:
    try:
        result = toolkit.memory.fetch(
            question, limit=limit, item_type=item_type, model=model
        )
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc
    return FetchContextResult.model_validate(result)


def _run_recall(toolkit: WrenToolkit, question: str, limit: int) -> list[RecalledPair]:
    try:
        rows = toolkit.memory.recall(question, limit=limit)
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc
    return [RecalledPair.model_validate(r) for r in rows]


def _run_store(
    toolkit: WrenToolkit,
    nl: str,
    sql: str,
    tags: list[str] | None,
) -> str:
    # Normalize None → [] up front so downstream callers see a list.
    tags_list = tags or []
    try:
        toolkit.memory.store(nl=nl, sql=sql, tags=tags_list)
    except WrenError as exc:
        if should_propagate(exc):
            raise
        raise to_model_retry(exc) from exc
    if tags_list:
        return f"Stored NL→SQL pair (tags: {', '.join(tags_list)})."
    return "Stored NL→SQL pair."
