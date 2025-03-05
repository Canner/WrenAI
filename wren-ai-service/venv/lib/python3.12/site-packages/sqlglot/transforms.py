from __future__ import annotations

import typing as t

from sqlglot import expressions as exp
from sqlglot.errors import UnsupportedError
from sqlglot.helper import find_new_name, name_sequence


if t.TYPE_CHECKING:
    from sqlglot._typing import E
    from sqlglot.generator import Generator


def preprocess(
    transforms: t.List[t.Callable[[exp.Expression], exp.Expression]],
) -> t.Callable[[Generator, exp.Expression], str]:
    """
    Creates a new transform by chaining a sequence of transformations and converts the resulting
    expression to SQL, using either the "_sql" method corresponding to the resulting expression,
    or the appropriate `Generator.TRANSFORMS` function (when applicable -- see below).

    Args:
        transforms: sequence of transform functions. These will be called in order.

    Returns:
        Function that can be used as a generator transform.
    """

    def _to_sql(self, expression: exp.Expression) -> str:
        expression_type = type(expression)

        try:
            expression = transforms[0](expression)
            for transform in transforms[1:]:
                expression = transform(expression)
        except UnsupportedError as unsupported_error:
            self.unsupported(str(unsupported_error))

        _sql_handler = getattr(self, expression.key + "_sql", None)
        if _sql_handler:
            return _sql_handler(expression)

        transforms_handler = self.TRANSFORMS.get(type(expression))
        if transforms_handler:
            if expression_type is type(expression):
                if isinstance(expression, exp.Func):
                    return self.function_fallback_sql(expression)

                # Ensures we don't enter an infinite loop. This can happen when the original expression
                # has the same type as the final expression and there's no _sql method available for it,
                # because then it'd re-enter _to_sql.
                raise ValueError(
                    f"Expression type {expression.__class__.__name__} requires a _sql method in order to be transformed."
                )

            return transforms_handler(self, expression)

        raise ValueError(f"Unsupported expression type {expression.__class__.__name__}.")

    return _to_sql


def unnest_generate_date_array_using_recursive_cte(expression: exp.Expression) -> exp.Expression:
    if isinstance(expression, exp.Select):
        count = 0
        recursive_ctes = []

        for unnest in expression.find_all(exp.Unnest):
            if (
                not isinstance(unnest.parent, (exp.From, exp.Join))
                or len(unnest.expressions) != 1
                or not isinstance(unnest.expressions[0], exp.GenerateDateArray)
            ):
                continue

            generate_date_array = unnest.expressions[0]
            start = generate_date_array.args.get("start")
            end = generate_date_array.args.get("end")
            step = generate_date_array.args.get("step")

            if not start or not end or not isinstance(step, exp.Interval):
                continue

            alias = unnest.args.get("alias")
            column_name = alias.columns[0] if isinstance(alias, exp.TableAlias) else "date_value"

            start = exp.cast(start, "date")
            date_add = exp.func(
                "date_add", column_name, exp.Literal.number(step.name), step.args.get("unit")
            )
            cast_date_add = exp.cast(date_add, "date")

            cte_name = "_generated_dates" + (f"_{count}" if count else "")

            base_query = exp.select(start.as_(column_name))
            recursive_query = (
                exp.select(cast_date_add)
                .from_(cte_name)
                .where(cast_date_add <= exp.cast(end, "date"))
            )
            cte_query = base_query.union(recursive_query, distinct=False)

            generate_dates_query = exp.select(column_name).from_(cte_name)
            unnest.replace(generate_dates_query.subquery(cte_name))

            recursive_ctes.append(
                exp.alias_(exp.CTE(this=cte_query), cte_name, table=[column_name])
            )
            count += 1

        if recursive_ctes:
            with_expression = expression.args.get("with") or exp.With()
            with_expression.set("recursive", True)
            with_expression.set("expressions", [*recursive_ctes, *with_expression.expressions])
            expression.set("with", with_expression)

    return expression


