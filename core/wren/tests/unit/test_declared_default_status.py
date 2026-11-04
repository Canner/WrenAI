"""What a statement's filters keep of a status column, computed over the column's whole domain."""

from pathlib import Path

import pytest
from sqlglot import parse_one
from sqlglot.optimizer.qualify import qualify

from wren.context import build_json
from wren.declared_default_check import DefaultsChecker, _Statement
from wren.declared_default_status import (
    StatusUndetermined,
    _Status,
    display,
    fold_all,
    judge,
)
from wren.declared_defaults import ColumnRef, SaleStatuses

pytestmark = pytest.mark.unit

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "declared_defaults"
DOMAIN = ("paid", "shipped", "cancelled", "pending")
RULE = SaleStatuses(
    id="paid-and-shipped",
    column=ColumnRef("orders", "status"),
    values=("paid", "shipped"),
    domain=DOMAIN,
    overridable_by_caller=False,
    aggregated_only=False,
)
CHECKER = DefaultsChecker([RULE], build_json(FIXTURE), "duckdb")


def statement(sql: str) -> _Statement:
    tree = qualify(
        parse_one(sql, dialect="duckdb"),
        dialect="duckdb",
        schema=CHECKER.schema,
        validate_qualify_columns=True,
        identify=False,
    )
    return _Statement(tree, CHECKER)


def outcome(sql: str, target=None, rule: SaleStatuses = RULE) -> str:
    folded = None if target is None else fold_all(target)
    return judge(statement(sql), CHECKER, rule, folded).outcome


def retained(sql: str) -> list[list[str]]:
    status = _Status(statement(sql), CHECKER, RULE, frozenset())
    return [display(RULE, kept) for kept, _ in status.retained().values()]


def count(where: str) -> str:
    return f"SELECT COUNT(*) FROM orders WHERE {where}"


@pytest.mark.parametrize("second_filter", ["", "WHERE status IN ('paid','shipped')"])
def test_shared_cte_consumers_keep_separate_status_obligations(second_filter):
    sql = f"""WITH raw AS (SELECT status FROM orders)
        SELECT COUNT(*) FROM raw WHERE status IN ('paid','shipped')
        UNION ALL SELECT COUNT(*) FROM raw {second_filter}"""
    import duckdb  # noqa: PLC0415

    with duckdb.connect() as db:
        db.execute("CREATE TABLE orders(status VARCHAR)")
        db.execute(
            "INSERT INTO orders VALUES ('paid'),('shipped'),('pending'),('cancelled')"
        )
        assert db.execute(sql).fetchall() == [(2,), (2 if second_filter else 4,)]
    assert outcome(sql) == ("satisfied" if second_filter else "missing")


@pytest.mark.parametrize(
    "where,expected",
    [
        ("UPPER(status) IN ('paid', 'shipped')", "subset"),
        ("LOWER(status) IN ('PAID', 'SHIPPED')", "subset"),
        ("UPPER(status) = 'paid' OR UPPER(status) = 'shipped'", "subset"),
        ("UPPER(status) NOT IN ('cancelled', 'pending')", "superset"),
        ("UPPER(status) IN (UPPER('paid'), UPPER('shipped'))", "satisfied"),
        ("LOWER(UPPER(status)) IN ('paid', 'shipped')", "satisfied"),
        ("UPPER(LOWER(status)) IN ('PAID', 'SHIPPED')", "satisfied"),
        ("LOWER(status) IN (LOWER('PAID'), LOWER('SHIPPED'))", "satisfied"),
    ],
)
def test_explicit_case_functions_are_evaluated_before_set_comparison(where, expected):
    assert outcome(count(where)) == expected


EQUAL = [
    "status IN ('paid', 'shipped')",
    "status = 'paid' OR status = 'shipped'",
    "status NOT IN ('cancelled', 'pending')",
    "NOT status IN ('cancelled', 'pending')",
    "NOT (status = 'cancelled' OR status = 'pending')",
    "status <> 'cancelled' AND status <> 'pending'",
    "status != 'cancelled' AND status != 'pending'",
    "lower(status) IN ('paid', 'shipped')",
    "LOWER(status) NOT IN ('cancelled', 'pending')",
    "UPPER(status) IN ('PAID', 'SHIPPED')",
    "UPPER(TRIM(status)) IN ('PAID', 'SHIPPED')",
    "status IN ('Paid', 'SHIPPED')",
    "status IN ('paid', 'shipped', 'refunded')",
    "status IN ('paid', 'shipped') AND order_total > 5",
    "order_total > 5 AND status IN ('paid', 'shipped')",
    "status IN ('paid', 'shipped', 'cancelled') AND status <> 'cancelled'",
    "(status = 'paid' OR status = 'shipped') AND NOT (status = 'pending')",
    "status IS NOT NULL AND status IN ('paid', 'shipped')",
    "(status = 'paid' AND order_total > 5) OR status = 'shipped'",
]


