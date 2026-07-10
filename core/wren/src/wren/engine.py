"""WrenEngine — SQL transform + execute against a data source.

Example usage:

    from wren.engine import WrenEngine
    from wren.model.data_source import DataSource

    engine = WrenEngine(
        manifest_str="<base64-encoded MDL JSON>",
        data_source=DataSource.postgres,
        connection_info={"host": "localhost", "port": 5432, ...},
    )

    # Plan only (no DB required)
    planned_sql = engine.dry_plan("SELECT * FROM orders")

    # Execute against the data source
    arrow_table = engine.query("SELECT * FROM orders", limit=100)
"""

from __future__ import annotations

import base64
import json
from typing import Any

import pyarrow as pa
from sqlglot import exp, parse_one

from wren.config import WrenConfig
from wren.connector.factory import get_connector
from wren.mdl import get_manifest_extractor, get_session_context, to_json_base64
from wren.mdl.cte_rewriter import CTERewriter, get_sqlglot_dialect
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError
from wren.policy import resolve_model_name, validate_sql_policy


class WrenEngine:
    """Thin facade over wren-core MDL processing and connector execution.

    Parameters
    ----------
    manifest_str:
        Base64-encoded MDL JSON string (as produced by ``wren_core.to_json_base64``).
    data_source:
        Target data source enum value.
    connection_info:
        Dict of connection parameters OR a typed ConnectionInfo object.
    function_path:
        Optional path to a CSV file of custom function definitions.
        Passed through to wren-core SessionContext.
    """

    def __init__(
        self,
        manifest_str: str,
        data_source: DataSource | str,
        connection_info: dict[str, Any] | object,
        function_path: str | None = None,
        *,
        fallback: bool = True,
        config: WrenConfig | None = None,
    ):
        if isinstance(data_source, str):
            data_source = DataSource(data_source)

        self.manifest_str = manifest_str
        self.data_source = data_source
        self.function_path = function_path
        self._fallback = fallback
        self._config = config or WrenConfig()

        # Build typed ConnectionInfo if a raw dict was given.
        # An empty dict is allowed for transpile-only usage (no DB connection).
        if isinstance(connection_info, dict) and connection_info:
            self.connection_info = data_source.get_connection_info(connection_info)
        else:
            self.connection_info = connection_info

        self._connector = None

    # ------------------------------------------------------------------
    # SQL transformation (no DB access)
    # ------------------------------------------------------------------

    def dry_plan(self, sql: str, properties: dict | None = None) -> str:
        """Plan SQL through MDL and return the expanded SQL in the target dialect.

        Transformation flow::

            User SQL (target dialect, e.g. Postgres)
              → sqlglot parse (target dialect)
              → qualify_tables + normalize_identifiers + qualify_columns
              → identify referenced models and columns
              → per-model: wren-core transform_sql → Wren dialect SQL
              → per-model: sqlglot parse (Wren dialect) → inject as CTE
              → sqlglot generate (target dialect)
              → output SQL with model CTEs in target dialect
        """
        return self._plan(sql, properties)

    # ------------------------------------------------------------------
    # SQL execution
    # ------------------------------------------------------------------

    def query(
        self,
        sql: str,
        limit: int | None = None,
        properties: dict | None = None,
    ) -> pa.Table:
        """Transpile and execute SQL, return results as an Arrow table."""
        dialect_sql = self.dry_plan(sql, properties)
        connector = self._get_connector()
        try:
            return connector.query(dialect_sql, limit)
        except WrenError:
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                str(e),
                phase=ErrorPhase.SQL_EXECUTION,
                metadata={DIALECT_SQL: dialect_sql},
            ) from e

    def dry_run(self, sql: str, properties: dict | None = None) -> None:
        """Transpile and dry-run SQL without returning results."""
        dialect_sql = self.dry_plan(sql, properties)
        connector = self._get_connector()
        try:
            connector.dry_run(dialect_sql)
        except WrenError:
            raise
        except Exception as e:
            raise WrenError(
                ErrorCode.GENERIC_USER_ERROR,
                str(e),
                phase=ErrorPhase.SQL_DRY_RUN,
                metadata={DIALECT_SQL: dialect_sql},
            ) from e

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        if self._connector is not None:
            self._connector.close()
            self._connector = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _plan(self, sql: str, properties: dict | None) -> str:
        processed = None
        if properties:
            processed = frozenset(properties.items())

        try:
            # Extract minimal manifest scoped to tables referenced in the SQL.
            # Use sqlglot (not DataFusion parser) since input is target dialect.
            dialect = get_sqlglot_dialect(self.data_source)
            ast = parse_one(sql, dialect=dialect)

            manifest_json = json.loads(base64.b64decode(self.manifest_str))
            model_names = {m["name"] for m in manifest_json.get("models", [])}
            view_names = {v["name"] for v in manifest_json.get("views", [])}
            # Views are MDL-defined objects too. Strict mode gates access to
            # objects *outside* the manifest, so a view reference is allowed;
            # ``extract_by`` scopes the view (and the models it joins) in.
            queryable_names = model_names | view_names

            # Policy validation: check tables and functions before execution.
            if self._config.strict_mode or self._config.denied_functions:
                validate_sql_policy(ast, queryable_names, self._config)

            # Resolve table refs to canonical manifest names so that
            # ``extract_by`` (case-sensitive in Rust) finds them under SQL's
            # case-sensitivity rules: quoted identifiers match exactly,
            # unquoted fall back to a case-insensitive scan.
            tables: list[str] = []
            for t in ast.find_all(exp.Table):
                if not t.name:
                    continue
                quoted = (
                    bool(t.this.quoted) if isinstance(t.this, exp.Identifier) else False
                )
                resolved = resolve_model_name(t.name, quoted, queryable_names)
                tables.append(resolved if resolved is not None else t.name)

            extractor = get_manifest_extractor(self.manifest_str)
            manifest = extractor.extract_by(tables)
            effective_manifest = to_json_base64(manifest)
        except WrenError:
            raise
        except Exception as e:
            if self._config.strict_mode or self._config.denied_functions:
                raise WrenError(
                    ErrorCode.INVALID_SQL,
                    str(e),
                    phase=ErrorPhase.SQL_PLANNING,
                    metadata={DIALECT_SQL: sql},
                ) from e
            effective_manifest = self.manifest_str

        try:
            session = get_session_context(
                effective_manifest,
                self.function_path,
                processed,
                self.data_source.name,
            )
            rewriter = CTERewriter(
                effective_manifest,
                session,
                self.data_source,
                fallback=self._fallback,
            )
            return rewriter.rewrite(sql)
        except Exception as e:
            raise WrenError(
                ErrorCode.INVALID_SQL,
                str(e),
                phase=ErrorPhase.SQL_PLANNING,
                metadata={DIALECT_SQL: sql},
            ) from e

    def _get_connector(self):
        if self._connector is None:
            self._connector = get_connector(self.data_source, self.connection_info)
        return self._connector
