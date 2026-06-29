"""Regression test: DuckDB file discovery is case-insensitive on extension."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import wren.connector.duckdb as duckdb_mod
from wren.connector.duckdb import DuckDBConnector


def _entry(path):
    """Build a fake opendal list entry exposing only a ``path`` attribute."""
    return SimpleNamespace(path=path)


def _stat(is_dir):
    """Build a fake opendal stat result whose ``mode.is_dir()`` returns ``is_dir``."""
    mode = MagicMock()
    mode.is_dir.return_value = is_dir
    return SimpleNamespace(mode=mode)


def test_list_duckdb_files_matches_uppercase_extension():
    # DuckDB database files are commonly named *.duckdb but the extension may
    # be upper- or mixed-case (e.g. exported "WAREHOUSE.DUCKDB"). The listing
    # must not drop them just because of letter case.
    entries = [
        _entry("/"),
        _entry("data.duckdb"),
        _entry("WAREHOUSE.DUCKDB"),
        _entry("Mixed.DuckDB"),
        _entry("notes.txt"),
        _entry("subdir/"),
    ]
    stat_by_path = {
        "data.duckdb": _stat(False),
        "WAREHOUSE.DUCKDB": _stat(False),
        "Mixed.DuckDB": _stat(False),
        "notes.txt": _stat(False),
        "subdir/": _stat(True),
    }

    fake_op = MagicMock()
    fake_op.list.return_value = entries
    fake_op.stat.side_effect = lambda p: stat_by_path[p]

    connection_info = SimpleNamespace(url="/tmp/dbs")

    # Bypass __init__ (it would open a real duckdb connection).
    connector = DuckDBConnector.__new__(DuckDBConnector)

    with patch.object(duckdb_mod.opendal, "Operator", return_value=fake_op):
        files = connector._list_duckdb_files(connection_info)

    assert files == [
        "/tmp/dbs/data.duckdb",
        "/tmp/dbs/WAREHOUSE.DUCKDB",
        "/tmp/dbs/Mixed.DuckDB",
    ]
