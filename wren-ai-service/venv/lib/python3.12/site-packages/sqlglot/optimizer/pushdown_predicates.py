from sqlglot import exp
from sqlglot.optimizer.normalize import normalized
from sqlglot.optimizer.scope import build_scope, find_in_scope
from sqlglot.optimizer.simplify import simplify


def pushdown_predicates(expression, dialect=None):
    """
    Rewrite sqlglot AST to pushdown predicates in FROMS and JOINS

    Example:
        >>> import sqlglot
        >>> sql = "SELECT y.a AS a FROM (SELECT x.a AS a FROM x AS x) AS y WHERE y.a = 1"
        >>> expression = sqlglot.parse_one(sql)
        >>> pushdown_predicates(expression).sql()
        'SELECT y.a AS a FROM (SELECT x.a AS a FROM x AS x WHERE x.a = 1) AS y WHERE TRUE'

    Args:
        expression (sqlglot.Expression): expression to optimize
    Returns:
        sqlglot.Expression: optimized expression
    """
    root = build_scope(expression)

    if root:
        scope_ref_count = root.ref_count()

        for scope in reversed(list(root.traverse())):
            select = scope.expression
            where = select.args.get("where")
            if where:
                selected_sources = scope.selected_sources
                join_index = {
                    join.alias_or_name: i for i, join in enumerate(select.args.get("joins") or [])
                }

                # a right join can only push down to itself and not the source FROM table
                for k, (node, source) in selected_sources.items():
                    parent = node.find_ancestor(exp.Join, exp.From)
                    if isinstance(parent, exp.Join) and parent.side == "RIGHT":
                        selected_sources = {k: (node, source)}
                        break

                pushdown(where.this, selected_sources, scope_ref_count, dialect, join_index)

            # joins should only pushdown into itself, not to other joins
            # so we limit the selected sources to only itself
            for join in select.args.get("joins") or []:
                name = join.alias_or_name
                if name in scope.selected_sources:
                    pushdown(
                        join.args.get("on"),
                        {name: scope.selected_sources[name]},
                        scope_ref_count,
                        dialect,
                    )

    return expression


def pushdown(condition, sources, scope_ref_count, dialect, join_index=None):
    if not condition:
        return

    condition = condition.replace(simplify(condition, dialect=dialect))
    cnf_like = normalized(condition) or not normalized(condition, dnf=True)

    predicates = list(
        condition.flatten()
        if isinstance(condition, exp.And if cnf_like else exp.Or)
        else [condition]
    )

    if cnf_like:
        pushdown_cnf(predicates, sources, scope_ref_count, join_index=join_index)
    else:
        pushdown_dnf(predicates, sources, scope_ref_count)


def pushdown_cnf(predicates, sources, scope_ref_count, join_index=None):
    """
    If the predicates are in CNF like form, we can simply replace each block in the parent.
    """
    join_index = join_index or {}
    for predicate in predicates:
        for node in nodes_for_predicate(predicate, sources, scope_ref_count).values():
            if isinstance(node, exp.Join):
                name = node.alias_or_name
                predicate_tables = exp.column_table_names(predicate, name)

                # Don't push the predicate if it references tables that appear in later joins
                this_index = join_index[name]
                if all(join_index.get(table, -1) < this_index for table in predicate_tables):
                    predicate.replace(exp.true())
                    node.on(predicate, copy=False)
                    break
            if isinstance(node, exp.Select):
                predicate.replace(exp.true())
                inner_predicate = replace_aliases(node, predicate)
                if find_in_scope(inner_predicate, exp.AggFunc):
                    node.having(inner_predicate, copy=False)
                else:
                    node.where(inner_predicate, copy=False)


def pushdown_dnf(predicates, sources, scope_ref_count):
    """
    If the predicates are in DNF form, we can only push down conditions that are in all blocks.
    Additionally, we can't remove predicates from their original form.
    """
    # find all the tables that can be pushdown too
    # these are tables that are referenced in all blocks of a DNF
    # (a.x AND b.x) OR (a.y AND c.y)
    # only table a can be push down
    pushdown_tables = set()

    for a in predicates:
        a_tables = exp.column_table_names(a)

        for b in predicates:
            a_tables &= exp.column_table_names(b)

        pushdown_tables.update(a_tables)

    conditions = {}

    # pushdown all predicates to their respective nodes
    for table in sorted(pushdown_tables):
        for predicate in predicates:
            nodes = nodes_for_predicate(predicate, sources, scope_ref_count)

            if table not in nodes:
                continue

            conditions[table] = (
                exp.or_(conditions[table], predicate) if table in conditions else predicate
            )

        for name, node in nodes.items():
            if name not in conditions:
                continue

            predicate = conditions[name]

            if isinstance(node, exp.Join):
                node.on(predicate, copy=False)
            elif isinstance(node, exp.Select):
                inner_predicate = replace_aliases(node, predicate)
                if find_in_scope(inner_predicate, exp.AggFunc):
                    node.having(inner_predicate, copy=False)
                else:
                    node.where(inner_predicate, copy=False)


def nodes_for_predicate(predicate, sources, scope_ref_count):
    nodes = {}
    tables = exp.column_table_names(predicate)
    where_condition = isinstance(predicate.find_ancestor(exp.Join, exp.Where), exp.Where)

    for table in sorted(tables):
        node, source = sources.get(table) or (None, None)

        # if the predicate is in a where statement we can try to push it down
        # we want to find the root join or from statement
        if node and where_condition:
            node = node.find_ancestor(exp.Join, exp.From)

        # a node can reference a CTE which should be pushed down
        if isinstance(node, exp.From) and not isinstance(source, exp.Table):
            with_ = source.parent.expression.args.get("with")
            if with_ and with_.recursive:
                return {}
            node = source.expression

        if isinstance(node, exp.Join):
            if node.side and node.side != "RIGHT":
                return {}
            nodes[table] = node
        elif isinstance(node, exp.Select) and len(tables) == 1:
            # We can't push down window expressions
            has_window_expression = any(
                select for select in node.selects if select.find(exp.Window)
            )
            # we can't push down predicates to select statements if they are referenced in
            # multiple places.
            if (
                not node.args.get("group")
                and scope_ref_count[id(source)] < 2
                and not has_window_expression
            ):
                nodes[table] = node
    return nodes


def replace_aliases(source, predicate):
    aliases = {}

    for select in source.selects:
        if isinstance(select, exp.Alias):
            aliases[select.alias] = select.this
        else:
            aliases[select.name] = select

    def _replace_alias(column):
        if isinstance(column, exp.Column) and column.name in aliases:
            return aliases[column.name].copy()
        return column

    return predicate.transform(_replace_alias)
