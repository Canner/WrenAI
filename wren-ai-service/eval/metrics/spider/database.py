import re
from collections import defaultdict
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

POSTGRES_SCHEMES = {"postgres", "postgresql"}
DOUBLE_QUOTED_IDENTIFIER_RE = re.compile(r'"((?:[^"]|"")*)"')


def is_postgres_target(target: str) -> bool:
    return urlparse(target).scheme in POSTGRES_SCHEMES


def _require_postgres_target(target: str, context: str) -> str:
    if not is_postgres_target(target):
        raise ValueError(f"{context} must be a PostgreSQL DSN, got: {target}")
    return target


def build_benchmark_db_target(db_target: str, db_name: str) -> str:
    _require_postgres_target(db_target, "Spider benchmark target")
    if "{" in db_target:
        return db_target.format(db_name=db_name, catalog=db_name)
    return db_target


def resolve_execution_targets(target: str) -> list[str]:
    _require_postgres_target(target, "Spider execution target")
    return [target]


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
    normalized_target, _ = _split_postgres_target(
        _require_postgres_target(target, "Spider cursor target")
    )
    connection = _connect_postgres(normalized_target)
    return connection, connection.cursor()


def get_schema(target: str) -> dict[str, list[str]]:
    normalized_target, schema_name = _split_postgres_target(
        _require_postgres_target(target, "Spider schema target")
    )
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


def close_cursor(cursor: Any):
    cursor.close()
    cursor.connection.close()
