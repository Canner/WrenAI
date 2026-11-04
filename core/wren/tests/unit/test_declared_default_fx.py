"""Single-match, base-currency survival and rule applicability: pure AST, no engine."""

from dataclasses import replace
from pathlib import Path

import pytest
from sqlglot import exp, parse_one

from wren.context import build_json
from wren.declared_default_check import DefaultsChecker
from wren.declared_default_fx import evaluate
from wren.declared_default_status import fold_all
from wren.declared_defaults import (
    ColumnRef,
    RequireRateJoin,
    SaleStatuses,
    read_declared_defaults,
)

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"
RATE = "usd-at-transaction-date"
EXCLUDE = "exclude-test-accounts"
CHARGES = "payments p JOIN orders o ON p.order_id = o.id JOIN customers c ON o.customer_id = c.id"
ON = "f.currency = p.currency AND p.captured_at >= f.date"


def declared():
    manifest = build_json(FIXTURE)
    return manifest, list(read_declared_defaults(FIXTURE, manifest))


def make_checker(both=False, **changes):
    """The fixture's rate rule (its ``unless`` flags off, ``changes`` applied); with ``both``
    also its exclusion rule."""
    manifest, rules = declared()
    rules = [
        replace(r, groups_by_currency=False, filters_currency_literal=False, **changes)
        if isinstance(r, RequireRateJoin)
        else r
        for r in rules
        if both or isinstance(r, RequireRateJoin)
    ]
    return DefaultsChecker(rules, manifest, "duckdb")


@pytest.fixture(scope="module")
def strict():
    return make_checker(base_currency="USD", match="single")


@pytest.fixture(scope="module")
def both():
    return make_checker(both=True, base_currency="USD", match="single")


def verdict(checker, sql):
    result = evaluate(checker, parse_one(sql, dialect="duckdb"))
    assert result is not None, sql
    return result


def violations(checker, sql):
    return list(verdict(checker, sql).violations)


def conv(select, tail=""):
    return f"SELECT {select} FROM {tail}"


# -- the four counter-examples of the plan -----------------------------------

MULTI = (
    "SELECT SUM(p.amount * f.rate_to_usd) FROM payments p JOIN fx_rates f "
    "ON f.currency = p.currency AND f.date <= p.captured_at WHERE 1 = 1"
)
INNER_ASOF = (
    f"SELECT SUM(p.amount * f.rate_to_usd) FROM payments p ASOF JOIN fx_rates f ON {ON}"
)
COALESCED = f"SELECT SUM(p.amount * COALESCE(f.rate_to_usd, 1)) FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
BASE_ONLY = (
    "SELECT SUM(CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * f.rate_to_usd END) "
    f"FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
)


def test_an_ordinary_date_join_can_match_several_rates(strict):
    assert violations(strict, MULTI) == [
        f"{RATE}:rate_multi_match",
        f"{RATE}:base_currency_dropped",
    ]


def test_an_inner_asof_join_is_single_but_drops_the_base_currency(strict):
    assert violations(strict, INNER_ASOF) == [f"{RATE}:base_currency_dropped"]


def test_a_blanket_default_rate_of_one_is_refused(strict):
    assert violations(strict, COALESCED) == [f"{RATE}:rate_default_literal"]


def test_taking_one_only_for_the_base_currency_is_accepted(strict):
    result = verdict(strict, BASE_ONLY)
    assert result.violations == ()
    assert result.checks[RATE] == {"applicable": True, "result": "satisfied"}
    assert result.fx_missing_rate_handling == "guarded_by_base_currency"


# -- how a default can be spelled --------------------------------------------