def unnest_generate_series(expression: exp.Expression) -> exp.Expression:
    """Unnests GENERATE_SERIES or SEQUENCE table references."""
    this = expression.this
    if isinstance(expression, exp.Table) and isinstance(this, exp.GenerateSeries):
        unnest = exp.Unnest(expressions=[this])
        if expression.alias:
            return exp.alias_(unnest, alias="_u", table=[expression.alias], copy=False)

        return unnest

    return expression


def unalias_group(expression: exp.Expression) -> exp.Expression:
    """
    Replace references to select aliases in GROUP BY clauses.

    Example:
        >>> import sqlglot
        >>> sqlglot.parse_one("SELECT a AS b FROM x GROUP BY b").transform(unalias_group).sql()
        'SELECT a AS b FROM x GROUP BY 1'

    Args:
        expression: the expression that will be transformed.

    Returns:
        The transformed expression.
    """
    if isinstance(expression, exp.Group) and isinstance(expression.parent, exp.Select):
        aliased_selects = {
            e.alias: i
            for i, e in enumerate(expression.parent.expressions, start=1)
            if isinstance(e, exp.Alias)
        }

        for group_by in expression.expressions:
            if (
                isinstance(group_by, exp.Column)
                and not group_by.table
                and group_by.name in aliased_selects
            ):
                group_by.replace(exp.Literal.number(aliased_selects.get(group_by.name)))

    return expression


def eliminate_distinct_on(expression: exp.Expression) -> exp.Expression:
    """
    Convert SELECT DISTINCT ON statements to a subquery with a window function.

    This is useful for dialects that don't support SELECT DISTINCT ON but support window functions.

    Args:
        expression: the expression that will be transformed.

    Returns:
        The transformed expression.
    """
    if (
        isinstance(expression, exp.Select)
        and expression.args.get("distinct")
        and isinstance(expression.args["distinct"].args.get("on"), exp.Tuple)
    ):
        row_number_window_alias = find_new_name(expression.named_selects, "_row_number")

        distinct_cols = expression.args["distinct"].pop().args["on"].expressions
        window = exp.Window(this=exp.RowNumber(), partition_by=distinct_cols)

        order = expression.args.get("order")
        if order:
            window.set("order", order.pop())
        else:
            window.set("order", exp.Order(expressions=[c.copy() for c in distinct_cols]))

        window = exp.alias_(window, row_number_window_alias)
        expression.select(window, copy=False)

        # We add aliases to the projections so that we can safely reference them in the outer query
        new_selects = []
        taken_names = {row_number_window_alias}
        for select in expression.selects[:-1]:
            if select.is_star:
                new_selects = [exp.Star()]
                break

            if not isinstance(select, exp.Alias):
                alias = find_new_name(taken_names, select.output_name or "_col")
                quoted = select.this.args.get("quoted") if isinstance(select, exp.Column) else None
                select = select.replace(exp.alias_(select, alias, quoted=quoted))

            taken_names.add(select.output_name)
            new_selects.append(select.args["alias"])

        return (
            exp.select(*new_selects, copy=False)
            .from_(expression.subquery("_t", copy=False), copy=False)
            .where(exp.column(row_number_window_alias).eq(1), copy=False)
        )

    return expression


