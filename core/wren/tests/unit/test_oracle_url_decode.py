"""Percent-decoding of credentials in the Oracle ``connection_url`` path.

Credentials routinely contain reserved characters (``@ / : ?``) which MUST be
percent-encoded inside a connection URL. ``urllib.parse.urlparse`` leaves those
escapes in place, so the connector must ``unquote`` them before handing them to
``oracledb.connect`` — otherwise auth fails with the literal ``%40`` etc.

These tests patch ``oracledb.connect`` and assert on the decoded kwargs, so no
live Oracle instance — and no ``oracle`` extra — is required. The connector
lazy-imports ``oracledb``, so we inject a stand-in module attribute when the
real driver isn't installed.
"""

from __future__ import annotations

from types import SimpleNamespace

from wren.connector import oracle as oracle_mod
from wren.connector.oracle import _make_oracle_connection


class _Secret:
    def __init__(self, value: str) -> None:
        self._value = value

    def get_secret_value(self) -> str:
        return self._value


def _capture_connect(monkeypatch) -> dict:
    captured: dict = {}

    def _fake_connect(**kwargs):
        captured.update(kwargs)
        return object()

    # The driver is lazy-imported and may be ``None`` when the ``oracle`` extra
    # isn't installed; provide a stand-in namespace exposing ``connect``.
    stub = oracle_mod.oracledb or SimpleNamespace()
    monkeypatch.setattr(oracle_mod, "oracledb", stub)
    monkeypatch.setattr(stub, "connect", _fake_connect, raising=False)
    return captured


def test_connection_url_decodes_percent_encoded_credentials(monkeypatch):
    captured = _capture_connect(monkeypatch)
    # password is ``p@ss/word`` — the ``@`` and ``/`` are percent-encoded so
    # the URL parses at all.
    info = SimpleNamespace(
        connection_url=_Secret("oracle://us%40er:p%40ss%2Fword@host:1521/svc")
    )
    _make_oracle_connection(info)

    assert captured["user"] == "us@er"
    assert captured["password"] == "p@ss/word"
    assert captured["host"] == "host"
    assert captured["port"] == 1521
    assert captured["service_name"] == "svc"


def test_connection_url_preserves_literal_plus_in_credentials(monkeypatch):
    # ``+`` in userinfo is a literal plus, not a space — unquote (not
    # unquote_plus) must leave it intact.
    captured = _capture_connect(monkeypatch)
    info = SimpleNamespace(
        connection_url=_Secret("oracle://svc+etl:pw+1@host:1521/svc")
    )
    _make_oracle_connection(info)

    assert captured["user"] == "svc+etl"
    assert captured["password"] == "pw+1"