DEFAULTS = {
    "coalesce": "COALESCE(f.rate_to_usd, 1)",
    "ifnull": "IFNULL(f.rate_to_usd, 1)",
    "nvl-style swap": "COALESCE(1, f.rate_to_usd)",
    "case on null": "CASE WHEN f.rate_to_usd IS NULL THEN 1 ELSE f.rate_to_usd END",
    "decimal literal": "COALESCE(f.rate_to_usd, 1.0)",
    "case on not null": "CASE WHEN f.rate_to_usd IS NOT NULL THEN f.rate_to_usd ELSE 1 END",
    "if on not null": "IF(f.rate_to_usd IS NOT NULL, f.rate_to_usd, 1)",
    "cast function literal": "COALESCE(f.rate_to_usd, CAST(1 AS DOUBLE))",
    "cast operator literal": "COALESCE(f.rate_to_usd, 1::DOUBLE)",
    "cast in case": "CASE WHEN f.rate_to_usd IS NULL THEN CAST(1 AS DOUBLE) ELSE f.rate_to_usd END",
    "cast in inverse case": "CASE WHEN f.rate_to_usd IS NOT NULL THEN f.rate_to_usd ELSE 1::DOUBLE END",
}


@pytest.mark.parametrize("default", DEFAULTS.values(), ids=DEFAULTS.keys())
def test_every_literal_default_of_a_rate_column_is_refused(strict, default):
    sql = f"SELECT SUM(p.amount * {default}) FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
    assert violations(strict, sql) == [f"{RATE}:rate_default_literal"]


GUARDED = {
    "default inside the base branch": "CASE WHEN p.currency = 'USD' THEN p.amount * COALESCE(f.rate_to_usd, 1) ELSE p.amount * f.rate_to_usd END",
    "default in the else of a not-base test": "CASE WHEN p.currency <> 'USD' THEN p.amount * f.rate_to_usd ELSE p.amount * COALESCE(f.rate_to_usd, 1) END",
    "lower-case literal": "CASE WHEN p.currency = 'usd' THEN p.amount ELSE p.amount * f.rate_to_usd END",
    "inverse case inside the base branch": "CASE WHEN p.currency = 'USD' THEN p.amount * (CASE WHEN f.rate_to_usd IS NOT NULL THEN f.rate_to_usd ELSE 1 END) ELSE p.amount * f.rate_to_usd END",
    "inverse case in the else of a not-base test": "CASE WHEN p.currency <> 'USD' THEN p.amount * f.rate_to_usd ELSE p.amount * (CASE WHEN f.rate_to_usd IS NOT NULL THEN f.rate_to_usd ELSE 1 END) END",
    "cast default inside the base branch": "CASE WHEN p.currency = 'USD' THEN p.amount * COALESCE(f.rate_to_usd, CAST(1 AS DOUBLE)) ELSE p.amount * f.rate_to_usd END",
    "cast operator default in the else of a not-base test": "CASE WHEN p.currency <> 'USD' THEN p.amount * f.rate_to_usd ELSE p.amount * COALESCE(f.rate_to_usd, 1::DOUBLE) END",
}


@pytest.mark.parametrize("amount", GUARDED.values(), ids=GUARDED.keys())
def test_a_default_only_the_base_currency_can_reach_is_accepted(strict, amount):
    sql = f"SELECT SUM({amount}) FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
    assert violations(strict, sql) == []


UNGUARDED_BRANCHES = {
    "default in the non-base branch": "CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * COALESCE(f.rate_to_usd, 1) END",
    "default in the then of a not-base test": "CASE WHEN p.currency <> 'USD' THEN p.amount * COALESCE(f.rate_to_usd, 1) ELSE p.amount END",
    "inverse case in the non-base branch": "CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * (CASE WHEN f.rate_to_usd IS NOT NULL THEN f.rate_to_usd ELSE 1 END) END",
    "cast default in the non-base branch": "CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * COALESCE(f.rate_to_usd, CAST(1 AS DOUBLE)) END",
    "guard on another literal": "CASE WHEN p.currency = 'EUR' THEN p.amount * COALESCE(f.rate_to_usd, 1) ELSE p.amount END",
}


@pytest.mark.parametrize(
    "amount", UNGUARDED_BRANCHES.values(), ids=UNGUARDED_BRANCHES.keys()
)
def test_a_default_in_a_branch_other_currencies_reach_is_refused(strict, amount):
    sql = f"SELECT SUM({amount}) FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
    assert violations(strict, sql) == [f"{RATE}:rate_default_literal"]


