"""Content formatters per tool. Used by tool wrappers to produce the
LLM-facing ``content`` field of the envelope."""

from __future__ import annotations

import json
from typing import Any

import pyarrow as pa

CONTENT_CAP_BYTES = 16 * 1024


def format_query_content(
    table: pa.Table, total_rows: int | None = None
) -> tuple[str, list[str]]:
    """Render query rows as JSON, truncating to fit ``CONTENT_CAP_BYTES``.

    Returns ``(content, warnings)``. The content is a JSON array of row dicts
    plus an optional ``(showing N of M rows)`` footer when truncated.
    """
    rows = table.to_pylist()
    full = json.dumps(rows, default=str)
    encoded = full.encode("utf-8")
    if len(encoded) <= CONTENT_CAP_BYTES:
        return full, []

    # Binary search-ish for largest prefix that fits.
    keep = len(rows)
    while keep > 0:
        partial = json.dumps(rows[:keep], default=str)
        if len(partial.encode("utf-8")) + 64 <= CONTENT_CAP_BYTES:
            break
        keep -= max(1, keep // 4)

    total = total_rows if total_rows is not None else len(rows)

    # Edge case: even the first row alone exceeds the content cap. Returning
    # `[]` with "showing 0 of N rows" would be misleading — the LLM would
    # think the query returned nothing. Surface a clear error message
    # instead, with concrete guidance on how to recover.
    if keep == 0:
        msg = (
            f"(0 of {total} rows shown — a single row exceeds the "
            f"{CONTENT_CAP_BYTES}-byte content cap. Use SELECT to pick fewer / "
            "narrower columns, or aggregate in SQL.)"
        )
        warning = (
            f"content truncated: row 1 alone exceeds {CONTENT_CAP_BYTES}-byte "
            "cap; no rows shown."
        )
        return msg, [warning]

    shown = rows[:keep]
    body = json.dumps(shown, default=str)
    footer = f"\n(showing {keep} of {total} rows)"
    warning = f"content truncated: showed {keep} of {total} rows due to size cap"
    return body + footer, [warning]


def format_dry_plan_content(sql: str) -> str:
    """Wrap dialect SQL in a markdown code fence."""
    return f"```sql\n{sql}\n```"


def format_fetch_context_content(result: dict[str, Any]) -> str:
    """Render get_context output as readable text.

    Strategy ``full`` returns the schema text directly.
    Strategy ``search`` returns a numbered list of items.
    """
    strategy = result.get("strategy")
    if strategy == "full":
        text = result.get("schema", "")
        return _cap_to_bytes(text, suffix="\n\n...[truncated]")

    items = result.get("results", []) or []
    if not items:
        return "_No relevant context items found._"

    lines = []
    for i, item in enumerate(items, start=1):
        item_type = item.get("item_type", "item")
        name = item.get("name", "")
        summary = item.get("summary") or item.get("text") or ""
        if len(summary) > 120:
            summary = summary[:117] + "..."
        lines.append(f"{i}. [{item_type}] {name} — {summary}")
    return _cap_to_bytes("\n".join(lines), suffix="\n...[truncated]")


def _cap_to_bytes(text: str, *, suffix: str) -> str:
    """Truncate *text* so its UTF-8 size never exceeds CONTENT_CAP_BYTES.

    Truncation is byte-aware (cuts on a UTF-8 boundary, not a char count) so
    multibyte chars cannot push the encoded size past the cap. The trailing
    *suffix* is reserved before slicing.
    """
    encoded = text.encode("utf-8")
    if len(encoded) <= CONTENT_CAP_BYTES:
        return text
    suffix_bytes = suffix.encode("utf-8")
    budget = max(0, CONTENT_CAP_BYTES - len(suffix_bytes))
    return encoded[:budget].decode("utf-8", errors="ignore") + suffix


def format_recall_content(rows: list[dict[str, Any]]) -> str:
    """Render recalled NL→SQL pairs as a numbered list with code fences."""
    if not rows:
        return "_No similar past queries found._"

    chunks = []
    for i, row in enumerate(rows, start=1):
        nl = row.get("nl_query") or row.get("nl") or ""
        sql = row.get("sql_query") or row.get("sql") or ""
        chunks.append(f'{i}. "{nl}"\n   ```sql\n   {sql}\n   ```')
    return "\n".join(chunks)


def format_store_content(nl: str, sql: str, tags: list[str] | None) -> str:
    """One-liner ``Stored: "<nl>" → <sql preview> (N tags)``."""
    sql_preview = sql.strip().split("\n")[0]
    if len(sql_preview) > 80:
        sql_preview = sql_preview[:77] + "..."
    tag_count = len(tags) if tags else 0
    return f'Stored: "{nl}" → {sql_preview} ({tag_count} tags)'


def format_list_models_content(manifest: dict[str, Any]) -> str:
    """Render manifest models as a compact markdown table.

    Columns: model | cols | description.
    """
    models = manifest.get("models", []) or []
    if not models:
        return "_No models defined in this Wren project._"

    lines = ["| model | cols | description |", "|---|---|---|"]
    for m in models:
        name = m.get("name", "")
        col_count = len(m.get("columns", []) or [])
        desc = (
            (m.get("properties") or {}).get("description") or m.get("description") or ""
        )
        # Trim long descriptions to keep table compact.
        if len(desc) > 80:
            desc = desc[:77] + "..."
        lines.append(f"| {name} | {col_count} | {desc} |")
    return "\n".join(lines)