def eliminate_qualify(expression: exp.Expression) -> exp.Expression:
    """
    Convert SELECT statements that contain the QUALIFY clause into subqueries, filtered equivalently.

    The idea behind this transformation can be seen in Snowflake's documentation for QUALIFY:
    https://docs.snowflake.com/en/sql-reference/constructs/qualify

    Some dialects don't support window functions in the WHERE clause, so we need to include them as
    projections in the subquery, in order to refer to them in the outer filter using aliases. Also,
    if a column is referenced in the QUALIFY clause but is not selected, we need to include it too,
    otherwise we won't be able to refer to it in the outer query's WHERE clause. Finally, if a
    newly aliased projection is referenced in the QUALIFY clause, it will be replaced by the
    corresponding expression to avoid creating invalid column references.
    """
    if isinstance(expression, exp.Select) and expression.args.get("qualify"):
        taken = set(expression.named_selects)
        for select in expression.selects:
            if not select.alias_or_name:
                alias = find_new_name(taken, "_c")
                select.replace(exp.alias_(select, alias))
                taken.add(alias)

        def _select_alias_or_name(select: exp.Expression) -> str | exp.Column:
            alias_or_name = select.alias_or_name
            identifier = select.args.get("alias") or select.this
            if isinstance(identifier, exp.Identifier):
                return exp.column(alias_or_name, quoted=identifier.args.get("quoted"))
            return alias_or_name

        outer_selects = exp.select(*list(map(_select_alias_or_name, expression.selects)))
        qualify_filters = expression.args["qualify"].pop().this
        expression_by_alias = {
            select.alias: select.this
            for select in expression.selects
            if isinstance(select, exp.Alias)
        }

        select_candidates = exp.Window if expression.is_star else (exp.Window, exp.Column)
        for select_candidate in qualify_filters.find_all(select_candidates):
            if isinstance(select_candidate, exp.Window):
                if expression_by_alias:
                    for column in select_candidate.find_all(exp.Column):
                        expr = expression_by_alias.get(column.name)
                        if expr:
                            column.replace(expr)

                alias = find_new_name(expression.named_selects, "_w")
                expression.select(exp.alias_(select_candidate, alias), copy=False)
                column = exp.column(alias)

                if isinstance(select_candidate.parent, exp.Qualify):
                    qualify_filters = column
                else:
                    select_candidate.replace(column)
            elif select_candidate.name not in expression.named_selects:
                expression.select(select_candidate.copy(), copy=False)

        return outer_selects.from_(expression.subquery(alias="_t", copy=False), copy=False).where(
            qualify_filters, copy=False
        )

    return expression


def remove_precision_parameterized_types(expression: exp.Expression) -> exp.Expression:
    """
    Some dialects only allow the precision for parameterized types to be defined in the DDL and not in
    other expressions. This transforms removes the precision from parameterized types in expressions.
    """
    for node in expression.find_all(exp.DataType):
        node.set(
            "expressions", [e for e in node.expressions if not isinstance(e, exp.DataTypeParam)]
        )

    return expression


def unqualify_unnest(expression: exp.Expression) -> exp.Expression:
    """Remove references to unnest table aliases, added by the optimizer's qualify_columns step."""
    from sqlglot.optimizer.scope import find_all_in_scope

    if isinstance(expression, exp.Select):
        unnest_aliases = {
            unnest.alias
            for unnest in find_all_in_scope(expression, exp.Unnest)
            if isinstance(unnest.parent, (exp.From, exp.Join))
        }
        if unnest_aliases:
            for column in expression.find_all(exp.Column):
                if column.table in unnest_aliases:
                    column.set("table", None)
                elif column.db in unnest_aliases:
                    column.set("db", None)

    return expression


