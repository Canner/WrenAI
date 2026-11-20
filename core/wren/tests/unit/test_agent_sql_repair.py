import duckdb
import pytest

from wren.agent_sql_repair import (
    RepairScope,
    execution_diagnostic,
    repair_syntax,
    temporal_join_hint,
)

SCHEMA = {
    "events": {"amount": "DOUBLE", "currency": "VARCHAR", "dt": "DATE"},
    "rates": {"currency": "VARCHAR", "dt": "DATE", "rate": "DOUBLE"},
}
SQL = """SELECT SUM(e.amount * CASE WHEN e.currency='USD' THEN 1 ELSE r.rate END)
FROM events LEFT ASOF JOIN rates r ON e.currency=r.currency AND e.dt>=r.dt
WHERE e.dt >= DATE '2025-01-01' AND e.dt < DATE '2025-02-01'"""


def test_bounded_repairs_execute_without_dropping_base_currency():
    fixed, codes = repair_syntax(SQL, SCHEMA)
    assert codes == ["asof_keyword_order", "missing_table_alias"]
    with duckdb.connect() as db:
        db.execute("CREATE TABLE events(amount DOUBLE,currency VARCHAR,dt DATE)")
        db.execute("CREATE TABLE rates(currency VARCHAR,dt DATE,rate DOUBLE)")
        db.execute(
            "INSERT INTO events VALUES (10,'USD','2025-01-06'),(10,'EUR','2025-01-06')"
        )
        db.execute(
            "INSERT INTO rates VALUES ('EUR','2025-01-03',2),('EUR','2025-02-03',9)"
        )
        assert db.execute(fixed).fetchone()[0] == 30
        assert (
            db.execute(fixed.replace("ASOF LEFT JOIN", "ASOF JOIN")).fetchone()[0] == 20
        )


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 'LEFT ASOF JOIN' FROM events",
        'SELECT "LEFT", "ASOF", "JOIN" FROM events',
        "SELECT amount FROM events -- LEFT ASOF JOIN\n",
        "SELECT e.amount FROM events; SELECT e.amount FROM events",
        "WITH x AS (SELECT amount FROM events) SELECT e.amount FROM x",
        "SELECT e.amount FROM events a JOIN events b ON a.dt=b.dt",
        "SELECT e.amount, events.dt FROM events",
        "SELECT e.secret FROM events",
    ],
)
def test_does_not_guess_or_rewrite_other_constructs(sql):
    assert repair_syntax(sql, SCHEMA) == (sql, [])


def test_ambiguous_missing_alias_is_not_inferred():
    sql = "SELECT x.currency FROM events CROSS JOIN rates"
    assert repair_syntax(sql, SCHEMA) == (sql, [])


def test_repair_scope_preserves_temporal_join_and_window_but_not_alias_spelling():
    fixed, _ = repair_syntax(SQL, SCHEMA)
    guard = RepairScope()
    guard.failed(fixed)
    assert not guard.changed(fixed.replace("e.", "evt.").replace("AS e ", "AS evt "))
    assert guard.changed(fixed.replace("ASOF LEFT JOIN", "ASOF JOIN"))
    assert guard.changed(fixed.replace("2025-02-01", "2025-01-15"))
    assert guard.changed("SELECT SUM(amount) FROM events")
    guard.succeeded()
    assert not guard.changed("SELECT COUNT(*) FROM events")


def test_engine_diagnostic_never_echoes_driver_data():
    code, hint = execution_diagnostic(
        ValueError(
            "PRIVATE_PATH column must appear in the GROUP BY clause PRIVATE_VALUE"
        )
    )
    assert code == "grouping_expression"
    assert "entire numeric measure expression" in hint
    assert "requested grain" in hint
    assert "PRIVATE" not in hint
    code, hint = execution_diagnostic(ValueError("PRIVATE_PATH PRIVATE_VALUE"))
    assert code is None
    assert "PRIVATE" not in hint


def test_missing_asof_inequality_has_specific_binding_free_feedback():
    fixed, _ = repair_syntax(SQL, SCHEMA)
    assert temporal_join_hint(fixed) is None
    hint = temporal_join_hint(fixed.replace(" AND e.dt >= r.dt", ""))
    assert "no temporal inequality" in hint
    assert "events" not in hint and "rates" not in hint
    assert temporal_join_hint("SELECT FROM") is None
    assert temporal_join_hint("SELECT amount FROM events") is None
