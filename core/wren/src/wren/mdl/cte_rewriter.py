"""CTE-based SQL rewriter.

Parses user SQL with sqlglot, uses ``qualify_columns`` to fully resolve
all column references, then calls wren-core ``transform_sql`` once per model
with a simple ``SELECT col1, col2 FROM model`` and injects each expanded
result as a CTE into the original query.

A referenced view is handled differently: its ``statement`` is native SQL
that references models, so it is injected as a CTE **verbatim** (never sent
to wren-core), and the models it references are emitted as model CTEs before
it. This keeps the view as the executable SQL it was authored as.
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
from wren.policy import resolve_model_name

_SQLGLOT_DIALECT_MAP: dict[DataSource, str] = {
    DataSource.canner: "trino",
    DataSource.datafusion: "wren",
    DataSource.mssql: "tsql",
    DataSource.local_file: "duckdb",
    DataSource.s3_file: "duckdb",
    DataSource.minio_file: "duckdb",
    DataSource.gcs_file: "duckdb",
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
        self.data_source = data_source
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
            # ``qualify_columns`` runs against the post-``normalize_identifiers``
            # AST, so the schema must be keyed under the same normalized form
            # of the model name. BigQuery / DuckDB lowercase, Oracle uppercases —
            # registering the literal manifest name leaves a mismatch and the
            # column qualification silently produces an empty CTE body.
            schema_name = normalize_identifiers(
                exp.to_identifier(name, quoted=True), dialect=self.dialect
            ).name
            self.schema.add_table(schema_name, cols, dialect=self.dialect)
            self._col_orig_name[name] = orig

        # A view's ``statement`` is native-dialect SQL that references models.
        # It is NOT expanded by wren-core — it becomes a CTE kept verbatim,
        # preceded by model CTEs for the models it references. view_dict maps
        # name → the view object so the statement can be emitted as-is.
        self.view_dict: dict[str, dict] = {
            view["name"]: view for view in self.manifest.get("views", [])
        }
        self.view_names: set[str] = set(self.view_dict)

    def rewrite(self, sql: str) -> str:
        """Rewrite *sql* by injecting model and view CTEs.

        Models are expanded by wren-core. A referenced view is emitted as a
        CTE holding its native-SQL ``statement`` verbatim; the models that
        statement references are expanded as model CTEs placed before it.

        Returns the transformed SQL string in the target sqlglot dialect.
        If no model or view references are found, falls back to
        ``session_context.transform_sql(sql)`` directly (when ``fallback``
        is ``True``); otherwise raises ``ValueError``.
        """
        ast = parse_one(sql, dialect=self.dialect)

        user_cte_names = self._collect_user_cte_names(ast)
        used_columns, user_table_refs = self._collect_model_columns(ast, user_cte_names)
        view_refs = self._collect_view_refs(ast, user_cte_names)

        # A view's native-SQL statement references models; collect those so
        # they get model CTEs placed before the (verbatim) view CTEs.
        self._collect_view_model_usage(view_refs, used_columns, user_table_refs)

        # No model or view references detected — either fall back to the
        # legacy whole-query transform, or raise so tests can catch the miss.
        if not used_columns and not view_refs:
            if self.fallback:
                wren_sql = self.session_context.transform_sql(sql)
                return sqlglot.transpile(wren_sql, read="wren", write=self.dialect)[0]
            raise ValueError(f"No model or view references found in SQL: {sql}")

        model_ctes = self._build_model_ctes(used_columns, user_table_refs)
        view_ctes = self._build_view_ctes(view_refs)
        self._inject_ctes(ast, model_ctes + view_ctes)
        # Oracle uppercases unquoted identifiers. Without forcing quoting
        # on output, the user's ``SELECT o_orderkey FROM orders`` would
        # land as ``SELECT O_ORDERKEY FROM ORDERS`` — both the table
        # reference and the result column name. The injected CTE projects
        # quoted lowercase columns, so the lookup misses (ORA-00904), and
        # any caller asserting on result-column casing breaks. Forcing
        # quoting on Oracle makes the dialect's output deterministic and
        # matches the pre-fallback path where wren-core's whole-query
        # transform had quoted everything implicitly.
        identify = self.data_source == DataSource.oracle
        return ast.sql(dialect=self.dialect, identify=identify)

    # ------------------------------------------------------------------
    # Column collection via qualify
    # ------------------------------------------------------------------

    def _collect_model_columns(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> tuple[dict[str, list[str] | None], dict[str, tuple[str, bool]]]:
        """Return ``(used_columns, user_table_refs)`` for all referenced models.

        ``used_columns``: ``{model_name: [col1, col2, ...]}``. A value of
        ``None`` means the model was referenced via ``SELECT *`` and should
        be passed as-is to ``transform_sql`` so wren-core applies CLAC.

        ``user_table_refs``: ``{model_name: (user_name, user_quoted)}``
        capturing the literal identifier the user wrote (case + quoting)
        for the first occurrence of each model. The CTE alias matches that
        so dialects with case-folding (Oracle uppercases unquoted ⇒ the
        emitted CTE must fold to the same form) bind the user's outer
        reference to the injected CTE.

        Uses sqlglot's ``qualify_columns`` to fully resolve all column
        references (including ``SELECT *`` expansion and correlated
        subquery outer references), then walks the qualified AST to collect
        model→column mappings. Column order follows the manifest definition
        (via insertion order) so ``SELECT *`` preserves schema order.
        """
        copy = ast.copy()
        copy = qualify_tables(copy, dialect=self.dialect)

        # Resolve every table ref to its canonical (manifest-case) model name
        # BEFORE normalize_identifiers strips case from quoted identifiers.
        # Dialects with NORMALIZATION_STRATEGY = CASE_INSENSITIVE (BigQuery,
        # DuckDB) lowercase even backtick-quoted names, but BigQuery table
        # identifiers are case-sensitive at the storage layer — capturing the
        # alias-to-model map pre-normalize keeps the right model bound.
        alias_to_model, user_table_refs = self._build_alias_map(copy, user_cte_names)

        # Detect models referenced via SELECT * BEFORE qualify_columns
        # expands the star.  These will use SELECT * in transform_sql so
        # that wren-core controls column visibility (CLAC).
        star_models = self._detect_star_models(copy, alias_to_model)

        copy = normalize_identifiers(copy, dialect=self.dialect)
        qualified = qualify_columns(
            copy,
            schema=self.schema,
            dialect=self.dialect,
            allow_partial_qualification=True,
        )

        # Ensure every referenced model appears in the result, even if no
        # specific columns are referenced (e.g. SELECT COUNT(*) FROM model).
        # Use dict as ordered set to preserve insertion order and deduplicate.
        used: dict[str, dict[str, None]] = {m: {} for m in alias_to_model.values()}
        # Lowercase index for column.table lookups — column qualifier may have
        # been normalized (lowercased) by qualify_columns even though we built
        # the alias map from the pre-normalize AST.
        alias_lookup = {k.lower(): v for k, v in alias_to_model.items()}
        for col in qualified.find_all(exp.Column):
            table_ref = col.table
            if not table_ref:
                continue
            model_name = alias_lookup.get(table_ref.lower())
            if model_name:
                used[model_name][col.name] = None

        return (
            {m: None if m in star_models else list(cols) for m, cols in used.items()},
            user_table_refs,
        )

    def _build_alias_map(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> tuple[dict[str, str], dict[str, tuple[str, bool]]]:
        """Map each table reference in *ast* to its canonical model name.

        Returns ``(alias_to_model, user_table_refs)`` — the second dict
        records the first user-written ``(name, quoted)`` per model so the
        CTE alias can be emitted with the same quoting style the user
        wrote, which is required for dialects with case-folding.

        Honours SQL identifier rules: quoted ⇒ case-sensitive, unquoted ⇒
        exact match preferred, then case-insensitive fallback. Skips tables
        that resolve to a user-defined CTE rather than an MDL model.
        """
        alias_to_model: dict[str, str] = {}
        user_table_refs: dict[str, tuple[str, bool]] = {}
        for table in ast.find_all(exp.Table):
            name = table.name
            if not name or name.lower() in user_cte_names:
                continue
            quoted = (
                bool(table.this.quoted)
                if isinstance(table.this, exp.Identifier)
                else False
            )
            model_name = resolve_model_name(name, quoted, self.model_dict)
            if model_name is None:
                continue
            alias = table.alias
            if alias:
                alias_to_model[alias] = model_name
            alias_to_model[name] = model_name
            user_table_refs.setdefault(model_name, (name, quoted))
        return alias_to_model, user_table_refs

    def _collect_view_refs(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> dict[str, tuple[str, bool]]:
        """Map each referenced MDL view to the user-written ``(name, quoted)``.

        Resolves table references against view names with the same
        quoted/unquoted rules as models. The recorded identifier is used as
        the injected CTE alias so dialects with case-folding bind the user's
        ``FROM <view>`` to the CTE. Unlike ``_build_alias_map`` it does not
        track SQL aliases, since a view is always expanded whole.
        """
        view_refs: dict[str, tuple[str, bool]] = {}
        qualified = qualify_tables(ast.copy(), dialect=self.dialect)
        for table in qualified.find_all(exp.Table):
            name = table.name
            if not name or name.lower() in user_cte_names:
                continue
            quoted = (
                bool(table.this.quoted)
                if isinstance(table.this, exp.Identifier)
                else False
            )
            view_name = resolve_model_name(name, quoted, self.view_names)
            if view_name is None:
                continue
            # A name defined as both a model and a view (malformed MDL) would
            # otherwise emit two CTEs with the same name — invalid SQL. The
            # model CTE wins; skip the view so output stays valid.
            if resolve_model_name(name, quoted, self.model_dict) is not None:
                continue
            view_refs.setdefault(view_name, (name, quoted))
        return view_refs

    # ------------------------------------------------------------------
    # CTE generation
    # ------------------------------------------------------------------

    def _build_model_ctes(
        self,
        used_columns: dict[str, list[str] | None],
        user_table_refs: dict[str, tuple[str, bool]],
    ) -> list[exp.CTE]:
        """Generate one CTE per model via wren-core transform_sql."""
        ctes: list[exp.CTE] = []
        for model_name, columns in used_columns.items():
            if columns is None:
                # SELECT * — let wren-core handle column visibility (CLAC)
                model_sql = f'SELECT * FROM "{model_name}"'
            elif columns:
                # ``_col_orig_name`` is keyed by lowercase column names; the
                # column refs come from the post-normalize AST whose case
                # depends on the dialect (Oracle uppercases unquoted idents,
                # Postgres lowercases them). Lower-case before lookup so the
                # original manifest casing is restored either way.
                orig = self._col_orig_name.get(model_name, {})
                resolved = [orig.get(c.lower(), c) for c in columns]
                col_list = ", ".join(f'"{model_name}"."{c}"' for c in resolved)
                model_sql = f'SELECT {col_list} FROM "{model_name}"'
            else:
                # No specific columns referenced (e.g. COUNT(*)) — only need rows
                model_sql = f'SELECT 1 FROM "{model_name}"'
            expanded = self.session_context.transform_sql(model_sql)

            expanded_ast = parse_one(expanded, dialect="wren")
            # wren-core emits ``SELECT "<m>".col FROM (...) AS "<m>"`` using
            # the model name as the outermost subquery alias. Wrapping that
            # in ``WITH "<m>" AS (...)`` makes ``"<m>".col`` ambiguous to
            # BigQuery — it treats the qualifier as a recursive reference to
            # the CTE itself and rejects the query with "Table must be
            # qualified with a dataset". Rename the outermost alias to
            # ``wren_src_<m>`` (no leading underscore — Oracle ORA-00911) so
            # the shadow chain breaks at the top scope.
            self._rename_outer_alias(expanded_ast, model_name)

            # Match the user's literal identifier (case + quoting) for the
            # CTE alias so dialects with case-folding still bind the user's
            # outer ``FROM <model>`` to the CTE. Oracle uppercases unquoted
            # identifiers (so ``FROM orders`` resolves to ``ORDERS``); a
            # quoted CTE ``"orders"`` would never match. Falling back to
            # canonical model_name + quoted=True covers introspection-only
            # callers that build their own used_columns dict without a
            # user_table_refs entry.
            cte_name, cte_quoted = user_table_refs.get(model_name, (model_name, True))
            cte = exp.CTE(
                this=expanded_ast,
                alias=exp.TableAlias(
                    this=exp.to_identifier(cte_name, quoted=cte_quoted)
                ),
            )
            ctes.append(cte)
        return ctes

    def _collect_view_model_usage(
        self,
        view_refs: dict[str, tuple[str, bool]],
        used_columns: dict[str, list[str] | None],
        user_table_refs: dict[str, tuple[str, bool]],
    ) -> None:
        """Merge the models each referenced view's statement uses into
        *used_columns* / *user_table_refs*, so those models get CTEs.

        A view's statement is native SQL referencing models by name. Parsing
        it through the same model-collection path captures which model columns
        it needs. (Views referencing other views are not supported — the
        manifest extractor does not scope nested views in, so they fail
        earlier with a "table not found" planning error.)
        """
        for view_name in view_refs:
            view_ast = parse_one(
                self.view_dict[view_name]["statement"], dialect=self.dialect
            )
            view_cte_names = self._collect_user_cte_names(view_ast)
            v_cols, v_refs = self._collect_model_columns(view_ast, view_cte_names)
            self._merge_used_columns(used_columns, v_cols)
            for model_name, ref in v_refs.items():
                user_table_refs.setdefault(model_name, ref)

    @staticmethod
    def _merge_used_columns(
        base: dict[str, list[str] | None], extra: dict[str, list[str] | None]
    ) -> None:
        """Merge *extra* model→columns into *base* in place.

        ``None`` means ``SELECT *`` and wins over a specific column list;
        otherwise column lists are unioned, preserving order.
        """
        for model, cols in extra.items():
            if model not in base:
                base[model] = cols
            elif base[model] is None or cols is None:
                base[model] = None
            else:
                seen = set(base[model])
                base[model] = base[model] + [c for c in cols if c not in seen]

    def _build_view_ctes(self, view_refs: dict[str, tuple[str, bool]]) -> list[exp.CTE]:
        """Generate one CTE per view, holding the native-SQL statement as-is.

        The statement is parsed/emitted with the target dialect (it is native
        SQL) and references models by name, which resolve to the model CTEs
        injected before it. wren-core is never asked to expand the view.
        """
        ctes: list[exp.CTE] = []
        for view_name, (cte_name, cte_quoted) in view_refs.items():
            body = parse_one(
                self.view_dict[view_name]["statement"], dialect=self.dialect
            )
            cte = exp.CTE(
                this=body,
                alias=exp.TableAlias(
                    this=exp.to_identifier(cte_name, quoted=cte_quoted)
                ),
            )
            ctes.append(cte)
        return ctes

    @staticmethod
    def _rename_outer_alias(ast: exp.Expression, model_name: str) -> None:
        """Rename the outermost FROM-subquery alias matching *model_name*.

        Updates top-scope column refs that use *model_name* as their table
        qualifier. Does not descend into subqueries, so inner aliases are
        left intact.
        """
        if not isinstance(ast, exp.Select):
            return
        from_clause = ast.args.get("from_") or ast.args.get("from")
        if from_clause is None:
            return
        source = from_clause.this
        if isinstance(source, exp.Alias):
            source = source.this
        if not isinstance(source, exp.Subquery) or source.alias != model_name:
            return

        # Avoid a leading underscore — Oracle rejects unquoted identifiers
        # starting with ``_`` (ORA-00911) and downstream transpiles can drop
        # the quoting.
        new_alias = f"wren_src_{model_name}"
        source.set(
            "alias",
            exp.TableAlias(this=exp.to_identifier(new_alias, quoted=True)),
        )

        def rewrite(node: exp.Expression) -> None:
            # Stop at subquery boundaries — inner scopes have their own
            # alias bindings and must keep their existing qualifiers.
            if isinstance(node, (exp.Subquery, exp.CTE)):
                return
            if isinstance(node, exp.Column) and node.table == model_name:
                node.set("table", exp.to_identifier(new_alias, quoted=True))
            for child in node.args.values():
                if isinstance(child, list):
                    for c in child:
                        if isinstance(c, exp.Expression):
                            rewrite(c)
                elif isinstance(child, exp.Expression):
                    rewrite(child)

        # Visit every top-scope clause except FROM (already handled).
        for key in ("expressions", "where", "group", "having", "order", "qualify"):
            value = ast.args.get(key)
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, exp.Expression):
                        rewrite(item)
            elif isinstance(value, exp.Expression):
                rewrite(value)

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
        self, ast: exp.Expression, alias_to_model: dict[str, str]
    ) -> set[str]:
        """Detect models selected via ``*`` before column qualification.

        A bare ``SELECT *`` marks all models; ``SELECT t.*`` marks only
        the referenced model. *alias_to_model* is the case-aware mapping
        produced by ``_build_alias_map``.
        """
        star_models: set[str] = set()
        select = ast.find(exp.Select)
        if not select:
            return star_models

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