def unnest_to_explode(
    expression: exp.Expression,
    unnest_using_arrays_zip: bool = True,
) -> exp.Expression:
    """Convert cross join unnest into lateral view explode."""

    def _unnest_zip_exprs(
        u: exp.Unnest, unnest_exprs: t.List[exp.Expression], has_multi_expr: bool
    ) -> t.List[exp.Expression]:
        if has_multi_expr:
            if not unnest_using_arrays_zip:
                raise UnsupportedError("Cannot transpile UNNEST with multiple input arrays")

            # Use INLINE(ARRAYS_ZIP(...)) for multiple expressions
            zip_exprs: t.List[exp.Expression] = [
                exp.Anonymous(this="ARRAYS_ZIP", expressions=unnest_exprs)
            ]
            u.set("expressions", zip_exprs)
            return zip_exprs
        return unnest_exprs

    def _udtf_type(u: exp.Unnest, has_multi_expr: bool) -> t.Type[exp.Func]:
        if u.args.get("offset"):
            return exp.Posexplode
        return exp.Inline if has_multi_expr else exp.Explode

    if isinstance(expression, exp.Select):
        from_ = expression.args.get("from")

        if from_ and isinstance(from_.this, exp.Unnest):
            unnest = from_.this
            alias = unnest.args.get("alias")
            exprs = unnest.expressions
            has_multi_expr = len(exprs) > 1
            this, *expressions = _unnest_zip_exprs(unnest, exprs, has_multi_expr)

            unnest.replace(
                exp.Table(
                    this=_udtf_type(unnest, has_multi_expr)(
                        this=this,
                        expressions=expressions,
                    ),
                    alias=exp.TableAlias(this=alias.this, columns=alias.columns) if alias else None,
                )
            )

        joins = expression.args.get("joins") or []
        for join in list(joins):
            join_expr = join.this

            is_lateral = isinstance(join_expr, exp.Lateral)

            unnest = join_expr.this if is_lateral else join_expr

            if isinstance(unnest, exp.Unnest):
                if is_lateral:
                    alias = join_expr.args.get("alias")
                else:
                    alias = unnest.args.get("alias")
                exprs = unnest.expressions
                # The number of unnest.expressions will be changed by _unnest_zip_exprs, we need to record it here
                has_multi_expr = len(exprs) > 1
                exprs = _unnest_zip_exprs(unnest, exprs, has_multi_expr)

                joins.remove(join)

                alias_cols = alias.columns if alias else []

                # # Handle UNNEST to LATERAL VIEW EXPLODE: Exception is raised when there are 0 or > 2 aliases
                # Spark LATERAL VIEW EXPLODE requires single alias for array/struct and two for Map type column unlike unnest in trino/presto which can take an arbitrary amount.
                # Refs: https://spark.apache.org/docs/latest/sql-ref-syntax-qry-select-lateral-view.html

                if not has_multi_expr and len(alias_cols) not in (1, 2):
                    raise UnsupportedError(
                        "CROSS JOIN UNNEST to LATERAL VIEW EXPLODE transformation requires explicit column aliases"
                    )

                for e, column in zip(exprs, alias_cols):
                    expression.append(
                        "laterals",
                        exp.Lateral(
                            this=_udtf_type(unnest, has_multi_expr)(this=e),
                            view=True,
                            alias=exp.TableAlias(
                                this=alias.this,  # type: ignore
                                columns=alias_cols,
                            ),
                        ),
                    )

    return expression


