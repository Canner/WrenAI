"""Typed Pydantic return models for tools facing the LLM.

Pydantic AI tools return native Python objects (or Pydantic models) that the
framework serializes for the model. This module defines the four return
types our six tools use; each has a stable schema, validates inputs, and
serializes cleanly through ``model_dump`` for log/audit trails.

The shapes here are pinned to Core's return shapes (see
``core/wren/src/wren/memory/store.py`` ``get_context`` and
``recall_queries``). Drift in Core surfaces here as a ValidationError,
not silently as a wrong tool result.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class WrenQueryResult(BaseModel):
    """Result of ``wren_query``: columns, rows, and overflow flag.

    ``row_count`` is the count of rows in this payload (always equal to
    ``len(rows)``). ``truncated=True`` signals the result was capped by
    either the tool-level ``limit`` argument or the toolkit-wide
    ``MAX_QUERY_ROWS`` safety cap — i.e. the *underlying* result set is
    larger than what's returned. Callers surface this to the LLM so it
    knows the answer may be partial.
    """

    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int = Field(ge=0)
    truncated: bool

    @model_validator(mode="after")
    def _row_count_matches_rows(self) -> WrenQueryResult:
        if self.row_count != len(self.rows):
            raise ValueError(
                f"row_count ({self.row_count}) must equal len(rows) "
                f"({len(self.rows)}); use `truncated=True` to signal the "
                "underlying result set was larger than the returned rows."
            )
        return self


class ModelSummary(BaseModel):
    """Per-model entry returned by ``wren_list_models``.

    ``description`` is optional — projects that haven't filled in
    ``properties.description`` in their model YAML omit it.
    """

    name: str
    column_count: int = Field(ge=0)
    description: str | None = None


class FetchContextResult(BaseModel):
    """Result of ``wren_fetch_context``, matching Core's get_context shape.

    Core emits one of two payloads:

    - Small schemas (under threshold): ``{"strategy": "full", "schema": <text>}``
    - Large schemas: ``{"strategy": "search", "results": [<dict>, ...]}``

    We expose both keys but only one is populated per response. The
    ``schema`` key is aliased to ``schema_text`` to avoid clashing with
    ``BaseModel`` internals.
    """

    model_config = ConfigDict(populate_by_name=True)

    strategy: Literal["full", "search"]
    schema_text: str | None = Field(default=None, alias="schema")
    results: list[dict[str, Any]] | None = None


class RecalledPair(BaseModel):
    """One NL→SQL pair returned by ``wren_recall_queries``.

    Field names mirror Core's LanceDB row keys verbatim. ``tags`` is a
    comma-joined string (Core's storage format, not a list) — the SDK
    surfaces it raw and lets the agent split if it needs to. ``score``
    is aliased to LanceDB's ``_distance`` field and only present after a
    vector search; seeded pairs from ``queries.yml`` have no score.

    Extra keys (e.g. ``text``, ``created_at``) from Core are tolerated
    via ``extra="ignore"`` so a Core upgrade adding fields doesn't
    break this model.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    nl_query: str
    sql_query: str
    datasource: str = ""
    tags: str = ""
    score: float | None = Field(default=None, alias="_distance")