def test_a_left_join_with_neither_default_nor_guard_passes_and_is_recorded(strict):
    sql = f"SELECT SUM(p.amount * f.rate_to_usd) FROM payments p ASOF LEFT JOIN fx_rates f ON {ON}"
    result = verdict(strict, sql)
    assert result.violations == ()
    assert result.checks[RATE] == {"applicable": True, "result": "satisfied"}
    assert result.fx_missing_rate_handling == "unguarded_left_join"


# -- where a single rate can come from ---------------------------------------

RANKED = (
    "WITH ranked AS (SELECT p.id AS pid, f.rate_to_usd AS rate, "
    "ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY f.date DESC) AS rn "
    "FROM payments p JOIN fx_rates f ON f.currency = p.currency AND f.date <= p.captured_at) "
    "SELECT SUM(CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * r.rate END) "
    "FROM payments p LEFT JOIN ranked r ON r.pid = p.id AND r.rn = {limit}"
)
QUALIFIED = (
    "WITH ranked AS (SELECT p.id AS pid, f.rate_to_usd AS rate FROM payments p "
    "JOIN fx_rates f ON f.currency = p.currency AND f.date <= p.captured_at "
    "QUALIFY ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY f.date {order}) = 1) "
    "SELECT SUM(CASE WHEN p.currency = 'USD' THEN p.amount ELSE p.amount * r.rate END) "
    "FROM payments p LEFT JOIN ranked r ON r.pid = p.id"
)


def test_the_latest_row_per_amount_through_row_number_is_single(strict):
    assert violations(strict, RANKED.format(limit=1)) == []
    assert violations(strict, QUALIFIED.format(order="DESC")) == []


@pytest.mark.parametrize("predicate", ["1 <= r.rn", "r.rn >= 1"])
def test_a_lower_bound_on_row_number_is_not_a_single_match(strict, predicate):
    sql = RANKED.replace("r.rn = {limit}", predicate)
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


@pytest.mark.parametrize(
    "predicate", ["r.rn = 1", "1 = r.rn", "r.rn <= 1", "1 >= r.rn"]
)
def test_single_match_limits_preserve_comparison_direction(strict, predicate):
    assert violations(strict, RANKED.replace("r.rn = {limit}", predicate)) == []


def test_each_partition_key_must_be_fixed_by_the_later_join(strict):
    sql = RANKED.replace("PARTITION BY p.id", "PARTITION BY p.id, f.date")
    assert violations(strict, sql.format(limit=1)) == [f"{RATE}:rate_multi_match"]


def test_an_unrelated_rank_alias_does_not_limit_the_rate(strict):
    sql = RANKED.replace("r.rn = {limit}", "p.id = 1")
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


def test_row_number_that_does_not_keep_the_newest_row_is_not_single(strict):
    # oldest first, and no filter on the row number, are not "the latest rate"
    assert violations(strict, QUALIFIED.format(order="ASC")) == [
        f"{RATE}:rate_multi_match"
    ]
    assert violations(strict, RANKED.format(limit=2)) == [f"{RATE}:rate_multi_match"]


def test_a_row_number_limit_under_or_is_not_single(strict):
    ranked = RANKED.replace("r.rn = {limit}", "{limit}")
    either = "(r.rn = 1 OR p.amount > 100)"
    assert violations(strict, ranked.format(limit=either)) == [
        f"{RATE}:rate_multi_match"
    ]
    both = "(r.rn = 1) AND p.amount > 100"
    assert violations(strict, ranked.format(limit=both)) == []


def test_the_inner_join_inside_a_ranked_source_is_not_the_one_that_drops_rows(strict):
    # the join in the CTE is inner, but the outer LEFT join keeps every payment
    assert f"{RATE}:base_currency_dropped" not in violations(
        strict, QUALIFIED.format(order="DESC")
    )
    inner_outside = QUALIFIED.format(order="DESC").replace(
        "LEFT JOIN ranked", "JOIN ranked"
    )
    assert f"{RATE}:base_currency_dropped" in violations(strict, inner_outside)


def test_match_single_alone_does_not_ask_for_the_base_currency():
    only_single = make_checker(match="single")
    assert violations(only_single, INNER_ASOF) == []
    assert violations(only_single, MULTI) == [f"{RATE}:rate_multi_match"]
    only_base = make_checker(base_currency="USD")
    assert violations(only_base, MULTI) == [f"{RATE}:base_currency_dropped"]
    assert violations(only_base, COALESCED) == [f"{RATE}:rate_default_literal"]


