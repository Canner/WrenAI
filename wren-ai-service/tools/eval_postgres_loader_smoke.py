import argparse
import json
import shutil
import sqlite3
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

sys.path.append(str(Path(__file__).resolve().parents[1]))

from eval.metrics.spider.database import build_benchmark_db_target
from eval.utils import load_eval_data_db_to_postgres

try:
    import psycopg2
except ModuleNotFoundError:  # pragma: no cover - exercised only in newer local envs
    import psycopg as psycopg2


TMP_SOURCE_ROOT = Path("tools/dev/etc/tmp-loader-smoke")


def quote_postgres_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a synthetic PostgreSQL benchmark-loader smoke test."
    )
    parser.add_argument(
        "--benchmark-target",
        required=True,
        help=(
            "PostgreSQL benchmark DSN template containing {db_name}; "
            "for example postgresql://postgres:postgres@localhost:9432/"
            "smoke_{db_name}?schema=analytics"
        ),
    )
    parser.add_argument(
        "--db-name",
        default="loader_smoke_case",
        help="Synthetic benchmark catalog name to import (default: loader_smoke_case).",
    )
    parser.add_argument(
        "--keep-artifacts",
        action="store_true",
        help="Keep the temporary SQLite source and PostgreSQL database for inspection.",
    )
    return parser.parse_args()


def parse_postgres_target(target: str) -> dict[str, str | int]:
    parsed = urlparse(target)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError(f"Expected PostgreSQL target, got: {target}")

    query_items = dict(parse_qsl(parsed.query, keep_blank_values=True))
    database = parsed.path.lstrip("/")
    if not database:
        raise ValueError(f"Benchmark target must include a database name: {target}")

    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": parsed.username or "postgres",
        "password": parsed.password or "",
        "database": database,
        "schema": query_items.get("schema", "public"),
    }


def connect_postgres(
    target_info: dict[str, str | int],
    *,
    database: str | None = None,
):
    return psycopg2.connect(
        host=str(target_info["host"]),
        port=int(target_info["port"]),
        dbname=database or str(target_info["database"]),
        user=str(target_info["user"]),
        password=str(target_info["password"]),
    )


def drop_database_if_exists(target_info: dict[str, str | int]) -> None:
    admin_connection = connect_postgres(target_info, database="postgres")
    admin_connection.autocommit = True
    cursor = admin_connection.cursor()
    try:
        cursor.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = %s AND pid <> pg_backend_pid()",
            (target_info["database"],),
        )
        cursor.execute(
            f"DROP DATABASE IF EXISTS "
            f"{quote_postgres_identifier(str(target_info['database']))}"
        )
    finally:
        cursor.close()
        admin_connection.close()


def create_temp_sqlite_source(db_name: str) -> None:
    source_dir = TMP_SOURCE_ROOT / db_name
    sqlite_path = source_dir / f"{db_name}.sqlite"
    shutil.rmtree(TMP_SOURCE_ROOT, ignore_errors=True)
    source_dir.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(sqlite_path)
    try:
        connection.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        connection.executemany(
            "INSERT INTO items (id, name) VALUES (?, ?)",
            [(1, "alpha"), (2, "beta")],
        )
        connection.commit()
    finally:
        connection.close()


def collect_verification(
    target_info: dict[str, str | int],
) -> dict[str, str | int]:
    connection = connect_postgres(target_info)
    cursor = connection.cursor()
    try:
        cursor.execute("SHOW search_path")
        search_path = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM items")
        unqualified_count = cursor.fetchone()[0]

        schema = quote_postgres_identifier(str(target_info["schema"]))
        cursor.execute(f"SELECT COUNT(*) FROM {schema}.items")
        qualified_count = cursor.fetchone()[0]

        return {
            "target_db": str(target_info["database"]),
            "schema": str(target_info["schema"]),
            "search_path": search_path,
            "unqualified_count": unqualified_count,
            "qualified_count": qualified_count,
        }
    finally:
        cursor.close()
        connection.close()


def main() -> None:
    args = parse_args()
    if "{db_name}" not in args.benchmark_target:
        raise ValueError(
            "--benchmark-target must contain {db_name} so the smoke test only "
            "creates and drops an isolated temporary database"
        )

    create_temp_sqlite_source(args.db_name)
    resolved_target = build_benchmark_db_target(args.benchmark_target, args.db_name)
    target_info = parse_postgres_target(resolved_target)
    drop_database_if_exists(target_info)

    try:
        load_eval_data_db_to_postgres(
            args.db_name,
            "etc/tmp-loader-smoke",
            args.benchmark_target,
        )
        summary = collect_verification(target_info)
        print(json.dumps(summary, indent=2, sort_keys=True))
    finally:
        if not args.keep_artifacts:
            drop_database_if_exists(target_info)
            shutil.rmtree(TMP_SOURCE_ROOT, ignore_errors=True)


if __name__ == "__main__":
    main()
