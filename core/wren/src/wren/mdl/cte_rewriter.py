"""CTE-based SQL rewriter.

Parses user SQL with sqlglot, uses ``qualify_columns`` to fully resolve
all column references, then calls wren-core
``transform_sql`` once per model with a simple ``SELECT col1, col2 FROM
model`` and injects each expanded result as a CTE into the original query.
"""

from __future__ import annotations

import base64
import json

import sqlglot
from sqlglot import exp, parse_one
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers
from sqlglot.optimizer.qualify_columns import qualify_columns
from sqlglot.optimizer.qualify_tables import qualify_tables
from sqlglot.schema import MappingSchema

# Ensure the Wren dialect is registered with sqlglot on import.
import wren.mdl.wren_dialect as _wren_dialect  # noqa: F401
from wren.model.data_source import DataSource

_SQLGLOT_DIALECT_MAP: dict[DataSource, str] = {
    DataSource.canner: "trino",
    DataSource.datafusion: "wren",
    DataSource.mssql: "tsql",
    DataSource.local_file: "duckdb",
    DataSource.s3_file: "duckdb",
    DataSource.minio_file: "duckdb",
    DataSource.gcs_file: "duckdb",
    DataSource.ytsaurus: "clickhouse",
}


def get_sqlglot_dialect(data_source: DataSource) -> str:
    """Map a DataSource to a valid sqlglot dialect name."""
    return _SQLGLOT_DIALECT_MAP.get(data_source, data_source.name)