def test_a_rule_without_the_new_keys_gets_exactly_the_old_verdict():
    plain = make_checker()
    for sql in (MULTI, INNER_ASOF, COALESCED, BASE_ONLY):
        assert violations(plain, sql) == []


def test_the_rules_own_unless_flags_still_excuse_the_statement():
    manifest, rules = declared()
    excused = [
        replace(r, base_currency="USD", match="single")
        if isinstance(r, RequireRateJoin)
        else r
        for r in rules
    ]
    checker = DefaultsChecker(excused, manifest, "duckdb")
    by_currency = "SELECT p.currency, SUM(p.amount) FROM payments p WHERE NOT 1 = 0 GROUP BY p.currency"
    result = verdict(checker, by_currency)
    assert result.checks[RATE] == {"applicable": True, "result": "satisfied"}
    assert RATE not in " ".join(result.violations)


# -- the existing decisions, unchanged ----------------------------------------

CORPUS = [
    f"SELECT COUNT(*) FROM {CHARGES}",
    f"SELECT COUNT(*) FROM {CHARGES} WHERE NOT c.is_test",
    f"SELECT SUM(p.amount) FROM {CHARGES}",
    f"SELECT SUM(p.amount * f.rate_to_usd) FROM {CHARGES} JOIN fx_rates f ON f.currency = p.currency AND f.date <= CAST(p.captured_at AS DATE) WHERE NOT c.is_test",
    f"SELECT SUM(p.amount * f.rate_to_usd) FROM {CHARGES} JOIN fx_rates f ON f.currency = p.currency WHERE NOT c.is_test",
    "SELECT p.currency, SUM(p.amount) FROM payments p GROUP BY p.currency",
    "SELECT COUNT(*) FROM fx_rates",
    "SELECT o.id FROM orders o",
    "SELECT c.country, COUNT(*) FROM orders o JOIN customers c ON o.customer_id = c.id GROUP BY c.country, c.is_test HAVING NOT c.is_test",
    "SELECT COUNT(*) FROM orders o WHERE o.customer_id NOT IN (SELECT id FROM customers WHERE is_test = TRUE)",
]


@pytest.mark.parametrize("sql", CORPUS)
def test_rules_without_the_new_keys_agree_with_the_existing_check(sql):
    checker = make_checker()
    expected = checker.check(parse_one(sql, dialect="duckdb"))
    assert list(verdict(checker, sql).violations) == expected


# -- applicability -------------------------------------------------------------


def test_each_rule_reports_whether_it_applied_and_whether_it_held(both):
    sql = f"SELECT COUNT(*) FROM {CHARGES} WHERE NOT c.is_test"
    assert verdict(both, sql).checks == {
        RATE: {"applicable": False, "result": "not_applicable"},
        EXCLUDE: {"applicable": True, "result": "satisfied"},
    }
    sql = "SELECT SUM(p.amount) FROM payments p"
    result = verdict(both, sql)
    assert result.checks[RATE] == {"applicable": True, "result": "violated"}
    assert result.checks[EXCLUDE]["result"] == "violated"
    assert list(result.violations) == [RATE, EXCLUDE]
    assert verdict(both, "SELECT COUNT(*) FROM fx_rates").checks == {
        RATE: {"applicable": False, "result": "not_applicable"},
        EXCLUDE: {"applicable": False, "result": "not_applicable"},
    }


def test_a_statement_without_an_aggregate_over_the_amount_does_not_apply_the_rate_rule(
    strict,
):
    result = verdict(strict, "SELECT p.amount FROM payments p")
    assert result.checks[RATE] == {"applicable": False, "result": "not_applicable"}


def test_no_declarations_means_no_checks_and_no_violations():
    manifest, _ = declared()
    empty = DefaultsChecker([], manifest, "duckdb")
    result = verdict(empty, "SELECT SUM(p.amount) FROM payments p")
    assert (result.violations, result.checks, result.fx_missing_rate_handling) == (
        (),
        {},
        None,
    )


