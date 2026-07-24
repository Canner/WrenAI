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
from sqlglot.dialects.dialect import Dialect, NormalizationStrategy
from sqlglot.optimizer.normalize_identifiers import normalize_identifiers
from sqlglot.optimizer.qualify_columns import qualify_columns
from sqlglot.optimizer.qualify_tables import qualify_tables
from sqlglot.schema import MappingSchema

# Ensure the Wren dialect is registered with sqlglot on import.
import wren.mdl.wren_dialect as _wren_dialect  # noqa: F401
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, ErrorPhase, WrenError
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


# sqlglot dialects whose *physical column names* are case-sensitive — i.e. the
# backing database can hold two columns differing only in case (``Year`` and
# ``year``) and address them via quoting. Only these allow a model to declare
# case-distinct columns; everywhere else such a model is physically
# unrepresentable and is rejected at build time (see ``CTERewriter.__init__``).
#
# This is an explicit allow-list rather than a derivation from sqlglot's
# ``NORMALIZATION_STRATEGY``, because the strategy is about identifier *folding*,
# not column-name uniqueness, and the two disagree: MySQL/Doris report
# CASE_SENSITIVE yet their column names are case-insensitive, and Athena
# (LOWERCASE) lowercases columns in the Glue catalog. Postgres/Oracle/Snowflake
# fold unquoted identifiers but compare the stored (quoted) name
# case-sensitively; ClickHouse is case-sensitive throughout.
_CASE_SENSITIVE_COLUMN_DIALECTS: frozenset[str] = frozenset(
    {"postgres", "oracle", "snowflake", "clickhouse"}
)


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
        Controls SQL that references a table which is not an MDL model or
        view. When ``True`` (default), fall back to
        ``session_context.transform_sql()`` directly. Set to ``False`` in
        tests so such a query raises instead of silently masking a rewriter
        miss. (Pure scalar / TVF SQL with no base-table reference always
        passes through, regardless of this flag.)
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
        # Upper-folding dialects (Oracle, Snowflake, …) uppercase every unquoted
        # identifier, which would change result-set column names (aggregate
        # aliases, cube columns, …). Render those with ``identify=True`` so the
        # output is fully quoted and result casing stays as authored. Detected
        # from the dialect's normalization strategy rather than hard-coded.
        self._force_identify = (
            Dialect.get_or_raise(self.dialect).NORMALIZATION_STRATEGY
            == NormalizationStrategy.UPPERCASE
        )
        self.manifest = json.loads(base64.b64decode(manifest_str))

        # A model may declare case-distinct columns (``Year`` and ``year``) only
        # on dialects whose physical column names are case-sensitive AND only
        # when the manifest actually contains such a collision. We engage the
        # case-sensitive resolution path *only then*, so the well-trodden
        # case-insensitive path (and its result-column casing) is unchanged for
        # every existing manifest. On the case-sensitive path quoted refs match
        # exactly and unquoted refs match exact-then-case-insensitively, erroring
        # only when ambiguous (see ``_resolve_column`` /
        # ``_normalize_model_column_case``).
        has_case_distinct = self._manifest_has_case_distinct_columns()
        if has_case_distinct and self.dialect not in _CASE_SENSITIVE_COLUMN_DIALECTS:
            self._raise_case_collision()
        self._case_sensitive_columns = has_case_distinct

        self.model_dict: dict[str, dict] = {}
        # On the case-sensitive path the qualify schema must NOT fold identifiers
        # (``normalize=False``) so a quoted ``"year"`` matches the stored ``year``
        # and not ``Year``; column keys are kept in manifest case.
        self.schema = MappingSchema(
            dialect=self.dialect, normalize=not self._case_sensitive_columns
        )
        # normalized column name → original manifest column name, per model
        # (only used on the case-insensitive path).
        self._col_orig_name: dict[str, dict[str, str]] = {}
        # manifest-case column names, per model (used on the case-sensitive path
        # for exact-then-CI resolution).
        self._model_cols: dict[str, list[str]] = {}

        for model in self.manifest.get("models", []):
            if not isinstance(model, dict):
                continue
            name = model.get("name")
            if not isinstance(name, str) or not name:
                continue
            self.model_dict[name] = model
            cols: dict[str, str] = {}
            orig: dict[str, str] = {}
            raw_cols = model.get("columns", []) or []
            if not isinstance(raw_cols, list):
                raw_cols = []
            for col in raw_cols:
                if not isinstance(col, dict):
                    continue
                if col.get("isHidden"):
                    continue
                if col.get("relationship"):
                    continue
                col_name = col.get("name")
                if not isinstance(col_name, str) or not col_name:
                    continue
                # Case-only collisions were already vetted by the pre-scan: on
                # case-insensitive-column dialects they raised INVALID_MDL; on
                # case-sensitive-column dialects they are kept distinct here and
                # resolved case-sensitively at query time.
                cols[col_name] = col.get("type", "TEXT")
                orig[col_name.lower()] = col_name
            self._model_cols[name] = list(cols)
            if self._case_sensitive_columns:
                # Keep manifest case as the schema key (``normalize=False``) so
                # quoted refs resolve exactly and case-distinct columns coexist.
                self.schema.add_table(name, cols)
            else:
                # ``qualify_columns`` runs against the post-``normalize_identifiers``
                # AST, so the schema must be keyed under the same normalized form
                # of the model name. BigQuery / DuckDB lowercase, Oracle uppercases
                # — registering the literal manifest name leaves a mismatch and the
                # column qualification silently produces an empty CTE body.
                schema_name = normalize_identifiers(
                    exp.to_identifier(name, quoted=True), dialect=self.dialect
                ).name
                self.schema.add_table(schema_name, cols, dialect=self.dialect)
            self._col_orig_name[name] = orig

        # Flat union of every model's columns, for resolving *unqualified*
        # column references on the case-sensitive path. Computed once here
        # rather than per ``_normalize_model_column_case`` call.
        self._all_model_cols: list[str] = [
            c for cols in self._model_cols.values() for c in cols
        ]

        # A view's ``statement`` is native-dialect SQL that references models.
        # It is NOT expanded by wren-core — it becomes a CTE kept verbatim,
        # preceded by model CTEs for the models it references. view_dict maps
        # name → the view object so the statement can be emitted as-is.
        self.view_dict: dict[str, dict] = {}
        for view in self.manifest.get("views", []) or []:
            if not isinstance(view, dict):
                continue
            vname = view.get("name")
            if isinstance(vname, str) and vname:
                self.view_dict[vname] = view
        self.view_names: set[str] = set(self.view_dict)

    @staticmethod
    def _iter_model_column_names(model: dict):
        """Yield the visible column names of *model* (skips hidden / relationship).

        Mirrors the column filter used when populating the schema so the
        case-collision pre-scan sees exactly the columns that get registered.
        """
        cols = model.get("columns", []) or []
        if not isinstance(cols, list):
            return
        for col in cols:
            if not isinstance(col, dict):
                continue
            if col.get("isHidden") or col.get("relationship"):
                continue
            col_name = col.get("name")
            if isinstance(col_name, str) and col_name:
                yield col_name

    def _manifest_has_case_distinct_columns(self) -> bool:
        """True if any model has two visible columns differing only in case."""
        for model in self.manifest.get("models", []):
            if not isinstance(model, dict):
                continue
            seen: set[str] = set()
            for col_name in self._iter_model_column_names(model):
                low = col_name.lower()
                if low in seen:
                    return True
                seen.add(low)
        return False

    def _raise_case_collision(self) -> None:
        """Raise ``INVALID_MDL`` for the first case-only column collision.

        Used on case-insensitive-column dialects, where Wren resolves column
        names case-insensitively and two columns differing only in case would
        silently collide — and the backing database cannot represent them.
        """
        for model in self.manifest.get("models", []):
            if not isinstance(model, dict):
                continue
            seen: dict[str, str] = {}
            for col_name in self._iter_model_column_names(model):
                low = col_name.lower()
                if low in seen:
                    raise WrenError(
                        error_code=ErrorCode.INVALID_MDL,
                        message=(
                            f"Model '{model['name']}' has columns that differ "
                            f"only in case ('{seen[low]}' and '{col_name}'). Wren "
                            f"resolves column names case-insensitively on "
                            f"{self.dialect} and cannot distinguish them; rename "
                            "one of the columns."
                        ),
                        phase=ErrorPhase.MDL_EXTRACTION,
                    )
                seen[low] = col_name

    def rewrite(self, sql: str) -> str:
        """Rewrite *sql* by injecting model and view CTEs.

        Models are expanded by wren-core. A referenced view is emitted as a
        CTE holding its native-SQL ``statement`` verbatim; the models that
        statement references are expanded as model CTEs placed before it.

        Returns the transformed SQL string in the target sqlglot dialect.
        Pure scalar / TVF SQL (no model, view, or base-table reference, e.g.
        ``SELECT 1``) is passed through transpiled to that dialect. A
        reference to a table that is not an MDL model or view falls back to
        ``session_context.transform_sql(sql)`` when ``fallback`` is ``True``;
        otherwise it raises ``ValueError``.
        """
        ast = parse_one(sql, dialect=self.dialect)

        user_cte_names = self._collect_user_cte_names(ast)

        # Two situations need model-column references canonicalized to the
        # manifest case before collection:
        #   * Upper-folding dialects (Oracle/Snowflake) render force-quoted
        #     (identify=True, below); a case-insensitive ref (``mixedcase`` for a
        #     manifest ``MixedCase``) would be quoted verbatim and never bind.
        #   * The case-sensitive path (manifest declares case-distinct columns)
        #     resolves quoted refs exactly and unquoted refs exact-then-CI, then
        #     force-quotes the resolved name so the dialect can't re-fold it.
        if self._force_identify or self._case_sensitive_columns:
            self._normalize_model_column_case(ast, user_cte_names)

        used_columns, user_table_refs, col_quoting = self._collect_model_columns(
            ast, user_cte_names
        )
        view_refs = self._collect_view_refs(ast, user_cte_names)

        # A view's native-SQL statement references models; collect those so
        # they get model CTEs placed before the (verbatim) view CTEs.
        self._collect_view_model_usage(
            view_refs, used_columns, user_table_refs, col_quoting
        )

        # The user's SQL is never rewritten — we only append CTEs. To bind the
        # user's column references to the injected CTE on dialects that
        # case-fold unquoted identifiers, each model CTE *exposes* its columns
        # with the same quoting the user wrote (see ``_collect_model_columns`` /
        # ``_alias_projection_to_user_quoting``): both the user's reference and
        # the CTE alias share the same quoting, so the dialect folds them
        # identically and they match.
        #
        # Upper-folding dialects (Oracle, Snowflake, …) are the exception: they
        # render with ``identify=True``. They uppercase every unquoted
        # identifier, so without forced quoting the result-set column names
        # (aggregate aliases like ``cnt``, cube columns like
        # ``order_date__month``) would come back uppercased — a breaking change
        # for callers that read columns by name. Forcing quoting keeps result
        # casing stable; case-insensitive references there are accepted by the
        # ``_normalize_model_column_case`` fold above. ``identify`` is purely an
        # output-rendering flag — the input AST is otherwise left as authored.
        identify = self._force_identify

        if not used_columns and not view_refs:
            # Nothing resolved to a model or view. If the query also has no
            # base-table reference at all, it is pure scalar / TVF SQL
            # (``SELECT 1`` or a standalone ``SELECT * FROM UNNEST([...])``)
            # with nothing to expand — pass it through transpiled to the
            # target dialect rather than rejecting it.
            base_tables = [
                t
                for t in ast.find_all(exp.Table)
                if (t.name or "").lower() not in user_cte_names
            ]
            if not base_tables:
                return ast.sql(dialect=self.dialect, identify=identify)
            # Otherwise the query references a table that is not an MDL model
            # or view. Fall back to the legacy whole-query transform (so a
            # broken/stale reference still surfaces an error), or raise when
            # ``fallback=False`` so tests catch a rewriter miss.
            if self.fallback:
                wren_sql = self.session_context.transform_sql(sql)
                return sqlglot.transpile(wren_sql, read="wren", write=self.dialect)[0]
            raise ValueError(f"No model or view references found in SQL: {sql}")

        model_ctes = self._build_model_ctes(used_columns, user_table_refs, col_quoting)
        view_ctes = self._build_view_ctes(view_refs)
        self._inject_ctes(ast, model_ctes + view_ctes)
        return ast.sql(dialect=self.dialect, identify=identify)

    # ------------------------------------------------------------------
    # Column collection via qualify
    # ------------------------------------------------------------------

    def _collect_model_columns(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> tuple[
        dict[str, list[str] | None],
        dict[str, tuple[str, bool]],
        dict[str, dict[str, bool]],
    ]:
        """Return ``(used_columns, user_table_refs, col_quoting)``.

        ``used_columns``: ``{model_name: [col1, col2, ...]}``. A value of
        ``None`` means the model was referenced via ``SELECT *`` and should
        be passed as-is to ``transform_sql`` so wren-core applies CLAC.

        ``user_table_refs``: ``{model_name: (user_name, user_quoted)}``
        capturing the literal identifier the user wrote (case + quoting)
        for the first occurrence of each model. The CTE alias matches that
        so dialects with case-folding (Oracle uppercases unquoted ⇒ the
        emitted CTE must fold to the same form) bind the user's outer
        reference to the injected CTE.

        ``col_quoting``: ``{model_name: {column_lower: was_quoted}}`` capturing
        whether the user quoted each column reference, scoped to the model the
        reference resolved to. The model CTE then exposes that column with the
        same quoting, so the user's (untouched) reference binds regardless of
        how the dialect folds unquoted identifiers. Scoping per model keeps a
        quoted reference to one source (a user CTE, or another model's
        same-named column) from flipping an unrelated model's CTE alias. When a
        model's column is referenced both quoted and unquoted, quoted wins
        (preserves the manifest case).

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

        if self._case_sensitive_columns:
            # Columns were already canonicalized + force-quoted to manifest case
            # by ``_normalize_model_column_case``; resolve them case-sensitively
            # against the ``normalize=False`` schema with no folding.
            return self._collect_columns_case_sensitive(
                copy, alias_to_model, user_table_refs, star_models
            )

        # Unquote model table refs on the collection-only copy so a quoted
        # mixed-case model name (e.g. ``"WREN_AI_CaseTest"``) folds to the
        # dialect's natural case during ``normalize_identifiers`` and matches
        # the dialect-folded qualify schema key. This mirrors the column
        # unquoting below: without it, the quoted reference preserves its case,
        # never matches the schema, ``qualify_columns`` leaves the column
        # unqualified, and the model CTE collapses to ``SELECT 1``.
        #
        # Only table refs that resolved to a model are unquoted (user CTEs are
        # excluded by ``_build_alias_map``), so a user CTE's case matching
        # between its definition and reference is untouched. ``user_table_refs``
        # has already captured the original quoting for CTE-alias mirroring, and
        # this copy is never emitted — the user's SQL is not mutated.
        model_refs = set(alias_to_model)
        for tbl in copy.find_all(exp.Table):
            ident = tbl.this
            if (
                isinstance(ident, exp.Identifier)
                and ident.quoted
                and ident.name in model_refs
            ):
                ident.set("quoted", False)

        # Record each column reference's quoting (by node identity), then unquote
        # it on the copy. The quoting drives CTE-alias mirroring; it is attributed
        # to a resolved model *after* qualification (below) so a quoted reference
        # to one source can't flip an unrelated model's CTE alias.
        # - Recording quoting lets the model CTE expose the column with the same
        #   quoting the user wrote (mirroring), so the untouched user reference
        #   binds.
        # - Unquoting on the copy makes a quoted mixed-case ref (e.g. ``"Year"``)
        #   fold to the dialect's natural case during ``normalize_identifiers``
        #   so it matches the dialect-folded qualify schema. Wren resolves column
        #   names case-insensitively (see ``_col_orig_name``); the copy is only
        #   used for collection, so the fold is safe. Without it a quoted
        #   ``"Year"`` never binds and the model CTE collapses to ``SELECT 1``.
        #
        # Quoting is recorded from *every* column reference (SELECT, WHERE, JOIN,
        # GROUP BY, ORDER BY, ...), not just the SELECT list — a column used only
        # in WHERE still needs its CTE alias to mirror it. The node identities
        # survive ``normalize_identifiers`` / ``qualify_columns``, so each
        # reference can be matched back to its resolved model afterwards.
        quoting_by_id: dict[int, bool] = {}
        for col in copy.find_all(exp.Column):
            ident = col.this
            if not isinstance(ident, exp.Identifier):
                continue
            quoting_by_id[id(col)] = ident.quoted
            if ident.quoted:
                ident.set("quoted", False)

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
        # Quoting recorded *per resolved model* (``{model: {col_lower: quoted}}``)
        # so a quoted reference to one source can't flip another model's CTE
        # alias. Quoted-wins within a model. A column referenced only via a
        # non-model source (user CTE, external table) is never attributed here.
        col_quoting: dict[str, dict[str, bool]] = {}
        for col in qualified.find_all(exp.Column):
            table_ref = col.table
            if not table_ref:
                continue
            model_name = alias_lookup.get(table_ref.lower())
            if not model_name:
                continue
            used[model_name][col.name] = None
            quoted = quoting_by_id.get(id(col))
            if quoted is None:
                continue
            per = col_quoting.setdefault(model_name, {})
            low = col.name.lower()
            if quoted:
                per[low] = True
            else:
                per.setdefault(low, False)

        return (
            {m: None if m in star_models else list(cols) for m, cols in used.items()},
            user_table_refs,
            col_quoting,
        )

    def _collect_columns_case_sensitive(
        self,
        copy: exp.Expression,
        alias_to_model: dict[str, str],
        user_table_refs: dict[str, tuple[str, bool]],
        star_models: set[str],
    ) -> tuple[
        dict[str, list[str] | None],
        dict[str, tuple[str, bool]],
        dict[str, dict[str, bool]],
    ]:
        """Collect model→columns on the case-sensitive path (no folding).

        The schema is keyed in manifest case (``normalize=False``) and column
        refs were already canonicalized + force-quoted to manifest case, so
        ``qualify_columns`` matches each ref exactly and ``SELECT *`` expands to
        the manifest-case columns. Returns an empty ``col_quoting`` map: the
        model CTE exposes *every* column quoted in manifest case (the default in
        ``_alias_projection_to_user_quoting``), matching the force-quoted refs.
        """
        alias_lower = {k.lower(): v for k, v in alias_to_model.items()}

        # Rewrite each model table ref to its manifest-case name (quoted) so it
        # matches the manifest-case schema key without folding. Only the table
        # *name* is touched; SQL aliases are left intact.
        for tbl in copy.find_all(exp.Table):
            ident = tbl.this
            if isinstance(ident, exp.Identifier):
                model_name = alias_lower.get(ident.name.lower())
                if model_name:
                    tbl.set("this", exp.to_identifier(model_name, quoted=True))

        qualified = qualify_columns(
            copy,
            schema=self.schema,
            dialect=self.dialect,
            allow_partial_qualification=True,
        )

        used: dict[str, dict[str, None]] = {m: {} for m in alias_to_model.values()}
        for col in qualified.find_all(exp.Column):
            table_ref = col.table
            if not table_ref:
                continue
            model_name = alias_lower.get(table_ref.lower())
            if model_name:
                used[model_name][col.name] = None

        return (
            {m: None if m in star_models else list(cols) for m, cols in used.items()},
            user_table_refs,
            {},
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

    def _resolve_column(
        self, candidates: list[str], name: str, quoted: bool, where: str
    ) -> str | None:
        """Resolve a column reference to its manifest-case name.

        SQL identifier semantics, mirroring ``resolve_model_name`` one level
        down: a **quoted** reference must match a manifest column exactly
        (case-sensitive); an **unquoted** reference prefers an exact match, then
        falls back to a case-insensitive scan. Returns the manifest-case name,
        or ``None`` if nothing matches (the ref then fails to bind, surfacing as
        a "column not found" from wren-core).

        Raises ``INVALID_SQL`` only when an unquoted reference is genuinely
        **ambiguous** — two or more candidates differ only in case and none
        matches exactly (e.g. ``YEAR`` against ``Year`` and ``year``).
        """
        # Single pass: an exact match wins immediately (quoted-exact or
        # unquoted-exact); otherwise an unquoted ref collects case-insensitive
        # candidates for the exact-then-CI fallback.
        low = name.lower()
        ci = []
        for c in candidates:
            if c == name:
                return name
            if not quoted and c.lower() == low:
                ci.append(c)
        if quoted:  # quoted is strict — no case-insensitive fallback
            return None
        if len(ci) == 1:
            return ci[0]
        if len(ci) > 1:
            raise WrenError(
                error_code=ErrorCode.INVALID_SQL,
                message=(
                    f"Column reference '{name}' in {where} is ambiguous: it "
                    f"matches case-distinct columns {sorted(ci)}. Quote it to "
                    "select one exactly."
                ),
                phase=ErrorPhase.SQL_PARSING,
            )
        return None

    @staticmethod
    def _collect_output_alias_refs(ast: exp.Expression) -> set[int]:
        """Return ``id()`` of column nodes that reference a SELECT output alias.

        An output alias (``SELECT x AS yr``) is referenceable by name only from
        its own SELECT's ``ORDER BY`` / ``GROUP BY`` / ``HAVING`` / ``QUALIFY``
        clauses — not from WHERE/JOIN, and not from another (e.g. outer) scope.
        Resolving this per scope (rather than with a query-wide alias-name set)
        avoids mis-skipping an outer column ref whose name merely coincides with
        a subquery's alias. Returns node identities so the caller can skip the
        exact references without re-deriving scope.
        """
        refs: set[int] = set()
        for select in ast.find_all(exp.Select):
            proj_aliases = {
                proj.alias.lower()
                for proj in select.expressions
                if isinstance(proj, exp.Alias) and proj.alias
            }
            if not proj_aliases:
                continue
            for clause_key in ("order", "group", "having", "qualify"):
                clause = select.args.get(clause_key)
                if clause is None:
                    continue
                for col in clause.find_all(exp.Column):
                    ident = col.this
                    if (
                        isinstance(ident, exp.Identifier)
                        and not col.table
                        and ident.name.lower() in proj_aliases
                    ):
                        refs.add(id(col))
        return refs

    def _normalize_model_column_case(
        self, ast: exp.Expression, user_cte_names: set[str]
    ) -> None:
        """Rewrite model-column references in *ast* to their manifest case.

        Invoked when the output is force-quoted (Oracle/Snowflake, ``identify=
        True``) or the manifest declares case-distinct columns (the
        case-sensitive path). In both, a user reference whose case differs from
        the manifest would otherwise be emitted quoted-verbatim and never bind
        the manifest-case CTE column. Canonicalizing it lets the input stay
        case-insensitive (for unambiguous refs) while result-set casing is the
        manifest case.

        On the **case-sensitive path** resolution is strict per SQL rules
        (``_resolve_column``): quoted refs match exactly, unquoted refs match
        exact-then-CI, ambiguous unquoted refs raise. The resolved identifier is
        force-quoted so a folding dialect (Postgres) cannot re-fold it and so
        two case-distinct columns stay distinct in the output.

        Scope guards keep this from rebinding non-model columns:

        - a column qualified by a user CTE (or any non-model alias) is left
          untouched;
        - an unqualified column is only rewritten when the query has no user
          CTEs, so it cannot shadow a CTE-exposed column.

        A *qualified* reference is resolved against its specific model, so two
        models whose columns share a lowercase form but differ in manifest case
        (``A.year`` vs ``B.Year``) each canonicalize correctly. An unqualified
        reference (only rewritten when there are no user CTEs) resolves against
        the union of all models' columns. Mutates *ast* in place; only column
        identifiers are touched (SELECT aliases, function names, etc. are left
        as the user wrote them).
        """
        if not self._model_cols:
            return

        alias_to_model, _ = self._build_alias_map(
            qualify_tables(ast.copy(), dialect=self.dialect), user_cte_names
        )
        alias_to_model_lower = {a.lower(): m for a, m in alias_to_model.items()}
        has_user_ctes = bool(user_cte_names)
        cs = self._case_sensitive_columns
        # A SELECT-list output alias (``SELECT x AS yr ... ORDER BY yr``) parses
        # as a bare column but is not a model column — never canonicalize or
        # error on it. It is only referenceable by name from its *own* SELECT's
        # ORDER BY / GROUP BY / HAVING / QUALIFY clauses, so resolve this
        # precisely per scope: collect the exact ``exp.Column`` *nodes* in those
        # clauses that match a projection alias of the same SELECT.
        alias_ref_cols = self._collect_output_alias_refs(ast)

        for col in ast.find_all(exp.Column):
            ident = col.this
            if not isinstance(ident, exp.Identifier):
                continue
            if id(col) in alias_ref_cols:
                # references a SELECT output alias, not a model column; skip
                continue
            table = col.table
            if table:
                model_name = alias_to_model_lower.get(table.lower())
                if model_name is None:
                    # qualified by something that isn't a model (e.g. a user CTE)
                    continue
                candidates = self._model_cols.get(model_name, [])
                where = f"{table}"
            elif has_user_ctes or not alias_to_model:
                # Skip canonicalization (and the case-sensitive existence check)
                # when the column can't be attributed to a model:
                #   * user CTEs present → it could be a CTE column, and we can't
                #     tell without full scope analysis;
                #   * no model table resolved at all → it belongs to an external
                #     table or a pure-TVF projection, which ``rewrite()`` handles
                #     via its passthrough/fallback branch.
                # Known limitation: an unqualified model-column ref in a query
                # that also defines CTEs is not force-quoted and bypasses the
                # case-sensitive "column does not exist" check — it falls back to
                # the old behavior (may collapse to ``SELECT 1``). Qualify the
                # column (``model.col``) to get strict checking.
                continue
            else:
                candidates = self._all_model_cols
                where = "the query"
            # On the case-sensitive path a quoted ref is strict (must match
            # exactly). On the force-identify-only path (no case-distinct
            # columns) preserve the existing lenient behavior: resolve every ref
            # case-insensitively — the candidate list has no case collisions, so
            # this lookup is unambiguous and never raises.
            canonical = self._resolve_column(
                candidates, ident.name, ident.quoted if cs else False, where
            )
            if canonical is None:
                if cs:
                    # Case-sensitive path: the ref is model-attributable but
                    # matches no manifest column — a quoted wrong-case ref
                    # (``"YEAR"`` vs ``Year``/``year``) or a genuine typo. Fail
                    # loudly here instead of dropping the column and emitting a
                    # ``SELECT 1`` CTE that explodes later as an opaque database
                    # "column does not exist" at execution.
                    quoted_hint = (
                        " (quoted references are matched case-sensitively)"
                        if ident.quoted
                        else ""
                    )
                    raise WrenError(
                        error_code=ErrorCode.INVALID_SQL,
                        message=(
                            f"Column '{ident.name}' in {where} does not exist"
                            f"{quoted_hint}. Available columns: {sorted(candidates)}."
                        ),
                        phase=ErrorPhase.SQL_PARSING,
                    )
                continue
            if ident.name != canonical:
                ident.set("this", canonical)
            if cs:
                # force-quote so a folding dialect cannot re-fold the resolved
                # name and case-distinct columns stay distinct in the output
                ident.set("quoted", True)

    @staticmethod
    def _alias_projection_to_user_quoting(
        expanded_ast: exp.Expression, col_quoting: dict[str, bool]
    ) -> None:
        """Alias the model CTE's outermost projection to mirror user quoting.

        wren-core projects manifest-case columns (e.g. ``"Year"``). We add an
        explicit alias to each so the CTE *exposes* the column with the same
        quoting the user wrote it with:

        - user wrote ``"Year"`` (quoted)  → expose ``... AS "Year"`` (the
          column stays case-sensitive ``Year``; the user's ``"Year"`` binds).
        - user wrote ``Year`` (unquoted) → expose ``... AS Year`` (the dialect
          folds it, e.g. Postgres → ``year``; the user's folded ``Year`` binds).

        Columns with no captured reference (``SELECT *`` / introspection)
        default to quoted so the result preserves the manifest case. This keeps
        the user's SQL untouched — only the CTE projection carries the mirror.
        """
        # wren-core's single-model expansion is always a ``SELECT``; guard
        # defensively so an unexpected shape can't crash the rewrite (it would
        # just skip mirroring and expose manifest-case columns).
        if not isinstance(expanded_ast, exp.Select):
            return
        new_exprs = []
        for proj in expanded_ast.expressions:
            if isinstance(proj, exp.Alias):
                name, inner = proj.alias, proj.this
            elif isinstance(proj, exp.Column):
                # Bare column with no alias wrapper. wren-core normally emits an
                # Alias, so this is defensive — handled the same way.
                name, inner = proj.name, proj
            else:
                new_exprs.append(proj)
                continue
            quoted = col_quoting.get(name.lower(), True)
            new_exprs.append(exp.alias_(inner, exp.to_identifier(name, quoted=quoted)))
        expanded_ast.set("expressions", new_exprs)

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
        col_quoting: dict[str, dict[str, bool]],
    ) -> list[exp.CTE]:
        """Generate one CTE per model via wren-core transform_sql."""
        ctes: list[exp.CTE] = []
        for model_name, columns in used_columns.items():
            if columns is None:
                # SELECT * — let wren-core handle column visibility (CLAC)
                model_sql = f'SELECT * FROM "{model_name}"'
            elif columns:
                if self._case_sensitive_columns:
                    # Collected names are already in manifest case (the schema is
                    # not folded), and ``_col_orig_name`` would collide for
                    # case-distinct columns — use the names as collected.
                    resolved = columns
                else:
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

            # Expose each column with the quoting the user wrote it with, so the
            # (untouched) user reference binds regardless of dialect folding.
            # Use this model's own quoting map only.
            self._alias_projection_to_user_quoting(
                expanded_ast, col_quoting.get(model_name, {})
            )

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
        col_quoting: dict[str, dict[str, bool]],
    ) -> None:
        """Merge the models each referenced view's statement uses into
        *used_columns* / *user_table_refs* / *col_quoting*, so those models get
        CTEs whose columns mirror how the view's statement quotes them.

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
            # Resolve the view body's column refs the same way as the user query,
            # so a case-distinct model referenced from a view statement gets the
            # same strict treatment (quoted = exact, unquoted = exact-then-CI,
            # ambiguous / not-found raise cleanly) rather than silently
            # mis-resolving or collapsing to ``SELECT 1``. Mutating this AST is
            # safe: it is used only to collect columns here; the view body is
            # emitted verbatim from a fresh parse in ``_build_view_ctes``.
            if self._force_identify or self._case_sensitive_columns:
                self._normalize_model_column_case(view_ast, view_cte_names)
            v_cols, v_refs, v_quoting = self._collect_model_columns(
                view_ast, view_cte_names
            )
            self._merge_used_columns(used_columns, v_cols)
            for model_name, ref in v_refs.items():
                user_table_refs.setdefault(model_name, ref)
            for model_name, qmap in v_quoting.items():
                # merge per-model, quoted-wins (consistent with
                # _collect_model_columns)
                dest = col_quoting.setdefault(model_name, {})
                for low, quoted in qmap.items():
                    if quoted:
                        dest[low] = True
                    else:
                        dest.setdefault(low, False)

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
