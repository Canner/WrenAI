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
import logging
from typing import Any

import pyarrow as pa
from sqlglot import exp, parse_one

from wren.config import WrenConfig
from wren.connector.factory import get_connector
from wren.mdl import get_manifest_extractor, get_session_context, to_json_base64
from wren.mdl.cte_rewriter import CTERewriter, get_sqlglot_dialect
from wren.model.data_source import DataSource
from wren.model.error import DIALECT_SQL, ErrorCode, ErrorPhase, WrenError
from wren.policy import validate_sql_policy

logger = logging.getLogger(__name__)


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
        dialect_sql = self._apply_physical_overrides(dialect_sql)
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
        dialect_sql = self._apply_physical_overrides(dialect_sql)
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
    # Physical SQL rewriting (currently: YT path substitution)
    # ------------------------------------------------------------------

    def _apply_physical_overrides(self, sql: str) -> str:
        """Apply data-source-specific rewrites to dialect SQL.

        For YTsaurus, the MDL's ``table_reference`` carries a synthetic
        ``schema.table`` name (e.g. ``cdm_clients.tenant_index``) that wren
        emits as an unquoted identifier. CHYT can't resolve those — it needs
        the full YT path in backticks. If a model declares
        ``properties.ytPath``, this rewrites every reference to that model
        into the backticked path form CHYT understands.
        """
        if self.data_source != DataSource.ytsaurus:
            return sql
        path_map = self._yt_path_map()
        if not path_map:
            return sql

        try:
            dialect = get_sqlglot_dialect(self.data_source)
            tree = parse_one(sql, read=dialect)
        except Exception:
            return sql

        def _rewrite(node):
            """Replace a sqlglot ``Table`` node with the model's YT path when one is mapped."""
            if not isinstance(node, exp.Table):
                return node
            db = node.args.get("db")
            name = node.args.get("this")
            db_name = db.name if db is not None else ""
            tbl_name = name.name if name is not None else ""
            if not tbl_name:
                return node
            yt_path = path_map.get(f"{db_name}.{tbl_name}") or path_map.get(tbl_name)
            if not yt_path:
                return node
            # Replace with a single backtick-quoted identifier carrying the
            # YT path. Set quoted=True so sqlglot preserves the backticks
            # when serializing to the ClickHouse dialect.
            replacement = exp.Table(
                this=exp.Identifier(this=yt_path, quoted=True),
                alias=node.args.get("alias"),
            )
            return replacement

        tree = tree.transform(_rewrite)
        return tree.sql(dialect=dialect)

    def _yt_path_map(self) -> dict[str, str]:
        """Build a `schema.table` / `table` → yt_path map from the manifest."""
        cached = getattr(self, "_yt_path_map_cache", None)
        if cached is not None:
            return cached
        try:
            manifest = (
                json.loads(self.manifest_str)
                if self.manifest_str.lstrip().startswith("{")
                else json.loads(base64.b64decode(self.manifest_str))
            )
        except Exception:
            self._yt_path_map_cache = {}
            return self._yt_path_map_cache
        out: dict[str, str] = {}
        # Unqualified `table` keys we've already chosen to remove because two
        # models in different schemas share that bare name — the rewrite must
        # not silently pick one yt_path over the other.
        ambiguous: set[str] = set()
        for m in manifest.get("models", []):
            props = m.get("properties", {}) or {}
            yt_path = props.get("ytPath") or props.get("yt_path")
            if not yt_path:
                continue
            tr = m.get("tableReference") or m.get("table_reference") or {}
            schema = (tr.get("schema") or "").strip()
            table = (tr.get("table") or m.get("name") or "").strip()
            if not table:
                continue
            if schema:
                out[f"{schema}.{table}"] = yt_path
            if table in ambiguous:
                continue
            existing = out.get(table)
            if existing is None:
                out[table] = yt_path
            elif existing != yt_path:
                # Conflict: drop the bare-name mapping so a query referencing
                # just `<table>` falls through to whatever CHYT resolves
                # natively rather than rewriting to the wrong YT path.
                logger.warning(
                    "YT path map collision on unqualified table %r "
                    "(paths %r vs %r) — dropping bare-name rewrite; "
                    "qualify with a schema to disambiguate.",
                    table,
                    existing,
                    yt_path,
                )
                del out[table]
                ambiguous.add(table)
        self._yt_path_map_cache = out
        return out

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

            # Policy validation: check tables and functions before execution.
            if self._config.strict_mode or self._config.denied_functions:
                manifest_json = json.loads(base64.b64decode(self.manifest_str))
                model_names = {m["name"] for m in manifest_json.get("models", [])}
                validate_sql_policy(ast, model_names, self._config)

            tables = [t.name for t in ast.find_all(exp.Table)]
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
