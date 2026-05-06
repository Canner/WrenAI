"""Tests for envelope construction and error formatting."""

import datetime as dt
from decimal import Decimal

from wren.model.error import ErrorCode, ErrorPhase, WrenError

from wren_langchain._envelope import (
    cap_size,
    format_error,
    json_safe,
    make_error,
    make_success,
)


def test_make_success_returns_ok_envelope():
    """make_success returns a JSON-serializable envelope with ok=True."""
    result = make_success(content="hello", data={"foo": "bar"})

    assert result == {
        "ok": True,
        "content": "hello",
        "data": {"foo": "bar"},
        "warnings": [],
    }


def test_make_success_includes_warnings_when_provided():
    """Warnings list is preserved in the envelope."""
    result = make_success(
        content="ok",
        data={},
        warnings=["content truncated: showed 32 of 100 rows"],
    )

    assert result["warnings"] == ["content truncated: showed 32 of 100 rows"]


def test_format_error_extracts_wren_error_fields():
    """format_error pulls code, phase, message, metadata from WrenError."""
    exc = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="syntax error near 'SELEC'",
        phase=ErrorPhase.SQL_PARSING,
        metadata={"position": 7},
    )

    result = format_error(exc)

    assert result["code"] == "INVALID_SQL"
    assert result["phase"] == "SQL_PARSING"
    assert result["message"] == "syntax error near 'SELEC'"
    assert result["metadata"] == {"position": 7}


def test_format_error_handles_non_wren_exception():
    """Generic exceptions become SDK_ERROR with stringified message."""
    result = format_error(ValueError("something went wrong"))

    assert result["code"] == "SDK_ERROR"
    assert result["phase"] is None
    assert result["message"] == "something went wrong"
    assert result["metadata"] == {}


def test_format_error_redacts_nested_secret_keys_in_metadata():
    """Nested secrets inside dicts and lists must also be redacted."""
    exc = WrenError(
        error_code=ErrorCode.GET_CONNECTION_ERROR,
        message="connect failed",
        metadata={
            "connection_info": {
                "host": "db.example.com",
                "password": "hunter2",
                "credentials": {"token": "deeply-nested"},
            },
            "history": [
                {"event": "connect", "auth_token": "should-be-hidden"},
            ],
        },
    )

    result = format_error(exc)
    md = result["metadata"]

    assert md["connection_info"]["host"] == "db.example.com"
    assert md["connection_info"]["password"] == "***"
    assert md["connection_info"]["credentials"] == "***"
    assert md["history"][0]["event"] == "connect"
    assert md["history"][0]["auth_token"] == "***"


def test_format_error_redacts_secret_keys_in_metadata():
    """Keys matching secret patterns get replaced with '***'."""
    exc = WrenError(
        error_code=ErrorCode.GET_CONNECTION_ERROR,
        message="connect failed",
        metadata={
            "host": "db.example.com",
            "password": "hunter2",
            "API_TOKEN": "abc123",
            "auth_secret": "shh",
            "user_credential": "pwd",
            "harmless": "value",
        },
    )

    result = format_error(exc)

    assert result["metadata"]["host"] == "db.example.com"
    assert result["metadata"]["harmless"] == "value"
    assert result["metadata"]["password"] == "***"
    assert result["metadata"]["API_TOKEN"] == "***"
    assert result["metadata"]["auth_secret"] == "***"
    assert result["metadata"]["user_credential"] == "***"


def test_json_safe_converts_datetime_to_iso_string():
    """datetime objects are serialized to ISO strings."""
    result = json_safe({"when": dt.datetime(2026, 5, 6, 12, 0, 0)})
    assert result["when"] == "2026-05-06T12:00:00"


def test_json_safe_converts_decimal_to_string():
    """Decimal objects are serialized to strings to preserve precision."""
    result = json_safe({"amount": Decimal("123.45")})
    assert result["amount"] == "123.45"


def test_json_safe_recurses_into_nested_dict_and_list():
    """Conversion recurses through nested structures."""
    payload = {
        "rows": [
            {"date": dt.date(2026, 5, 6), "amount": Decimal("1.5")},
            {"date": dt.date(2026, 5, 7), "amount": Decimal("2.5")},
        ],
    }
    result = json_safe(payload)
    assert result["rows"][0]["date"] == "2026-05-06"
    assert result["rows"][0]["amount"] == "1.5"
    assert result["rows"][1]["amount"] == "2.5"


def test_cap_size_returns_input_unchanged_when_under_limit():
    """cap_size leaves data alone when JSON-serialized size is below limit."""
    payload = {"a": 1, "b": "hello"}
    result = cap_size(payload, max_bytes=4096)
    assert result == payload


def test_cap_size_truncates_and_marks_when_over_limit():
    """When over-limit, cap_size returns a marker dict with the original size note."""
    payload = {"big": "x" * 10000}
    result = cap_size(payload, max_bytes=1024)
    assert result["_truncated"] is True
    assert "original_size_bytes" in result


def test_format_error_caps_metadata_at_4kb():
    """Metadata exceeding 4KB is replaced by a truncation marker."""
    big_metadata = {"sql": "SELECT * FROM x WHERE y = '" + ("a" * 5000) + "'"}
    exc = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="bad sql",
        metadata=big_metadata,
    )

    result = format_error(exc)

    assert result["metadata"].get("_truncated") is True


def test_make_error_returns_full_envelope():
    """make_error returns a full {ok: False, content, error} envelope."""
    exc = WrenError(
        error_code=ErrorCode.INVALID_SQL,
        message="syntax error",
        phase=ErrorPhase.SQL_PARSING,
    )

    result = make_error(exc)

    assert result["ok"] is False
    assert result["content"] == "syntax error"
    assert result["error"]["code"] == "INVALID_SQL"
    assert result["error"]["phase"] == "SQL_PARSING"