def explode_to_unnest(index_offset: int = 0) -> t.Callable[[exp.Expression], exp.Expression]:
    """Convert explode/posexplode into unnest."""

    def _explode_to_unnest(expression: exp.Expression) -> exp.Expression:
        if isinstance(expression, exp.Select):
            from sqlglot.optimizer.scope import Scope

            taken_select_names = set(expression.named_selects)
            taken_source_names = {name for name, _ in Scope(expression).references}

            def new_name(names: t.Set[str], name: str) -> str:
                name = find_new_name(names, name)
                names.add(name)
                return name

            arrays: t.List[exp.Condition] = []
            series_alias = new_name(taken_select_names, "pos")
            series = exp.alias_(
                exp.Unnest(
                    expressions=[exp.GenerateSeries(start=exp.Literal.number(index_offset))]
                ),
                new_name(taken_source_names, "_u"),
                table=[series_alias],
            )

            # we use list here because expression.selects is mutated inside the loop
            for select in list(expression.selects):
                explode = select.find(exp.Explode)

                if explode:
                    pos_alias = ""
                    explode_alias = ""

                    if isinstance(select, exp.Alias):
                        explode_alias = select.args["alias"]
                        alias = select
                    elif isinstance(select, exp.Aliases):
                        pos_alias = select.aliases[0]
                        explode_alias = select.aliases[1]
                        alias = select.replace(exp.alias_(select.this, "", copy=False))
                    else:
                        alias = select.replace(exp.alias_(select, ""))
                        explode = alias.find(exp.Explode)
                        assert explode

                    is_posexplode = isinstance(explode, exp.Posexplode)
                    explode_arg = explode.this

                    if isinstance(explode, exp.ExplodeOuter):
                        bracket = explode_arg[0]
                        bracket.set("safe", True)
                        bracket.set("offset", True)
                        explode_arg = exp.func(
                            "IF",
                            exp.func(
                                "ARRAY_SIZE", exp.func("COALESCE", explode_arg, exp.Array())
                            ).eq(0),
                            exp.array(bracket, copy=False),
                            explode_arg,
                        )

                    # This ensures that we won't use [POS]EXPLODE's argument as a new selection
                    if isinstance(explode_arg, exp.Column):
                        taken_select_names.add(explode_arg.output_name)

                    unnest_source_alias = new_name(taken_source_names, "_u")

                    if not explode_alias:
                        explode_alias = new_name(taken_select_names, "col")

                        if is_posexplode:
                            pos_alias = new_name(taken_select_names, "pos")

                    if not pos_alias:
                        pos_alias = new_name(taken_select_names, "pos")

                    alias.set("alias", exp.to_identifier(explode_alias))

                    series_table_alias = series.args["alias"].this
                    column = exp.If(
                        this=exp.column(series_alias, table=series_table_alias).eq(
                            exp.column(pos_alias, table=unnest_source_alias)
                        ),
                        true=exp.column(explode_alias, table=unnest_source_alias),
                    )

                    explode.replace(column)

                    if is_posexplode:
                        expressions = expression.expressions
                        expressions.insert(
                            expressions.index(alias) + 1,
                            exp.If(
                                this=exp.column(series_alias, table=series_table_alias).eq(
                                    exp.column(pos_alias, table=unnest_source_alias)
                                ),
                                true=exp.column(pos_alias, table=unnest_source_alias),
                            ).as_(pos_alias),
                        )
                        expression.set("expressions", expressions)

                    if not arrays:
                        if expression.args.get("from"):
                            expression.join(series, copy=False, join_type="CROSS")
                        else:
                            expression.from_(series, copy=False)

                    size: exp.Condition = exp.ArraySize(this=explode_arg.copy())
                    arrays.append(size)

                    # trino doesn't support left join unnest with on conditions
                    # if it did, this would be much simpler
                    expression.join(
                        exp.alias_(
                            exp.Unnest(
                                expressions=[explode_arg.copy()],
                                offset=exp.to_identifier(pos_alias),
                            ),
                            unnest_source_alias,
                            table=[explode_alias],
                        ),
                        join_type="CROSS",
                        copy=False,
                    )

                    if index_offset != 1:
                        size = size - 1

                    expression.where(
                        exp.column(series_alias, table=series_table_alias)
                        .eq(exp.column(pos_alias, table=unnest_source_alias))
                        .or_(
                            (exp.column(series_alias, table=series_table_alias) > size).and_(
                                exp.column(pos_alias, table=unnest_source_alias).eq(size)
                            )
                        ),
                        copy=False,
                    )

            if arrays:
                end: exp.Condition = exp.Greatest(this=arrays[0], expressions=arrays[1:])

                if index_offset != 1:
                    end = end - (1 - index_offset)
                series.expressions[0].set("end", end)

        return expression

    return _explode_to_unnest


def add_within_group_for_percentiles(expression: exp.Expression) -> exp.Expression:
    """Transforms percentiles by adding a WITHIN GROUP clause to them."""
    if (
        isinstance(expression, exp.PERCENTILES)
        and not isinstance(expression.parent, exp.WithinGroup)
        and expression.expression
    ):
        column = expression.this.pop()
        expression.set("this", expression.expression.pop())
        order = exp.Order(expressions=[exp.Ordered(this=column)])
        expression = exp.WithinGroup(this=expression, expression=order)

    return expression


def remove_within_group_for_percentiles(expression: exp.Expression) -> exp.Expression:
    """Transforms percentiles by getting rid of their corresponding WITHIN GROUP clause."""
    if (
        isinstance(expression, exp.WithinGroup)
        and isinstance(expression.this, exp.PERCENTILES)
        and isinstance(expression.expression, exp.Order)
    ):
        quantile = expression.this.this
        input_value = t.cast(exp.Ordered, expression.find(exp.Ordered)).this
        return expression.replace(exp.ApproxQuantile(this=input_value, quantile=quantile))

    return expression


def add_recursive_cte_column_names(expression: exp.Expression) -> exp.Expression:
    """Uses projection output names in recursive CTE definitions to define the CTEs' columns."""
    if isinstance(expression, exp.With) and expression.recursive:
        next_name = name_sequence("_c_")

        for cte in expression.expressions:
            if not cte.args["alias"].columns:
                query = cte.this
                if isinstance(query, exp.SetOperation):
                    query = query.this

                cte.args["alias"].set(
                    "columns",
                    [exp.to_identifier(s.alias_or_name or next_name()) for s in query.selects],
                )

    return expression


