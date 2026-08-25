"""Unit tests for native MySQL connector helpers.

These tests cover the pure helpers in ``wren.connector.mysql`` — limit
sanitisation, SQL composition, decimal type derivation — without requiring
a live MySQL server.
"""

from __future__ import annotations

import pyarrow as pa
import pytest

import wren.connector.mysql as mysql_connector
from wren.connector.base import coerce_limit
from wren.connector.mysql import (
    _apply_limit,
    _arrow_decimal_from_mysql_field,
    _build_mysql_column,
    _build_mysql_connect_kwargs,
    _mysql_blob_codes,
    _mysql_decimal_codes,
    _mysql_decimal_type_for_values,
    _mysql_field_type_map,
    _mysql_string_codes,
    _mysql_unsigned_variant_map,
)
from wren.model.error import ErrorCode, WrenError

pytestmark = pytest.mark.unit


class _FakeConnUrl:
    def __init__(self, url: str) -> None:
        self._url = url

    def get_secret_value(self) -> str:
        return self._url


class _FakeConnInfoFromUrl:
    def __init__(self, url: str, kwargs: dict[str, str] | None = None) -> None:
        self.connection_url = _FakeConnUrl(url)
        self.kwargs = kwargs


class _FakeCursor:
    def __init__(self, description: list[tuple], rows: list[tuple]) -> None:
        self.description = description
        self._rows = rows

    def fetchall(self) -> list[tuple]:
        return self._rows


# ── coerce_limit (shared base helper; mysql private removed) ─────────────


def test_coerce_limit_none_passthrough() -> None:
    assert coerce_limit(None) is None


def test_coerce_limit_accepts_int() -> None:
    assert coerce_limit(10) == 10


def test_coerce_limit_accepts_numeric_string() -> None:
    # ``int()`` accepts numeric strings — keep that contract.
    assert coerce_limit("25") == 25


def test_coerce_limit_rejects_injection_string() -> None:
    """A crafted limit value must not survive ``int()`` coercion."""
    with pytest.raises(ValueError):
        coerce_limit("1; DROP TABLE foo")


def test_coerce_limit_rejects_negative() -> None:
    with pytest.raises(ValueError):
        coerce_limit(-1)


def test_coerce_limit_rejects_fractional_decimal_and_fraction() -> None:
    from decimal import Decimal
    from fractions import Fraction

    with pytest.raises(ValueError, match="integral"):
        coerce_limit(Decimal("1.5"))
    with pytest.raises(ValueError, match="integral"):
        coerce_limit(Fraction(3, 2))
    with pytest.raises(ValueError):
        coerce_limit(Decimal("-0.5"))


# ── _apply_limit ──────────────────────────────────────────────────────────


def test_apply_limit_appends_clause() -> None:
    out = _apply_limit("SELECT a FROM t", 5)
    assert out.endswith("LIMIT 5")
    assert "SELECT a FROM t" in out


def test_apply_limit_strips_trailing_semicolon() -> None:
    out = _apply_limit("SELECT a FROM t;", 3)
    assert "; " not in out
    assert out.endswith("LIMIT 3")
    assert ";" not in out.split("LIMIT")[0]


def test_apply_limit_zero() -> None:
    out = _apply_limit("SELECT a FROM t", 0)
    assert out.endswith("LIMIT 0")


# ── URL connection kwargs ─────────────────────────────────────────────────


@pytest.mark.parametrize("scheme", ["mysql", "mysql+pymysql", "mysql+mysqldb"])
def test_mysql_url_allows_raw_brackets_in_password(scheme: str) -> None:
    out = _build_mysql_connect_kwargs(
        _FakeConnInfoFromUrl(f"{scheme}://user:p[a]ss@db.example.com:3306/test")
    )

    assert out["host"] == "db.example.com"
    assert out["port"] == 3306
    assert out["user"] == "user"
    assert out["passwd"] == "p[a]ss"
    assert out["db"] == "test"


def test_mysql_url_decodes_user_password_and_database() -> None:
    out = _build_mysql_connect_kwargs(
        _FakeConnInfoFromUrl(
            "mysql://us%40er:p%40ss%20word@db.example.com:3306/my%20db"
            "?charset=utf8mb4"
        )
    )

    assert out["user"] == "us@er"
    assert out["passwd"] == "p@ss word"
    assert out["db"] == "my db"
    assert out["charset"] == "utf8mb4"


def test_mysql_url_preserves_literal_plus_in_userinfo() -> None:
    out = _build_mysql_connect_kwargs(
        _FakeConnInfoFromUrl("mysql://svc+etl:p+wd@db.example.com:3306/test")
    )

    assert out["user"] == "svc+etl"
    assert out["passwd"] == "p+wd"


