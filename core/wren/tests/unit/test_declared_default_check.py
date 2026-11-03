"""The declared-default checker over parsed SQL: pure functions, no engine."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from sqlglot import parse_one

from wren.context import build_json
from wren.declared_default_check import DefaultsChecker, _Statement
from wren.declared_defaults import read_declared_defaults

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"
EXCLUDE = "exclude-test-accounts"
RATE = "usd-at-transaction-date"
JOIN = "orders o JOIN customers c ON o.customer_id = c.id"
COUNT = f"SELECT COUNT(*) FROM {JOIN}"
CHARGES = (
    "payments p JOIN orders o ON p.order_id = o.id "
    "JOIN customers c ON o.customer_id = c.id"
)


def make_checker(dialect="duckdb"):
    manifest = build_json(FIXTURE)
    return DefaultsChecker(read_declared_defaults(FIXTURE, manifest), manifest, dialect)


@pytest.fixture(scope="module")
def checker():
    return make_checker()


def check(checker, sql, dialect="duckdb"):
    return checker.check(parse_one(sql, dialect=dialect))


# -- exclude_rows: every recognised exclusion atom ---------------------------

ATOMS = {
    "not": "NOT c.is_test",
    "equals false": "c.is_test = FALSE",
    "false equals": "FALSE = c.is_test",
    "is false": "c.is_test IS FALSE",
    "is not true": "c.is_test IS NOT TRUE",
    "is distinct from true": "c.is_test IS DISTINCT FROM TRUE",
    "not equal true": "c.is_test <> TRUE",
    "not equals true": "NOT (c.is_test = TRUE)",
    "coalesce": "COALESCE(c.is_test, FALSE) = FALSE",
    "false or null": "(c.is_test = FALSE OR c.is_test IS NULL)",
    "null or false": "(c.is_test IS NULL OR NOT c.is_test)",
    "parenthesised conjunct": "((c.country = 'US') AND (NOT c.is_test))",
}


@pytest.mark.parametrize("atom", ATOMS.values(), ids=ATOMS.keys())
def test_each_recognised_atom_satisfies_the_rule(checker, atom):
    assert check(checker, f"{COUNT} WHERE {atom}") == []


def test_a_query_without_the_atom_fires(checker):
    assert check(checker, f"{COUNT}") == [EXCLUDE]


def test_the_atom_may_live_in_a_join_condition_or_having(checker):
    assert (
        check(
            checker,
            "SELECT COUNT(*) FROM orders o JOIN customers c "
            "ON o.customer_id = c.id AND NOT c.is_test",
        )
        == []
    )
    assert (
        check(
            checker,
            f"SELECT c.country, COUNT(*) FROM {JOIN} "
            "GROUP BY c.country, c.is_test HAVING NOT c.is_test",
        )
        == []
    )


def test_anti_joins_on_the_flag_satisfy_the_rule(checker):
    assert (
        check(
            checker,
            "SELECT COUNT(*) FROM orders o WHERE NOT EXISTS "
            "(SELECT 1 FROM customers c WHERE c.id = o.customer_id AND c.is_test = TRUE)",
        )
        == []
    )
    assert (
        check(
            checker,
            "SELECT COUNT(*) FROM orders o WHERE o.customer_id NOT IN "
            "(SELECT id FROM customers WHERE is_test = TRUE)",
        )
        == []
    )


NOT_IN_MISSES = {
    "outer column is not the flagged key": "SELECT COUNT(*) FROM orders o WHERE o.id NOT IN "
    "(SELECT id FROM customers WHERE is_test = TRUE)",
    "subquery selects a non-key column": "SELECT COUNT(*) FROM orders o WHERE o.customer_id NOT IN "
    "(SELECT country FROM customers WHERE is_test = TRUE)",
    "outer side is computed": "SELECT COUNT(*) FROM orders o WHERE o.customer_id + 0 NOT IN "
    "(SELECT id FROM customers WHERE is_test = TRUE)",
}


@pytest.mark.parametrize("sql", NOT_IN_MISSES.values(), ids=NOT_IN_MISSES.keys())
def test_cr5_not_in_counts_only_when_the_outer_column_is_the_flagged_key(checker, sql):
    assert check(checker, sql) == [EXCLUDE]


def test_cr5_not_in_over_the_flagged_model_itself_still_satisfies_the_rule(checker):
    assert (
        check(
            checker,
            "SELECT COUNT(*) FROM customers c WHERE c.id NOT IN "
            "(SELECT id FROM customers WHERE is_test = TRUE)",
        )
        == []
    )


CTE_ACTIVE = "WITH active AS (SELECT id FROM customers WHERE NOT is_test) "
CR6_MISSES = {
    "uncorrelated exists over a filtering cte": f"{CTE_ACTIVE}"
    "SELECT COUNT(*) FROM customers WHERE EXISTS (SELECT 1 FROM active)",
    "uncorrelated exists with its own filter": "SELECT COUNT(*) FROM customers "
    "WHERE EXISTS (SELECT 1 FROM customers x WHERE NOT x.is_test)",
    "scalar subquery with its own filter": "SELECT COUNT(*) FROM customers WHERE id = "
    "(SELECT MIN(id) FROM customers WHERE NOT is_test)",
    "a sibling set-operation branch": "SELECT COUNT(*) FROM customers UNION ALL "
    "SELECT COUNT(*) FROM customers WHERE NOT is_test",
    "cte read only inside a negated predicate": f"{CTE_ACTIVE}"
    "SELECT COUNT(*) FROM customers WHERE NOT EXISTS (SELECT 1 FROM active a WHERE a.id = 0)",
}


@pytest.mark.parametrize("sql", CR6_MISSES.values(), ids=CR6_MISSES.keys())
def test_cr6_a_filter_off_the_outer_read_does_not_satisfy_the_rule(checker, sql):
    assert check(checker, sql) == [EXCLUDE]


CR6_HITS = {
    "the cte is the source": f"{CTE_ACTIVE}SELECT COUNT(*) FROM active",
    "in over a filtering cte": f"{CTE_ACTIVE}"
    "SELECT COUNT(*) FROM orders o WHERE o.customer_id IN (SELECT id FROM active)",
    "correlated exists over a filtering cte": f"{CTE_ACTIVE}"
    "SELECT COUNT(*) FROM orders o WHERE EXISTS (SELECT 1 FROM active a WHERE a.id = o.customer_id)",
    "a derived source": "SELECT COUNT(*) FROM orders o JOIN "
    "(SELECT id FROM customers WHERE NOT is_test) d ON o.customer_id = d.id",
}


@pytest.mark.parametrize("sql", CR6_HITS.values(), ids=CR6_HITS.keys())
def test_cr6_a_filter_on_a_row_source_of_the_outer_read_still_counts(checker, sql):
    assert check(checker, sql) == []


NEAR_MISSES = {
    "not null only": "c.is_test IS NOT NULL",
    "is not false keeps test rows": "c.is_test IS NOT FALSE",
    "or with another column": "(c.is_test = FALSE OR c.country = 'US')",
    "unrelated column": "c.country = 'US'",
    "another model's flag-shaped column": "o.status = 'done'",
    "not exists with no flag": "NOT EXISTS (SELECT 1 FROM customers x WHERE x.id = o.customer_id)",
}


@pytest.mark.parametrize("atom", NEAR_MISSES.values(), ids=NEAR_MISSES.keys())
def test_an_atom_outside_the_closed_list_fires(checker, atom):
    assert check(checker, f"{COUNT} WHERE {atom}") == [EXCLUDE]


def test_a_flag_in_a_projection_alone_does_not_satisfy_the_rule(checker):
    sql = f"WITH x AS (SELECT c.is_test AS t, o.id FROM {JOIN}) SELECT COUNT(*) FROM x"
    assert check(checker, sql) == [EXCLUDE]


# -- lineage: origins through CTE, derived and correlated scopes ------------


def test_the_atom_is_found_through_a_cte_projection(checker):
    sql = (
        "WITH cc AS (SELECT id, is_test AS t FROM customers) "
        "SELECT COUNT(*) FROM orders o JOIN cc ON o.customer_id = cc.id "
        "WHERE cc.t IS NOT TRUE"
    )
    assert check(checker, sql) == []


def test_the_atom_is_found_through_a_derived_table_and_nested_ctes(checker):
    derived = (
        "SELECT COUNT(*) FROM orders o JOIN "
        "(SELECT id AS cid, is_test AS flag FROM customers) d ON o.customer_id = d.cid "
        "WHERE NOT d.flag"
    )
    assert check(checker, derived) == []
    nested = (
        "WITH a AS (SELECT id, is_test FROM customers), "
        "b AS (SELECT id, is_test AS deep FROM a) "
        "SELECT COUNT(*) FROM orders o JOIN b ON o.customer_id = b.id WHERE NOT b.deep"
    )
    assert check(checker, nested) == []


def test_the_atom_is_found_in_a_correlated_subquery(checker):
    sql = (
        "SELECT COUNT(*) FROM orders o WHERE EXISTS "
        "(SELECT 1 FROM customers c WHERE c.id = o.customer_id AND NOT c.is_test)"
    )
    assert check(checker, sql) == []


def test_a_cte_shadowing_a_covered_model_still_reads_the_base_table(checker):
    assert check(
        checker,
        "WITH customers AS (SELECT * FROM customers) SELECT COUNT(*) FROM customers",
    ) == [EXCLUDE]
    assert check(
        checker,
        "WITH orders AS (SELECT id, customer_id FROM orders) "
        "SELECT COUNT(*) FROM orders",
    ) == [EXCLUDE]


def test_a_cte_named_like_a_covered_model_but_built_elsewhere_reads_none(checker):
    sql = "WITH orders AS (SELECT id, name FROM products) SELECT COUNT(*) FROM orders"
    assert check(checker, sql) == []


def test_a_computed_projection_is_not_a_direct_origin(checker):
    sql = (
        "WITH cc AS (SELECT id, NOT is_test AS ok FROM customers) "
        "SELECT COUNT(*) FROM orders o JOIN cc ON o.customer_id = cc.id WHERE cc.ok"
    )
    assert check(checker, sql) == [EXCLUDE]


def test_union_branches_must_agree_on_the_origin(checker):
    agree = (
        "WITH u AS (SELECT id, is_test AS f FROM customers "
        "UNION ALL SELECT id, is_test AS f FROM customers) "
        "SELECT COUNT(*) FROM orders o JOIN u ON o.customer_id = u.id WHERE NOT u.f"
    )
    assert check(checker, agree) == []
    disagree = (
        "WITH u AS (SELECT id, is_test AS f FROM customers "
        "UNION ALL SELECT id, country = 'US' AS f FROM customers) "
        "SELECT COUNT(*) FROM orders o JOIN u ON o.customer_id = u.id WHERE NOT u.f"
    )
    assert check(checker, disagree) == [EXCLUDE]


def test_a_same_named_column_of_another_model_is_not_the_flag(checker):
    sql = "SELECT COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id WHERE NOT o.legacy_ord_id"
    assert check(checker, sql) == [EXCLUDE]


# -- covered models, when ----------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(*) FROM returns",
        "SELECT COUNT(*) FROM order_items",
        "SELECT SUM(quantity) FROM order_items oi JOIN orders o ON oi.order_id = o.id",
    ],
)
def test_every_model_reaching_the_anchor_is_covered(checker, sql):
    assert check(checker, sql) == [EXCLUDE]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(*) FROM products",
        "SELECT SUM(amount) FROM legacy_orders",
        "SELECT COUNT(*) FROM fx_rates",
    ],
)
def test_a_statement_reading_no_covered_model_does_not_fire(checker, sql):
    assert check(checker, sql) == []


def test_a_covered_model_hidden_in_a_cte_or_subquery_is_still_read(checker):
    assert check(
        checker, "WITH x AS (SELECT id FROM orders) SELECT COUNT(*) FROM x"
    ) == [EXCLUDE]
    assert check(
        checker,
        "SELECT COUNT(*) FROM products p WHERE p.id IN (SELECT product_id FROM order_items)",
    ) == [EXCLUDE]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM customers LIMIT 5",
        "SELECT o.id, o.status FROM orders o ORDER BY o.id LIMIT 10",
        "SELECT DISTINCT status FROM orders",
    ],
)
def test_when_aggregated_keeps_exploration_probes_out(checker, sql):
    assert check(checker, sql) == []


@pytest.mark.parametrize(
    ("sql", "fired"),
    [
        ("SELECT COUNT(*) FROM orders", [EXCLUDE]),
        ("SELECT status, COUNT(1) FROM orders GROUP BY status", [EXCLUDE]),
        ("SELECT status FROM orders GROUP BY status", [EXCLUDE]),
        (
            "SELECT status, SUM(order_total) OVER (PARTITION BY status) FROM orders",
            [RATE, EXCLUDE],
        ),
    ],
)
def test_aggregate_group_by_and_window_aggregates_count_as_aggregated(
    checker, sql, fired
):
    assert check(checker, sql) == fired


# -- unless facts ------------------------------------------------------------


def test_addresses_column_by_selecting_the_flag(checker):
    assert check(checker, f"{COUNT} WHERE c.is_test") == []
    assert check(checker, f"{COUNT} WHERE c.is_test = TRUE") == []
    assert check(checker, f"{COUNT} WHERE c.is_test IS TRUE") == []


def test_addresses_column_by_grouping_or_aggregating_it(checker):
    assert (
        check(checker, f"SELECT c.is_test, COUNT(*) FROM {JOIN} GROUP BY c.is_test")
        == []
    )
    assert (
        check(checker, f"SELECT SUM(CASE WHEN c.is_test THEN 1 ELSE 0 END) FROM {JOIN}")
        == []
    )
    through_cte = (
        f"WITH x AS (SELECT o.id, c.is_test AS t FROM {JOIN}) "
        "SELECT COUNT(CASE WHEN t THEN 1 END) FROM x"
    )
    assert check(checker, through_cte) == []


def test_filtered_by_matches_structurally_after_origin_normalisation(checker):
    base = "SELECT COUNT(*) FROM orders"
    assert check(checker, f"{base} WHERE legacy_ord_id IS NOT NULL") == []
    assert check(checker, f"{base} o WHERE NOT o.legacy_ord_id IS NULL") == []
    assert (
        check(
            checker,
            f"{base} x JOIN customers c ON x.customer_id = c.id WHERE x.legacy_ord_id IS NOT NULL",
        )
        == []
    )
    # the opposite atom is not the exemption
    assert check(checker, f"{base} WHERE legacy_ord_id IS NULL") == [EXCLUDE]
    assert check(checker, f"{base} WHERE legacy_ord_id > 0") == [EXCLUDE]


# -- unanalyzable SQL: no verdict -------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT COUNT(nope) FROM orders",
        "SELECT x.id FROM orders o",
        "SELECT id FROM orders o JOIN payments p ON p.order_id = o.id",
        "DROP TABLE orders",
        "INSERT INTO orders (id) VALUES (1)",
    ],
)
def test_sql_that_cannot_be_qualified_earns_no_verdict(checker, sql):
    assert check(checker, sql) is None


def test_a_checker_without_rules_never_has_a_verdict(checker):
    empty = DefaultsChecker([], build_json(FIXTURE), "duckdb")
    assert empty.check(parse_one("SELECT COUNT(nope) FROM orders")) == []


def test_checking_does_not_mutate_the_parsed_statement(checker):
    ast = parse_one(f"{COUNT} WHERE c.is_test = FALSE", dialect="duckdb")
    before = ast.sql()
    assert checker.check(ast) == []
    assert ast.sql() == before


def test_identifier_case_follows_the_dialect():
    snowflake = make_checker("snowflake")
    sql = f"{COUNT} WHERE NOT C.IS_TEST"
    assert snowflake.check(parse_one(sql, dialect="snowflake")) == []
    assert snowflake.check(parse_one(COUNT, dialect="snowflake")) == [EXCLUDE]


LEFT_JOINED = (
    "SELECT COUNT(*) FROM orders o LEFT JOIN customers c "
    "ON c.id = o.customer_id WHERE {atom}"
)
NULL_TOLERANT = {
    "key is null first": "(c.id IS NULL OR c.is_test = FALSE)",
    "key is null last": "(c.is_test = FALSE OR c.id IS NULL)",
    "unparenthesised": "c.id IS NULL OR NOT c.is_test",
    "another column of the flag's model": "c.country IS NULL OR c.is_test = FALSE",
}


@pytest.mark.parametrize("atom", NULL_TOLERANT.values(), ids=NULL_TOLERANT.keys())
def test_a_left_join_that_keeps_rows_without_a_customer_satisfies_the_rule(
    checker, atom
):
    assert check(checker, LEFT_JOINED.format(atom=atom)) == []


NULL_TOLERANT_MISSES = {
    "is null on another model": "(o.id IS NULL OR c.is_test = FALSE)",
    "another model's column in a null-check": "(o.customer_id IS NULL OR c.is_test = FALSE)",
    "non-null disjunct": "(c.is_test = FALSE OR c.country = 'US')",
    "is not null": "(c.id IS NOT NULL OR c.is_test = FALSE)",
    "null-check alone": "c.id IS NULL",
}


@pytest.mark.parametrize(
    "atom", NULL_TOLERANT_MISSES.values(), ids=NULL_TOLERANT_MISSES.keys()
)
def test_a_null_tolerant_exclusion_must_stay_on_the_flags_model(checker, atom):
    assert check(checker, LEFT_JOINED.format(atom=atom)) == [EXCLUDE]


def on_clause(shape, atom="NOT c.is_test"):
    return {
        "left_preserved": f"SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id AND {atom}",
        "left_nullable": f"SELECT COUNT(*) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id AND {atom}",
        "right_preserved": f"SELECT COUNT(*) FROM orders o RIGHT JOIN customers c ON o.customer_id = c.id AND {atom}",
        "right_nullable": f"SELECT COUNT(*) FROM customers c RIGHT JOIN orders o ON o.customer_id = c.id AND {atom}",
        "full": f"SELECT COUNT(*) FROM orders o FULL JOIN customers c ON o.customer_id = c.id AND {atom}",
        "inner": f"SELECT COUNT(*) FROM orders o INNER JOIN customers c ON o.customer_id = c.id AND {atom}",
        "where": f"SELECT COUNT(*) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE {atom}",
    }[shape]


@pytest.mark.parametrize("shape", ["left_preserved", "right_preserved", "full"])
def test_an_exclusion_in_the_on_of_an_outer_join_filters_nothing_on_a_preserved_side(
    checker, shape
):
    assert check(checker, on_clause(shape)) == [EXCLUDE]


@pytest.mark.parametrize("shape", ["inner", "where"])
def test_an_exclusion_in_where_or_an_inner_join_counts(checker, shape):
    assert check(checker, on_clause(shape)) == []


@pytest.mark.parametrize("shape", ["left_nullable", "right_nullable"])
def test_an_exclusion_in_the_on_of_an_outer_join_never_counts_even_on_the_nullable_side(
    checker, shape
):
    assert check(checker, on_clause(shape)) == [EXCLUDE]


@pytest.mark.parametrize(
    "join",
    [
        "customers c ANTI JOIN orders o ON o.customer_id = c.id AND NOT c.is_test",
        "customers c SEMI JOIN orders o ON o.customer_id = c.id AND NOT c.is_test",
        "orders o RIGHT JOIN (customers c JOIN customers d ON d.id = c.id) "
        "ON c.id = o.customer_id AND NOT c.is_test",
        "customers c LEFT JOIN (orders o JOIN customers d ON d.id = o.customer_id) "
        "ON o.customer_id = c.id AND NOT c.is_test",
    ],
    ids=["anti", "semi", "right-group", "left-group"],
)
def test_an_exclusion_in_a_bare_semi_anti_or_grouped_join_on_filters_nothing(
    checker, join
):
    assert check(checker, f"SELECT COUNT(*) FROM {join}") == [EXCLUDE]


def test_the_on_clause_of_a_join_still_carries_the_rate_join_whatever_its_side(checker):
    sql = (
        "SELECT SUM(p.amount * f.rate_to_usd) FROM "
        + CHARGES
        + " LEFT JOIN fx_rates f "
        "ON f.currency = p.currency AND f.date <= CAST(p.captured_at AS DATE) "
        "WHERE NOT c.is_test"
    )
    assert check(checker, sql) == []


# -- require_rate_join -------------------------------------------------------

RATED = (
    "SELECT SUM(p.amount * f.rate_to_usd) FROM " + CHARGES + " JOIN fx_rates f "
    "ON f.currency = p.currency AND {date} WHERE NOT c.is_test"
)
DATES = {
    "correlated max": "f.date = (SELECT MAX(x.date) FROM fx_rates x WHERE x.currency = p.currency AND x.date <= CAST(p.captured_at AS DATE))",
    "on or before": "f.date <= CAST(p.captured_at AS DATE)",
    "reversed": "CAST(p.captured_at AS DATE) >= f.date",
    "order date": "f.date <= CAST(o.placed_at AS DATE)",
    "between with a declared upper bound": "f.date BETWEEN CAST(p.captured_at AS DATE) - INTERVAL 7 DAY AND CAST(p.captured_at AS DATE)",
}


@pytest.mark.parametrize("date", DATES.values(), ids=DATES.keys())
def test_a_rate_join_bounded_on_or_before_a_declared_date_satisfies_the_rule(
    checker, date
):
    assert check(checker, RATED.format(date=date)) == []


FX_BAD_DATES = {
    "same day": "f.date = CAST(p.captured_at AS DATE)",
    "latest rate": "f.date = (SELECT MAX(date) FROM fx_rates)",
    "strictly before": "f.date < CAST(p.captured_at AS DATE)",
    "bounded by today": "f.date <= CURRENT_DATE",
    "bounded by an undeclared column": "f.date <= CAST(c.created_at AS DATE)",
    "between whose upper bound is not a declared date": "f.date BETWEEN CAST(p.captured_at AS DATE) AND CURRENT_DATE",
    "between literals": "f.date BETWEEN DATE '2020-01-01' AND DATE '2030-01-01'",
}


@pytest.mark.parametrize("date", FX_BAD_DATES.values(), ids=FX_BAD_DATES.keys())
def test_a_rate_join_outside_the_declared_shape_fires(checker, date):
    assert check(checker, RATED.format(date=date)) == [RATE]


CAST_DATES = {
    "cast to date": "CAST(f.date AS DATE) <= p.captured_at",
    "double colon date": "f.date::date <= p.captured_at",
    "double colon timestamp": "f.date::timestamp <= p.captured_at",
    "cast to timestamp": "CAST(f.date AS TIMESTAMP) <= p.captured_at",
    "reversed": "p.captured_at >= f.date::date",
    "between": "f.date::date BETWEEN CAST(p.captured_at AS DATE) - INTERVAL 7 DAY AND CAST(p.captured_at AS DATE)",
    "cast on both sides": "CAST(f.date AS DATE) <= CAST(p.captured_at AS DATE)",
    "cast in the as-of subquery": "f.date = (SELECT MAX(x.date) FROM fx_rates x WHERE x.currency = p.currency AND x.date::date <= p.captured_at)",
}


@pytest.mark.parametrize("date", CAST_DATES.values(), ids=CAST_DATES.keys())
def test_a_temporal_cast_on_the_rate_date_still_bounds_the_rate(checker, date):
    assert check(checker, RATED.format(date=date)) == []


NON_TEMPORAL_CAST_DATES = {
    "cast to varchar": "CAST(f.date AS VARCHAR) <= p.captured_at",
    "double colon varchar": "f.date::varchar <= p.captured_at",
    "cast to integer": "CAST(f.date AS INTEGER) <= p.captured_at",
    "varchar between": "CAST(f.date AS VARCHAR) BETWEEN '2020-01-01' AND p.captured_at",
    "varchar in the as-of subquery": "f.date = (SELECT MAX(x.date) FROM fx_rates x WHERE x.currency = p.currency AND CAST(x.date AS VARCHAR) <= p.captured_at)",
}


@pytest.mark.parametrize(
    "date", NON_TEMPORAL_CAST_DATES.values(), ids=NON_TEMPORAL_CAST_DATES.keys()
)
def test_a_non_temporal_cast_on_the_rate_date_does_not_bound_the_rate(checker, date):
    assert check(checker, RATED.format(date=date)) == [RATE]


def test_a_missing_rate_join_fires(checker):
    sql = f"SELECT SUM(p.amount) FROM {CHARGES} WHERE NOT c.is_test"
    assert check(checker, sql) == [RATE]


def test_the_rate_must_be_joined_on_a_declared_currency(checker):
    sql = (
        f"SELECT SUM(p.amount * f.rate_to_usd) FROM {CHARGES} JOIN fx_rates f "
        "ON f.currency = c.country AND f.date <= p.captured_at WHERE NOT c.is_test"
    )
    assert check(checker, sql) == [RATE]


def test_a_hard_coded_rate_currency_does_not_satisfy_the_rule(checker):
    sql = (
        f"SELECT SUM(p.amount * f.rate_to_usd) FROM {CHARGES} JOIN fx_rates f "
        "ON f.currency = 'EUR' AND f.date <= p.captured_at WHERE NOT c.is_test"
    )
    assert check(checker, sql) == [RATE]


def test_lateral_asof_and_cte_conversions_are_recognised(checker):
    lateral = (
        f"SELECT SUM(p.amount * f.rate_to_usd) FROM {CHARGES} JOIN LATERAL "
        "(SELECT rate_to_usd FROM fx_rates x WHERE x.currency = p.currency "
        "AND x.date <= p.captured_at ORDER BY x.date DESC LIMIT 1) f ON TRUE "
        "WHERE NOT c.is_test"
    )
    assert check(checker, lateral) == []
    asof = (
        "SELECT SUM(p.amount * f.rate_to_usd) FROM payments p "
        "ASOF JOIN fx_rates f ON p.currency = f.currency AND p.captured_at >= f.date "
        "JOIN orders o ON p.order_id = o.id JOIN customers c ON o.customer_id = c.id "
        "WHERE NOT c.is_test"
    )
    assert check(checker, asof) == []
    in_cte = (
        "WITH conv AS (SELECT p.order_id, p.amount * f.rate_to_usd AS usd "
        "FROM payments p JOIN fx_rates f ON f.currency = p.currency "
        "AND f.date <= p.captured_at) "
        "SELECT SUM(usd) FROM conv JOIN orders o ON conv.order_id = o.id "
        "JOIN customers c ON o.customer_id = c.id WHERE NOT c.is_test"
    )
    assert check(checker, in_cte) == []


def test_an_amount_aggregated_through_a_cte_is_still_governed(checker):
    sql = (
        "WITH t AS (SELECT o.id, o.order_total * 2 AS doubled FROM orders o "
        "JOIN customers c ON o.customer_id = c.id WHERE NOT c.is_test) "
        "SELECT SUM(doubled) FROM t"
    )
    assert check(checker, sql) == [RATE]


def test_a_conversion_hidden_in_a_cte_without_a_date_bound_fires(checker):
    sql = (
        "WITH conv AS (SELECT p.order_id, p.amount * f.rate_to_usd AS usd "
        "FROM payments p JOIN fx_rates f ON f.currency = p.currency) "
        "SELECT SUM(usd) FROM conv JOIN orders o ON conv.order_id = o.id "
        "JOIN customers c ON o.customer_id = c.id WHERE NOT c.is_test"
    )
    assert check(checker, sql) == [RATE]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT p.currency, SUM(p.amount) FROM {c} WHERE NOT c.is_test GROUP BY p.currency",
        "SELECT SUM(p.amount) FROM {c} WHERE NOT c.is_test AND p.currency = 'USD'",
        "SELECT SUM(p.amount) FROM {c} WHERE NOT c.is_test AND p.currency IN ('EUR', 'GBP')",
    ],
    ids=["groups by currency", "currency literal", "currency literal list"],
)
def test_per_currency_and_single_currency_queries_are_exempt(checker, sql):
    assert check(checker, sql.format(c=CHARGES)) == []


def test_a_non_literal_currency_filter_is_not_an_exemption(checker):
    sql = f"SELECT SUM(p.amount) FROM {CHARGES} WHERE NOT c.is_test AND p.currency = o.currency"
    assert check(checker, sql) == [RATE]


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT p.amount, p.currency FROM payments p LIMIT 5",
        "SELECT COUNT(*) FROM payments p JOIN orders o ON p.order_id = o.id JOIN customers c ON o.customer_id = c.id WHERE NOT c.is_test",
        "SELECT MAX(p.captured_at) FROM payments p JOIN orders o ON p.order_id = o.id JOIN customers c ON o.customer_id = c.id WHERE NOT c.is_test",
    ],
)
def test_without_an_aggregated_amount_the_rate_rule_does_not_fire(checker, sql):
    assert check(checker, sql) == []


def test_both_rules_fire_in_declaration_order(checker):
    assert check(checker, "SELECT SUM(p.amount) FROM payments p") == [RATE, EXCLUDE]


@pytest.mark.parametrize("fault", [RuntimeError, ValueError, KeyError, AttributeError])
@pytest.mark.parametrize("method", ["fires_exclude", "fires_rate"])
def test_any_checker_fault_earns_no_verdict(checker, monkeypatch, method, fault):
    monkeypatch.setattr(_Statement, method, MagicMock(side_effect=fault("boom")))
    assert check(checker, f"{COUNT}") is None