@pytest.mark.parametrize("where", EQUAL)
def test_a_filter_that_keeps_exactly_the_declared_set_is_satisfied(where):
    assert outcome(count(where)) == "satisfied"


def test_not_in_is_computed_over_the_domain_not_compared_as_a_literal_list():
    assert retained(count("status NOT IN ('cancelled', 'pending')")) == [
        ["paid", "shipped"]
    ]
    assert retained(count("status NOT IN ('cancelled')")) == [
        ["paid", "shipped", "pending"]
    ]
    assert retained(count("status <> 'paid'")) == [["shipped", "cancelled", "pending"]]


SUBSET = [
    "status = 'paid'",
    "status IN ('paid')",
    "status NOT IN ('cancelled', 'pending', 'shipped')",
    "lower(status) = 'shipped'",
    "status IN ('paid', 'shipped') AND status <> 'paid'",
    "status = 'paid' AND order_total > 5",
    "status IN ('paid', 'refunded')",
    "status = 'refunded'",
]


@pytest.mark.parametrize("where", SUBSET)
def test_a_proper_subset_is_a_violation(where):
    assert outcome(count(where)) == "subset"


SUPERSET = [
    "status NOT IN ('cancelled')",
    "status <> 'cancelled'",
    "status IN ('paid', 'shipped', 'pending')",
    "status IS NOT NULL",
    "status IS NULL",
    "status = 'paid' OR order_total > 5",
    "status IN ('paid', 'shipped') OR order_total > 5",
    "NOT (status = 'cancelled' AND order_total > 5)",
    "status IN ('paid', 'pending')",
    "NOT (status = 'cancelled' AND status = 'pending')",
]


@pytest.mark.parametrize("where", SUPERSET)
def test_a_superset_or_one_that_also_keeps_a_value_it_should_not_is_a_violation(where):
    assert outcome(count(where)) == "superset"


def test_no_status_predicate_at_all_is_missing():
    assert outcome("SELECT COUNT(*) FROM orders") == "missing"
    assert outcome(count("order_total > 5")) == "missing"
    assert outcome("SELECT status, COUNT(*) FROM orders GROUP BY status") == "missing"


@pytest.mark.parametrize(
    "where",
    [
        "status = currency",
        "status = lower(currency)",
        "status IN (SELECT currency FROM orders)",
        "status IN (currency, 'paid')",
        "status LIKE 'p%'",
        "status > 'a'",
        "status BETWEEN 'a' AND 'z'",
        "substr(status, 1, 3) = 'pai'",
        "concat(status, 'x') = 'paidx'",
        "CASE WHEN status = 'paid' THEN 1 ELSE 0 END = 1",
        "status = ANY(['paid'])",
        "status IS NOT DISTINCT FROM 'paid'",
        "status = NULL",
        "TRIM(status, 'x') = 'paid'",
        "CAST(status AS VARCHAR) = 'paid'",
    ],
)
def test_a_predicate_the_module_does_not_evaluate_has_no_verdict(where):
    with pytest.raises(StatusUndetermined):
        outcome(count(where))


def test_a_status_derived_in_a_subquery_has_no_verdict():
    sql = (
        "WITH t AS (SELECT lower(status) AS s, order_total FROM orders) "
        "SELECT COUNT(*) FROM t WHERE s IN ('paid', 'shipped')"
    )
    with pytest.raises(StatusUndetermined):
        outcome(sql)


def test_a_status_passed_through_a_cte_or_derived_table_is_followed():
    assert (
        outcome(
            "WITH t AS (SELECT status, order_total FROM orders) "
            "SELECT COUNT(*) FROM t WHERE status IN ('paid', 'shipped')"
        )
        == "satisfied"
    )
    assert (
        outcome(
            "SELECT COUNT(*) FROM (SELECT status AS s FROM orders) t WHERE t.s = 'paid'"
        )
        == "subset"
    )
    assert (
        outcome(
            "WITH t AS (SELECT * FROM orders WHERE status IN ('paid', 'shipped')) "
            "SELECT COUNT(*) FROM t"
        )
        == "satisfied"
    )


