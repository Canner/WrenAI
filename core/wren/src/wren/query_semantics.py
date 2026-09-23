"""Conservative query-to-cube provenance for governed analytical checks."""

from sqlglot import exp, parse_one


def query_semantics(ast: exp.Expression, sql: str, manifest: dict) -> dict | None:
    """Resolve a simple cube projection; unsupported SQL earns no semantic proof.

    Never infer declared metrics from aliases, narrative, raw model aggregates or
    arbitrary joins. Cube dimensions may be projected directly because the engine
    owns the cube's aggregate grouping. A sum of a declared measure is also additive;
    other measure transformations do not preserve this proof.
    """
    if not isinstance(ast, exp.Select) or any(
        ast.find(kind) is not None
        for kind in (
            exp.Join,
            exp.Subquery,
            exp.CTE,
            exp.Distinct,
            exp.Window,
            exp.Having,
        )
    ):
        return None
    # Every supported clause is checked below. New dialect clauses must not silently
    # acquire proof just because their columns happen to name known members.
    if any(
        value
        and key
        not in {
            "expressions",
            "from",
            "from_",
            "where",
            "group",
            "order",
            "limit",
            "offset",
        }
        for key, value in ast.args.items()
    ):
        return None
    tables = list(ast.find_all(exp.Table))
    if len(tables) != 1 or tables[0].db or tables[0].catalog:
        return None
    table = tables[0]
    cubes = [
        cube for cube in manifest.get("cubes", []) if cube.get("name") == table.name
    ]
    if len(cubes) != 1:
        return None
    if any(value and key not in {"this", "alias"} for key, value in table.args.items()):
        return None
    cube = cubes[0]
    measures = {item["name"] for item in cube.get("measures", [])}
    dimensions = {item["name"] for item in cube.get("dimensions", [])}
    temporal = {item["name"] for item in cube.get("timeDimensions", [])}
    if measures & (dimensions | temporal) or dimensions & temporal:
        return None
    members = measures | dimensions | temporal
    columns = list(ast.find_all(exp.Column))
    if any(
        col.name not in members or (col.table and col.table != table.alias_or_name)
        for col in columns
    ):
        return None
    selected_metrics: set[str] = set()
    selected_dimensions: set[str] = set()
    for projection in ast.expressions:
        value = projection.this if isinstance(projection, exp.Alias) else projection
        if isinstance(value, exp.Sum):
            value = value.this
            if not isinstance(value, exp.Column) or value.name not in measures:
                return None
        if not isinstance(value, exp.Column):
            return None
        if value.name in measures:
            selected_metrics.add(value.name)
        elif value.name in dimensions:
            selected_dimensions.add(value.name)
    group = ast.args.get("group")
    if group:
        for item in group.expressions:
            if (
                not isinstance(item, exp.Column)
                or item.name not in dimensions | temporal
            ):
                return None
            if item.name in dimensions:
                selected_dimensions.add(item.name)

    def dimension(value):
        return isinstance(value, exp.Column) and value.name in dimensions | temporal

    def literal(value):
        return isinstance(value, (exp.Literal, exp.Boolean, exp.Null))

    def predicate(value):
        if isinstance(value, (exp.And, exp.Or)):
            return predicate(value.this) and predicate(value.expression)
        if isinstance(value, (exp.Paren, exp.Not)):
            return predicate(value.this)
        if isinstance(
            value, (exp.EQ, exp.NEQ, exp.GT, exp.GTE, exp.LT, exp.LTE, exp.Is)
        ):
            return dimension(value.this) and literal(value.expression)
        if isinstance(value, exp.Between):
            return (
                dimension(value.this)
                and literal(value.args.get("low"))
                and literal(value.args.get("high"))
                and not value.args.get("symmetric")
            )
        if isinstance(value, exp.In):
            return (
                dimension(value.this)
                and bool(value.expressions)
                and all(literal(item) for item in value.expressions)
                and not value.args.get("query")
                and not value.args.get("unnest")
            )
        return False

    where = ast.args.get("where")
    if where and not predicate(where.this):
        return None
    order = ast.args.get("order")
    if order and any(
        not isinstance(item, exp.Ordered) or not isinstance(item.this, exp.Column)
        for item in order.expressions
    ):
        return None
    for key in ("limit", "offset"):
        clause = ast.args.get(key)
        if clause and (
            not isinstance(clause.expression, exp.Literal)
            or not clause.expression.is_int
            or int(clause.expression.this) < 0
            or any(value and arg != "expression" for arg, value in clause.args.items())
        ):
            return None
    if group and any(
        value and key != "expressions" for key, value in group.args.items()
    ):
        return None
    # Filters and ordering are analytical dimensions too; counting only projected
    # dimensions lets a query hide arbitrary drill depth in its WHERE clause.
    selected_dimensions.update(col.name for col in columns if col.name in dimensions)
    if not selected_metrics:
        return None
    for name in selected_metrics:
        declarations = [
            item for item in cube.get("measures", []) if item.get("name") == name
        ]
        if len(declarations) != 1:
            return None
        try:
            expression = parse_one(declarations[0]["expression"])
        except Exception:
            return None
        if (
            not isinstance(expression, (exp.Sum, exp.Count))
            or any(
                expression.find(kind) is not None
                for kind in (exp.Distinct, exp.Subquery, exp.Window)
            )
            or len(list(expression.find_all(exp.AggFunc))) != 1
        ):
            return None

    def refs(values):
        return [{"owner": cube["name"], "name": name} for name in sorted(values)]

    return {
        "version": "1",
        "sql": sql,
        "metrics": refs(selected_metrics),
        "dimensions": refs(selected_dimensions),
        "temporal_dimensions": refs(
            {col.name for col in columns if col.name in temporal}
        ),
    }
