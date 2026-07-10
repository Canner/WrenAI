import os
import re

import opendal
import pyarrow as pa
from loguru import logger

from wren.connector.base import ConnectorABC
from wren.model import (
    GcsFileConnectionInfo,
    MinioFileConnectionInfo,
    S3FileConnectionInfo,
)
from wren.model.error import ErrorCode, WrenError

_TRAILING_SEMICOLONS_RE = re.compile(r"[;\s]+\Z")


def _strip_trailing_semicolon(sql: str) -> str:
    """Strip the terminating run of ``;`` characters and surrounding whitespace.

    Matches the canner/clickhouse/trino helpers of the same name. Wrapping
    user SQL as ``SELECT * FROM ({sql}) AS _q LIMIT N`` breaks when ``sql``
    ends in a semicolon — ``SELECT 1;`` is invalid inside a subquery. Only the
    terminating run is removed so semicolons inside string literals
    (e.g. ``SELECT ';' AS x``) are preserved.
    """
    return _TRAILING_SEMICOLONS_RE.sub("", sql)


def _escape_sql(value: str) -> str:
    return value.replace("'", "''")


def _init_duckdb_s3(connection, info: S3FileConnectionInfo):
    connection.execute(f"""
    CREATE SECRET wren_s3 (
        TYPE S3,
        KEY_ID '{_escape_sql(info.access_key.get_secret_value())}',
        SECRET '{_escape_sql(info.secret_key.get_secret_value())}',
        REGION '{_escape_sql(info.region)}'
    )""")


def _init_duckdb_minio(connection, info: MinioFileConnectionInfo):
    connection.execute(f"""
    CREATE SECRET wren_minio (
        TYPE S3,
        KEY_ID '{_escape_sql(info.access_key.get_secret_value())}',
        SECRET '{_escape_sql(info.secret_key.get_secret_value())}',
        REGION 'ap-northeast-1'
    )""")
    connection.execute("SET s3_endpoint=?", [info.endpoint])
    connection.execute("SET s3_url_style='path'")
    connection.execute("SET s3_use_ssl=?", [info.ssl_enabled])


def _init_duckdb_gcs(connection, info: GcsFileConnectionInfo):
    connection.execute(f"""
    CREATE SECRET wren_gcs (
        TYPE GCS,
        KEY_ID '{_escape_sql(info.key_id.get_secret_value())}',
        SECRET '{_escape_sql(info.secret_key.get_secret_value())}'
    )""")


class DuckDBConnector(ConnectorABC):
    def __init__(self, connection_info):
        import duckdb  # noqa: PLC0415
        from duckdb import HTTPException, IOException  # noqa: PLC0415

        self._HTTPException = HTTPException
        self._IOException = IOException
        self.connection = duckdb.connect()

        try:
            if isinstance(connection_info, S3FileConnectionInfo):
                _init_duckdb_s3(self.connection, connection_info)
            if isinstance(connection_info, MinioFileConnectionInfo):
                _init_duckdb_minio(self.connection, connection_info)
            if isinstance(connection_info, GcsFileConnectionInfo):
                _init_duckdb_gcs(self.connection, connection_info)

            if connection_info.format == "duckdb":
                self._attach_database(connection_info)
        except Exception:
            self.connection.close()
            raise

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        """Execute ``sql`` and return the result as an Arrow table.

        When ``limit`` is provided the query is wrapped in a ``LIMIT`` clause
        so only that many rows are fetched.
        """
        if limit is not None:
            # Strip the terminating run of ``;`` / whitespace before wrapping so
            # the subquery stays valid SQL (e.g. ``SELECT 1;`` must not become
            # ``SELECT * FROM (SELECT 1;) AS _q LIMIT ...``). Semicolons inside
            # string literals are preserved.
            stripped = _strip_trailing_semicolon(sql)
            sql = f"SELECT * FROM ({stripped}) AS _q LIMIT {int(limit)}"
        return self.connection.execute(sql).fetch_arrow_table()

    def dry_run(self, sql: str) -> None:
        """Validate ``sql`` without returning rows or side effects.

        ``duckdb.execute`` runs semicolon-separated batches, so an ``EXPLAIN``
        prefix on raw input would still execute any trailing statements. Rather
        than reject multi-statement input outright (which false-positives on
        semicolons inside string literals), we neutralize it the same way the
        other connectors do: wrap in a ``LIMIT 0`` subquery. Any trailing
        statement then becomes a natural syntax error inside the subquery, and
        no rows are materialized.
        """
        stripped = _strip_trailing_semicolon(sql)
        self.connection.execute(f"SELECT * FROM ({stripped}) AS _q LIMIT 0")

    def _attach_database(self, connection_info) -> None:
        """Attach every discovered DuckDB file as a read-only database.

        Each file is attached under an alias derived from its base name.
        Raises ``WrenError`` if no files are found or an attach fails.
        """
        db_files = self._list_duckdb_files(connection_info)
        if not db_files:
            raise WrenError(ErrorCode.DUCKDB_FILE_NOT_FOUND, "No DuckDB files found.")

        # Sort for deterministic alias assignment: OpenDAL listing order is not
        # guaranteed, so without this the bare alias could attach to a different
        # file across runs when case-colliding names are present.
        used_aliases: set[str] = set()
        for file in sorted(db_files):
            try:
                escaped_file = file.replace("'", "''")
                base_alias = os.path.splitext(os.path.basename(file))[0]
                # Case-insensitive discovery can surface files whose names differ
                # only by case (e.g. warehouse.duckdb / warehouse.DUCKDB), which
                # would otherwise derive the same attach alias and collide. Make
                # each alias unique deterministically.
                unique_alias = base_alias
                suffix = 1
                while unique_alias.lower() in used_aliases:
                    unique_alias = f"{base_alias}_{suffix}"
                    suffix += 1
                used_aliases.add(unique_alias.lower())
                alias = unique_alias.replace('"', '""')
                self.connection.execute(
                    f"ATTACH DATABASE '{escaped_file}' AS \"{alias}\" (READ_ONLY);"
                )
            except (self._IOException, self._HTTPException) as e:
                raise WrenError(
                    ErrorCode.ATTACH_DUCKDB_ERROR, f"Failed to attach: {e!s}"
                )

    def _list_duckdb_files(self, connection_info) -> list[str]:
        """List DuckDB database files in the configured directory.

        Walks the connection's root directory and returns the full paths of
        all non-directory entries whose name ends with ``.duckdb``. The
        extension comparison is case-insensitive so files exported or renamed
        with upper/mixed-case extensions (e.g. ``WAREHOUSE.DUCKDB``) are still
        discovered. Raises ``WrenError`` if the directory cannot be listed.
        """
        op = opendal.Operator("fs", root=connection_info.url)
        files = []
        try:
            for file in op.list("/"):
                if file.path != "/":
                    stat = op.stat(file.path)
                    if not stat.mode.is_dir() and file.path.lower().endswith(".duckdb"):
                        files.append(f"{connection_info.url}/{file.path}")
        except Exception as e:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR, f"Failed to list files: {e!s}"
            )
        return files

    def close(self) -> None:
        """Close the underlying DuckDB connection, logging any error."""
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing DuckDB connection: {e}")


def create_connector(connection_info) -> DuckDBConnector:
    return DuckDBConnector(connection_info)
