"""Native pyathena connector — bypasses the ibis athena backend.

Athena's wire types are Trino-flavoured (varchar, decimal(p,s), array<T>,
row(...), map<K,V>, ...). This module parses those type strings via sqlglot
and materialises cursor results into PyArrow tables directly, so we no longer
depend on ibis-framework[athena].
"""

from __future__ import annotations

import contextlib
import datetime as dtlib
import json
from decimal import Decimal as PyDecimal
from typing import Any

import pyarrow as pa

from wren.connector.base import ConnectorABC
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError

# Athena's DB-API cursor returns Trino-style type names. We delegate the
# lexing to sqlglot so we get nested type support (array<row<a int, b varchar>>,
# decimal(p, s), map<K, V>, etc.) for free.
_TRINO_DATA_TYPE_TO_ARROW: dict = {}


def _init_trino_data_type_map() -> None:
    if _TRINO_DATA_TYPE_TO_ARROW:
        return
    from sqlglot.expressions import DataType  # noqa: PLC0415

    T = DataType.Type
    _TRINO_DATA_TYPE_TO_ARROW.update(
        {
            T.BOOLEAN: pa.bool_(),
            T.TINYINT: pa.int8(),
            T.SMALLINT: pa.int16(),
            T.INT: pa.int32(),
            T.BIGINT: pa.int64(),
            T.FLOAT: pa.float32(),
            T.DOUBLE: pa.float64(),
            T.VARCHAR: pa.string(),
            T.CHAR: pa.string(),
            T.NCHAR: pa.string(),
            T.NVARCHAR: pa.string(),
            T.TEXT: pa.string(),
            T.JSON: pa.string(),
            T.UUID: pa.string(),
            T.IPADDRESS: pa.string(),
            T.HLLSKETCH: pa.string(),  # hyperloglog
            T.GEOMETRY: pa.string(),
            T.VARBINARY: pa.binary(),
            T.BINARY: pa.binary(),
            T.DATE: pa.date32(),
            T.TIME: pa.time64("us"),
            T.TIMETZ: pa.time64("us"),
            T.TIMESTAMP: pa.timestamp("ms"),
            T.TIMESTAMPTZ: pa.timestamp("ms", tz="UTC"),
            T.TIMESTAMPLTZ: pa.timestamp("ms", tz="UTC"),
        }
    )


def _parse_athena_type(type_str: str | None) -> pa.DataType:
    """Parse an Athena/Trino cursor type string into a PyArrow type."""
    if not type_str:
        return pa.string()
    from sqlglot import parse_one  # noqa: PLC0415
    from sqlglot.expressions import DataType  # noqa: PLC0415

    try:
        parsed = parse_one(type_str, into=DataType, dialect="trino")
    except Exception:
        return pa.string()
    if parsed is None:
        return pa.string()
    return _trino_data_type_to_arrow(parsed)


def _trino_data_type_to_arrow(node) -> pa.DataType:
    from sqlglot.expressions import ColumnDef, DataType  # noqa: PLC0415

    _init_trino_data_type_map()
    if not isinstance(node, DataType):
        return pa.string()

    kind = node.this
    T = DataType.Type
    if kind in _TRINO_DATA_TYPE_TO_ARROW:
        return _TRINO_DATA_TYPE_TO_ARROW[kind]

    if kind == T.DECIMAL:
        precision, scale = 38, 9
        params = node.expressions
        if len(params) >= 1:
            with contextlib.suppress(AttributeError, ValueError, TypeError):
                precision = min(int(params[0].this.this), 38)
        if len(params) >= 2:
            with contextlib.suppress(AttributeError, ValueError, TypeError):
                scale = min(int(params[1].this.this), precision)
        return pa.decimal128(precision, scale)

    if kind == T.ARRAY:
        inner = node.expressions[0] if node.expressions else None
        return pa.list_(_trino_data_type_to_arrow(inner) if inner else pa.string())

    if kind == T.MAP:
        if len(node.expressions) >= 2:
            return pa.map_(
                _trino_data_type_to_arrow(node.expressions[0]),
                _trino_data_type_to_arrow(node.expressions[1]),
            )
        return pa.string()

    if kind == T.STRUCT:
        fields: list[pa.Field] = []
        for idx, child in enumerate(node.expressions):
            if isinstance(child, ColumnDef):
                name = child.name or f"f{idx}"
                inner = child.args.get("kind")
                fields.append(
                    pa.field(
                        name,
                        _trino_data_type_to_arrow(inner) if inner else pa.string(),
                    )
                )
            else:
                fields.append(pa.field(f"f{idx}", _trino_data_type_to_arrow(child)))
        return pa.struct(fields)

    return pa.string()


