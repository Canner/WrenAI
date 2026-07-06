"""Regression tests for ClickHouse connection-URL credential decoding.

``DataSource.clickhouse._build_connection_info`` parses a ``connectionUrl`` and
must percent-decode the username, password, and database. Two bugs are covered:

1. The password was decoded with ``unquote_plus``, which turns a literal ``+``
   (a valid password character) into a space.
2. The username and database were not decoded at all, so percent-escapes such
   as ``%40`` survived as literal text.
"""

from urllib.parse import quote

from wren.model.data_source import DataSource


def _info(url: str):
    return DataSource.clickhouse._build_connection_info({"connectionUrl": url})


def test_plus_in_password_is_preserved():
    # A literal '+' in the password must stay a '+', not become a space
    # (the bug: unquote_plus decodes '+' -> ' ').
    url = "clickhouse://user:pa+ss@localhost:8123/mydb"
    info = _info(url)
    assert info.password.get_secret_value() == "pa+ss"


def test_username_and_database_are_decoded():
    user = quote("us@er", safe="")
    db = quote("my db", safe="")
    url = f"clickhouse://{user}:secret@localhost:8123/{db}"
    info = _info(url)
    assert info.user == "us@er"
    assert info.database == "my db"


def test_special_chars_in_password_decoded():
    pwd = quote("p@ss/w:rd", safe="")
    url = f"clickhouse://user:{pwd}@localhost:8123/mydb"
    info = _info(url)
    assert info.password.get_secret_value() == "p@ss/w:rd"