# -- no verdict -----------------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT SUM(nothing) FROM payments p",
        "SELECT SUM(p.amount) FROM payments p WHERE p.nothing = 1",
    ],
)
def test_a_statement_that_cannot_be_qualified_has_no_verdict(strict, sql):
    assert evaluate(strict, parse_one(sql, dialect="duckdb")) is None
    assert strict.check(parse_one(sql, dialect="duckdb")) is None


def test_something_that_is_not_a_query_has_no_verdict(strict):
    assert evaluate(strict, exp.Literal.number(1)) is None


def test_a_checker_fault_is_no_verdict_not_a_refusal(strict, monkeypatch):
    from wren import declared_default_fx as fx  # noqa: PLC0415

    def boom(self):
        raise RuntimeError("fault")

    monkeypatch.setattr(fx._Rate, "judge", boom)
    assert evaluate(strict, parse_one(INNER_ASOF, dialect="duckdb")) is None


# -- two sale_statuses rules on different columns --------------------------------------------


def status_rule(rule_id, column, values, domain):
    return SaleStatuses(
        id=rule_id,
        column=ColumnRef("orders", column),
        values=values,
        domain=domain,
        overridable_by_caller=True,
        aggregated_only=False,
    )


def two_status_rules():
    manifest, _ = declared()
    rules = [
        status_rule(
            "keep-paid-shipped",
            "status",
            ("paid", "shipped"),
            ("paid", "shipped", "cancelled"),
        ),
        status_rule("keep-usd-eur", "currency", ("USD", "EUR"), ("USD", "EUR", "GBP")),
    ]
    return DefaultsChecker(rules, manifest, "duckdb")


NARROW_BOTH = "SELECT COUNT(*) FROM orders WHERE status = 'paid' AND currency = 'USD'"


def test_a_confirmed_scope_applies_only_to_the_rule_it_was_given_for():
    checker = two_status_rules()
    ast = parse_one(NARROW_BOTH, dialect="duckdb")
    plain = evaluate(checker, ast)
    assert list(plain.violations) == ["keep-paid-shipped:subset", "keep-usd-eur:subset"]
    scoped = evaluate(checker, ast, {"keep-paid-shipped": fold_all(["paid"])})
    assert list(scoped.violations) == ["keep-usd-eur:subset"]
    assert scoped.checks["keep-paid-shipped"]["result"] == "satisfied_by_caller_scope"
    assert scoped.checks["keep-usd-eur"]["result"] == "violated"


def test_a_scope_for_one_rule_does_not_excuse_another_that_would_otherwise_pass():
    checker = two_status_rules()
    ast = parse_one(
        "SELECT COUNT(*) FROM orders WHERE status = 'paid' AND currency IN ('USD', 'EUR')",
        dialect="duckdb",
    )
    scoped = evaluate(checker, ast, {"keep-usd-eur": fold_all(["USD"])})
    assert list(scoped.violations) == [
        "keep-paid-shipped:subset",
        "keep-usd-eur:superset",
    ]
    kept = evaluate(checker, ast, {"keep-paid-shipped": fold_all(["paid"])})
    assert list(kept.violations) == []
    assert kept.checks["keep-usd-eur"]["result"] == "satisfied"


def test_a_passthrough_alias_preserves_the_rank_proof():
    strict = make_checker(match="single")
    sql = RANKED.replace(
        ") SELECT SUM",
        "), renamed AS (SELECT pid AS key, rate, rn AS rank FROM ranked) SELECT SUM",
    )
    sql = sql.replace(
        "LEFT JOIN ranked r ON r.pid = p.id AND r.rn = {limit}",
        "LEFT JOIN renamed r ON r.key = p.id AND r.rank = 1",
    )
    assert violations(strict, sql) == []


def test_each_consumer_needs_its_own_rank_limit(strict):
    sql = RANKED.format(limit=1) + " LEFT JOIN ranked s ON s.pid = p.id"
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


def test_a_same_named_rank_on_another_source_is_not_a_limit(strict):
    sql = RANKED.replace("r.rn = {limit}", "other.rn = 1")
    sql += " LEFT JOIN (SELECT id AS rn FROM payments) other ON other.rn=p.id"
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


