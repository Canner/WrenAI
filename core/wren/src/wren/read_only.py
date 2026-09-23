"""Conservative SQL admission for host-governed analytical queries.

This is an opt-in boundary, independent of the ordinary CLI query policy. Only
one query statement and known analytical functions are admitted. Unknown UDFs,
reader functions, commands, nested writes, locks and SELECT INTO fail closed.
Database credentials and trusted model definitions remain host responsibilities.
"""

from sqlglot import exp, parse

from wren.model.error import ErrorCode, ErrorPhase, WrenError

_FUNCTIONS = frozenset(
    "abs avg sum count min max round ceil floor coalesce nullif if case cast "
    "trycast extract date dateadd datesub datediff datetrunc timestamptrunc "
    "timetostr strtodate strtotime currentdate currenttimestamp "
    "lower upper trim ltrim rtrim length substring concat concatws replace "
    "row_number rownumber rank denserank lag lead firstvalue lastvalue "
    "stddev stddevpop stddevsamp variance variancepop percentilecont "
    "percentiledisc greatest least power sqrt year month day dayofmonth "
    "dayofweek dayofyear week quarter hour minute second".split()
)


def validate_read_only_query(sql: str, dialect: str | None) -> None:
    """Raise before planning or connector creation for unsupported SQL."""
    try:
        statements = parse(sql, dialect=dialect)
        if len(statements) != 1 or not isinstance(
            statements[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)
        ):
            raise ValueError("Expected one analytical query")
        for node in statements[0].walk():
            if isinstance(node, (exp.DML, exp.DDL, exp.Command, exp.Into, exp.Lock)):
                raise ValueError("Query contains an operation with side effects")
            if isinstance(node, exp.Func) and (
                isinstance(node, exp.Anonymous) or node.key not in _FUNCTIONS
            ):
                raise ValueError("Query uses an unsupported function")
            # Qualified calls can resolve to a user-defined function even when
            # their unqualified spelling looks like a built-in aggregate.
            if isinstance(node, exp.Dot) and isinstance(node.expression, exp.Func):
                raise ValueError("Qualified functions are not supported")
    except Exception as error:
        raise WrenError(
            ErrorCode.INVALID_SQL,
            "SQL is not supported by the read-only analytical query policy.",
            phase=ErrorPhase.SQL_PLANNING,
        ) from error