def test_mysql_url_preserves_ipv6_host_parsing() -> None:
    out = _build_mysql_connect_kwargs(
        _FakeConnInfoFromUrl("mysql://user:p[a]ss@[::1]:3306/test")
    )

    assert out["host"] == "::1"
    assert out["port"] == 3306
    assert out["passwd"] == "p[a]ss"
    assert out["db"] == "test"


def test_mysql_url_kwargs_override_query_params() -> None:
    out = _build_mysql_connect_kwargs(
        _FakeConnInfoFromUrl(
            "mysql://user:pw@db.example.com:3306/test"
            "?charset=latin1&connect_timeout=10",
            kwargs={"charset": "utf8mb4"},
        )
    )

    assert out["charset"] == "utf8mb4"
    assert out["connect_timeout"] == "10"


def test_mysql_url_invalid_scheme_raises() -> None:
    with pytest.raises(WrenError) as exc:
        _build_mysql_connect_kwargs(
            _FakeConnInfoFromUrl("postgres://user:pw@db.example.com:5432/test")
        )

    assert exc.value.error_code == ErrorCode.INVALID_CONNECTION_INFO


# ── _arrow_decimal_from_mysql_field ──────────────────────────────────────


def test_decimal_type_passthrough() -> None:
    # DECIMAL(12, 4) signed → MySQLdb description length = 12 + 1 (sign) + 1
    # (decimal point) = 14.
    t = _arrow_decimal_from_mysql_field(14, 4, is_unsigned=False)
    assert t == pa.decimal128(12, 4)


def test_decimal_type_unsigned_recovers_precision() -> None:
    # DECIMAL(12, 4) UNSIGNED → length = 12 + 0 (no sign) + 1 (point) = 13.
    t = _arrow_decimal_from_mysql_field(13, 4, is_unsigned=True)
    assert t.precision == 12
    assert t.scale == 4


def test_decimal_type_zero_scale() -> None:
    # DECIMAL(10, 0) signed → length = 10 + 1 (sign) + 0 (no point) = 11.
    t = _arrow_decimal_from_mysql_field(11, 0, is_unsigned=False)
    assert t.precision == 10
    assert t.scale == 0


def test_decimal_type_high_scale() -> None:
    """MySQL allows scale up to 30 — we must not clamp below that for
    precision >= 30."""
    # DECIMAL(38, 30) signed → length = 38 + 1 + 1 = 40.
    t = _arrow_decimal_from_mysql_field(40, 30, is_unsigned=False)
    assert t == pa.decimal128(38, 30)


def test_decimal_type_precision_39_starts_decimal256() -> None:
    # DECIMAL(39, 30) signed → length = 39 + 1 + 1 = 41.
    t = _arrow_decimal_from_mysql_field(41, 30, is_unsigned=False)
    assert t == pa.decimal256(39, 30)


def test_decimal_type_above_decimal128_uses_decimal256() -> None:
    # DECIMAL(65, 30) signed → length = 65 + 1 + 1 = 67.
    t = _arrow_decimal_from_mysql_field(67, 30, is_unsigned=False)
    assert t == pa.decimal256(65, 30)


def test_decimal_type_preserves_doris_decimal256_maximum() -> None:
    # Doris DECIMAL(76, 76) signed → length = 76 + 1 + 1 = 78.
    t = _arrow_decimal_from_mysql_field(78, 76, is_unsigned=False)
    value_decimal = "0." + "9" * 76

    assert t == pa.decimal256(76, 76)
    assert str(_build_mysql_column([value_decimal], t)[0].as_py()) == value_decimal


def test_decimal_type_none_uses_fallback() -> None:
    t = _arrow_decimal_from_mysql_field(None, None)
    assert t.precision == 38
    assert t.scale == 9


def test_decimal_type_scale_not_greater_than_precision() -> None:
    # Pathological case: length implies tiny precision but scale is huge.
    # Result must keep scale <= precision so PyArrow accepts the type.
    t = _arrow_decimal_from_mysql_field(7, 30, is_unsigned=False)
    assert t.scale <= t.precision


# ── value-aware DECIMAL conversion ────────────────────────────────