def epoch_cast_to_ts(expression: exp.Expression) -> exp.Expression:
    """Replace 'epoch' in casts by the equivalent date literal."""
    if (
        isinstance(expression, (exp.Cast, exp.TryCast))
        and expression.name.lower() == "epoch"
        and expression.to.this in exp.DataType.TEMPORAL_TYPES
    ):
        expression.this.replace(exp.Literal.string("1970-01-01 00:00:00"))

    return expression


def eliminate_semi_and_anti_joins(expression: exp.Expression) -> exp.Expression:
    """Convert SEMI and ANTI joins into equivalent forms that use EXIST instead."""
    if isinstance(expression, exp.Select):
        for join in expression.args.get("joins") or []:
            on = join.args.get("on")
            if on and join.kind in ("SEMI", "ANTI"):
                subquery = exp.select("1").from_(join.this).where(on)
                exists = exp.Exists(this=subquery)
                if join.kind == "ANTI":
                    exists = exists.not_(copy=False)

                join.pop()
                expression.where(exists, copy=False)

    return expression


def eliminate_full_outer_join(expression: exp.Expression) -> exp.Expression:
    """
    Converts a query with a FULL OUTER join to a union of identical queries that
    use LEFT/RIGHT OUTER joins instead. This transformation currently only works
    for queries that have a single FULL OUTER join.
    """
    if isinstance(expression, exp.Select):
        full_outer_joins = [
            (index, join)
            for index, join in enumerate(expression.args.get("joins") or [])
            if join.side == "FULL"
        ]

        if len(full_outer_joins) == 1:
            expression_copy = expression.copy()
            expression.set("limit", None)
            index, full_outer_join = full_outer_joins[0]

            tables = (expression.args["from"].alias_or_name, full_outer_join.alias_or_name)
            join_conditions = full_outer_join.args.get("on") or exp.and_(
                *[
                    exp.column(col, tables[0]).eq(exp.column(col, tables[1]))
                    for col in full_outer_join.args.get("using")
                ]
            )

            full_outer_join.set("side", "left")
            anti_join_clause = exp.select("1").from_(expression.args["from"]).where(join_conditions)
            expression_copy.args["joins"][index].set("side", "right")
            expression_copy = expression_copy.where(exp.Exists(this=anti_join_clause).not_())
            expression_copy.args.pop("with", None)  # remove CTEs from RIGHT side
            expression.args.pop("order", None)  # remove order by from LEFT side

            return exp.union(expression, expression_copy, copy=False, distinct=False)

    return expression


def move_ctes_to_top_level(expression: E) -> E:
    """
    Some dialects (e.g. Hive, T-SQL, Spark prior to version 3) only allow CTEs to be
    defined at the top-level, so for example queries like:

        SELECT * FROM (WITH t(c) AS (SELECT 1) SELECT * FROM t) AS subq

    are invalid in those dialects. This transformation can be used to ensure all CTEs are
    moved to the top level so that the final SQL code is valid from a syntax standpoint.

    TODO: handle name clashes whilst moving CTEs (it can get quite tricky & costly).
    """
    top_level_with = expression.args.get("with")
    for inner_with in expression.find_all(exp.With):
        if inner_with.parent is expression:
            continue

        if not top_level_with:
            top_level_with = inner_with.pop()
            expression.set("with", top_level_with)
        else:
            if inner_with.recursive:
                top_level_with.set("recursive", True)

            parent_cte = inner_with.find_ancestor(exp.CTE)
            inner_with.pop()

            if parent_cte:
                i = top_level_with.expressions.index(parent_cte)
                top_level_with.expressions[i:i] = inner_with.expressions
                top_level_with.set("expressions", top_level_with.expressions)
            else:
                top_level_with.set(
                    "expressions", top_level_with.expressions + inner_with.expressions
                )

    return expression