def _build_athena_column(values: list, arrow_type: pa.DataType) -> pa.Array:
    """Coerce pyathena cursor values into a PyArrow array of arrow_type."""
    if pa.types.is_string(arrow_type):
        processed: list[Any] = []
        for v in values:
            if v is None:
                processed.append(None)
            elif isinstance(v, dict | list | tuple):
                processed.append(json.dumps(v, default=str))
            elif isinstance(v, str):
                processed.append(v)
            else:
                processed.append(str(v))
        return pa.array(processed, type=pa.string(), from_pandas=True)

    if pa.types.is_binary(arrow_type):
        processed = [bytes(v) if isinstance(v, memoryview) else v for v in values]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_decimal(arrow_type):
        processed = [
            None
            if v is None
            else (v if isinstance(v, PyDecimal) else PyDecimal(str(v)))
            for v in values
        ]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_timestamp(arrow_type):
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.datetime):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.datetime.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_date(arrow_type):
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.date):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.date.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_time(arrow_type):
        processed = []
        for v in values:
            if v is None or isinstance(v, dtlib.time):
                processed.append(v)
            else:
                try:
                    processed.append(dtlib.time.fromisoformat(str(v)))
                except ValueError:
                    processed.append(None)
        return pa.array(processed, type=arrow_type, from_pandas=True)

    if pa.types.is_map(arrow_type):
        # pyathena returns dicts for map columns; PyArrow's map_ wants iterables
        # of (key, value) pairs.
        processed = [None if v is None else list(v.items()) for v in values]
        return pa.array(processed, type=arrow_type, from_pandas=True)

    return pa.array(values, type=arrow_type, from_pandas=True)


def _build_athena_arrow_table(cursor) -> pa.Table:
    """Materialise a pyathena DB-API cursor into a PyArrow table."""
    if cursor.description is None:
        return pa.table({})

    rows = cursor.fetchall()
    fields = [
        pa.field(col[0], _parse_athena_type(col[1]), nullable=True)
        for col in cursor.description
    ]
    schema = pa.schema(fields)

    if not rows:
        arrays = [pa.array([], type=field.type) for field in schema]
    else:
        arrays = [
            _build_athena_column([row[i] for row in rows], schema.field(i).type)
            for i in range(len(fields))
        ]

    return pa.table(
        dict(zip([f.name for f in fields], arrays, strict=False)),
        schema=schema,
    )


def _build_connect_kwargs(connection_info) -> dict[str, Any]:
    """Translate AthenaConnectionInfo into pyathena.connect() kwargs.

    Resolves credentials in priority order:
      1. Web Identity Token (OIDC) → STS AssumeRoleWithWebIdentity
      2. Explicit aws_access_key_id / aws_secret_access_key (+ optional session token)
      3. Default AWS credential provider chain (env, profile, instance role, …)
    """
    import boto3  # noqa: PLC0415

    kwargs: dict[str, Any] = {
        "s3_staging_dir": connection_info.s3_staging_dir.get_secret_value(),
    }
    if getattr(connection_info, "region_name", None):
        kwargs["region_name"] = connection_info.region_name
    if getattr(connection_info, "schema_name", None):
        kwargs["schema_name"] = connection_info.schema_name

    web_identity_token = getattr(connection_info, "web_identity_token", None)
    role_arn = getattr(connection_info, "role_arn", None)
    access_key = getattr(connection_info, "aws_access_key_id", None)
    secret_key = getattr(connection_info, "aws_secret_access_key", None)

    if web_identity_token and role_arn:
        session_name = (
            getattr(connection_info, "role_session_name", None) or "wren-oidc-session"
        )
        sts = boto3.client(
            "sts", region_name=getattr(connection_info, "region_name", None)
        )
        resp = sts.assume_role_with_web_identity(
            RoleArn=role_arn.get_secret_value(),
            RoleSessionName=session_name,
            WebIdentityToken=web_identity_token.get_secret_value(),
        )
        creds = resp["Credentials"]
        kwargs["aws_access_key_id"] = creds["AccessKeyId"]
        kwargs["aws_secret_access_key"] = creds["SecretAccessKey"]
        kwargs["aws_session_token"] = creds["SessionToken"]
    elif access_key and secret_key:
        kwargs["aws_access_key_id"] = access_key.get_secret_value()
        kwargs["aws_secret_access_key"] = secret_key.get_secret_value()
        session_token = getattr(connection_info, "aws_session_token", None)
        if session_token:
            kwargs["aws_session_token"] = session_token.get_secret_value()
    # else: fall back to the boto3 default credential chain

    user_kwargs = getattr(connection_info, "kwargs", None)
    if user_kwargs:
        kwargs.update(user_kwargs)
    kwargs.setdefault("kill_on_interrupt", True)
    return kwargs


class AthenaConnector(ConnectorABC):
    def __init__(self, connection_info):
        from pyathena import connect  # noqa: PLC0415

        self.connection = connect(**_build_connect_kwargs(connection_info))

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        try:
            with contextlib.closing(self.connection.cursor()) as cursor:
                cursor.execute(sql)
                table = _build_athena_arrow_table(cursor)
            if limit is not None:
                table = table.slice(0, limit)
            return table
        except (WrenError, TimeoutError):
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: sql},
            ) from e

    def dry_run(self, sql: str) -> None:
        try:
            with contextlib.closing(self.connection.cursor()) as cursor:
                cursor.execute(f"EXPLAIN {sql}")
        except (WrenError, TimeoutError):
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: sql},
            ) from e

    def close(self) -> None:
        if self.connection is None:
            return
        try:
            self.connection.close()
        except Exception:
            pass
        finally:
            self.connection = None


def create_connector(connection_info) -> AthenaConnector:
    return AthenaConnector(connection_info)
