"""Envelope construction and error formatting for LLM-facing tools.

The envelope shape is the contract between SDK tools and LangChain agents.
Success: {"ok": True, "content": str, "data": dict, "warnings": list[str]}
Error:   {"ok": False, "content": str, "error": {"code", "phase", "message", "metadata"}}
"""

import datetime as _dt
import json
from decimal import Decimal
from typing import Any

from wren.model.error import WrenError

_SECRET_PATTERNS = ("password", "secret", "token", "credential")
_DEFAULT_METADATA_CAP = 4 * 1024
_DEFAULT_CONTENT_CAP = 16 * 1024


def json_safe(value: Any) -> Any:
    """Recursively convert non-JSON-serializable values to JSON-friendly forms.

    - datetime/date/time → ISO 8601 string
    - Decimal → string (preserves precision)
    - dict / list / tuple → recurse
    - other types fall back to str(value) when not natively JSON-encodable
    """
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def cap_size(data: dict[str, Any], max_bytes: int) -> dict[str, Any]:
    """Return *data* unchanged if JSON-serialized size <= max_bytes.

    When over-limit, return a sentinel marker dict instead. Callers should
    treat the marker as opaque and surface to logs/middleware, not LLMs.
    """
    encoded = json.dumps(data, default=str).encode("utf-8")
    if len(encoded) <= max_bytes:
        return data
    return {
        "_truncated": True,
        "original_size_bytes": len(encoded),
    }


def redact_secrets(data: dict[str, Any]) -> dict[str, Any]:
    """Replace values whose keys contain secret patterns with '***'.

    Match is case-insensitive substring match against the key. Recursively
    walks nested dicts and lists so a payload like
    ``{"connection_info": {"password": "..."}}`` is also redacted.
    Input is not mutated.
    """

    def _walk(value: Any, key_hint: str | None = None) -> Any:
        if key_hint and any(pat in key_hint.lower() for pat in _SECRET_PATTERNS):
            return "***"
        if isinstance(value, dict):
            return {k: _walk(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [_walk(v, key_hint) for v in value]
        return value

    return {k: _walk(v, k) for k, v in data.items()}


def make_success(
    content: str,
    data: dict[str, Any],
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Construct a success envelope."""
    return {
        "ok": True,
        "content": content,
        "data": data,
        "warnings": warnings or [],
    }


def format_error(exc: Exception) -> dict[str, Any]:
    """Convert an exception into the structured error dict used in envelopes."""
    if isinstance(exc, WrenError):
        metadata = redact_secrets(exc.metadata or {})
        metadata = json_safe(metadata)
        metadata = cap_size(metadata, max_bytes=_DEFAULT_METADATA_CAP)
        return {
            "code": exc.error_code.name,
            "phase": exc.phase.name if exc.phase else None,
            "message": exc.message,
            "metadata": metadata,
        }
    return {
        "code": "SDK_ERROR",
        "phase": None,
        "message": str(exc),
        "metadata": {},
    }


def make_error(exc: Exception) -> dict[str, Any]:
    """Construct a failure envelope from an exception."""
    error = format_error(exc)
    return {
        "ok": False,
        "content": error["message"],
        "error": error,
    }
