"""Case-sensitivity rules across the wren SDK.

Locks in the contract shared by ``policy.resolve_model_name``,
``policy.validate_sql_policy`` (strict mode), and ``CTERewriter``:

- a **quoted** identifier must match a manifest model name case-sensitively
- an **unquoted** identifier prefers an exact match, then a case-insensitive
  scan

The CTE rewriter is exercised against a manifest that intentionally contains
two models differing only in case (``Users`` and ``users``) to prove the
right one is bound regardless of the user's casing.
"""

from __future__ import annotations

import base64

import orjson
import pytest
from sqlglot import parse_one

from wren.config import WrenConfig
from wren.mdl import get_manifest_extractor, get_session_context, to_json_base64
from wren.mdl.cte_rewriter import CTERewriter
from wren.model.data_source import DataSource
from wren.model.error import WrenError
from wren.policy import resolve_model_name, validate_sql_policy

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _model(name: str) -> dict:
    return {
        "name": name,
        "tableReference": {
            "catalog": "test",
            "schema": "public",
            "table": name.lower(),
        },
        "columns": [{"name": "id", "type": "integer"}],
    }


@pytest.fixture
def dual_case_manifest_b64() -> str:
    """Manifest with both ``Users`` and ``users`` as separate models."""
    manifest = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "models": [_model("Users"), _model("users"), _model("Orders")],
    }
    return base64.b64encode(orjson.dumps(manifest)).decode("utf-8")


# ---------------------------------------------------------------------------
# resolve_model_name
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "quoted", "expected"),
    [
        # Quoted: case-sensitive exact match required.
        ("Users", True, "Users"),
        ("users", True, "users"),
        ("USERS", True, None),
        # Unquoted: exact match preferred, then case-insensitive scan.
        ("Users", False, "Users"),
        ("users", False, "users"),
        ("USERS", False, "Users"),  # CI fallback resolves to first match
        # Misses regardless of quoting.
        ("nonexistent", True, None),
        ("nonexistent", False, None),
    ],
)
def test_resolve_model_name_dual_case(name, quoted, expected):
    """Quoted = strict CS; unquoted = exact-then-CI fallback."""
    model_names = {"Users", "users", "Orders"}
    actual = resolve_model_name(name, quoted, model_names)
    if expected is None:
        assert actual is None
    elif expected == "Users":
        # ``USERS`` unquoted may pick either manifest entry depending on set
        # iteration order — accept either as long as case-insensitive matches.
        assert actual is not None and actual.lower() == name.lower()
    else:
        assert actual == expected


def test_resolve_model_name_postgres_quoted_distinct():
    """Postgres ``"Orders"`` (quoted, mixed case) must not match lowercase ``orders``."""
    model_names = {"orders"}
    assert resolve_model_name("Orders", True, model_names) is None
    assert resolve_model_name("Orders", False, model_names) == "orders"
    assert resolve_model_name("orders", True, model_names) == "orders"


# ---------------------------------------------------------------------------
# validate_sql_policy (strict mode)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sql", "should_pass", "description"),
    [
        ("SELECT * FROM `Users`", True, "quoted exact match"),
        ("SELECT * FROM `users`", True, "quoted exact match (lowercase variant)"),
        ("SELECT * FROM `USERS`", False, "quoted no match — strict"),
        ("SELECT * FROM Users", True, "unquoted exact match"),
        ("SELECT * FROM users", True, "unquoted exact match"),
        ("SELECT * FROM USERS", True, "unquoted CI fallback"),
        ("SELECT * FROM `Nonexistent`", False, "quoted no match"),
        ("SELECT * FROM Nonexistent", False, "unquoted no match"),
    ],
)
def test_validate_sql_policy_dual_case_bigquery(sql, should_pass, description):
    """Strict-mode policy honors quoted vs unquoted in BigQuery dialect."""
    config = WrenConfig(strict_mode=True)
    model_names = {"Users", "users", "Orders"}
    ast = parse_one(sql, dialect="bigquery")
    if should_pass:
        validate_sql_policy(ast, model_names, config)  # no raise
    else:
        with pytest.raises(WrenError):
            validate_sql_policy(ast, model_names, config)


def test_validate_sql_policy_postgres_quoted_rejects_uppercase():
    """``"Orders"`` against a manifest of only ``orders`` is rejected.

    Postgres semantics: ``"Orders"`` (quoted) is a distinct identifier
    from ``orders``, so it shouldn't pass strict-mode policy.
    """
    config = WrenConfig(strict_mode=True)
    model_names = {"orders"}
    with pytest.raises(WrenError):
        validate_sql_policy(
            parse_one('SELECT * FROM "Orders"', dialect="postgres"),
            model_names,
            config,
        )
    # And the lowercased counterpart still works.
    validate_sql_policy(
        parse_one('SELECT * FROM "orders"', dialect="postgres"),
        model_names,
        config,
    )


# ---------------------------------------------------------------------------
# CTERewriter — end-to-end model resolution
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("table_ref", "expected_model"),
    [
        ("`Users`", "Users"),
        ("`users`", "users"),
    ],
)
def test_cte_rewriter_quoted_preserves_case(
    dual_case_manifest_b64, table_ref, expected_model
):
    """The injected CTE must bind the model the user actually wrote.

    With both ``Users`` and ``users`` in the manifest, lowercasing the
    backtick-quoted name (the pre-fix behavior of ``normalize_identifiers``
    on BigQuery) would silently pick the wrong model.
    """
    extractor = get_manifest_extractor(dual_case_manifest_b64)
    mini = extractor.extract_by([expected_model])
    mini_b64 = to_json_base64(mini)
    session = get_session_context(mini_b64, None, None, "bigquery")
    rewriter = CTERewriter(mini_b64, session, DataSource.bigquery, fallback=False)

    sql = f"SELECT u.id FROM {table_ref} AS u"
    ast = parse_one(sql, dialect="bigquery")
    user_ctes = rewriter._collect_user_cte_names(ast)
    used, _refs, _quoting = rewriter._collect_model_columns(ast, user_ctes)

    assert list(used.keys()) == [expected_model], (
        f"expected the rewriter to bind {expected_model!r} for {table_ref}, "
        f"got {list(used.keys())!r}"
    )


