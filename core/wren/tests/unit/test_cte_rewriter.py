"""Unit tests for CTERewriter — no database required."""

from __future__ import annotations

import base64

import orjson
import pytest
import sqlglot

from wren.mdl import get_session_context
from wren.mdl.cte_rewriter import CTERewriter, get_sqlglot_dialect
from wren.model.data_source import DataSource
from wren.model.error import ErrorCode, WrenError

pytestmark = pytest.mark.unit

# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

_SINGLE_MODEL_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "orders",
            "tableReference": {"schema": "main", "table": "orders"},
            "columns": [
                {"name": "o_orderkey", "type": "integer"},
                {"name": "o_custkey", "type": "integer"},
                {"name": "o_orderstatus", "type": "varchar"},
                {
                    "name": "order_cust_key",
                    "type": "varchar",
                    "expression": "concat(cast(o_orderkey as varchar), '_', cast(o_custkey as varchar))",
                },
            ],
            "primaryKey": "o_orderkey",
        }
    ],
}

_MULTI_MODEL_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "orders",
            "tableReference": {"schema": "main", "table": "orders"},
            "columns": [
                {"name": "o_orderkey", "type": "integer"},
                {"name": "o_custkey", "type": "integer"},
                {"name": "o_orderstatus", "type": "varchar"},
                {
                    "name": "order_cust_key",
                    "type": "varchar",
                    "expression": "concat(cast(o_orderkey as varchar), '_', cast(o_custkey as varchar))",
                },
            ],
            "primaryKey": "o_orderkey",
        },
        {
            "name": "customer",
            "tableReference": {"schema": "main", "table": "customer"},
            "columns": [
                {"name": "c_custkey", "type": "integer"},
                {"name": "c_name", "type": "varchar"},
            ],
            "primaryKey": "c_custkey",
        },
    ],
    "relationships": [
        {
            "name": "orders_customer",
            "models": ["orders", "customer"],
            "joinType": "many_to_one",
            "condition": '"orders".o_custkey = "customer".c_custkey',
        }
    ],
}


_VIEW_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": _MULTI_MODEL_MANIFEST["models"],
    "relationships": _MULTI_MODEL_MANIFEST["relationships"],
    "views": [
        {
            "name": "orders_with_customer",
            "statement": (
                "SELECT o.o_orderkey, o.o_orderstatus, c.c_name "
                'FROM "orders" o JOIN "customer" c ON o.o_custkey = c.c_custkey'
            ),
        }
    ],
}


def _b64(manifest: dict) -> str:
    return base64.b64encode(orjson.dumps(manifest)).decode()


def _make_rewriter(
    manifest: dict,
    data_source: DataSource = DataSource.duckdb,
    *,
    fallback: bool = False,
) -> CTERewriter:
    manifest_str = _b64(manifest)
    session = get_session_context(manifest_str, None, None, data_source.name)
    return CTERewriter(manifest_str, session, data_source, fallback=fallback)


# ---------------------------------------------------------------------------
# Helper: parse and check CTE presence
# ---------------------------------------------------------------------------


def _has_cte(sql: str, cte_name: str, dialect: str = "duckdb") -> bool:
    """Return True if *sql* contains a CTE named *cte_name*."""
    ast = sqlglot.parse_one(sql, dialect=dialect)
    with_clause = ast.args.get("with_")
    if not with_clause:
        return False
    for cte in with_clause.expressions:
        alias = cte.args.get("alias")
        if alias and alias.this.name == cte_name:
            return True
    return False


def _count_ctes(sql: str, dialect: str = "duckdb") -> int:
    ast = sqlglot.parse_one(sql, dialect=dialect)
    with_clause = ast.args.get("with_")
    if not with_clause:
        return 0
    return len(with_clause.expressions)


def _cte_body_sql(sql: str, cte_name: str, dialect: str = "duckdb") -> str | None:
    """Return the SQL body of a named CTE, or None if not found."""
    ast = sqlglot.parse_one(sql, dialect=dialect)
    with_clause = ast.args.get("with_")
    if not with_clause:
        return None
    for cte in with_clause.expressions:
        alias = cte.args.get("alias")
        if alias and alias.this.name == cte_name:
            return cte.this.sql(dialect=dialect)
    return None


# ---------------------------------------------------------------------------
# Tests: basic model resolution
# ---------------------------------------------------------------------------


