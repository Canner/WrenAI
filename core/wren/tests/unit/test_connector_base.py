"""Unit tests for wren.connector.base — shared limit utilities."""

from __future__ import annotations

import pytest

from wren.connector.base import MAX_ROW_LIMIT, ConnectorABC


class _TestConnector(ConnectorABC):
    """Concrete subclass exposing _normalize_limit for testing."""

    def query(self, sql, limit=None):
        raise NotImplementedError

    def dry_run(self, sql):
        raise NotImplementedError

    def close(self):
        raise NotImplementedError


pytestmark = pytest.mark.unit


@pytest.fixture
def connector():
    return _TestConnector()


class TestNormalizeLimit:
    def test_none_returns_none(self, connector):
        assert connector._normalize_limit(None) is None

    def test_zero_passthrough(self, connector):
        assert connector._normalize_limit(0) == 0

    def test_normal_value_passthrough(self, connector):
        assert connector._normalize_limit(500) == 500

    def test_negative_clamps_to_max_limit(self, connector):
        assert connector._normalize_limit(-1) == MAX_ROW_LIMIT

    def test_very_negative_clamps_to_max_limit(self, connector):
        assert connector._normalize_limit(-100000) == MAX_ROW_LIMIT

    def test_above_max_limit_clamped(self, connector):
        assert connector._normalize_limit(MAX_ROW_LIMIT + 1) == MAX_ROW_LIMIT

    def test_at_max_limit_passthrough(self, connector):
        assert connector._normalize_limit(MAX_ROW_LIMIT) == MAX_ROW_LIMIT

    def test_non_numeric_string_falls_back(self, connector):
        assert connector._normalize_limit("abc") == MAX_ROW_LIMIT

    def test_float_truncated(self, connector):
        assert connector._normalize_limit(3.14) == 3

    def test_bool_true_truncated(self, connector):
        assert connector._normalize_limit(True) == 1

    def test_bool_false_passthrough(self, connector):
        assert connector._normalize_limit(False) == 0

    def test_custom_max_limit(self, connector):
        assert connector._normalize_limit(50, max_limit=20) == 20
        assert connector._normalize_limit(10, max_limit=20) == 10

    def test_negative_with_custom_max_limit(self, connector):
        assert connector._normalize_limit(-1, max_limit=50) == 50