def ensure_bools(expression: exp.Expression) -> exp.Expression:
    """Converts numeric values used in conditions into explicit boolean expressions."""
    from sqlglot.optimizer.canonicalize import ensure_bools

    def _ensure_bool(node: exp.Expression) -> None:
        if (
            node.is_number
            or (
                not isinstance(node, exp.SubqueryPredicate)
                and node.is_type(exp.DataType.Type.UNKNOWN, *exp.DataType.NUMERIC_TYPES)
            )
            or (isinstance(node, exp.Column) and not node.type)
        ):
            node.replace(node.neq(0))

    for node in expression.walk():
        ensure_bools(node, _ensure_bool)

    return expression


def unqualify_columns(expression: exp.Expression) -> exp.Expression:
    for column in expression.find_all(exp.Column):
        # We only wanna pop off the table, db, catalog args
        for part in column.parts[:-1]:
            part.pop()

    return expression


def remove_unique_constraints(expression: exp.Expression) -> exp.Expression:
    assert isinstance(expression, exp.Create)
    for constraint in expression.find_all(exp.UniqueColumnConstraint):
        if constraint.parent:
            constraint.parent.pop()

    return expression


def ctas_with_tmp_tables_to_create_tmp_view(
    expression: exp.Expression,
    tmp_storage_provider: t.Callable[[exp.Expression], exp.Expression] = lambda e: e,
) -> exp.Expression:
    assert isinstance(expression, exp.Create)
    properties = expression.args.get("properties")
    temporary = any(
        isinstance(prop, exp.TemporaryProperty)
        for prop in (properties.expressions if properties else [])
    )

    # CTAS with temp tables map to CREATE TEMPORARY VIEW
    if expression.kind == "TABLE" and temporary:
        if expression.expression:
            return exp.Create(
                kind="TEMPORARY VIEW",
                this=expression.this,
                expression=expression.expression,
            )
        return tmp_storage_provider(expression)

    return expression


def move_schema_columns_to_partitioned_by(expression: exp.Expression) -> exp.Expression:
    """
    In Hive, the PARTITIONED BY property acts as an extension of a table's schema. When the
    PARTITIONED BY value is an array of column names, they are transformed into a schema.
    The corresponding columns are removed from the create statement.
    """
    assert isinstance(expression, exp.Create)
    has_schema = isinstance(expression.this, exp.Schema)
    is_partitionable = expression.kind in {"TABLE", "VIEW"}

    if has_schema and is_partitionable:
        prop = expression.find(exp.PartitionedByProperty)
        if prop and prop.this and not isinstance(prop.this, exp.Schema):
            schema = expression.this
            columns = {v.name.upper() for v in prop.this.expressions}
            partitions = [col for col in schema.expressions if col.name.upper() in columns]
            schema.set("expressions", [e for e in schema.expressions if e not in partitions])
            prop.replace(exp.PartitionedByProperty(this=exp.Schema(expressions=partitions)))
            expression.set("this", schema)

    return expression


def move_partitioned_by_to_schema_columns(expression: exp.Expression) -> exp.Expression:
    """
    Spark 3 supports both "HIVEFORMAT" and "DATASOURCE" formats for CREATE TABLE.

    Currently, SQLGlot uses the DATASOURCE format for Spark 3.
    """
    assert isinstance(expression, exp.Create)
    prop = expression.find(exp.PartitionedByProperty)
    if (
        prop
        and prop.this
        and isinstance(prop.this, exp.Schema)
        and all(isinstance(e, exp.ColumnDef) and e.kind for e in prop.this.expressions)
    ):
        prop_this = exp.Tuple(
            expressions=[exp.to_identifier(e.this) for e in prop.this.expressions]
        )
        schema = expression.this
        for e in prop.this.expressions:
            schema.append("expressions", e)
        prop.set("this", prop_this)

    return expression


def struct_kv_to_alias(expression: exp.Expression) -> exp.Expression:
    """Converts struct arguments to aliases, e.g. STRUCT(1 AS y)."""
    if isinstance(expression, exp.Struct):
        expression.set(
            "expressions",
            [
                exp.alias_(e.expression, e.this) if isinstance(e, exp.PropertyEQ) else e
                for e in expression.expressions
            ],
        )

    return expression


