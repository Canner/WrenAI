from __future__ import annotations

import pytest

from wren.connector import factory
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError

pytestmark = pytest.mark.unit


def test_connector_import_error_has_quoted_wrenai_extra_hint(monkeypatch) -> None:
    def _fake_import_module(name: str):
        if name == "wren.connector.mysql":
            raise ImportError("No module named 'mysqlclient'")
        raise AssertionError(f"Unexpected import: {name}")

    monkeypatch.setattr(factory.importlib, "import_module", _fake_import_module)

    with pytest.raises(WrenError) as exc:
        factory.get_connector(DataSource.doris, {})

    assert exc.value.error_code == ErrorCode.NOT_IMPLEMENTED
    assert "pip install 'wrenai[mysql]'" in str(exc.value)
