from __future__ import annotations

import datetime as dtlib
import json
import uuid
from contextlib import closing
from decimal import Decimal as PyDecimal

import pyarrow as pa
import sqlglot.expressions as sge
from loguru import logger
from sqlglot import exp, parse_one

from wren.connector.base import ConnectorABC
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError


class MSSqlConnector(ConnectorABC):
    """Native pyodbc-backed MSSQL connector.

    Uses a raw pyodbc cursor for execution, builds Arrow schema from
    ``cursor.description`` plus value sampling, and rewrites pagination via
    sqlglot (tsql dialect) so that ``LIMIT n`` becomes
    ``OFFSET 0 ROWS FETCH NEXT n ROWS ONLY``.
    """

    def __init__(self, connection_info):
        self.data_source = DataSource.mssql
        self.connection = self.data_source.get_connection(connection_info)
        self._closed = False

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        sql = self._flatten_pagination_limit(sql)
        with closing(self.connection.cursor()) as cursor:
            cursor.execute(self._raw_cursor_sql(sql, limit))
            if cursor.description is None:
                return pa.table({})

            rows = cursor.fetchmany(limit) if limit is not None else cursor.fetchall()
            arrow_schema = self._build_mssql_arrow_schema(cursor.description, rows)
            arrays = [
                self._build_mssql_column(
                    [row[index] for row in rows], arrow_schema.field(index).type
                )
                for index in range(len(cursor.description))
            ]
            # ``dict(zip(...))`` collapses duplicate column names — build the
            # table from arrays + schema so projections like ``SELECT a, a``
            # are preserved.
            return pa.Table.from_arrays(arrays, schema=arrow_schema)

    def dry_run(self, sql: str) -> None:
        sql = self._flatten_pagination_limit(sql)
        try:
            with closing(self.connection.cursor()) as cursor:
                cursor.execute(self._raw_cursor_sql(sql, 0))
        except Exception as e:
            error_message = self._describe_sql_for_error_message(sql)
            if error_message != "Unknown reason":
                raise WrenError(
                    error_code=ErrorCode.INVALID_SQL,
                    message=f"The sql dry run failed. {error_message}.",
                    phase=ErrorPhase.SQL_DRY_RUN,
                    metadata={DIALECT_SQL: sql},
                ) from e
            raise

    def close(self) -> None:
        if self._closed or not hasattr(self, "connection") or self.connection is None:
            return
        try:
            self.connection.close()
        except Exception as e:
            logger.warning(f"Error closing MSSQL connection: {e}")
        finally:
            self._closed = True
            self.connection = None

    # ------------------------------------------------------------------
    # SQL rewriting
    # ------------------------------------------------------------------

    @staticmethod
    def _raw_cursor_sql(
        sql: str, limit: int | None, input_dialect: str = "tsql"
    ) -> str:
        """Inject a ``LIMIT n`` into a Select so sqlglot emits the tsql
        ``OFFSET 0 ROWS FETCH NEXT n ROWS ONLY`` clause."""
        if limit is None:
            return sql

        try:
            parsed = parse_one(sql, dialect=input_dialect)
        except Exception:
            return sql

        if isinstance(parsed, exp.Select) and not parsed.args.get("limit"):
            parsed.set("limit", exp.Limit(expression=exp.Literal.number(limit)))
            return parsed.sql(dialect="tsql")

        return sql

    def _flatten_pagination_limit(
        self, sql_query: str, input_dialect: str = "tsql"
    ) -> str:
        """Collapse an outer ``LIMIT`` wrapped around a single subquery into
        the inner Select's ``LIMIT`` — undoes the v4 paginate-wrap pattern."""
        try:
            parsed = parse_one(sql_query, dialect=input_dialect)
            if not isinstance(parsed, exp.Select) or not parsed.args.get("limit"):
                return sql_query

            from_clause = parsed.find(exp.From)
            if not from_clause:
                return sql_query

            subqueries = []
            if isinstance(from_clause.this, exp.Subquery):
                subqueries.append(from_clause.this)
            for join in parsed.args.get("joins") or []:
                if isinstance(join, exp.Join):
                    if isinstance(join.this, exp.Subquery):
                        subqueries.append(join.this)
                    if join.expression and isinstance(join.expression, exp.Subquery):
                        subqueries.append(join.expression)

            if len(subqueries) != 1:
                return sql_query

            inner = subqueries[0].this
            if not isinstance(inner, exp.Select):
                return sql_query

            inner.set("limit", exp.Limit(expression=parsed.args["limit"].expression))
            return inner.sql(dialect="tsql")
        except Exception:
            return sql_query

    def _describe_sql_for_error_message(self, sql: str) -> str:
        """Surface a precise error string by asking SQL Server to describe
        the first result set of the failing query."""
        try:
            tsql = sge.convert(sql).sql("mssql")
            describe_sql = (
                "SELECT error_message FROM "
                f"sys.dm_exec_describe_first_result_set({tsql}, NULL, 0)"
            )
            with closing(self.connection.cursor()) as cur:
                cur.execute(describe_sql)
                rows = cur.fetchall()
                if not rows:
                    return "Unknown reason"
                return rows[0][0]
        except Exception:
            return "Unknown reason"

    # ------------------------------------------------------------------
    # Arrow schema inference + column build
    # ------------------------------------------------------------------

    @staticmethod
    def _build_mssql_arrow_schema(description, rows: list[tuple]) -> pa.Schema:
        fields = []
        for index, column in enumerate(description):
            values = [row[index] for row in rows]
            fields.append(
                pa.field(
                    column[0],
                    MSSqlConnector._mssql_arrow_type(column, values),
                    nullable=True,
                )
            )
        return pa.schema(fields)

    @staticmethod
    def _mssql_arrow_type(column, values: list) -> pa.DataType:
        type_code = column[1] if len(column) > 1 else None
        internal_size = column[3] if len(column) > 3 else None
        precision = column[4] if len(column) > 4 else None
        sample = next((value for value in values if value is not None), None)

        if isinstance(sample, bool) or type_code is bool:
            return pa.bool_()
        if isinstance(sample, bytes | bytearray | memoryview) or type_code in {
            bytes,
            bytearray,
            memoryview,
        }:
            return pa.binary()
        if isinstance(sample, dtlib.datetime) or type_code is dtlib.datetime:
            tz = MSSqlConnector._mssql_timezone_name(sample)
            return pa.timestamp("ns", tz=tz)
        if isinstance(sample, dtlib.date) or type_code is dtlib.date:
            return pa.date32()
        if isinstance(sample, dtlib.time) or type_code is dtlib.time:
            return pa.time64("ns")
        if isinstance(sample, float) or type_code is float:
            return pa.float32() if internal_size == 4 else pa.float64()
        if isinstance(sample, int) or type_code is int:
            return MSSqlConnector._mssql_integer_arrow_type(
                internal_size, precision, values
            )
        if isinstance(sample, PyDecimal) or type_code is PyDecimal:
            return pa.string()
        if isinstance(sample, uuid.UUID) or type_code is uuid.UUID:
            return pa.string()

        return pa.string()

    @staticmethod
    def _mssql_timezone_name(value: dtlib.datetime | None) -> str | None:
        if value is None or value.tzinfo is None:
            return None
        offset = value.utcoffset()
        if offset is None:
            return None
        if offset.total_seconds() == 0:
            return "UTC"
        total_minutes = int(offset.total_seconds() // 60)
        sign = "+" if total_minutes >= 0 else "-"
        hours, minutes = divmod(abs(total_minutes), 60)
        return f"{sign}{hours:02d}:{minutes:02d}"

    @staticmethod
    def _mssql_integer_arrow_type(
        internal_size: int | None, precision: int | None, values: list
    ) -> pa.DataType:
        non_negative = all(value is None or int(value) >= 0 for value in values)

        # SQL Server TINYINT is unconditionally unsigned (0..255), so map by
        # the declared internal_size rather than sampling for sign.
        if internal_size == 1:
            return pa.uint8()
        if internal_size == 2:
            return pa.int16()
        if internal_size == 4:
            return pa.int32()
        if internal_size == 8:
            return pa.int64()

        if precision is not None:
            if precision <= 3 and non_negative:
                return pa.uint8()
            if precision <= 5:
                return pa.int16()
            if precision <= 10:
                return pa.int32()
        return pa.int64()

    @staticmethod
    def _build_mssql_column(values: list, arrow_type: pa.DataType) -> pa.Array:
        if pa.types.is_integer(arrow_type):
            processed = [None if value is None else int(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_floating(arrow_type):
            processed = [None if value is None else float(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_boolean(arrow_type):
            processed = [None if value is None else bool(value) for value in values]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_decimal(arrow_type):
            processed = [
                None
                if value is None
                else value
                if isinstance(value, PyDecimal)
                else PyDecimal(str(value))
                for value in values
            ]
            return pa.array(processed, type=arrow_type, from_pandas=True)

        if pa.types.is_string(arrow_type):
            processed = []
            for value in values:
                if value is None:
                    processed.append(None)
                elif isinstance(value, dict | list):
                    processed.append(json.dumps(value, default=str))
                elif isinstance(value, str):
                    processed.append(value)
                else:
                    processed.append(str(value))
            return pa.array(processed, type=arrow_type, from_pandas=True)

        return pa.array(values, type=arrow_type, from_pandas=True)


def create_connector(connection_info) -> MSSqlConnector:
    return MSSqlConnector(connection_info)
