"""Typed Pydantic return models for tools facing the LLM.

Pydantic AI tools return native Python objects (or Pydantic models) that the
framework serializes for the model. This module defines the four return
types our six tools use; each has a stable schema, validates inputs, and
serializes cleanly through ``model_dump`` for log/audit trails.

Wren-langchain's parallel is a hand-rolled envelope dict — here we lean on
Pydantic's validation + JSON-schema generation, which Pydantic AI consumes
to expose typed tool outputs to the model.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class WrenQueryResult(BaseModel):
    """Result of ``wren_query``: columns, rows, and overflow flag.

    ``truncated=True`` signals the result was capped by either the
    tool-level ``limit`` argument or the toolkit-wide ``MAX_QUERY_ROWS``
    safety cap. Callers should surface this to the LLM so it knows the
    answer may be partial.
    """

    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int = Field(ge=0)
    truncated: bool


class ModelSummary(BaseModel):
    """Per-model entry returned by ``wren_list_models``.

    ``description`` is optional — projects that haven't filled in
    ``properties.description`` in their model YAML omit it.
    """

    name: str
    column_count: int = Field(ge=0)
    description: str | None = None


class FetchContextResult(BaseModel):
    """Result of ``wren_fetch_context``.

    ``strategy`` mirrors Core's MemoryStore behavior: small projects get
    the entire schema dump (``full_schema``), large ones get embedding
    search hits (``search``). ``items`` is heterogeneous in v0.1 — same
    shape Core returns. v0.2 may tighten this into a discriminated union.
    """

    strategy: Literal["search", "full_schema"]
    items: list[dict[str, Any]]


class RecalledPair(BaseModel):
    """One NL→SQL pair returned by ``wren_recall_queries``.

    ``score`` is optional because Core may not always emit it (e.g. for
    the seed pairs loaded from ``queries.yml``).
    """

    nl: str
    sql: str
    tags: list[str] = Field(default_factory=list)
    score: float | None = None
