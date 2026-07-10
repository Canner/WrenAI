"""WrenError → ModelRetry mapping for Pydantic AI tools.

Pydantic AI's idiom for "the LLM should retry with a corrected call" is to
raise ``ModelRetry(msg)`` from inside a tool — the framework forwards the
message to the LLM as a ``RetryPromptPart`` and loops up to the tool's
configured ``retries=`` count.

Wren errors split into two classes:

- **Propagate** (infra-class ErrorCodes): config / connection / filesystem
  failures. Retrying won't help; let them bubble out of the agent so the
  user's outer try/except can deal with them.
- **Retry** (everything else): SQL / model-lookup / validation failures
  the LLM can plausibly self-correct by adjusting its next tool call.

Secret redaction (recursive) and a 4KB cap apply to the message body so
neither db passwords nor multi-MB metadata blobs end up in the retry
prompt forwarded to the model.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic_ai import ModelRetry
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

_SECRET_PATTERNS = ("password", "secret", "token", "credential")

METADATA_CAP_BYTES = 4 * 1024
"""Hard cap on the bytes of metadata we serialize into a ModelRetry message.
Anything over this is replaced with a truncation marker — keeps retry
prompts compact and avoids leaking large blobs to the LLM."""

_DIALECT_SQL_EXCERPT_CHARS = 200
"""How many characters of the planned dialect SQL to include in
SQL_EXECUTION retry messages. Long enough for the model to see the bad
fragment, short enough to keep the prompt focused."""


# ErrorCodes that signal infra / config issues the LLM can't fix by retrying.
# All other codes flow through to_model_retry().
_PROPAGATE_CODES: frozenset[ErrorCode] = frozenset(
    {
        ErrorCode.GET_CONNECTION_ERROR,
        ErrorCode.INVALID_CONNECTION_INFO,
        ErrorCode.DUCKDB_FILE_NOT_FOUND,
        ErrorCode.ATTACH_DUCKDB_ERROR,
        ErrorCode.GENERIC_INTERNAL_ERROR,
        ErrorCode.NOT_IMPLEMENTED,
    }
)


def should_propagate(exc: WrenError) -> bool:
    """Whether this WrenError should bubble past the agent instead of
    becoming a ModelRetry. Used by tool wrappers to decide between
    ``raise`` and ``raise to_model_retry(...)``."""
    return exc.error_code in _PROPAGATE_CODES


def redact_secrets(data: Any) -> Any:
    """Replace values whose keys contain secret patterns with '***'.

    Recursively walks nested dicts and lists. Input is not mutated.
    Match is case-insensitive substring against the key name.
    """

    def _walk(value: Any, key_hint: str | None = None) -> Any:
        if key_hint and any(pat in key_hint.lower() for pat in _SECRET_PATTERNS):
            return "***"
        if isinstance(value, dict):
            return {k: _walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [_walk(v, key_hint) for v in value]
        return value

    return _walk(data)


def _build_message(exc: WrenError) -> str:
    """Build the human-readable retry message for *exc*.

    Phase-aware framing tells the LLM what kind of problem it hit so the
    next attempt focuses on the right thing. SQL_EXECUTION includes a
    dialect-SQL excerpt so the LLM sees what was actually sent.
    """
    phase = exc.phase
    msg = exc.message

    if phase == ErrorPhase.SQL_PARSING:
        framing = f"SQL parse error: {msg}. Fix the SQL syntax and retry."
    elif phase == ErrorPhase.SQL_PLANNING:
        framing = f"SQL planning error: {msg}. Check model/column names and retry."
    elif phase == ErrorPhase.SQL_TRANSPILE:
        framing = f"SQL transpile error (target dialect): {msg}. Simplify and retry."
    elif phase == ErrorPhase.SQL_DRY_RUN:
        framing = f"SQL dry-run failed: {msg}. The query is invalid at planning."
    elif phase == ErrorPhase.SQL_EXECUTION:
        framing = f"Database execution error: {msg}."
    elif phase == ErrorPhase.METADATA_FETCHING:
        framing = (
            f"Metadata lookup failed: {msg}. "
            "Verify the model name with wren_list_models and retry."
        )
    elif phase == ErrorPhase.MDL_EXTRACTION:
        framing = f"MDL extraction failed: {msg}. Check schema references and retry."
    elif phase == ErrorPhase.VALIDATION:
        framing = f"Validation error: {msg}. Adjust the SQL and retry."
    else:
        framing = f"Wren error: {msg}."

    # SQL_EXECUTION carries the dialect SQL — include a truncated excerpt
    # so the LLM sees what actually hit the database.
    metadata = redact_secrets(exc.metadata or {})
    if (
        phase == ErrorPhase.SQL_EXECUTION
        and isinstance(metadata, dict)
        and DIALECT_SQL in metadata
    ):
        dialect = str(metadata[DIALECT_SQL])
        if len(dialect) > _DIALECT_SQL_EXCERPT_CHARS:
            dialect = dialect[:_DIALECT_SQL_EXCERPT_CHARS] + "..."
        framing += f" Dialect SQL was: {dialect}"

    # Hard cap. Serialize any extra metadata only if there's room.
    if len(framing.encode("utf-8")) > METADATA_CAP_BYTES:
        return _cap(framing)

    if metadata and phase != ErrorPhase.SQL_EXECUTION:
        # Non-SQL_EXECUTION errors: optionally append serialized metadata
        # if it fits within the remaining cap budget.
        try:
            meta_str = json.dumps(metadata, default=str, ensure_ascii=False)
        except (TypeError, ValueError):
            meta_str = str(metadata)
        candidate = f"{framing} metadata={meta_str}"
        if len(candidate.encode("utf-8")) <= METADATA_CAP_BYTES:
            return candidate

    return _cap(framing)


def _cap(text: str) -> str:
    """Truncate *text* (bytes-aware) to the metadata cap, marking the cut."""
    encoded = text.encode("utf-8")
    if len(encoded) <= METADATA_CAP_BYTES:
        return text
    # Leave room for the marker
    marker = "... [truncated]"
    keep = METADATA_CAP_BYTES - len(marker.encode("utf-8"))
    return encoded[:keep].decode("utf-8", errors="ignore") + marker


def to_model_retry(exc: WrenError) -> ModelRetry:
    """Convert a retry-class WrenError into a ModelRetry the LLM can act on.

    Callers must check ``should_propagate(exc)`` first — calling this on a
    propagate-class error still produces a ModelRetry but the LLM won't be
    able to fix the underlying issue, so it'll waste retry budget.
    """
    return ModelRetry(_build_message(exc))