class CTERewriter:
    """Rewrite user SQL by expanding MDL model references into CTEs.

    Parameters
    ----------
    manifest_str:
        Base64-encoded MDL JSON string.
    session_context:
        A ``wren_core.SessionContext`` used to expand per-model SQL.
    data_source:
        The target data source (determines sqlglot dialect).
    fallback:
        When ``True`` (default), if no model references are detected in the
        SQL, fall back to ``session_context.transform_sql()`` directly.
        Set to ``False`` in tests to ensure the CTE path is always exercised
        and silent fallbacks don't mask bugs.
    """

    def __init__(
        self,
        manifest_str: str,
        session_context,
        data_source: DataSource,
        *,
        fallback: bool = True,
    ):
        self.session_context = session_context
        self.fallback = fallback
        self.dialect = get_sqlglot_dialect(data_source)
        self.manifest = json.loads(base64.b64decode(manifest_str))

        self.model_dict: dict[str, dict] = {}
        self.schema = MappingSchema(dialect=self.dialect)
        # normalized column name → original manifest column name, per model
        self._col_orig_name: dict[str, dict[str, str]] = {}

        for model in self.manifest.get("models", []):
            name = model["name"]
            self.model_dict[name] = model
            cols: dict[str, str] = {}
            orig: dict[str, str] = {}
            for col in model.get("columns", []):
                if col.get("isHidden"):
                    continue
                if col.get("relationship"):
                    continue
                col_name = col["name"]
                cols[col_name] = col.get("type", "TEXT")
                orig[col_name.lower()] = col_name
            self.schema.add_table(name, cols, dialect=self.dialect)
            self._col_orig_name[name] = orig

    def rewrite(self, sql: str) -> str:
        """Rewrite *sql* by injecting model CTEs.

        Returns the transformed SQL string in the target sqlglot dialect.
        If no model references are found, falls back to
        ``session_context.transform_sql(sql)`` directly.
        """
        ast = parse_one(sql, dialect=self.dialect)

        user_cte_names = self._collect_user_cte_names(ast)
        used_columns = self._collect_model_columns(ast, user_cte_names)

        # No model references detected — either fall back to the legacy
        # whole-query transform, or raise so tests can catch the miss.
        if not used_columns:
            if self.fallback:
                wren_sql = self.session_context.transform_sql(sql)
                return sqlglot.transpile(wren_sql, read="wren", write=self.dialect)[0]
            raise ValueError(f"No model references found in SQL: {sql}")

        model_ctes = self._build_model_ctes(used_columns)
        self._inject_ctes(ast, model_ctes)
        return ast.sql(dialect=self.dialect)

    # ------------------------------------------------------------------
    # Column collection via qualify
    # ------------------------------------------------------------------

    def _collect_model_columns(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> dict[str, list[str] | None]:
        """Return ``{model_name: [col1, col2, ...]}`` for all referenced models.

        A value of ``None`` means the model was referenced via ``SELECT *``
        and should be passed as-is to ``transform_sql`` so that wren-core
        can apply column-level access control (CLAC).

        Uses sqlglot's ``qualify_columns`` to fully resolve all column
        references (including ``SELECT *`` expansion and
        correlated subquery outer references), then walks the qualified AST
        to collect model→column mappings.  Column order follows the manifest
        definition (via insertion order) so ``SELECT *`` preserves schema order.
        """
        copy = ast.copy()
        copy = qualify_tables(copy, dialect=self.dialect)
        copy = normalize_identifiers(copy, dialect=self.dialect)

        # Detect models referenced via SELECT * BEFORE qualify_columns
        # expands the star.  These will use SELECT * in transform_sql so
        # that wren-core controls column visibility (CLAC).
        star_models = self._detect_star_models(copy, user_cte_names)

        qualified = qualify_columns(
            copy,
            schema=self.schema,
            dialect=self.dialect,
            allow_partial_qualification=True,
        )

        # Build alias → model name mapping from Table nodes
        alias_to_model: dict[str, str] = {}
        for table in qualified.find_all(exp.Table):
            table_name = table.name
            if table_name not in self.model_dict or table_name in user_cte_names:
                continue
            alias = table.alias
            if alias:
                alias_to_model[alias] = table_name
            alias_to_model[table_name] = table_name

        # Ensure every referenced model appears in the result, even if no
        # specific columns are referenced (e.g. SELECT COUNT(*) FROM model).
        # Use dict as ordered set to preserve insertion order and deduplicate.
        used: dict[str, dict[str, None]] = {m: {} for m in alias_to_model.values()}
        for col in qualified.find_all(exp.Column):
            table_ref = col.table
            if not table_ref:
                continue
            model_name = alias_to_model.get(table_ref)
            if model_name:
                used[model_name][col.name] = None

        return {m: None if m in star_models else list(cols) for m, cols in used.items()}

    # ------------------------------------------------------------------
    # CTE generation
    # ------------------------------------------------------------------

    def _build_model_ctes(
        self, used_columns: dict[str, list[str] | None]
    ) -> list[exp.CTE]:
        """Generate one CTE per model via wren-core transform_sql."""
        ctes: list[exp.CTE] = []
        for model_name, columns in used_columns.items():
            if columns is None:
                # SELECT * — let wren-core handle column visibility (CLAC)
                col_list = "*"
            elif columns:
                orig = self._col_orig_name.get(model_name, {})
                resolved = [orig.get(c, c) for c in columns]
                col_list = ", ".join(f'"{model_name}"."{c}"' for c in resolved)
            else:
                # No specific columns referenced (e.g. COUNT(*)) — only need rows
                col_list = "1"
            model_sql = f'SELECT {col_list} FROM "{model_name}"'
            expanded = self.session_context.transform_sql(model_sql)

            expanded_ast = parse_one(expanded, dialect="wren")
            cte = exp.CTE(
                this=expanded_ast,
                alias=exp.TableAlias(this=exp.to_identifier(model_name, quoted=True)),
            )
            ctes.append(cte)
        return ctes

    # ------------------------------------------------------------------
    # CTE injection
    # ------------------------------------------------------------------

    def _inject_ctes(self, ast: exp.Expression, model_ctes: list[exp.CTE]) -> None:
        """Prepend *model_ctes* before any existing user CTEs in *ast*."""
        if not model_ctes:
            return

        existing_with = ast.args.get("with_")

        if existing_with:
            # Prepend model CTEs before user CTEs
            existing_ctes = list(existing_with.expressions)
            all_ctes = model_ctes + existing_ctes
            existing_with.set("expressions", all_ctes)
        else:
            with_clause = exp.With(expressions=model_ctes)
            ast.set("with_", with_clause)

        # Preserve RECURSIVE if the original WITH had it
        final_with = ast.args.get("with_")
        if existing_with and existing_with.args.get("recursive"):
            final_with.set("recursive", True)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _detect_star_models(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> set[str]:
        """Detect models selected via ``*`` before column qualification.

        A bare ``SELECT *`` marks all models; ``SELECT t.*`` marks only
        the referenced model.
        """
        star_models: set[str] = set()
        select = ast.find(exp.Select)
        if not select:
            return star_models

        # Build alias → model mapping from tables in FROM/JOIN
        alias_to_model: dict[str, str] = {}
        for table in ast.find_all(exp.Table):
            name = table.name
            if name not in self.model_dict or name in user_cte_names:
                continue
            alias = table.alias or name
            alias_to_model[alias] = name
            alias_to_model[name] = name

        for sel_expr in select.expressions:
            if isinstance(sel_expr, exp.Star):
                # Bare * → all models
                star_models.update(alias_to_model.values())
            elif isinstance(sel_expr, exp.Column) and isinstance(
                sel_expr.this, exp.Star
            ):
                # table.* → specific model
                table_ref = sel_expr.table
                if table_ref and table_ref in alias_to_model:
                    star_models.add(alias_to_model[table_ref])

        return star_models

    @staticmethod
    def _collect_user_cte_names(ast: exp.Expression) -> set[str]:
        """Collect all CTE names defined in the user's SQL (all scopes)."""
        names: set[str] = set()
        for with_clause in ast.find_all(exp.With):
            for cte in with_clause.expressions:
                alias = cte.args.get("alias")
                if alias:
                    raw = (
                        alias.this.name
                        if isinstance(alias.this, exp.Identifier)
                        else str(alias.this)
                    )
                    names.add(raw.lower())
        return names