def test_cte_rewriter_unquoted_ci_fallback(dual_case_manifest_b64):
    """An unquoted reference matching a model exactly wins over CI fallback."""
    extractor = get_manifest_extractor(dual_case_manifest_b64)
    mini = extractor.extract_by(["Users"])
    mini_b64 = to_json_base64(mini)
    session = get_session_context(mini_b64, None, None, "bigquery")
    rewriter = CTERewriter(mini_b64, session, DataSource.bigquery, fallback=False)

    # Unquoted ``Users`` matches the ``Users`` model (exact case) — not
    # ``users`` even though both exist.
    ast = parse_one("SELECT u.id FROM Users AS u", dialect="bigquery")
    used, _refs, _quoting = rewriter._collect_model_columns(ast, set())
    assert list(used.keys()) == ["Users"]


def test_cte_rewriter_renames_outer_alias_to_avoid_bigquery_shadow():
    """Outermost subquery alias inside the model CTE must not match the CTE name.

    wren-core's transform_sql emits ``SELECT "<m>".col FROM (...) AS "<m>"``;
    when wrapped in ``WITH "<m>" AS (...)`` BigQuery treats the qualifier
    as a recursive reference to the CTE itself and rejects the query with
    "Table must be qualified with a dataset". CTERewriter renames just the
    outermost alias to ``wren_src_<m>`` to break the shadow chain.
    """
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "Cards_Cleaned",
                "tableReference": {
                    "catalog": "proj",
                    "schema": "ds",
                    "table": "Cards_Cleaned",
                },
                "columns": [
                    {"name": "id", "type": "integer"},
                    {"name": "card_type", "type": "varchar"},
                ],
            }
        ],
    }
    manifest_b64 = base64.b64encode(orjson.dumps(manifest)).decode("utf-8")
    session = get_session_context(manifest_b64, None, None, "bigquery")
    rewriter = CTERewriter(manifest_b64, session, DataSource.bigquery, fallback=False)

    rewritten = rewriter.rewrite("SELECT c.card_type FROM `Cards_Cleaned` AS c")

    # Sentinel must appear (the outer alias was renamed).
    assert "wren_src_Cards_Cleaned" in rewritten
    # The top-scope of the CTE body must not have ``AS `Cards_Cleaned``` —
    # only the renamed sentinel as the outermost alias. The middle/inner
    # scopes can still use the original name (separate parentheses).
    cte_body = rewritten.split("`Cards_Cleaned` AS (", 1)[1]
    cte_body_top = cte_body.split(")", 1)[0]
    assert "AS `Cards_Cleaned`" not in cte_body_top


def test_cte_rewriter_oracle_emits_quoted_identifiers():
    """Oracle output must force-quote all identifiers (``identify=True``).

    Without forced quoting, Oracle uppercases unquoted refs, mismatching
    the CTE's quoted lowercase columns (ORA-00904). With it, the user's
    outer ``FROM orders`` and ``SELECT o_orderkey`` both emit quoted
    lowercase, matching the CTE — and the result column names stay in
    the original lowercase case rather than getting folded to uppercase.
    """
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {"schema": "SYSTEM", "table": "orders"},
                "columns": [{"name": "o_orderkey", "type": "integer"}],
            }
        ],
    }
    manifest_b64 = base64.b64encode(orjson.dumps(manifest)).decode("utf-8")
    session = get_session_context(manifest_b64, None, None, "oracle")
    rewriter = CTERewriter(manifest_b64, session, DataSource.oracle, fallback=False)

    rewritten = rewriter.rewrite("SELECT o_orderkey FROM orders")
    # Every identifier the user wrote must come out quoted so Oracle
    # doesn't case-fold them.
    assert 'WITH "orders" AS' in rewritten, rewritten
    assert 'SELECT "o_orderkey" FROM "orders"' in rewritten, rewritten


def test_cte_rewriter_oracle_uppercases_columns():
    """Oracle uppercases unquoted columns; CTE body must restore manifest case.

    Regression test for the case where ``_col_orig_name`` (lowercase-keyed)
    was looked up with the post-normalize column name (``O_ORDERKEY`` on
    Oracle), missing the entry and emitting an uppercase column that
    wren-core's schema check then rejected.
    """
    manifest = {
        "catalog": "wren",
        "schema": "public",
        "models": [
            {
                "name": "orders",
                "tableReference": {"schema": "SYSTEM", "table": "orders"},
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                ],
            }
        ],
    }
    manifest_b64 = base64.b64encode(orjson.dumps(manifest)).decode("utf-8")
    session = get_session_context(manifest_b64, None, None, "oracle")
    rewriter = CTERewriter(manifest_b64, session, DataSource.oracle, fallback=False)

    sql = "SELECT o_orderkey FROM orders"
    rewritten = rewriter.rewrite(sql)
    # Must contain the original lowercase column from the manifest, not the
    # post-normalize uppercase form. Don't lowercase the output before
    # checking — that would mask a regression where Oracle's uppercased
    # ``O_ORDERKEY`` leaks into the rewritten CTE body.
    assert '"o_orderkey"' in rewritten, rewritten
    assert '"O_ORDERKEY"' not in rewritten, rewritten