def test_each_branch_of_a_union_is_judged_on_its_own_read():
    branch = "SELECT id FROM orders WHERE status IN ('paid', 'shipped')"
    assert (
        outcome(f"SELECT COUNT(*) FROM ({branch} UNION ALL {branch}) t") == "satisfied"
    )
    two_halves = (
        "SELECT id FROM orders WHERE status = 'paid' UNION ALL "
        "SELECT id FROM orders WHERE status = 'shipped'"
    )
    assert outcome(f"SELECT COUNT(*) FROM ({two_halves}) t") == "subset"
    unfiltered = f"{branch} UNION ALL SELECT id FROM orders"
    assert outcome(f"SELECT COUNT(*) FROM ({unfiltered}) t") == "missing"


def test_a_filter_on_a_union_column_applies_to_every_branch_it_comes_from():
    sql = (
        "WITH u AS (SELECT status FROM orders UNION ALL SELECT status FROM orders) "
        "SELECT COUNT(*) FROM u WHERE status IN ('paid', 'shipped')"
    )
    assert outcome(sql) == "satisfied"


def test_every_read_of_the_model_needs_its_own_filter():
    both = (
        "SELECT COUNT(*) FROM orders a JOIN orders b ON a.customer_id = b.customer_id "
        "WHERE a.status IN ('paid', 'shipped') AND b.status IN ('paid', 'shipped')"
    )
    assert outcome(both) == "satisfied"
    one = both.replace(" AND b.status IN ('paid', 'shipped')", "")
    assert outcome(one) == "missing"
    mixed = both.replace("b.status IN ('paid', 'shipped')", "b.status = 'paid'")
    assert outcome(mixed) == "subset"
    crossed = (
        "SELECT COUNT(*) FROM orders a JOIN orders b ON a.customer_id = b.customer_id "
        "WHERE a.status = 'paid' OR b.status = 'shipped'"
    )
    with pytest.raises(StatusUndetermined):
        outcome(crossed)


def test_a_subquery_over_the_model_is_a_read_of_its_own():
    inner_unfiltered = (
        "SELECT COUNT(*) FROM orders WHERE status IN ('paid', 'shipped') "
        "AND customer_id IN (SELECT customer_id FROM orders)"
    )
    assert outcome(inner_unfiltered) == "missing"
    both = inner_unfiltered.replace(
        "FROM orders)", "FROM orders WHERE status IN ('paid', 'shipped'))"
    )
    assert outcome(both) == "satisfied"


def test_a_filter_in_a_join_condition_counts_like_one_in_where():
    sql = (
        "SELECT COUNT(*) FROM customers c JOIN orders o ON o.customer_id = c.id "
        "AND o.status IN ('paid', 'shipped')"
    )
    assert outcome(sql) == "satisfied"


def test_a_statement_that_does_not_read_the_model_is_not_applicable():
    assert outcome("SELECT COUNT(*) FROM customers") == "not_applicable"


def test_when_aggregated_a_plain_listing_is_not_applicable():
    rule = SaleStatuses(**{**RULE.__dict__, "aggregated_only": True})
    assert outcome("SELECT id FROM orders", rule=rule) == "not_applicable"
    assert outcome("SELECT COUNT(*) FROM orders", rule=rule) == "missing"


def test_the_target_can_be_a_set_the_caller_confirmed():
    assert outcome(count("status = 'paid'"), target=["paid"]) == "satisfied"
    assert (
        outcome(count("status IN ('paid', 'shipped')"), target=["paid"]) == "superset"
    )
    assert outcome(count("status = 'paid'"), target=["paid", "shipped"]) == "subset"
    assert outcome(count("status = 'PAID'"), target=["Paid"]) == "satisfied"


def test_comparison_ignores_case_in_the_domain_and_the_declaration():
    rule = SaleStatuses(
        **{
            **RULE.__dict__,
            "values": ("Paid", "SHIPPED"),
            "domain": ("PAID", "Shipped", "Cancelled", "pending"),
        }
    )
    checker = DefaultsChecker([rule], build_json(FIXTURE), "duckdb")
    tree = qualify(
        parse_one(count("lower(status) IN ('paid', 'shipped')"), dialect="duckdb"),
        dialect="duckdb",
        schema=checker.schema,
        validate_qualify_columns=True,
        identify=False,
    )
    assert judge(_Statement(tree, checker), checker, rule).outcome == "satisfied"