def eliminate_join_marks(expression: exp.Expression) -> exp.Expression:
    """
    Remove join marks from an AST. This rule assumes that all marked columns are qualified.
    If this does not hold for a query, consider running `sqlglot.optimizer.qualify` first.

    For example,
        SELECT * FROM a, b WHERE a.id = b.id(+)    -- ... is converted to
        SELECT * FROM a LEFT JOIN b ON a.id = b.id -- this

    Args:
        expression: The AST to remove join marks from.

    Returns:
       The AST with join marks removed.
    """
    from sqlglot.optimizer.scope import traverse_scope

    for scope in traverse_scope(expression):
        query = scope.expression

        where = query.args.get("where")
        joins = query.args.get("joins")

        if not where or not joins:
            continue

        query_from = query.args["from"]

        # These keep track of the joins to be replaced
        new_joins: t.Dict[str, exp.Join] = {}
        old_joins = {join.alias_or_name: join for join in joins}

        for column in scope.columns:
            if not column.args.get("join_mark"):
                continue

            predicate = column.find_ancestor(exp.Predicate, exp.Select)
            assert isinstance(
                predicate, exp.Binary
            ), "Columns can only be marked with (+) when involved in a binary operation"

            predicate_parent = predicate.parent
            join_predicate = predicate.pop()

            left_columns = [
                c for c in join_predicate.left.find_all(exp.Column) if c.args.get("join_mark")
            ]
            right_columns = [
                c for c in join_predicate.right.find_all(exp.Column) if c.args.get("join_mark")
            ]

            assert not (
                left_columns and right_columns
            ), "The (+) marker cannot appear in both sides of a binary predicate"

            marked_column_tables = set()
            for col in left_columns or right_columns:
                table = col.table
                assert table, f"Column {col} needs to be qualified with a table"

                col.set("join_mark", False)
                marked_column_tables.add(table)

            assert (
                len(marked_column_tables) == 1
            ), "Columns of only a single table can be marked with (+) in a given binary predicate"

            join_this = old_joins.get(col.table, query_from).this
            new_join = exp.Join(this=join_this, on=join_predicate, kind="LEFT")

            # Upsert new_join into new_joins dictionary
            new_join_alias_or_name = new_join.alias_or_name
            existing_join = new_joins.get(new_join_alias_or_name)
            if existing_join:
                existing_join.set("on", exp.and_(existing_join.args.get("on"), new_join.args["on"]))
            else:
                new_joins[new_join_alias_or_name] = new_join

            # If the parent of the target predicate is a binary node, then it now has only one child
            if isinstance(predicate_parent, exp.Binary):
                if predicate_parent.left is None:
                    predicate_parent.replace(predicate_parent.right)
                else:
                    predicate_parent.replace(predicate_parent.left)

        if query_from.alias_or_name in new_joins:
            only_old_joins = old_joins.keys() - new_joins.keys()
            assert (
                len(only_old_joins) >= 1
            ), "Cannot determine which table to use in the new FROM clause"

            new_from_name = list(only_old_joins)[0]
            query.set("from", exp.From(this=old_joins[new_from_name].this))

        query.set("joins", list(new_joins.values()))

        if not where.this:
            where.pop()

    return expression


def any_to_exists(expression: exp.Expression) -> exp.Expression:
    """
    Transform ANY operator to Spark's EXISTS

    For example,
        - Postgres: SELECT * FROM tbl WHERE 5 > ANY(tbl.col)
        - Spark: SELECT * FROM tbl WHERE EXISTS(tbl.col, x -> x < 5)

    Both ANY and EXISTS accept queries but currently only array expressions are supported for this
    transformation
    """
    if isinstance(expression, exp.Select):
        for any in expression.find_all(exp.Any):
            this = any.this
            if isinstance(this, exp.Query):
                continue

            binop = any.parent
            if isinstance(binop, exp.Binary):
                lambda_arg = exp.to_identifier("x")
                any.replace(lambda_arg)
                lambda_expr = exp.Lambda(this=binop.copy(), expressions=[lambda_arg])
                binop.replace(exp.Exists(this=this.unnest(), expression=lambda_expr))

    return expression
