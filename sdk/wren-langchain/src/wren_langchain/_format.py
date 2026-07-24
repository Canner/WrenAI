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


def format_dry_plan_content(sql: str | None) -> str:
    """Wrap dialect SQL in a markdown code fence.

    Coerce ``None`` to empty so tool wrappers that pass through a missing plan
    do not render the literal string ``None`` inside the fence.
    """
    text = "" if sql is None else str(sql)
    return f"```sql\n{text}\n```"


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
    if not isinstance(items, list) or not items:
        return "_No relevant context items found._"

    lines = []
    n = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        n += 1
        item_type = item.get("item_type", "item")
        name = item.get("name", "")
        summary = item.get("summary") or item.get("text") or ""
        if not isinstance(summary, str):
            summary = str(summary) if summary is not None else ""
        if len(summary) > 120:
            summary = summary[:117] + "..."
        lines.append(f"{n}. [{item_type}] {name} — {summary}")
    if not lines:
        return "_No relevant context items found._"
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
    if not isinstance(rows, list) or not rows:
        return "_No similar past queries found._"

    chunks = []
    n = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        n += 1
        nl = row.get("nl_query") or row.get("nl") or ""
        sql = row.get("sql_query") or row.get("sql") or ""
        chunks.append(f'{n}. "{nl}"\n   ```sql\n   {sql}\n   ```')
    if not chunks:
        return "_No similar past queries found._"
    return "\n".join(chunks)


def format_store_content(nl: str, sql: str, tags: list[str] | None) -> str:
    """One-liner ``Stored: "<nl>" → <sql preview> (N tags)``."""
    # Store tool paths occasionally surface None/placeholders before validation.
    # Coerce so format helpers never TypeError on .strip().
    if not isinstance(nl, str):
        nl = "" if nl is None else str(nl)
    if not isinstance(sql, str):
        sql = "" if sql is None else str(sql)
    sql_preview = sql.strip().split("\n")[0]
    if len(sql_preview) > 80:
        sql_preview = sql_preview[:77] + "..."
    tag_count = len(tags) if isinstance(tags, list) else 0
    return f'Stored: "{nl}" → {sql_preview} ({tag_count} tags)'


def format_list_models_content(manifest: dict[str, Any]) -> str:
    """Render manifest models as a compact markdown table.

    Columns: model | cols | description.
    """
    models = manifest.get("models", []) or []
    if not isinstance(models, list) or not models:
        return "_No models defined in this Wren project._"

    lines = ["| model | cols | description |", "|---|---|---|"]
    any_model = False
    for m in models:
        if not isinstance(m, dict):
            continue
        any_model = True
        name = m.get("name", "")
        cols = m.get("columns", []) or []
        col_count = len(cols) if isinstance(cols, list) else 0
        props = m.get("properties") or {}
        if not isinstance(props, dict):
            props = {}
        desc = props.get("description") or m.get("description") or ""
        if not isinstance(desc, str):
            desc = str(desc) if desc is not None else ""
        # Trim long descriptions to keep table compact.
        if len(desc) > 80:
            desc = desc[:77] + "..."
        lines.append(f"| {name} | {col_count} | {desc} |")
    if not any_model:
        return "_No models defined in this Wren project._"
    return "\n".join(lines)
