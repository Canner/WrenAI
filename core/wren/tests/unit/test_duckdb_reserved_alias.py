"""DuckDB files named like a built-in catalog must still attach."""

import duckdb
import pytest

from wren.connector.duckdb import DuckDBConnector
from wren.model import LocalFileConnectionInfo

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("name", ["main", "memory", "temp", "system"])
def test_attaches_file_named_like_a_builtin_catalog(tmp_path, name):
    with duckdb.connect(str(tmp_path / f"{name}.duckdb")) as con:
        con.execute("CREATE TABLE t AS SELECT 1 AS x")

    connector = DuckDBConnector(
        LocalFileConnectionInfo(url=str(tmp_path), format="duckdb")
    )
    try:
        result = connector.query(f'SELECT x FROM "{name}_1".main.t')
        assert result.to_pylist() == [{"x": 1}]
    finally:
        connector.close()
