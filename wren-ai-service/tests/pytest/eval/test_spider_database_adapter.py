import builtins

import pytest

from eval.metrics.spider.database import (
    _connect_postgres,
    build_benchmark_db_target,
    get_schema,
    is_postgres_target,
    normalize_postgres_query_for_execution,
    resolve_execution_targets,
)


def test_build_benchmark_db_target_rejects_file_layout():
    with pytest.raises(ValueError, match="PostgreSQL DSN"):
        build_benchmark_db_target(
            "./tools/dev/etc/spider1.0/database", "concert_singer"
        )


def test_build_benchmark_db_target_supports_postgres_template():
    assert (
        build_benchmark_db_target(
            "postgresql://postgres:postgres@localhost:5432/{db_name}?schema=public",
            "concert_singer",
        )
        == "postgresql://postgres:postgres@localhost:5432/concert_singer?schema=public"
    )


def test_is_postgres_target_detects_postgres_schemes():
    assert is_postgres_target("postgresql://localhost:5432/db")
    assert is_postgres_target("postgres://localhost:5432/db")
    assert not is_postgres_target("/tmp/legacy-benchmark.db")


def test_resolve_execution_targets_rejects_file_target():
    with pytest.raises(ValueError, match="PostgreSQL DSN"):
        resolve_execution_targets("/tmp/legacy-benchmark.db")


def test_resolve_execution_targets_keeps_postgres_target_as_single_entry():
    target = (
        "postgresql://postgres:postgres@localhost:5432/concert_singer?schema=public"
    )
    assert resolve_execution_targets(target) == [target]


def test_get_schema_rejects_file_target():
    with pytest.raises(ValueError, match="PostgreSQL DSN"):
        get_schema("/tmp/concert_singer.db")


def test_get_schema_supports_postgres_target(mocker):
    cursor = mocker.Mock()
    cursor.fetchall.return_value = [
        ("singer", "singer_id"),
        ("singer", "name"),
        ("concert", "concert_id"),
    ]
    connection = mocker.Mock()
    connection.cursor.return_value = cursor
    connect = mocker.patch(
        "eval.metrics.spider.database._connect_postgres",
        return_value=connection,
    )

    target = (
        "postgresql://postgres:postgres@localhost:5432/concert_singer?schema=analytics"
    )
    assert get_schema(target) == {
        "concert": ["concert_id"],
        "singer": ["singer_id", "name"],
    }

    connect.assert_called_once_with(
        "postgresql://postgres:postgres@localhost:5432/concert_singer"
    )
    cursor.execute.assert_called_once()
    assert cursor.execute.call_args.args[1] == ("analytics",)


def test_connect_postgres_falls_back_to_psycopg(monkeypatch, mocker):
    fake_driver = mocker.Mock()
    fake_connection = object()
    fake_driver.connect.return_value = fake_connection

    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "psycopg2":
            raise ModuleNotFoundError("No module named 'psycopg2'")
        if name == "psycopg":
            return fake_driver
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    assert _connect_postgres("postgresql://localhost:5432/test") is fake_connection
    fake_driver.connect.assert_called_once_with("postgresql://localhost:5432/test")


def test_normalize_postgres_query_for_execution_lowercases_quoted_identifiers():
    query = (
        'SELECT COUNT(DISTINCT "Nationality") AS "Nationality_Count" '
        'FROM "people" WHERE note = \'Keep "MixedCase" literal\''
    )

    assert normalize_postgres_query_for_execution(query) == (
        'SELECT COUNT(DISTINCT "nationality") AS "nationality_count" '
        'FROM "people" WHERE note = \'Keep "MixedCase" literal\''
    )