class TestSingleModel:
    def test_single_model_generates_cte(self):
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST)
        result = rw.rewrite('SELECT o_orderkey FROM "orders" LIMIT 1')
        assert _has_cte(result, "orders")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_star_not_expanded(self):
        """SELECT * should pass star to wren-core so all columns are included."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST)
        result = rw.rewrite('SELECT * FROM "orders"')
        assert _has_cte(result, "orders")
        cte_body = _cte_body_sql(result, "orders")
        assert cte_body is not None
        # wren-core expands SELECT * into all model columns — verify every
        # non-hidden, non-relationship column is present in the CTE body.
        body_lower = cte_body.lower()
        for col_name in ("o_orderkey", "o_custkey", "o_orderstatus", "order_cust_key"):
            assert col_name.lower() in body_lower, (
                f"Expected column {col_name!r} in CTE body: {cte_body}"
            )

    def test_alias_resolution(self):
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST)
        result = rw.rewrite('SELECT o.o_orderkey FROM "orders" o')
        assert _has_cte(result, "orders")

    def test_calculated_column(self):
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST)
        result = rw.rewrite('SELECT order_cust_key FROM "orders"')
        assert _has_cte(result, "orders")
        # The CTE should contain the expanded expression
        assert "concat" in result.lower() or "||" in result.lower()


class TestMultiModel:
    def test_join_generates_two_ctes(self):
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST)
        result = rw.rewrite(
            "SELECT o.o_orderkey, c.c_name "
            'FROM "orders" o JOIN "customer" c ON o.o_custkey = c.c_custkey'
        )
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")
        assert _count_ctes(result) >= 2

    def test_qualified_star_not_expanded(self):
        """SELECT table.* should pass star to wren-core so all columns appear."""
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST)
        result = rw.rewrite('SELECT "orders".* FROM "orders"')
        assert _has_cte(result, "orders")
        cte_body = _cte_body_sql(result, "orders")
        assert cte_body is not None
        body_lower = cte_body.lower()
        for col_name in ("o_orderkey", "o_custkey", "o_orderstatus", "order_cust_key"):
            assert col_name.lower() in body_lower, (
                f"Expected column {col_name!r} in CTE body: {cte_body}"
            )

    def test_mixed_star_and_explicit_columns(self):
        """orders.* should include all columns; customer CTE only referenced ones."""
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST)
        result = rw.rewrite(
            'SELECT "orders".*, c.c_name '
            'FROM "orders" JOIN "customer" c ON "orders".o_custkey = c.c_custkey'
        )
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")
        # orders used star → all columns present
        orders_body = _cte_body_sql(result, "orders")
        assert orders_body is not None
        orders_lower = orders_body.lower()
        for col_name in ("o_orderkey", "o_custkey", "o_orderstatus", "order_cust_key"):
            assert col_name.lower() in orders_lower
        # customer used explicit column → only c_name (not necessarily c_custkey
        # in the select list, though it may appear in the subquery structure)
        customer_body = _cte_body_sql(result, "customer")
        assert customer_body is not None
        assert "c_name" in customer_body.lower()


# ---------------------------------------------------------------------------
# Tests: CTE edge cases
# ---------------------------------------------------------------------------


class TestCTEEdgeCases:
    def test_user_cte_references_model(self):
        """User CTE that references a model — model CTE should be prepended."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST)
        result = rw.rewrite(
            'WITH summary AS (SELECT o_orderkey FROM "orders") SELECT * FROM summary'
        )
        assert _has_cte(result, "orders")
        assert _has_cte(result, "summary")
        # Model CTE should come before user CTE
        ast = sqlglot.parse_one(result, dialect="duckdb")
        cte_names = [
            cte.args["alias"].this.name for cte in ast.args["with_"].expressions
        ]
        assert cte_names.index("orders") < cte_names.index("summary")

    def test_user_cte_shadows_model(self):
        """User CTE with same name as model — no model CTE generated for that name."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST, fallback=True)
        result = rw.rewrite("WITH orders AS (SELECT 1 AS id) SELECT * FROM orders")
        # The model name is shadowed by user CTE, so CTERewriter skips it
        # and falls back to session_context.transform_sql which processes
        # the whole query (wren-core handles user CTEs natively).
        assert isinstance(result, str)
        # No model-generated CTE named "orders" should be present
        # (wren-core may restructure the query but won't add a model CTE)
        assert not _has_cte(result, "orders") or _count_ctes(result) <= 1

    def test_user_cte_shadows_model_case_insensitive(self):
        """User CTE 'Orders' (mixed case) should shadow model 'orders'."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST, fallback=True)
        result = rw.rewrite(
            "WITH Orders AS (SELECT 1 AS o_orderkey, 'OPEN' AS o_orderstatus) "
            "SELECT * FROM Orders"
        )
        ast = sqlglot.parse_one(result, dialect="duckdb")
        with_clause = ast.args.get("with_")
        if with_clause:
            cte_names = [cte.args["alias"].this.name for cte in with_clause.expressions]
            orders_count = sum(1 for n in cte_names if n.lower() == "orders")
            assert orders_count <= 1, f"Duplicate 'orders' CTE: {result}"

    def test_nested_cte_shadows_model(self):
        """CTE defined in a subquery WITH should also shadow the model name."""
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST, fallback=True)
        result = rw.rewrite(
            "SELECT * FROM orders WHERE o_custkey IN ("
            "  WITH customer AS (SELECT 1 AS c_custkey) "
            "  SELECT c_custkey FROM customer"
            ")"
        )
        # "customer" is shadowed by the nested CTE — only "orders" should
        # get a model CTE, not "customer".
        assert _has_cte(result, "orders")
        assert not _has_cte(result, "customer")

    def test_recursive_cte_preserved(self):
        """WITH RECURSIVE keyword should be preserved after model CTE injection."""
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST)
        result = rw.rewrite(
            "WITH RECURSIVE hierarchy AS ("
            '  SELECT o_orderkey, o_custkey FROM "orders" WHERE o_custkey = 1'
            "  UNION ALL"
            '  SELECT o.o_orderkey, o.o_custkey FROM "orders" o'
            "  JOIN hierarchy h ON o.o_custkey = h.o_orderkey"
            ") SELECT * FROM hierarchy"
        )
        assert _has_cte(result, "orders")
        assert _has_cte(result, "hierarchy")
        # RECURSIVE keyword must be preserved
        ast = sqlglot.parse_one(result, dialect="duckdb")
        assert ast.args["with_"].args.get("recursive")

    @pytest.mark.parametrize(
        ("sql", "data_source"),
        [
            ("SELECT 1", DataSource.postgres),
            ("SELECT 1 + 1 AS two", DataSource.postgres),
            ("SELECT CURRENT_DATE", DataSource.postgres),
            # Oracle forces identifier quoting (identify=True) on output; the
            # passthrough must still round-trip a scalar query cleanly.
            ("SELECT 1", DataSource.oracle),
            # A pure inline-row STRUCT spine — no model reference.
            (
                "SELECT stage, sort_order FROM UNNEST(["
                "STRUCT('Prospecting' AS stage, 1 AS sort_order), "
                "('Qualification', 2), ('Proposal', 3)])",
                DataSource.bigquery,
            ),
        ],
    )
    def test_scalar_or_pure_tvf_passes_through(self, sql, data_source):
        """SQL with no model/view reference is passed through, never rejected."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST, data_source, fallback=True)
        out = rw.rewrite(sql)

        # Nothing to expand — no model CTE is injected.
        assert "with" not in out.lower()
        # It round-trips to the same AST in the target dialect.
        dialect = get_sqlglot_dialect(data_source)
        assert sqlglot.parse_one(out, dialect=dialect) == sqlglot.parse_one(
            sql, dialect=dialect
        )

    def test_scalar_passes_through_without_fallback(self):
        """Pure scalar SQL passes through even when fallback is disabled."""
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST, fallback=False)
        out = rw.rewrite("SELECT 1")
        assert "with" not in out.lower()

    def test_unresolved_table_raises_without_fallback(self):
        """A non-model table reference raises when fallback is disabled.

        Only pure scalar / TVF SQL passes through unconditionally; a table
        reference that resolves to no MDL model or view is still a rewriter
        miss and must surface, not be silently passed on.
        """
        rw = _make_rewriter(_SINGLE_MODEL_MANIFEST, fallback=False)
        with pytest.raises(ValueError):
            rw.rewrite("SELECT * FROM unknown_table")


# ---------------------------------------------------------------------------
# Tests: correlated subquery (the key fix)
# ---------------------------------------------------------------------------


class TestCorrelatedSubquery:
    def test_exists_subquery(self):
        """Correlated subquery with EXISTS — both models should get CTEs."""
        rw = _make_rewriter(_MULTI_MODEL_MANIFEST)
        result = rw.rewrite(
            'SELECT * FROM "orders" WHERE EXISTS '
            '(SELECT 1 FROM "customer" WHERE c_custkey = o_custkey)'
        )
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")


# ---------------------------------------------------------------------------
# Tests: MDL views
# ---------------------------------------------------------------------------


class TestView:
    def test_view_only_query(self):
        """A view-only query expands the view as a verbatim CTE, plus the
        model CTEs the view statement references."""
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite('SELECT o_orderkey FROM "orders_with_customer"')
        assert _has_cte(result, "orders_with_customer")
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")

    def test_model_ctes_precede_view_cte(self):
        """The models a view references must be defined before the view CTE."""
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite('SELECT c_name FROM "orders_with_customer"')
        ast = sqlglot.parse_one(result, dialect="duckdb")
        cte_names = [
            cte.args["alias"].this.name for cte in ast.args["with_"].expressions
        ]
        view_idx = cte_names.index("orders_with_customer")
        assert cte_names.index("orders") < view_idx
        assert cte_names.index("customer") < view_idx

    def test_view_body_kept_verbatim(self):
        """The view CTE body is the native-SQL statement, not a wren-core
        expansion — it still references the models by name and keeps the join."""
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite('SELECT c_name FROM "orders_with_customer"')
        body = _cte_body_sql(result, "orders_with_customer")
        assert body is not None
        body_lower = body.lower()
        assert "orders" in body_lower
        assert "customer" in body_lower
        assert "join" in body_lower

    def test_view_select_star(self):
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite('SELECT * FROM "orders_with_customer"')
        assert _has_cte(result, "orders_with_customer")
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")

    def test_view_join_model(self):
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite(
            "SELECT v.c_name, o.o_orderstatus "
            'FROM "orders_with_customer" v '
            'JOIN "orders" o ON v.o_orderkey = o.o_orderkey'
        )
        assert _has_cte(result, "orders_with_customer")
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")

    def test_user_cte_references_view_and_model(self):
        rw = _make_rewriter(_VIEW_MANIFEST)
        result = rw.rewrite(
            "WITH summary AS ("
            "  SELECT v.c_name, o.o_orderkey "
            '  FROM "orders_with_customer" v '
            '  JOIN "orders" o ON v.o_orderkey = o.o_orderkey'
            ") SELECT * FROM summary"
        )
        assert _has_cte(result, "orders_with_customer")
        assert _has_cte(result, "orders")
        assert _has_cte(result, "customer")
        assert _has_cte(result, "summary")


# ---------------------------------------------------------------------------
# Tests: dialect mapping
# ---------------------------------------------------------------------------


class TestDialectMapping:
    def test_postgres(self):
        assert get_sqlglot_dialect(DataSource.postgres) == "postgres"

    def test_mssql_maps_to_tsql(self):
        assert get_sqlglot_dialect(DataSource.mssql) == "tsql"

    def test_canner_maps_to_trino(self):
        assert get_sqlglot_dialect(DataSource.canner) == "trino"

    def test_local_file_maps_to_duckdb(self):
        assert get_sqlglot_dialect(DataSource.local_file) == "duckdb"


# ---------------------------------------------------------------------------
# Tests: case-insensitive column & model binding
# ---------------------------------------------------------------------------

_MIXED_CASE_COL_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "events",
            "tableReference": {"schema": "main", "table": "events"},
            "columns": [
                {"name": "id", "type": "integer"},
                {"name": "Amount", "type": "integer"},
            ],
            "primaryKey": "id",
        }
    ],
}

_MIXED_CASE_MODEL_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "CaseModel",
            "tableReference": {"schema": "main", "table": "case_model"},
            "columns": [{"name": "id", "type": "integer"}],
            "primaryKey": "id",
        }
    ],
}

_CASE_COLLISION_MANIFEST = {
    "catalog": "wren",
    "schema": "public",
    "models": [
        {
            "name": "clash",
            "tableReference": {"schema": "main", "table": "clash"},
            "columns": [
                {"name": "Year", "type": "integer"},
                {"name": "year", "type": "integer"},
            ],
        }
    ],
}


class TestCaseSensitiveBinding:
    def test_force_identify_detected_from_dialect(self):
        """Upper-folding dialects force-quote output; others do not."""
        assert _make_rewriter(_SINGLE_MODEL_MANIFEST, DataSource.oracle)._force_identify
        assert _make_rewriter(
            _SINGLE_MODEL_MANIFEST, DataSource.snowflake
        )._force_identify
        assert not _make_rewriter(
            _SINGLE_MODEL_MANIFEST, DataSource.postgres
        )._force_identify
        assert not _make_rewriter(
            _SINGLE_MODEL_MANIFEST, DataSource.bigquery
        )._force_identify

    def test_case_only_column_collision_rejected_on_ci_dialect(self):
        """Case-distinct columns are rejected on a case-insensitive dialect."""
        with pytest.raises(WrenError) as exc:
            _make_rewriter(_CASE_COLLISION_MANIFEST, DataSource.bigquery)
        assert exc.value.error_code == ErrorCode.INVALID_MDL

    def test_case_distinct_columns_allowed_on_case_sensitive_dialect(self):
        """Postgres can hold case-distinct columns — build succeeds, refs bind."""
        rw = _make_rewriter(_CASE_COLLISION_MANIFEST, DataSource.postgres)
        assert rw._case_sensitive_columns
        # Quoted refs select each case-distinct column exactly.
        out = rw.rewrite('SELECT "Year", "year" FROM clash')
        assert _has_cte(out, "clash", dialect="postgres")
        assert "select 1" not in out.lower()

    def test_quoted_wrong_case_column_rejected_on_case_sensitive_dialect(self):
        """A quoted ref to a non-existent case variant fails loudly."""
        rw = _make_rewriter(_CASE_COLLISION_MANIFEST, DataSource.postgres)
        with pytest.raises(WrenError) as exc:
            rw.rewrite('SELECT "YEAR" FROM clash')
        assert exc.value.error_code == ErrorCode.INVALID_SQL

    def test_ambiguous_unquoted_ref_rejected_on_case_sensitive_dialect(self):
        """An unquoted ref matching multiple case-distinct columns is ambiguous."""
        rw = _make_rewriter(_CASE_COLLISION_MANIFEST, DataSource.postgres)
        with pytest.raises(WrenError) as exc:
            rw.rewrite("SELECT YEAR FROM clash")
        assert exc.value.error_code == ErrorCode.INVALID_SQL

    def test_quoted_mixed_case_column_binds(self):
        """A quoted mixed-case column reference binds to the model CTE."""
        rw = _make_rewriter(_MIXED_CASE_COL_MANIFEST, DataSource.postgres)
        out = rw.rewrite('SELECT "Amount" FROM events')
        assert _has_cte(out, "events", dialect="postgres")
        # The CTE exposes the column with the user's quoting and does not
        # collapse to a column-less SELECT 1.
        assert "Amount" in out
        assert "select 1" not in out.lower()

    def test_unquoted_mixed_case_column_binds(self):
        """An unquoted mixed-case column reference binds via dialect folding."""
        rw = _make_rewriter(_MIXED_CASE_COL_MANIFEST, DataSource.postgres)
        out = rw.rewrite("SELECT Amount FROM events")
        assert _has_cte(out, "events", dialect="postgres")
        assert "select 1" not in out.lower()

    def test_quoted_mixed_case_model_binds(self):
        """A quoted mixed-case model name binds to its CTE (not SELECT 1)."""
        rw = _make_rewriter(_MIXED_CASE_MODEL_MANIFEST, DataSource.postgres)
        out = rw.rewrite('SELECT id FROM "CaseModel"')
        assert _has_cte(out, "CaseModel", dialect="postgres")
        assert "select 1" not in out.lower()

    def test_quoting_does_not_leak_across_sources(self):
        """A quoted same-name column elsewhere must not flip a model CTE alias.

        ``events`` has a mixed-case ``Amount`` and is referenced unquoted; a
        user CTE also exposes ``amount`` referenced quoted. Quoting is scoped
        per model, so the ``events`` CTE still mirrors the unquoted reference
        (``AS Amount``) and the user's ``e.Amount`` binds on Postgres — the
        CTE's quoted ``"amount"`` does not force-quote it.
        """
        rw = _make_rewriter(_MIXED_CASE_COL_MANIFEST, DataSource.postgres)
        out = rw.rewrite(
            "WITH c AS (SELECT 1 AS amount) "
            'SELECT e.Amount, c."amount" FROM events e JOIN c ON 1=1'
        )
        ast = sqlglot.parse_one(out, dialect="postgres")
        events_cte = next(
            cte for cte in ast.args["with_"].expressions if cte.alias == "events"
        )
        proj = events_cte.this.expressions[0]
        assert isinstance(proj, sqlglot.exp.Alias)
        assert not proj.args["alias"].quoted, (
            f"events CTE alias should be unquoted (mirroring e.Amount), got: {out}"
        )

    def test_case_insensitive_ref_on_upper_folding_dialect(self):
        """Oracle: a lower-case ref to a mixed-case column is canonicalized."""
        rw = _make_rewriter(_MIXED_CASE_COL_MANIFEST, DataSource.oracle)
        out = rw.rewrite("SELECT amount FROM events")
        # Output is force-quoted; the manifest-case column survives.
        assert "Amount" in out
        assert "select 1" not in out.lower()
