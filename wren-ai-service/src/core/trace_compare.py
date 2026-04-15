from typing import Any, Optional


def _read_value(payload: Any, key: str, default=None):
    if payload is None:
        return default
    if isinstance(payload, dict):
        return payload.get(key, default)
    return getattr(payload, key, default)


def _list_items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, tuple):
        return list(payload)
    return []


def summarize_ask_result(result: Optional[dict[str, Any]]) -> dict[str, Any]:
    metadata = _read_value(result, "metadata", {}) or {}
    ask_results = _list_items(_read_value(result, "ask_result", []))

    return {
        "type": _read_value(metadata, "type"),
        "ask_path": _read_value(metadata, "ask_path"),
        "error_type": _read_value(metadata, "error_type"),
        "fallback_reason": _read_value(metadata, "fallback_reason"),
        "resolved_runtime": _read_value(metadata, "resolved_runtime"),
        "ask_runtime_mode": _read_value(metadata, "ask_runtime_mode"),
        "orchestrator": _read_value(metadata, "orchestrator"),
        "sql": _read_value(ask_results[0], "sql") if ask_results else None,
        "result_count": len(ask_results),
    }


def _match_summaries(
    primary_summary: dict[str, Any],
    shadow_summary: dict[str, Any],
    *,
    executed: bool,
    shadow_error: Optional[str],
) -> bool:
    if not _is_comparable(
        primary_summary,
        shadow_summary,
        executed=executed,
        shadow_error=shadow_error,
    ):
        return False

    if primary_summary["type"] == "TEXT_TO_SQL":
        return (
            primary_summary["error_type"] == shadow_summary["error_type"]
            and primary_summary["sql"] == shadow_summary["sql"]
            and primary_summary["result_count"] == shadow_summary["result_count"]
        )

    return False


def _is_comparable(
    primary_summary: dict[str, Any],
    shadow_summary: dict[str, Any],
    *,
    executed: bool,
    shadow_error: Optional[str],
) -> bool:
    return bool(
        executed
        and not shadow_error
        and primary_summary["type"] == "TEXT_TO_SQL"
        and primary_summary["type"] == shadow_summary["type"]
    )


def build_shadow_compare(
    *,
    enabled: bool,
    executed: bool,
    primary_result: Optional[dict[str, Any]] = None,
    shadow_result: Optional[dict[str, Any]] = None,
    shadow_error: Optional[str] = None,
    reason: Optional[str] = None,
) -> dict[str, Any]:
    primary_summary = summarize_ask_result(primary_result)
    shadow_summary = summarize_ask_result(shadow_result)
    comparable = _is_comparable(
        primary_summary,
        shadow_summary,
        executed=executed,
        shadow_error=shadow_error,
    )
    resolved_reason = (
        reason
        if reason is not None
        else (
            primary_summary["fallback_reason"]
            if not executed
            else "shadow_error"
            if shadow_error
            else None
        )
    )

    return {
        "enabled": enabled,
        "executed": executed,
        "comparable": comparable,
        "primary_type": primary_summary["type"],
        "shadow_type": shadow_summary["type"],
        "primary_ask_path": primary_summary["ask_path"],
        "shadow_ask_path": shadow_summary["ask_path"],
        "primary_error_type": primary_summary["error_type"],
        "shadow_error_type": shadow_summary["error_type"],
        "primary_sql": primary_summary["sql"],
        "shadow_sql": shadow_summary["sql"],
        "primary_result_count": primary_summary["result_count"],
        "shadow_result_count": shadow_summary["result_count"],
        "matched": _match_summaries(
            primary_summary,
            shadow_summary,
            executed=executed,
            shadow_error=shadow_error,
        ),
        "shadow_error": shadow_error,
        "reason": resolved_reason,
    }
