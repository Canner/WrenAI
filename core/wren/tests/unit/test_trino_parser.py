"""Pure unit tests for the native Trino connector helpers (no Docker).

These exercise the type-string parser, the column builder, the connection-URL
parser, and the lazy-import error path. They deliberately avoid the
``testcontainers.trino`` import so the ``test-unit`` CI job (which does not
install the ``trino`` extra) can collect and run them. The container-backed
integration suite lives in ``tests/connectors/test_trino.py``.
"""

from __future__ import annotations

from decimal import Decimal

import pyarrow as pa
import pytest

from wren.connector.trino import (
    _build_trino_column,
    _parse_trino_data_type,
    _parse_trino_url,
    _strip_trailing_semicolon,
)
from wren.model.error import ErrorCode, WrenError

# ---------------------------------------------------------------------------
# Type-string parser and column builder.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("type_str", "expected"),
    [
        # Scalars
        ("boolean", pa.bool_()),
        ("tinyint", pa.int8()),
        ("smallint", pa.int16()),
        ("integer", pa.int32()),
        ("int", pa.int32()),
        ("bigint", pa.int64()),
        ("real", pa.float32()),
        ("double", pa.float64()),
        ("varchar", pa.string()),
        ("varchar(255)", pa.string()),
        ("char(10)", pa.string()),
        ("varbinary", pa.binary()),
        ("date", pa.date32()),
        ("uuid", pa.string()),
        ("ipaddress", pa.string()),
        ("json", pa.string()),
        # Decimal
        ("decimal(10,2)", pa.decimal128(10, 2)),
        ("decimal(38,9)", pa.decimal128(38, 9)),
        # DECIMAL(p) is scale 0 and bare DECIMAL is DECIMAL(38, 0) in Trino.
        ("decimal", pa.decimal128(38, 0)),
        ("decimal(10)", pa.decimal128(10, 0)),
        ("decimal(5)", pa.decimal128(5, 0)),
        # Time / timestamp
        ("time", pa.time64("us")),
        ("time(3)", pa.time64("us")),
        ("timestamp", pa.timestamp("ms")),
        ("timestamp(6)", pa.timestamp("ms")),
        ("timestamp with time zone", pa.timestamp("ms", tz="UTC")),
        ("timestamp(6) with time zone", pa.timestamp("ms", tz="UTC")),
        # Containers
        ("array(integer)", pa.list_(pa.int32())),
        ("array(decimal(10,2))", pa.list_(pa.decimal128(10, 2))),
        ("array(varchar)", pa.list_(pa.string())),
        # Map
        ("map(varchar,bigint)", pa.map_(pa.string(), pa.int64())),
        ("map(varchar, bigint)", pa.map_(pa.string(), pa.int64())),
        # Row — named and anonymous
        (
            "row(a integer, b varchar)",
            pa.struct([pa.field("a", pa.int32()), pa.field("b", pa.string())]),
        ),
        (
            "row(map(varchar, integer), bigint)",
            pa.struct(
                [
                    pa.field("f0", pa.map_(pa.string(), pa.int32())),
                    pa.field("f1", pa.int64()),
                ]
            ),
        ),
        # Nested array(map(varchar, row(...)))
        (
            "array(map(varchar, row(a integer, b varchar)))",
            pa.list_(
                pa.map_(
                    pa.string(),
                    pa.struct(
                        [
                            pa.field("a", pa.int32()),
                            pa.field("b", pa.string()),
                        ]
                    ),
                )
            ),
        ),
        # Unknown / interval — fall back to string
        ("interval year to month", pa.string()),
        ("interval day to second", pa.string()),
        ("hyperloglog", pa.string()),
    ],
)
def test_parse_trino_data_type(type_str: str, expected: pa.DataType) -> None:
    assert _parse_trino_data_type(type_str) == expected


def test_parse_trino_data_type_handles_none() -> None:
    assert _parse_trino_data_type(None) == pa.string()


def test_parse_trino_data_type_unparseable_falls_back() -> None:
    assert _parse_trino_data_type("not a real type {{") == pa.string()


def test_build_trino_column_map_dict_to_pairs() -> None:
    # Trino driver returns Python dicts; PyArrow map_ wants (k, v) pairs.
    arrow_type = pa.map_(pa.string(), pa.int64())
    arr = _build_trino_column([{"a": 1, "b": 2}, None, {"x": 9}], arrow_type)
    assert arr.type == arrow_type
    assert arr.to_pylist() == [
        [("a", 1), ("b", 2)],
        None,
        [("x", 9)],
    ]


