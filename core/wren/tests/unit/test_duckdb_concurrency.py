"""Concurrent calls must not overwrite another call's DuckDB result."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import duckdb
import pytest

from wren.connector.duckdb import DuckDBConnector
from wren.model import LocalFileConnectionInfo

pytestmark = pytest.mark.unit


@pytest.fixture
def connector(tmp_path):
    instance = DuckDBConnector(
        LocalFileConnectionInfo(url=str(tmp_path), format="parquet")
    )
    yield instance
    instance.close()


class _InterleavedConnection:
    """Pause after real execution so the second call runs before the fetch."""

    def __init__(self, connection, executed, resume, second_executed):
        self.connection = connection
        self.executed = executed
        self.resume = resume
        self.second_executed = second_executed

    def execute(self, sql):
        result = self.connection.execute(sql)
        if "AS first_result" in sql:
            self.executed.set()
            assert self.resume.wait(10), "second call did not finish"
        if "AS second_result" in sql:
            self.second_executed.set()
        return result

    def close(self):
        self.connection.close()


@pytest.mark.parametrize("second_operation", ["query", "dry_run"])
def test_execute_and_fetch_are_isolated(connector, second_operation):
    executed, resume, second_executed = Event(), Event(), Event()
    connector.connection = _InterleavedConnection(
        connector.connection, executed, resume, second_executed
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(connector.query, "SELECT 11 AS first_result")
        try:
            assert executed.wait(10), "first query did not execute"
            second = pool.submit(
                getattr(connector, second_operation), "SELECT 22 AS second_result"
            )
            # On the broken shared connection this lets the second operation
            # replace the first result. With serialization it waits for resume.
            second_executed.wait(1)
        finally:
            resume.set()
        assert first.result().to_pylist() == [{"first_result": 11}]
        if second_operation == "query":
            assert second.result().to_pylist() == [{"second_result": 22}]
        else:
            assert second.result() is None


def test_parallel_queries_share_memory_tables_and_views(connector):
    connector.connection.execute("CREATE TABLE numbers AS SELECT 7 AS value")
    connector.connection.execute(
        "CREATE TEMP TABLE temp_numbers AS SELECT * FROM numbers"
    )
    connector.connection.execute(
        "CREATE TEMP VIEW number_view AS SELECT * FROM temp_numbers"
    )
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [
            pool.submit(
                connector.query,
                f"SELECT {i} AS query_id, value FROM number_view",
            )
            for i in range(16)
        ]
        for i, future in enumerate(futures):
            assert future.result().to_pylist() == [{"query_id": i, "value": 7}]


def test_queries_preserve_attached_tables_and_settings(connector, tmp_path):
    db_path = tmp_path / "sample.duckdb"
    with duckdb.connect(str(db_path)) as source:
        source.execute("CREATE TABLE numbers AS SELECT 42 AS value")
    connector._attach_database(
        LocalFileConnectionInfo(url=str(tmp_path), format="duckdb")
    )
    connector.connection.execute("SET TimeZone='Asia/Tokyo'")
    assert connector.query(
        "SELECT value, current_setting('TimeZone') AS timezone FROM sample.numbers"
    ).to_pylist() == [{"value": 42, "timezone": "Asia/Tokyo"}]
    connector.dry_run("SELECT * FROM sample.numbers")
    with pytest.raises(duckdb.Error):
        connector.query("SELECT * FROM missing_table")
    with pytest.raises(duckdb.Error):
        connector.dry_run("SELECT * FROM missing_table")
    assert connector.query("SELECT 1 AS value").to_pylist() == [{"value": 1}]
    connector.close()
    with pytest.raises(duckdb.Error):
        connector.query("SELECT 1")


def test_close_waits_for_query_to_fetch(connector):
    executed, resume, close_started, close_finished = Event(), Event(), Event(), Event()
    connector.connection = _InterleavedConnection(
        connector.connection, executed, resume, Event()
    )

    def close():
        close_started.set()
        connector.close()
        close_finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(connector.query, "SELECT 11 AS first_result")
        try:
            assert executed.wait(10), "first query did not execute"
            closing = pool.submit(close)
            assert close_started.wait(10), "close did not start"
            close_finished.wait(1)
        finally:
            resume.set()
        assert first.result().to_pylist() == [{"first_result": 11}]
        closing.result()
    with pytest.raises(duckdb.Error):
        connector.query("SELECT 1")