def test_a_local_rank_cannot_partition_an_amount_by_an_unrelated_source(strict):
    sql = """SELECT SUM(CASE WHEN p.currency='USD' THEN p.amount ELSE p.amount*f.rate_to_usd END)
        FROM payments p LEFT JOIN fx_rates f
        ON f.currency=p.currency AND f.date<=p.captured_at
        CROSS JOIN customers c GROUP BY p.id,c.id,f.date
        QUALIFY ROW_NUMBER() OVER (PARTITION BY p.id,c.id ORDER BY f.date DESC)=1"""
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


def test_a_postaggregate_rank_cannot_remove_already_aggregated_rate_duplicates(strict):
    sql = """SELECT SUM(CASE WHEN p.currency='USD' THEN p.amount ELSE p.amount*f.rate_to_usd END)
        FROM payments p LEFT JOIN fx_rates f
        ON f.currency=p.currency AND f.date<=p.captured_at
        GROUP BY p.id,f.date
        QUALIFY ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY f.date DESC)=1"""
    import duckdb  # noqa: PLC0415

    with duckdb.connect() as db:
        db.execute(
            "CREATE TABLE payments(id INT, amount INT, currency VARCHAR, captured_at DATE)"
        )
        db.execute(
            "CREATE TABLE fx_rates(currency VARCHAR, date DATE, rate_to_usd INT)"
        )
        db.execute("INSERT INTO payments VALUES (1,100,'EUR','2026-06-02')")
        db.execute(
            "INSERT INTO fx_rates VALUES ('EUR','2026-06-01',2),('EUR','2026-06-01',2)"
        )
        assert db.execute(sql).fetchone() == (400,)
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


def test_local_window_sum_already_consumes_duplicate_rates_before_qualify(strict):
    import duckdb  # noqa: PLC0415

    sql = """SELECT SUM(CASE WHEN p.currency='USD' THEN p.amount ELSE p.amount*f.rate_to_usd END)
        OVER (PARTITION BY p.id)
        FROM payments p LEFT JOIN fx_rates f
        ON f.currency=p.currency AND f.date<=p.captured_at
        QUALIFY ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY f.date DESC)=1"""
    with duckdb.connect() as db:
        db.execute(
            "CREATE TABLE payments(id INT, amount INT, currency VARCHAR, captured_at DATE)"
        )
        db.execute(
            "CREATE TABLE fx_rates(currency VARCHAR, date DATE, rate_to_usd INT)"
        )
        db.execute("INSERT INTO payments VALUES (1,100,'EUR','2026-06-02')")
        db.execute(
            "INSERT INTO fx_rates VALUES ('EUR','2026-06-01',2),('EUR','2026-06-01',2)"
        )
        assert db.execute(sql).fetchone() == (400,)
    assert violations(strict, sql) == [f"{RATE}:rate_multi_match"]


@pytest.mark.parametrize("value", ["p.amount", "p.amount*f.rate_to_usd"])
def test_a_rate_alias_cannot_borrow_another_alias_date_bound(value):
    sql = f"""SELECT SUM({value}) FROM payments p
        JOIN fx_rates f ON f.currency=p.currency
        JOIN fx_rates g ON g.currency=p.currency AND g.date<=p.captured_at"""
    # Without a rate-valued expression, either complete rate instance suffices.
    expected = [] if value == "p.amount" else [RATE]
    assert make_checker().check(parse_one(sql, dialect="duckdb")) == expected


def test_currency_and_date_conditions_must_belong_to_one_rate_instance():
    sql = """SELECT SUM(p.amount) FROM payments p
        JOIN fx_rates f ON f.currency=p.currency
        JOIN fx_rates g ON g.date<=p.captured_at"""
    assert make_checker().check(parse_one(sql, dialect="duckdb")) == [RATE]


def test_computed_rate_value_keeps_its_consuming_alias_obligation():
    sql = """WITH rates AS (SELECT currency,date,rate_to_usd*2 AS rate FROM fx_rates)
        SELECT SUM(p.amount*f.rate) FROM payments p
        JOIN rates f ON f.currency=p.currency
        JOIN rates g ON g.currency=p.currency AND g.date<=p.captured_at"""
    assert make_checker().check(parse_one(sql, dialect="duckdb")) == [RATE]