def test_build_trino_column_decimal_string_input() -> None:
    arr = _build_trino_column(["1.23", "4.56", None], pa.decimal128(10, 2))
    assert arr.to_pylist() == [Decimal("1.23"), Decimal("4.56"), None]


def test_build_trino_column_struct_tuple_to_dict() -> None:
    arrow_type = pa.struct([pa.field("a", pa.int32()), pa.field("b", pa.string())])
    arr = _build_trino_column([(1, "x"), None, (2, "y")], arrow_type)
    assert arr.to_pylist() == [{"a": 1, "b": "x"}, None, {"a": 2, "b": "y"}]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SELECT 1", "SELECT 1"),
        ("SELECT 1;", "SELECT 1"),
        ("SELECT 1  ;  ", "SELECT 1"),
        ("SELECT 1\n;\n", "SELECT 1"),
        ("SELECT 1; -- trailing", "SELECT 1; -- trailing"),
        # Only the final semicolon is stripped — internal ones stay.
        ("SELECT 1; SELECT 2;", "SELECT 1; SELECT 2"),
    ],
)
def test_strip_trailing_semicolon(raw: str, expected: str) -> None:
    assert _strip_trailing_semicolon(raw) == expected


# ---------------------------------------------------------------------------
# Connection-URL parser.
# ---------------------------------------------------------------------------


def test_parse_trino_url_rejects_missing_username() -> None:
    with pytest.raises(WrenError) as exc:
        _parse_trino_url("trino://host:8080/catalog/schema", None)
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    assert "username" in str(exc.value).lower()


def test_parse_trino_url_accepts_explicit_username() -> None:
    out = _parse_trino_url("trino://alice@host:8080/catalog/schema", None)
    assert out["user"] == "alice"
    assert out["host"] == "host"
    assert out["catalog"] == "catalog"
    assert out["schema"] == "schema"


def test_parse_trino_url_decodes_user_password_and_identifiers() -> None:
    """Credentials and path identifiers are percent-decoded with unquote."""
    out = _parse_trino_url(
        "trino://us%40er:p%40ss%2Fword@host:8080/my%2Fcatalog/my%20schema",
        None,
    )
    assert out["user"] == "us@er"
    assert out["_password"] == "p@ss/word"
    assert out["catalog"] == "my/catalog"
    assert out["schema"] == "my schema"


def test_parse_trino_url_preserves_literal_plus_in_userinfo() -> None:
    """``+`` in userinfo is a literal plus, not a form-encoded space."""
    out = _parse_trino_url("trino://svc+etl:pw+1@host:8080/catalog/schema", None)
    assert out["user"] == "svc+etl"
    assert out["_password"] == "pw+1"


def test_parse_trino_url_rejects_bad_scheme() -> None:
    with pytest.raises(WrenError) as exc:
        _parse_trino_url("http://alice@host:8080/c/s", None)
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO


# ---------------------------------------------------------------------------
# Lazy-import behaviour.
# ---------------------------------------------------------------------------


def test_trino_connector_import_error_has_install_hint(monkeypatch) -> None:
    """If ``import trino`` fails, the connector should raise a WrenError with
    a clear ``pip install 'wrenai[trino]'`` hint rather than a raw
    ImportError.
    """
    import builtins  # noqa: PLC0415
    import sys  # noqa: PLC0415

    from wren.connector import trino as trino_module  # noqa: PLC0415

    # Remove cached trino module so the lazy import re-runs.
    monkeypatch.setitem(sys.modules, "trino", None)
    real_import = builtins.__import__

    def _fake_import(name, *args, **kwargs):
        if name == "trino" or name.startswith("trino."):
            raise ImportError("No module named 'trino'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)

    with pytest.raises(WrenError) as exc:
        trino_module._import_trino()
    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO
    msg = str(exc.value)
    assert "pip install 'wrenai[trino]'" in msg


def test_native_connector_does_not_import_ibis() -> None:
    # Acceptance criterion: importing the native trino connector must not
    # pull ibis into sys.modules (the new module is independent of
    # ibis-framework[trino]).
    import sys  # noqa: PLC0415

    sys.modules.pop("ibis", None)
    sys.modules.pop("wren.connector.trino", None)
    import wren.connector.trino  # noqa: F401, PLC0415

    assert "ibis" not in sys.modules
