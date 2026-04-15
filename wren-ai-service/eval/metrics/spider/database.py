import os
import re
import sqlite3
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

SQLITE_SUFFIX = ".sqlite"
POSTGRES_SCHEMES = {"postgres", "postgresql"}
DOUBLE_QUOTED_IDENTIFIER_RE = re.compile(r'"((?:[^"]|"")*)"')


def is_postgres_target(target: str) -> bool:
    return urlparse(target).scheme in POSTGRES_SCHEMES


def build_benchmark_db_target(db_dir: str, db_name: str) -> str:
    if is_postgres_target(db_dir):
        if "{" in db_dir:
            return db_dir.format(db_name=db_name, catalog=db_name)
        return db_dir

    return os.path.join(db_dir, db_name, f"{db_name}{SQLITE_SUFFIX}")


def resolve_execution_targets(target: str) -> list[str]:
    if is_postgres_target(target):
        return [target]

    db_dir = os.path.dirname(target)
    if not os.path.isdir(db_dir):
        return [target]

    sqlite_targets = sorted(
        os.path.join(db_dir, basename)
        for basename in os.listdir(db_dir)
        if basename.endswith(SQLITE_SUFFIX)
    )
    return sqlite_targets or [target]


def _split_postgres_target(target: str) -> tuple[str, str]:
    parsed = urlparse(target)
    query_items = parse_qsl(parsed.query, keep_blank_values=True)
    schema = "public"
    retained_query_items = []

    for key, value in query_items:
        if key == "schema" and value:
            schema = value
            continue
        retained_query_items.append((key, value))

    normalized_target = urlunparse(
        parsed._replace(query=urlencode(retained_query_items))
    )
    return normalized_target, schema


def normalize_postgres_query_for_execution(query: str) -> str:
    normalized: list[str] = []
    index = 0
    in_single_quoted_literal = False

    while index < len(query):
        char = query[index]

        if char == "'":
            normalized.append(char)
            if in_single_quoted_literal and index + 1 < len(query) and query[index + 1] == "'":
                normalized.append(query[index + 1])
                index += 2
                continue

            in_single_quoted_literal = not in_single_quoted_literal
            index += 1
            continue

        if char == '"' and not in_single_quoted_literal:
            match = DOUBLE_QUOTED_IDENTIFIER_RE.match(query, index)
            if match is not None:
                normalized.append(f'"{match.group(1).lower()}"')
                index = match.end()
                continue

        normalized.append(char)
        index += 1

    return "".join(normalized)


def _connect_postgres(target: str):
    try:
        import psycopg2 as postgres_driver
    except ModuleNotFoundError:
        try:
            import psycopg as postgres_driver
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "psycopg2 or psycopg is required for PostgreSQL-backed Spider benchmark adapters"
            ) from exc

    return postgres_driver.connect(target)


def get_cursor_from_target(target: str):
    if is_postgres_target(target):
        normalized_target, _ = _split_postgres_target(target)
        connection = _connect_postgres(normalized_target)
        return connection, connection.cursor()

    if not os.path.exists(target):
        print("Openning a new connection %s" % target)

    connection = sqlite3.connect(target)
    connection.text_factory = lambda b: b.decode(errors="ignore")
    return connection, connection.cursor()


def get_schema(target: str) -> dict[str, list[str]]:
    if is_postgres_target(target):
        normalized_target, schema_name = _split_postgres_target(target)
        connection = _connect_postgres(normalized_target)
        cursor = connection.cursor()
        try:
            cursor.execute(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = %s
                ORDER BY table_name, ordinal_position
                """,
                (schema_name,),
            )

            schema = defaultdict(list)
            for table_name, column_name in cursor.fetchall():
                schema[str(table_name).lower()].append(str(column_name).lower())

            return dict(schema)
        finally:
            cursor.close()
            connection.close()

    schema = {}
    connection = sqlite3.connect(target)
    cursor = connection.cursor()

    try:
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [str(table[0].lower()) for table in cursor.fetchall()]

        for table in tables:
            cursor.execute("PRAGMA table_info({})".format(table))
            schema[table] = [str(col[1].lower()) for col in cursor.fetchall()]

        return schema
    finally:
        cursor.close()
        connection.close()


def close_cursor(cursor: Any):
    cursor.close()
    cursor.connection.close()
