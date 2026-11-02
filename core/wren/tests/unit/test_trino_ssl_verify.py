"""Trino SSL verify coercion (#1502)."""

import pytest

from wren.connector.trino import (
    _apply_trino_ssl_overrides,
    _coerce_trino_verify,
    _parse_trino_url,
)
from wren.model.error import WrenError


def test_coerce_false_strings():
    assert _coerce_trino_verify("false") is False
    assert _coerce_trino_verify("FALSE") is False
    assert _coerce_trino_verify("0") is False


def test_coerce_true_and_path():
    assert _coerce_trino_verify("true") is True
    assert _coerce_trino_verify("/etc/ssl/certs/ca.pem") == "/etc/ssl/certs/ca.pem"


def test_parse_url_verify_false_query_param():
    kwargs = _parse_trino_url(
        "trino+https://alice@trino.example:443/cat/sch?verify=false", None
    )
    assert kwargs["http_scheme"] == "https"
    assert kwargs["verify"] is False


def test_apply_insecure_alias():
    out = _apply_trino_ssl_overrides({"host": "h", "insecure": "true"})
    assert out["verify"] is False
    assert "insecure" not in out


def test_apply_ssl_verify_alias():
    out = _apply_trino_ssl_overrides({"host": "h", "ssl_verify": "false"})
    assert out["verify"] is False
    assert "ssl_verify" not in out


def test_apply_relative_verify_path_resolved_against_cwd(tmp_path, monkeypatch):
    (tmp_path / "certs").mkdir()
    (tmp_path / "certs" / "ca-chain.pem").write_text("cert")
    monkeypatch.chdir(tmp_path)
    out = _apply_trino_ssl_overrides({"host": "h", "verify": "certs/ca-chain.pem"})
    assert out["verify"] == str(tmp_path / "certs/ca-chain.pem")


def test_apply_relative_ssl_verify_alias_path_resolved_against_cwd(
    tmp_path, monkeypatch
):
    (tmp_path / "certs").mkdir()
    (tmp_path / "certs" / "ca.pem").write_text("cert")
    monkeypatch.chdir(tmp_path)
    out = _apply_trino_ssl_overrides({"host": "h", "ssl_verify": "certs/ca.pem"})
    assert out["verify"] == str(tmp_path / "certs/ca.pem")


def test_apply_absolute_verify_path_untouched(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text("cert")
    out = _apply_trino_ssl_overrides({"host": "h", "verify": str(ca)})
    assert out["verify"] == str(ca)


def test_apply_verify_path_expanduser(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "certs").mkdir()
    (tmp_path / "certs" / "ca.pem").write_text("cert")
    out = _apply_trino_ssl_overrides({"host": "h", "verify": "~/certs/ca.pem"})
    assert out["verify"] == str(tmp_path / "certs/ca.pem")


def test_apply_verify_path_missing_raises_with_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(WrenError) as exc_info:
        _apply_trino_ssl_overrides({"host": "h", "verify": "certs/ca-chain.pem"})
    assert str(tmp_path / "certs/ca-chain.pem") in str(exc_info.value)
