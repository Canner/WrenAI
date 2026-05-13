"""YTsaurus (CHYT) connector.

Talks to a YTsaurus cluster through its CHYT (ClickHouse-over-YT) clique. CHYT
exposes a ClickHouse-compatible HTTP protocol on the YT HTTP proxy, so the
underlying machinery is ibis' ClickHouse backend with YT-flavored auth.

Auth: YT OAuth token. Resolution order:
  1. ``connection_info.token`` (SecretStr) if provided
  2. ``YT_TOKEN`` environment variable

CHYT diverges from a stock ClickHouse server in two ways the IbisConnector
default can't handle:

  * **No CREATE VIEW.** ibis introspects query schemas by creating a temporary
    view, but CHYT is read-only at the SQL layer and rejects DDL with
    ``std::out_of_range``. This connector overrides ``query`` and
    ``dry_run`` to bypass ibis and talk to the underlying ``clickhouse_connect``
    HttpClient directly via ``query_arrow``.
  * **OAuth-only auth.** The token is sent as ``Authorization: OAuth <token>``
    (the ``Bearer`` and ``Basic`` schemes are explicitly rejected by the YT
    proxy). The clique alias is passed via the ``chyt.clique_alias`` URL
    parameter, both wired in :func:`wren.model.data_source.DataSourceExtension.get_ytsaurus_connection`.
"""

from __future__ import annotations

import pyarrow as pa

from wren.connector.base import IbisConnector
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

try:
    import clickhouse_connect

    _ClickHouseDbError = clickhouse_connect.driver.exceptions.DatabaseError
except ImportError:

    class _ClickHouseDbError(Exception):
        """Fallback stand-in when ``clickhouse_connect`` is not installed."""


class YTsaurusConnector(IbisConnector):
    """Connector for YTsaurus clusters via their CHYT (ClickHouse-over-YT) clique."""

    def __init__(self, connection_info):
        """Build the connector with a :class:`YTsaurusConnectionInfo`-shaped payload."""
        super().__init__(DataSource.ytsaurus, connection_info)

    @property
    def _ch_client(self):
        """Underlying clickhouse_connect HttpClient (set up by data_source.py)."""
        return self.connection.con

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        """Execute ``sql`` against CHYT and return the result as a ``pyarrow.Table``.

        ``limit``, if given, is appended as a ``LIMIT`` on a wrapping ``SELECT``.
        Non-timeout backend errors are remapped to ``WrenError(INVALID_SQL)``.
        """
        wrapped = sql
        if limit is not None:
            # ``limit`` is interpolated into the SQL string, so refuse anything
            # that isn't a non-negative integer to make the f-string safe even
            # if a caller bypasses the type hint.
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
                raise ValueError(f"limit must be a non-negative int, got {limit!r}")
            wrapped = f"SELECT * FROM (\n{sql}\n) LIMIT {limit}"
        try:
            # CHYT speaks the ClickHouse Native protocol but rejects
            # ``query_arrow`` (UNKNOWN_FORMAT for Arrow). Fall back to native
            # rows + columns and assemble a pyarrow.Table here.
            result = self._ch_client.query(wrapped)
            columns = list(result.column_names)
            data = list(result.result_columns)
            if len(columns) != len(data):
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    f"CHYT returned mismatched column metadata: "
                    f"{len(columns)} names vs {len(data)} column arrays",
                    phase=ErrorPhase.SQL_EXECUTION,
                    metadata={DIALECT_SQL: sql},
                )
            return pa.table({name: col for name, col in zip(columns, data)})
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" not in str(e):
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_EXECUTION,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise
        except (WrenError, TimeoutError):
            raise

    def dry_run(self, sql: str) -> None:
        """Validate ``sql`` against CHYT via ``EXPLAIN AST`` without materializing rows."""
        # CHYT supports `EXPLAIN AST` for syntax/planning validation without
        # materializing rows. Wrap the user SQL and let CHYT parse it.
        try:
            self._ch_client.query(f"EXPLAIN AST {sql}")
        except _ClickHouseDbError as e:
            if "TIMEOUT_EXCEEDED" not in str(e):
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_DRY_RUN,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise
        except (WrenError, TimeoutError):
            raise


def create_connector(connection_info) -> YTsaurusConnector:
    """Factory hook used by :mod:`wren.connector.factory`."""
    return YTsaurusConnector(connection_info)