def test_decimal_column_widens_for_concrete_integer_digits() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("1" + "0" * 65)
    arrow_type = _mysql_decimal_type_for_values(66, 0, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal256(66, 0)
    assert column.to_pylist() == [value]


def test_decimal_column_widens_scale_without_losing_integer_capacity() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("12345678.1234")
    # Signed DECIMAL(10, 2): 10 digits + sign + decimal point.
    arrow_type = _mysql_decimal_type_for_values(12, 2, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal128(12, 4)
    assert column.to_pylist() == [value]


def test_decimal_column_reuses_decimal128_when_observed_value_fits() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("1.234567")
    # Signed DECIMAL(38, 4) has spare integer capacity that can be reassigned
    # to the observed scale without escalating to Decimal256.
    arrow_type = _mysql_decimal_type_for_values(40, 4, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal128(38, 6)
    assert column.to_pylist() == [value]


def test_decimal_column_rebalances_scale_to_stay_decimal128() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("12")
    # Signed DECIMAL(38, 37) reserves one integer digit. The observed value
    # needs two, so release one unused scale digit without using Decimal256.
    arrow_type = _mysql_decimal_type_for_values(40, 37, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal128(38, 36)
    assert column.to_pylist() == [value]


def test_decimal_column_rebalances_metadata_scale_for_observed_integer_digits() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("12")
    # Signed DECIMAL(76, 75) reserves one integer digit. The observed value
    # needs two, so retain the maximum scale that still fits Decimal256.
    arrow_type = _mysql_decimal_type_for_values(78, 75, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal256(76, 74)
    assert column.to_pylist() == [value]


def test_decimal_column_rebalances_integer_capacity_for_observed_scale() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("0.12")
    # Signed DECIMAL(76, 1) reserves 75 integer digits. The observed value
    # needs scale 2, so release unused integer capacity to preserve it exactly.
    arrow_type = _mysql_decimal_type_for_values(78, 1, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal256(76, 2)
    assert column.to_pylist() == [value]


def test_decimal_column_above_arrow_limit_uses_exact_strings() -> None:
    from decimal import Decimal  # noqa: PLC0415

    values = [Decimal("9" * 77), None, Decimal("9" * 80)]
    arrow_type = _mysql_decimal_type_for_values(66, 0, False, values)
    column = _build_mysql_column(values, arrow_type)

    assert arrow_type == pa.string()
    assert column.to_pylist() == [
        "9" * 77,
        None,
        "9" * 80,
    ]


@pytest.mark.parametrize(
    ("digits", "expected_type"),
    [(76, pa.decimal256(76, 0)), (77, pa.string())],
)
def test_negative_decimal_values_follow_arrow_precision_limit(
    digits: int,
    expected_type: pa.DataType,
) -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("-" + "9" * digits)
    arrow_type = _mysql_decimal_type_for_values(66, 0, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == expected_type
    assert column.to_pylist() == (
        [str(value)] if pa.types.is_string(arrow_type) else [value]
    )


def test_decimal_unparseable_value_uses_exact_strings() -> None:
    values = [b"1.5"]
    arrow_type = _mysql_decimal_type_for_values(4, 1, False, values)
    column = _build_mysql_column(values, arrow_type)

    assert arrow_type == pa.string()
    assert column.to_pylist() == ["1.5"]


def test_decimal_metadata_above_arrow_limit_with_fitting_value_stays_numeric() -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal("9" * 65)
    # Signed precision 89 is not representable in Arrow Decimal256.
    arrow_type = _mysql_decimal_type_for_values(90, 0, False, [value])
    column = _build_mysql_column([value], arrow_type)

    assert arrow_type == pa.decimal256(76, 0)
    assert column.to_pylist() == [value]


@pytest.mark.parametrize("rows", [[], [(None,)]], ids=["empty", "all_null"])
def test_decimal_metadata_above_arrow_limit_without_values_stays_numeric(
    rows: list[tuple],
) -> None:
    values = [row[0] for row in rows]
    arrow_type = _mysql_decimal_type_for_values(90, 0, False, values)
    column = _build_mysql_column(values, arrow_type)

    assert arrow_type == pa.decimal256(76, 0)
    assert column.to_pylist() == values


def test_decimal_table_uses_metadata_type_before_scanning_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from decimal import Decimal  # noqa: PLC0415

    values_seen = []

    def get_arrow_type(
        type_code: int,
        flags: int = 0,
        precision: int | None = None,
        scale: int | None = None,
        values: list | None = None,
    ) -> pa.DataType:
        values_seen.append(values)
        return pa.decimal128(3, 2)

    monkeypatch.setattr(mysql_connector, "_mysql_field_arrow_type", get_arrow_type)
    cursor = _FakeCursor(
        [("amount", 0, None, None, 5, 2, True)],
        [(Decimal("1.23"),)],
    )

    table = mysql_connector._build_mysql_arrow_table(cursor)

    assert values_seen == [None]
    assert table.schema.field("amount").type == pa.decimal128(3, 2)
    assert table.column("amount").to_pylist() == [Decimal("1.23")]


@pytest.mark.parametrize(
    ("value", "display_length", "scale", "expected"),
    [
        pytest.param(None, 66, 0, "9" * 77, id="above-arrow-limit"),
        pytest.param(b"1.5", 4, 1, "1.5", id="unparseable"),
        pytest.param("NaN", 4, 1, "NaN", id="non-finite"),
    ],
)
def test_decimal_table_warns_when_falling_back_to_exact_strings(
    monkeypatch: pytest.MonkeyPatch,
    value,
    display_length: int,
    scale: int,
    expected: str,
) -> None:
    from decimal import Decimal  # noqa: PLC0415

    value = Decimal(expected) if value is None else value
    warnings = []

    class _WarningRecorder:
        def warning(self, message: str, *args) -> None:
            warnings.append(message.format(*args))

    def get_arrow_type(
        type_code: int,
        flags: int = 0,
        precision: int | None = None,
        scale: int | None = None,
        values: list | None = None,
    ) -> pa.DataType:
        if values is not None:
            return _mysql_decimal_type_for_values(
                precision,
                scale,
                is_unsigned=False,
                values=values,
            )
        return mysql_connector._arrow_decimal_from_mysql_field(precision, scale)

    monkeypatch.setattr(mysql_connector, "logger", _WarningRecorder())
    monkeypatch.setattr(mysql_connector, "_mysql_field_arrow_type", get_arrow_type)
    cursor = _FakeCursor(
        [("product", 0, None, None, display_length, scale, True)],
        [(value,)],
    )

    table = mysql_connector._build_mysql_arrow_table(cursor)

    assert table.schema.field("product").type == pa.string()
    assert table.column("product").to_pylist() == [expected]
    assert len(warnings) == 1
    assert "product" in warnings[0]


# ── TIME → duration round-trip ────────────────────────────────────────────


def test_time_column_preserves_negative_and_over_24h() -> None:
    """MySQL ``TIME`` ranges ``-838:59:59`` to ``838:59:59`` and can be
    negative. The Arrow type must be ``duration("us")``, not ``time64("us")``
    (which only accepts 0-24h positive values), and the conversion must
    preserve the sign and magnitude of MySQLdb's ``datetime.timedelta``
    values.
    """
    import datetime  # noqa: PLC0415

    values = [
        datetime.timedelta(hours=-100),
        datetime.timedelta(0),
        datetime.timedelta(hours=838, minutes=59, seconds=59),
        -datetime.timedelta(hours=838, minutes=59, seconds=59),
        None,
    ]
    arr = _build_mysql_column(values, pa.duration("us"))
    assert pa.types.is_duration(arr.type)
    out = arr.to_pylist()
    assert out[0] == datetime.timedelta(hours=-100)
    assert out[1] == datetime.timedelta(0)
    assert out[2] == datetime.timedelta(hours=838, minutes=59, seconds=59)
    assert out[3] == -datetime.timedelta(hours=838, minutes=59, seconds=59)
    assert out[4] is None


# ── Thread-safe lazy init ────────────────────────────────────────────────


def test_lazy_init_thread_safe() -> None:
    """The cached FIELD_TYPE accessors must publish fully-populated results
    even when many threads hit them concurrently on a cold cache.

    The previous in-place dict/set mutation pattern could expose a partially
    populated map to a thread that raced the initializer. ``functools.cache``
    guarantees the initializer body runs to completion before the result is
    visible to any caller.
    """
    pytest.importorskip("MySQLdb")
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415

    accessors = (
        _mysql_field_type_map,
        _mysql_unsigned_variant_map,
        _mysql_blob_codes,
        _mysql_string_codes,
        _mysql_decimal_codes,
    )
    for fn in accessors:
        fn.cache_clear()

    # Capture the expected fully-populated reference values once, single-
    # threaded, so the assertions below have a definitive ground truth.
    expected = {fn: fn() for fn in accessors}
    for fn in accessors:
        fn.cache_clear()

    def hit_all() -> tuple:
        return tuple(fn() for fn in accessors)

    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(lambda _: hit_all(), range(64)))

    for row in results:
        for fn, got in zip(accessors, row, strict=True):
            # Every thread sees the same fully-populated object.
            assert got == expected[fn]
            # Sanity: the field-type map is non-empty (MySQLdb constants exist).
            if fn is _mysql_field_type_map:
                assert len(got) > 0