def test_display_uses_the_declared_case_in_domain_order():
    assert display(RULE, fold_all(["SHIPPED", "paid"])) == ["paid", "shipped"]


def test_the_checker_reports_a_violated_status_rule_and_no_verdict_for_an_unreadable_one():
    ok = parse_one(count("status IN ('paid', 'shipped')"), dialect="duckdb")
    assert CHECKER.check(ok) == []
    bad = parse_one(count("status = 'paid'"), dialect="duckdb")
    assert CHECKER.check(bad) == ["paid-and-shipped"]
    unreadable = parse_one(count("status = currency"), dialect="duckdb")
    assert CHECKER.check(unreadable) is None


# -- a row whose status is NULL ------------------------------------------------------------------

NULL_RETAINED = [
    "status IN ('paid', 'shipped') OR status IS NULL",
    "status = 'paid' OR status = 'shipped' OR status IS NULL",
    "status IS NULL OR status IN ('paid', 'shipped')",
    "(status IN ('paid', 'shipped') OR status IS NULL) AND order_total > 5",
    "NOT (status IS NOT NULL AND status NOT IN ('paid', 'shipped'))",
    "status IS NULL",
    "NOT (NOT (status IS NULL)) OR status IN ('paid', 'shipped')",
]


@pytest.mark.parametrize("where", NULL_RETAINED)
def test_a_filter_that_can_keep_a_null_status_is_not_satisfied(where):
    assert outcome(count(where)) == "superset"


NULL_EXCLUDED = [
    "status IS NOT NULL AND status IN ('paid', 'shipped')",
    "NOT (status IS NULL) AND status IN ('paid', 'shipped')",
    "NOT (status IS NULL OR status NOT IN ('paid', 'shipped'))",
    "status IN ('paid', 'shipped') AND status IS NOT NULL AND order_total > 5",
    "status NOT IN ('cancelled', 'pending')",
    "status <> 'cancelled' AND status <> 'pending'",
    "NOT status IN ('cancelled', 'pending')",
]


@pytest.mark.parametrize("where", NULL_EXCLUDED)
def test_a_filter_that_cannot_keep_a_null_status_is_still_satisfied(where):
    assert outcome(count(where)) == "satisfied"


def test_null_is_not_added_to_the_domain_so_not_in_does_not_keep_it():
    assert retained(count("status NOT IN ('cancelled', 'pending')")) == [
        ["paid", "shipped"]
    ]
    assert retained(count("status IS NULL")) == [[]]


# -- predicates in HAVING --------------------------------------------------------------------


def test_a_status_predicate_in_having_is_judged_like_one_in_where():
    grouped = "SELECT status, COUNT(*) FROM orders GROUP BY status HAVING {having}"
    assert (
        outcome(grouped.format(having="status IN ('paid', 'shipped')")) == "satisfied"
    )
    assert outcome(grouped.format(having="status = 'paid'")) == "subset"
    assert outcome(grouped.format(having="status <> 'cancelled'")) == "superset"


def test_a_having_on_an_aggregate_does_not_filter_the_status():
    grouped = "SELECT status, COUNT(*) FROM orders GROUP BY status HAVING {having}"
    assert outcome(grouped.format(having="COUNT(*) > 5")) == "missing"
    assert (
        outcome(grouped.format(having="COUNT(*) > 5 AND status IN ('paid', 'shipped')"))
        == "satisfied"
    )


# -- filters in the ON clause of an outer join ------------------------------------------------

PAID = "o.status IN ('paid', 'shipped')"


def joined(kind: str, on: str, where: str = "") -> str:
    left, right = (
        ("customers c", "orders o") if kind == "RIGHT" else ("orders o", "customers c")
    )
    sql = f"SELECT SUM(o.order_total) FROM {left} {kind} JOIN {right} ON c.id = o.customer_id AND {on}"
    return f"{sql} WHERE {where}" if where else sql


@pytest.mark.parametrize("kind", ["LEFT", "LEFT OUTER", "FULL", "RIGHT"])
def test_a_status_filter_on_the_preserved_side_in_an_outer_join_on_filters_nothing(
    kind,
):
    assert outcome(joined(kind, PAID)) == "missing"


@pytest.mark.parametrize("kind", ["LEFT", "FULL", "RIGHT"])
def test_the_same_predicate_in_where_is_a_filter(kind):
    assert outcome(joined(kind, "TRUE", PAID)) == "satisfied"


