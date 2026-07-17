"""Trino SSL verify coercion (#1502)."""

from wren.connector.trino import (
    _apply_trino_ssl_overrides,
    _coerce_trino_verify,
    _parse_trino_url,
)


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
