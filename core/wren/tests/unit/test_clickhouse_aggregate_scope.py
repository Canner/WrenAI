"""Column scope regressions for ClickHouse aggregate-alias qualification."""

import pytest
from sqlglot import exp, parse_one

from wren.mdl.clickhouse_compat import translate

pytestmark = pytest.mark.unit


def test_aggregate_alias_does_not_qualify_a_scalar_subquery_column():
    ast = translate(
        parse_one(
            "SELECT t.id, SUM(c + (SELECT c FROM u WHERE u.id = t.id)) AS c "
            "FROM t GROUP BY t.id"
        )
    )

    columns = list(ast.find(exp.Sum).find_all(exp.Column))
    c_columns = [column for column in columns if column.name == "c"]
    assert [column.table for column in c_columns] == ["t", ""]