def test_a_status_filter_on_the_nullable_side_in_an_outer_join_on_still_counts():
    on_nullable = (
        "SELECT SUM(o.order_total) FROM customers c "
        f"LEFT JOIN orders o ON o.customer_id = c.id AND {PAID}"
    )
    assert outcome(on_nullable) == "satisfied"
    assert outcome(on_nullable.replace(PAID, "o.status = 'paid'")) == "subset"
    right = (
        "SELECT SUM(o.order_total) FROM orders o "
        f"RIGHT JOIN customers c ON o.customer_id = c.id AND {PAID}"
    )
    assert outcome(right) == "satisfied"


def test_a_predicate_that_also_names_the_other_side_filters_neither():
    mixed = (
        "SELECT SUM(o.order_total) FROM customers c LEFT JOIN orders o "
        "ON o.customer_id = c.id AND (o.status IN ('paid', 'shipped') OR c.is_test)"
    )
    assert outcome(mixed) == "missing"


def test_a_status_filter_in_an_inner_join_on_still_counts():
    sql = f"SELECT SUM(o.order_total) FROM customers c JOIN orders o ON o.customer_id = c.id AND {PAID}"
    assert outcome(sql) == "satisfied"
    assert (
        outcome(sql.replace("customers c JOIN", "customers c INNER JOIN"))
        == "satisfied"
    )


def test_a_later_inner_join_filter_on_a_preserved_side_counts():
    sql = (
        "SELECT SUM(o.order_total) FROM orders o LEFT JOIN customers c ON c.id = o.customer_id "
        f"JOIN payments p ON p.order_id = o.id AND {PAID}"
    )
    assert outcome(sql) == "satisfied"


@pytest.mark.parametrize("kind", ["ANTI", "SEMI"])
def test_a_bare_semi_or_anti_join_condition_filters_nothing(kind):
    sql = f"SELECT o.id FROM orders o {kind} JOIN customers c ON c.id = o.customer_id AND {PAID}"
    assert outcome(sql) == "missing"


GROUP = "(customers c JOIN customers d ON d.id = c.id)"


def test_a_joined_group_has_no_name_to_tell_its_side_so_its_on_filters_nothing():
    for sql in (
        "SELECT SUM(o.order_total) FROM customers c RIGHT JOIN "
        f"(orders o JOIN customers d ON d.id = o.customer_id) ON c.id = o.customer_id AND {PAID}",
        f"SELECT SUM(o.order_total) FROM orders o LEFT JOIN {GROUP} ON c.id = o.customer_id AND {PAID}",
        f"SELECT SUM(o.order_total) FROM orders o RIGHT JOIN {GROUP} ON c.id = o.customer_id AND {PAID}",
    ):
        assert outcome(sql) == "missing"


def test_a_semi_join_condition_filters_nothing():
    sql = f"SELECT o.id FROM orders o LEFT SEMI JOIN customers c ON c.id = o.customer_id AND {PAID}"
    assert outcome(sql) == "missing"


def test_case_mapping_checks_the_original_domain_before_casefolding():
    from dataclasses import replace  # noqa: PLC0415

    rule = replace(RULE, values=("ß",), domain=("ß", "cancelled"))
    with pytest.raises(StatusUndetermined, match="case_mapping"):
        outcome(count("UPPER(status) = 'SS'"), rule=rule)


@pytest.mark.parametrize(
    "value,predicate,expected",
    [
        ("paid ", "TRIM(status) = 'paid '", "subset"),
        ("paid ", "TRIM(status) = 'paid'", "satisfied"),
        ("\tpaid\t", "TRIM(status) = 'paid'", "subset"),
        ("\tpaid\t", "TRIM(status) = '\tpaid\t'", "satisfied"),
        ("\tpaid\t", "LOWER(TRIM(status)) = '\tpaid\t'", "satisfied"),
        ("paid", "status = TRIM('\tpaid\t')", "subset"),
    ],
)
def test_default_trim_only_removes_spaces_on_bare_and_case_wrapped_status(
    value, predicate, expected
):
    from dataclasses import replace  # noqa: PLC0415

    import duckdb  # noqa: PLC0415

    rule = replace(RULE, values=(value,), domain=(value, "other"))
    sql = count(predicate)
    with duckdb.connect() as db:
        db.execute("CREATE TABLE orders(status VARCHAR)")
        db.execute("INSERT INTO orders VALUES (?)", [value])
        actual = db.execute(sql).fetchone()[0]
    assert actual == (1 if expected == "satisfied" else 0)
    assert outcome(sql, rule=rule) == expected
