"""Regression test: ClickHouse URL ``secure`` truthy spellings must not be
silently downgraded to ``secure=False``."""

import pytest

from wren.model.data_source import DataSource
from wren.model.error import WrenError


def _info(url: str):
    return DataSource.clickhouse._build_connection_info({"connectionUrl": url})


@pytest.mark.parametrize("value", ["true", "1", "yes", "on", "ON", " on "])
def test_truthy_secure_spellings_enable_tls(value):
    info = _info(f"clickhouse://user:pw@localhost:8443/db?secure={value}")
    assert info.secure is True


@pytest.mark.parametrize("value", ["false", "0", "no", "off"])
def test_falsy_secure_spellings_disable_tls(value):
    info = _info(f"clickhouse://user:pw@localhost:8443/db?secure={value}")
    assert info.secure is False


@pytest.mark.parametrize("value", ["enabled", "ture", "maybe"])
def test_unrecognised_secure_spelling_is_rejected(value):
    with pytest.raises(WrenError):
        _info(f"clickhouse://user:pw@localhost:8443/db?secure={value}")
