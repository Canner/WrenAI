import builtins
import sqlite3
from pathlib import Path
from unittest.mock import call

from eval.metrics.spider.database import (
    _connect_postgres,
    build_benchmark_db_target,
    get_schema,
    is_postgres_target,
    normalize_postgres_query_for_execution,
    resolve_execution_targets,
)
from eval.utils import _build_pgloader_destination, load_eval_data_db_to_postgres


def test_build_benchmark_db_target_defaults_to_sqlite_layout():
    assert (
        build_benchmark_db_target(
            "./tools/dev/etc/spider1.0/database", "concert_singer"
        )
        == "./tools/dev/etc/spider1.0/database/concert_singer/concert_singer.sqlite"
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
    assert not is_postgres_target("./tools/dev/etc/spider1.0/database/foo/foo.sqlite")


def test_resolve_execution_targets_returns_sorted_sqlite_siblings(tmp_path: Path):
    db_dir = tmp_path / "concert_singer"
    db_dir.mkdir()
    primary = db_dir / "concert_singer.sqlite"
    sibling = db_dir / "concert_singer_copy.sqlite"
    primary.write_text("")
    sibling.write_text("")

    assert resolve_execution_targets(str(primary)) == [
        str(primary),
        str(sibling),
    ]


def test_resolve_execution_targets_keeps_postgres_target_as_single_entry():
    target = (
        "postgresql://postgres:postgres@localhost:5432/concert_singer?schema=public"
    )
    assert resolve_execution_targets(target) == [target]


def test_get_schema_supports_sqlite_database(tmp_path: Path):
    db_path = tmp_path / "concert_singer.sqlite"
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("CREATE TABLE singer (Singer_ID INTEGER, Name TEXT)")
        connection.commit()
    finally:
        connection.close()

    assert get_schema(str(db_path)) == {
        "singer": ["singer_id", "name"],
    }


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


def test_build_pgloader_destination_falls_back_to_host_gateway_when_no_container_route(
    mocker,
):
    docker_client = mocker.Mock()
    docker_client.containers.list.return_value = []

    target, run_options = _build_pgloader_destination(
        docker_client,
        "postgresql://postgres:postgres@localhost:9432/concert_singer?schema=analytics",
    )

    assert (
        target == "pgsql://postgres:postgres@host.docker.internal:9432/concert_singer"
    )
    assert run_options == {"extra_hosts": {"host.docker.internal": "host-gateway"}}


def test_load_eval_data_db_to_postgres_defaults_to_eval_settings_postgres_target(
    mocker,
):
    admin_connection = mocker.Mock()
    admin_cursor = mocker.Mock()
    admin_connection.cursor.return_value = admin_cursor
    admin_cursor.fetchone.return_value = [(1,)]

    reset_connection = mocker.Mock()
    reset_cursor = mocker.Mock()
    reset_connection.cursor.return_value = reset_cursor

    finalize_connection = mocker.Mock()
    finalize_cursor = mocker.Mock()
    finalize_connection.cursor.return_value = finalize_cursor

    connect = mocker.patch(
        "eval.utils.psycopg2.connect",
        side_effect=[admin_connection, reset_connection, finalize_connection],
    )

    class FakeSettings:
        default_spider_postgres_benchmark_db_target = (
            "postgresql://postgres:postgres@localhost:9432/default_benchmark"
            "?schema=public"
        )

    mocker.patch("eval.utils.EvalSettings", return_value=FakeSettings())

    docker_client = mocker.Mock()
    docker_client.containers.list.return_value = []
    mocker.patch("eval.utils.docker.from_env", return_value=docker_client)

    load_eval_data_db_to_postgres("concert_singer", "etc/spider1.0/database")

    assert connect.call_args_list == [
        call(
            host="localhost",
            port=9432,
            dbname="postgres",
            user="postgres",
            password="postgres",
        ),
        call(
            host="localhost",
            port=9432,
            dbname="default_benchmark",
            user="postgres",
            password="postgres",
        ),
        call(
            host="localhost",
            port=9432,
            dbname="default_benchmark",
            user="postgres",
            password="postgres",
        ),
    ]
    docker_client.containers.run.assert_called_once()
    assert docker_client.containers.run.call_args.kwargs["extra_hosts"] == {
        "host.docker.internal": "host-gateway"
    }
    assert (
        "pgsql://postgres:postgres@host.docker.internal:9432/default_benchmark"
        in docker_client.containers.run.call_args.kwargs["command"]
    )


def test_load_eval_data_db_to_postgres_targets_resolved_postgres_database_and_network(
    mocker,
):
    admin_connection = mocker.Mock()
    admin_cursor = mocker.Mock()
    admin_connection.cursor.return_value = admin_cursor
    admin_cursor.fetchone.return_value = None

    reset_connection = mocker.Mock()
    reset_cursor = mocker.Mock()
    reset_connection.cursor.return_value = reset_cursor

    finalize_connection = mocker.Mock()
    finalize_cursor = mocker.Mock()
    finalize_connection.cursor.return_value = finalize_cursor
    finalize_cursor.fetchall.return_value = [("people",)]

    connect = mocker.patch(
        "eval.utils.psycopg2.connect",
        side_effect=[admin_connection, reset_connection, finalize_connection],
    )

    docker_client = mocker.Mock()
    mocker.patch("eval.utils.docker.from_env", return_value=docker_client)
    postgres_container = mocker.Mock()
    postgres_container.name = "wrenai-local-postgres-1"
    postgres_container.attrs = {
        "NetworkSettings": {
            "Ports": {"5432/tcp": [{"HostPort": "9432"}]},
            "Networks": {
                "wrenai-local_wren": {
                    "Aliases": [
                        "wrenai-local-postgres-1",
                        "postgres",
                        "123456789abc",
                    ]
                }
            },
        }
    }
    docker_client.containers.list.return_value = [postgres_container]

    load_eval_data_db_to_postgres(
        "concert_singer",
        "etc/spider1.0/database",
        "postgresql://postgres:postgres@localhost:9432/{db_name}?schema=analytics",
    )

    assert connect.call_args_list == [
        call(
            host="localhost",
            port=9432,
            dbname="postgres",
            user="postgres",
            password="postgres",
        ),
        call(
            host="localhost",
            port=9432,
            dbname="concert_singer",
            user="postgres",
            password="postgres",
        ),
        call(
            host="localhost",
            port=9432,
            dbname="concert_singer",
            user="postgres",
            password="postgres",
        ),
    ]
    admin_cursor.execute.assert_has_calls(
        [
            call("SELECT 1 FROM pg_database WHERE datname = %s", ("concert_singer",)),
            call('CREATE DATABASE "concert_singer"'),
        ]
    )
    reset_cursor.execute.assert_has_calls(
        [
            call('DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";'),
            call(
                'DROP SCHEMA IF EXISTS "analytics" CASCADE; CREATE SCHEMA "analytics";'
            ),
        ]
    )
    docker_client.containers.run.assert_called_once()
    command = docker_client.containers.run.call_args.kwargs["command"]
    assert '--with "quote identifiers"' not in command
    assert "sqlite:///data/concert_singer/concert_singer.sqlite" in command
    assert "pgsql://postgres:postgres@postgres:5432/concert_singer" in command
    assert "schema=" not in command
    assert (
        docker_client.containers.run.call_args.kwargs["network"] == "wrenai-local_wren"
    )
    finalize_cursor.execute.assert_has_calls(
        [
            call(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
            ),
            call('ALTER TABLE "public"."people" SET SCHEMA "analytics";'),
            call(
                'ALTER DATABASE "concert_singer" SET search_path TO "analytics", "public";'
            ),
        ]
    )
