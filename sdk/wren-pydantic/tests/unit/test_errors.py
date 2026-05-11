"""Tests for WrenError → ModelRetry mapping.

Mirrors wren-langchain's test_envelope.py but adapts to Pydantic AI's
ModelRetry idiom. Covers phase-aware messages, secret redaction (recursive),
4KB cap, dialect_sql truncation, and the propagate vs retry split.
"""

from __future__ import annotations

import pytest
from pydantic_ai import ModelRetry
from wren.model.error import ErrorCode, ErrorPhase, WrenError

from wren_pydantic._errors import (
    METADATA_CAP_BYTES,
    redact_secrets,
    should_propagate,
    to_model_retry,
)

# ── Propagate vs retry classification ─────────────────────────────────────


@pytest.mark.parametrize(
    "code",
    [
        ErrorCode.GET_CONNECTION_ERROR,
        ErrorCode.INVALID_CONNECTION_INFO,
        ErrorCode.DUCKDB_FILE_NOT_FOUND,
        ErrorCode.ATTACH_DUCKDB_ERROR,
    ],
)
def test_should_propagate_returns_true_for_infra_codes(code):
    exc = WrenError(error_code=code, message="boom")
    assert should_propagate(exc) is True


@pytest.mark.parametrize(
    "code",
    [
        ErrorCode.INVALID_SQL,
        ErrorCode.MODEL_NOT_FOUND,
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.GENERIC_USER_ERROR,
    ],
)
def test_should_propagate_returns_false_for_retry_codes(code):
    exc = WrenError(error_code=code, message="boom")
    assert should_propagate(exc) is False


# ── Message construction per phase ────────────────────────────────────────


def test_to_model_retry_sql_parsing_phase_signals_fixable_sql():
    exc = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="unexpected token at line 1",
        phase=ErrorPhase.SQL_PARSING,
    )
    retry = to_model_retry(exc)
    assert isinstance(retry, ModelRetry)
    text = str(retry).lower()
    assert "sql" in text and ("parse" in text or "parsing" in text)
    assert "unexpected token" in str(retry)


def test_to_model_retry_metadata_fetching_phase_hints_model_lookup():
    exc = WrenError(
        error_code=ErrorCode.MODEL_NOT_FOUND,
        message="model 'orders' not found",
        phase=ErrorPhase.METADATA_FETCHING,
    )
    retry = to_model_retry(exc)
    text = str(retry).lower()
    assert "model" in text or "metadata" in text
    assert "orders" in str(retry)


def test_to_model_retry_sql_execution_includes_dialect_sql_excerpt():
    """SQL_EXECUTION errors include the planned dialect SQL (truncated)
    so the LLM can self-correct against what was actually sent."""
    long_sql = "SELECT " + "x, " * 200 + "y FROM events"
    exc = WrenError(
        error_code=ErrorCode.GENERIC_USER_ERROR,
        message="(1064, 'syntax error')",
        phase=ErrorPhase.SQL_EXECUTION,
        metadata={"dialectSql": long_sql},
    )
    retry = to_model_retry(exc)
    text = str(retry)
    assert "SELECT" in text
    # Excerpt is capped — exact value documented in code, just verify
    # it's substantially shorter than the original.
    assert len(text) < len(long_sql) + 500
    assert "..." in text  # truncation marker


def test_to_model_retry_no_phase_still_builds_a_message():
    """phase=None shouldn't crash — fall back to a generic retry message."""
    exc = WrenError(error_code=ErrorCode.GENERIC_USER_ERROR, message="something off")
    retry = to_model_retry(exc)
    assert "something off" in str(retry)


# ── Redaction + cap ───────────────────────────────────────────────────────


def test_redact_secrets_walks_nested_dicts_and_lists():
    payload = {
        "host": "db.example.com",
        "connection_info": {
            "password": "supersecret",
            "options": [{"api_token": "xyz"}, {"port": 5432}],
        },
    }
    cleaned = redact_secrets(payload)
    assert cleaned["host"] == "db.example.com"
    assert cleaned["connection_info"]["password"] == "***"
    assert cleaned["connection_info"]["options"][0]["api_token"] == "***"
    assert cleaned["connection_info"]["options"][1]["port"] == 5432
    # input unchanged
    assert payload["connection_info"]["password"] == "supersecret"


def test_to_model_retry_redacts_secrets_in_metadata():
    exc = WrenError(
        error_code=ErrorCode.GET_CONNECTION_ERROR,
        message="auth failed",
        phase=ErrorPhase.SQL_EXECUTION,
        metadata={"connection_info": {"password": "supersecret"}},
    )
    # propagate path doesn't apply here — we want to test the message
    # builder still redacts when called directly
    from wren_pydantic._errors import _build_message  # noqa: PLC0415

    msg = _build_message(exc)
    assert "supersecret" not in msg
    assert "***" in msg or "password" not in msg.lower()


def test_to_model_retry_caps_message_at_4kb():
    """Even when metadata is huge, the ModelRetry message stays under cap."""
    huge_metadata = {"junk": "x" * 100_000}
    exc = WrenError(
        error_code=ErrorCode.GENERIC_USER_ERROR,
        message="error with big metadata",
        phase=ErrorPhase.SQL_EXECUTION,
        metadata=huge_metadata,
    )
    retry = to_model_retry(exc)
    assert len(str(retry).encode("utf-8")) <= METADATA_CAP_BYTES + 1024
