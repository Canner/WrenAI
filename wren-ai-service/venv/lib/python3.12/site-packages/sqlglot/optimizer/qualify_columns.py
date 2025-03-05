from __future__ import annotations

import itertools
import typing as t

from sqlglot import alias, exp
from sqlglot.dialects.dialect import Dialect, DialectType
from sqlglot.errors import OptimizeError
from sqlglot.helper import seq_get, SingleValuedMapping
from sqlglot.optimizer.annotate_types import TypeAnnotator
from sqlglot.optimizer.scope import Scope, build_scope, traverse_scope, walk_in_scope
from sqlglot.optimizer.simplify import simplify_parens
from sqlglot.schema import Schema, ensure_schema

if t.TYPE_CHECKING:
    from sqlglot._typing import E


def qualify_columns(
    expression: exp.Expression,
    schema: t.Dict | Schema,
    expand_alias_refs: bool = True,
    expand_stars: bool = True,
    infer_schema: t.Optional[bool] = None,
    allow_partial_qualification: bool = False,
) -> exp.Expression:
    """
    Rewrite sqlglot AST to have fully qualified columns.

    Example:
        >>> import sqlglot
        >>> schema = {"tbl": {"col": "INT"}}
        >>> expression = sqlglot.parse_one("SELECT col FROM tbl")
        >>> qualify_columns(expression, schema).sql()
        'SELECT tbl.col AS col FROM tbl'

    Args:
        expression: Expression to qualify.
        schema: Database schema.
        expand_alias_refs: Whether to expand references to aliases.
        expand_stars: Whether to expand star queries. This is a necessary step
            for most of the optimizer's rules to work; do not set to False unless you
            know what you're doing!
        infer_schema: Whether to infer the schema if missing.
        allow_partial_qualification: Whether to allow partial qualification.

    Returns:
        The qualified expression.

    Notes:
        - Currently only handles a single PIVOT or UNPIVOT operator
    """
    schema = ensure_schema(schema)
    annotator = TypeAnnotator(schema)
    infer_schema = schema.empty if infer_schema is None else infer_schema
    dialect = Dialect.get_or_raise(schema.dialect)
    pseudocolumns = dialect.PSEUDOCOLUMNS

    for scope in traverse_scope(expression):
        resolver = Resolver(scope, schema, infer_schema=infer_schema)
        _pop_table_column_aliases(scope.ctes)
        _pop_table_column_aliases(scope.derived_tables)
        using_column_tables = _expand_using(scope, resolver)

        if (schema.empty or dialect.FORCE_EARLY_ALIAS_REF_EXPANSION) and expand_alias_refs:
            _expand_alias_refs(
                scope,
                resolver,
                expand_only_groupby=dialect.EXPAND_ALIAS_REFS_EARLY_ONLY_IN_GROUP_BY,
            )

        _convert_columns_to_dots(scope, resolver)
        _qualify_columns(scope, resolver, allow_partial_qualification=allow_partial_qualification)

        if not schema.empty and expand_alias_refs:
            _expand_alias_refs(scope, resolver)

        if not isinstance(scope.expression, exp.UDTF):
            if expand_stars:
                _expand_stars(
                    scope,
                    resolver,
                    using_column_tables,
                    pseudocolumns,
                    annotator,
                )
            qualify_outputs(scope)

        _expand_group_by(scope, dialect)
        _expand_order_by(scope, resolver)

        if dialect == "bigquery":
            annotator.annotate_scope(scope)

    return expression


def validate_qualify_columns(expression: E) -> E:
    """Raise an `OptimizeError` if any columns aren't qualified"""
    all_unqualified_columns = []
    for scope in traverse_scope(expression):
        if isinstance(scope.expression, exp.Select):
            unqualified_columns = scope.unqualified_columns

            if scope.external_columns and not scope.is_correlated_subquery and not scope.pivots:
                column = scope.external_columns[0]
                for_table = f" for table: '{column.table}'" if column.table else ""
                raise OptimizeError(f"Column '{column}' could not be resolved{for_table}")

            if unqualified_columns and scope.pivots and scope.pivots[0].unpivot:
                # New columns produced by the UNPIVOT can't be qualified, but there may be columns
                # under the UNPIVOT's IN clause that can and should be qualified. We recompute
                # this list here to ensure those in the former category will be excluded.
                unpivot_columns = set(_unpivot_columns(scope.pivots[0]))
                unqualified_columns = [c for c in unqualified_columns if c not in unpivot_columns]

            all_unqualified_columns.extend(unqualified_columns)

    if all_unqualified_columns:
        raise OptimizeError(f"Ambiguous columns: {all_unqualified_columns}")

    return expression


def _unpivot_columns(unpivot: exp.Pivot) -> t.Iterator[exp.Column]:
    name_column = []
    field = unpivot.args.get("field")
    if isinstance(field, exp.In) and isinstance(field.this, exp.Column):
        name_column.append(field.this)

    value_columns = (c for e in unpivot.expressions for c in e.find_all(exp.Column))
    return itertools.chain(name_column, value_columns)


def _pop_table_column_aliases(derived_tables: t.List[exp.CTE | exp.Subquery]) -> None:
    """
    Remove table column aliases.

    For example, `col1` and `col2` will be dropped in SELECT ... FROM (SELECT ...) AS foo(col1, col2)
    """
    for derived_table in derived_tables:
        if isinstance(derived_table.parent, exp.With) and derived_table.parent.recursive:
            continue
        table_alias = derived_table.args.get("alias")
        if table_alias:
            table_alias.args.pop("columns", None)


def _expand_using(scope: Scope, resolver: Resolver) -> t.Dict[str, t.Any]:
    columns = {}

    def _update_source_columns(source_name: str) -> None:
        for column_name in resolver.get_source_columns(source_name):
            if column_name not in columns:
                columns[column_name] = source_name

    joins = list(scope.find_all(exp.Join))
    names = {join.alias_or_name for join in joins}
    ordered = [key for key in scope.selected_sources if key not in names]

    # Mapping of automatically joined column names to an ordered set of source names (dict).
    column_tables: t.Dict[str, t.Dict[str, t.Any]] = {}

    for source_name in ordered:
        _update_source_columns(source_name)

    for i, join in enumerate(joins):
        source_table = ordered[-1]
        if source_table:
            _update_source_columns(source_table)

        join_table = join.alias_or_name
        ordered.append(join_table)

        using = join.args.get("using")
        if not using:
            continue

        join_columns = resolver.get_source_columns(join_table)
        conditions = []
        using_identifier_count = len(using)

        for identifier in using:
            identifier = identifier.name
            table = columns.get(identifier)

            if not table or identifier not in join_columns:
                if (columns and "*" not in columns) and join_columns:
                    raise OptimizeError(f"Cannot automatically join: {identifier}")

            table = table or source_table

            if i == 0 or using_identifier_count == 1:
                lhs: exp.Expression = exp.column(identifier, table=table)
            else:
                coalesce_columns = [
                    exp.column(identifier, table=t)
                    for t in ordered[:-1]
                    if identifier in resolver.get_source_columns(t)
                ]
                if len(coalesce_columns) > 1:
                    lhs = exp.func("coalesce", *coalesce_columns)
                else:
                    lhs = exp.column(identifier, table=table)

            conditions.append(lhs.eq(exp.column(identifier, table=join_table)))

            # Set all values in the dict to None, because we only care about the key ordering
            tables = column_tables.setdefault(identifier, {})
            if table not in tables:
                tables[table] = None
            if join_table not in tables:
                tables[join_table] = None

        join.args.pop("using")
        join.set("on", exp.and_(*conditions, copy=False))

    if column_tables:
        for column in scope.columns:
            if not column.table and column.name in column_tables:
                tables = column_tables[column.name]
                coalesce_args = [exp.column(column.name, table=table) for table in tables]
                replacement: exp.Expression = exp.func("coalesce", *coalesce_args)

                if isinstance(column.parent, exp.Select):
                    # Ensure the USING column keeps its name if it's projected
                    replacement = alias(replacement, alias=column.name, copy=False)
                elif isinstance(column.parent, exp.Struct):
                    # Ensure the USING column keeps its name if it's an anonymous STRUCT field
                    replacement = exp.PropertyEQ(
                        this=exp.to_identifier(column.name), expression=replacement
                    )

                scope.replace(column, replacement)

    return column_tables


def _expand_alias_refs(scope: Scope, resolver: Resolver, expand_only_groupby: bool = False) -> None:
    expression = scope.expression

    if not isinstance(expression, exp.Select):
        return

    alias_to_expression: t.Dict[str, t.Tuple[exp.Expression, int]] = {}

    def replace_columns(
        node: t.Optional[exp.Expression], resolve_table: bool = False, literal_index: bool = False
    ) -> None:
        is_group_by = isinstance(node, exp.Group)
        if not node or (expand_only_groupby and not is_group_by):
            return

        for column in walk_in_scope(node, prune=lambda node: node.is_star):
            if not isinstance(column, exp.Column):
                continue

            # BigQuery's GROUP BY allows alias expansion only for standalone names, e.g:
            #   SELECT FUNC(col) AS col FROM t GROUP BY col --> Can be expanded
            #   SELECT FUNC(col) AS col FROM t GROUP BY FUNC(col)  --> Shouldn't be expanded, will result to FUNC(FUNC(col))
            # This not required for the HAVING clause as it can evaluate expressions using both the alias & the table columns
            if expand_only_groupby and is_group_by and column.parent is not node:
                continue

            table = resolver.get_table(column.name) if resolve_table and not column.table else None
            alias_expr, i = alias_to_expression.get(column.name, (None, 1))
            double_agg = (
                (
                    alias_expr.find(exp.AggFunc)
                    and (
                        column.find_ancestor(exp.AggFunc)
                        and not isinstance(column.find_ancestor(exp.Window, exp.Select), exp.Window)
                    )
                )
                if alias_expr
                else False
            )

            if table and (not alias_expr or double_agg):
                column.set("table", table)
            elif not column.table and alias_expr and not double_agg:
                if isinstance(alias_expr, exp.Literal) and (literal_index or resolve_table):
                    if literal_index:
                        column.replace(exp.Literal.number(i))
                else:
                    column = column.replace(exp.paren(alias_expr))
                    simplified = simplify_parens(column)
                    if simplified is not column:
                        column.replace(simplified)

    for i, projection in enumerate(expression.selects):
        replace_columns(projection)
        if isinstance(projection, exp.Alias):
            alias_to_expression[projection.alias] = (projection.this, i + 1)

    parent_scope = scope
    while parent_scope.is_union:
        parent_scope = parent_scope.parent

    # We shouldn't expand aliases if they match the recursive CTE's columns
    if parent_scope.is_cte:
        cte = parent_scope.expression.parent
        if cte.find_ancestor(exp.With).recursive:
            for recursive_cte_column in cte.args["alias"].columns or cte.this.selects:
                alias_to_expression.pop(recursive_cte_column.output_name, None)

    replace_columns(expression.args.get("where"))
    replace_columns(expression.args.get("group"), literal_index=True)
    replace_columns(expression.args.get("having"), resolve_table=True)
    replace_columns(expression.args.get("qualify"), resolve_table=True)

    scope.clear_cache()


def _expand_group_by(scope: Scope, dialect: DialectType) -> None:
    expression = scope.expression
    group = expression.args.get("group")
    if not group:
        return

    group.set("expressions", _expand_positional_references(scope, group.expressions, dialect))
    expression.set("group", group)


def _expand_order_by(scope: Scope, resolver: Resolver) -> None:
    order = scope.expression.args.get("order")
    if not order:
        return

    ordereds = order.expressions
    for ordered, new_expression in zip(
        ordereds,
        _expand_positional_references(
            scope, (o.this for o in ordereds), resolver.schema.dialect, alias=True
        ),
    ):
        for agg in ordered.find_all(exp.AggFunc):
            for col in agg.find_all(exp.Column):
                if not col.table:
                    col.set("table", resolver.get_table(col.name))

        ordered.set("this", new_expression)

    if scope.expression.args.get("group"):
        selects = {s.this: exp.column(s.alias_or_name) for s in scope.expression.selects}

        for ordered in ordereds:
            ordered = ordered.this

            ordered.replace(
                exp.to_identifier(_select_by_pos(scope, ordered).alias)
                if ordered.is_int
                else selects.get(ordered, ordered)
            )


def _expand_positional_references(
    scope: Scope, expressions: t.Iterable[exp.Expression], dialect: DialectType, alias: bool = False
) -> t.List[exp.Expression]:
    new_nodes: t.List[exp.Expression] = []
    ambiguous_projections = None

    for node in expressions:
        if node.is_int:
            select = _select_by_pos(scope, t.cast(exp.Literal, node))

            if alias:
                new_nodes.append(exp.column(select.args["alias"].copy()))
            else:
                select = select.this

                if dialect == "bigquery":
                    if ambiguous_projections is None:
                        # When a projection name is also a source name and it is referenced in the
                        # GROUP BY clause, BQ can't understand what the identifier corresponds to
                        ambiguous_projections = {
                            s.alias_or_name
                            for s in scope.expression.selects
                            if s.alias_or_name in scope.selected_sources
                        }

                    ambiguous = any(
                        column.parts[0].name in ambiguous_projections
                        for column in select.find_all(exp.Column)
                    )
                else:
                    ambiguous = False

                if (
                    isinstance(select, exp.CONSTANTS)
                    or select.find(exp.Explode, exp.Unnest)
                    or ambiguous
                ):
                    new_nodes.append(node)
                else:
                    new_nodes.append(select.copy())
        else:
            new_nodes.append(node)

    return new_nodes


def _select_by_pos(scope: Scope, node: exp.Literal) -> exp.Alias:
    try:
        return scope.expression.selects[int(node.this) - 1].assert_is(exp.Alias)
    except IndexError:
        raise OptimizeError(f"Unknown output column: {node.name}")


def _convert_columns_to_dots(scope: Scope, resolver: Resolver) -> None:
    """
    Converts `Column` instances that represent struct field lookup into chained `Dots`.

    Struct field lookups look like columns (e.g. "struct"."field"), but they need to be
    qualified separately and represented as Dot(Dot(...(<table>.<column>, field1), field2, ...)).
    """
    converted = False
    for column in itertools.chain(scope.columns, scope.stars):
        if isinstance(column, exp.Dot):
            continue

        column_table: t.Optional[str | exp.Identifier] = column.table
        if (
            column_table
            and column_table not in scope.sources
            and (
                not scope.parent
                or column_table not in scope.parent.sources
                or not scope.is_correlated_subquery
            )
        ):
            root, *parts = column.parts

            if root.name in scope.sources:
                # The struct is already qualified, but we still need to change the AST
                column_table = root
                root, *parts = parts
            else:
                column_table = resolver.get_table(root.name)

            if column_table:
                converted = True
                column.replace(exp.Dot.build([exp.column(root, table=column_table), *parts]))

    if converted:
        # We want to re-aggregate the converted columns, otherwise they'd be skipped in
        # a `for column in scope.columns` iteration, even though they shouldn't be
        scope.clear_cache()


def _qualify_columns(scope: Scope, resolver: Resolver, allow_partial_qualification: bool) -> None:
    """Disambiguate columns, ensuring each column specifies a source"""
    for column in scope.columns:
        column_table = column.table
        column_name = column.name

        if column_table and column_table in scope.sources:
            source_columns = resolver.get_source_columns(column_table)
            if (
                not allow_partial_qualification
                and source_columns
                and column_name not in source_columns
                and "*" not in source_columns
            ):
                raise OptimizeError(f"Unknown column: {column_name}")

        if not column_table:
            if scope.pivots and not column.find_ancestor(exp.Pivot):
                # If the column is under the Pivot expression, we need to qualify it
                # using the name of the pivoted source instead of the pivot's alias
                column.set("table", exp.to_identifier(scope.pivots[0].alias))
                continue

            # column_table can be a '' because bigquery unnest has no table alias
            column_table = resolver.get_table(column_name)
            if column_table:
                column.set("table", column_table)

    for pivot in scope.pivots:
        for column in pivot.find_all(exp.Column):
            if not column.table and column.name in resolver.all_columns:
                column_table = resolver.get_table(column.name)
                if column_table:
                    column.set("table", column_table)


def _expand_struct_stars(
    expression: exp.Dot,
) -> t.List[exp.Alias]:
    """[BigQuery] Expand/Flatten foo.bar.* where bar is a struct column"""

    dot_column = t.cast(exp.Column, expression.find(exp.Column))
    if not dot_column.is_type(exp.DataType.Type.STRUCT):
        return []

    # All nested struct values are ColumnDefs, so normalize the first exp.Column in one
    dot_column = dot_column.copy()
    starting_struct = exp.ColumnDef(this=dot_column.this, kind=dot_column.type)

    # First part is the table name and last part is the star so they can be dropped
    dot_parts = expression.parts[1:-1]

    # If we're expanding a nested struct eg. t.c.f1.f2.* find the last struct (f2 in this case)
    for part in dot_parts[1:]:
        for field in t.cast(exp.DataType, starting_struct.kind).expressions:
            # Unable to expand star unless all fields are named
            if not isinstance(field.this, exp.Identifier):
                return []

            if field.name == part.name and field.kind.is_type(exp.DataType.Type.STRUCT):
                starting_struct = field
                break
        else:
            # There is no matching field in the struct
            return []

    taken_names = set()
    new_selections = []

    for field in t.cast(exp.DataType, starting_struct.kind).expressions:
        name = field.name

        # Ambiguous or anonymous fields can't be expanded
        if name in taken_names or not isinstance(field.this, exp.Identifier):
            return []

        taken_names.add(name)

        this = field.this.copy()
        root, *parts = [part.copy() for part in itertools.chain(dot_parts, [this])]
        new_column = exp.column(
            t.cast(exp.Identifier, root),
            table=dot_column.args.get("table"),
            fields=t.cast(t.List[exp.Identifier], parts),
        )
        new_selections.append(alias(new_column, this, copy=False))

    return new_selections


def _expand_stars(
    scope: Scope,
    resolver: Resolver,
    using_column_tables: t.Dict[str, t.Any],
    pseudocolumns: t.Set[str],
    annotator: TypeAnnotator,
) -> None:
    """Expand stars to lists of column selections"""

    new_selections: t.List[exp.Expression] = []
    except_columns: t.Dict[int, t.Set[str]] = {}
    replace_columns: t.Dict[int, t.Dict[str, exp.Alias]] = {}
    rename_columns: t.Dict[int, t.Dict[str, str]] = {}

    coalesced_columns = set()
    dialect = resolver.schema.dialect

    pivot_output_columns = None
    pivot_exclude_columns = None

    pivot = t.cast(t.Optional[exp.Pivot], seq_get(scope.pivots, 0))
    if isinstance(pivot, exp.Pivot) and not pivot.alias_column_names:
        if pivot.unpivot:
            pivot_output_columns = [c.output_name for c in _unpivot_columns(pivot)]

            field = pivot.args.get("field")
            if isinstance(field, exp.In):
                pivot_exclude_columns = {
                    c.output_name for e in field.expressions for c in e.find_all(exp.Column)
                }
        else:
            pivot_exclude_columns = set(c.output_name for c in pivot.find_all(exp.Column))

            pivot_output_columns = [c.output_name for c in pivot.args.get("columns", [])]
            if not pivot_output_columns:
                pivot_output_columns = [c.alias_or_name for c in pivot.expressions]

    is_bigquery = dialect == "bigquery"
    if is_bigquery and any(isinstance(col, exp.Dot) for col in scope.stars):
        # Found struct expansion, annotate scope ahead of time
        annotator.annotate_scope(scope)

    for expression in scope.expression.selects:
        tables = []
        if isinstance(expression, exp.Star):
            tables.extend(scope.selected_sources)
            _add_except_columns(expression, tables, except_columns)
            _add_replace_columns(expression, tables, replace_columns)
            _add_rename_columns(expression, tables, rename_columns)
        elif expression.is_star:
            if not isinstance(expression, exp.Dot):
                tables.append(expression.table)
                _add_except_columns(expression.this, tables, except_columns)
                _add_replace_columns(expression.this, tables, replace_columns)
                _add_rename_columns(expression.this, tables, rename_columns)
            elif is_bigquery:
                struct_fields = _expand_struct_stars(expression)
                if struct_fields:
                    new_selections.extend(struct_fields)
                    continue

        if not tables:
            new_selections.append(expression)
            continue

        for table in tables:
            if table not in scope.sources:
                raise OptimizeError(f"Unknown table: {table}")

            columns = resolver.get_source_columns(table, only_visible=True)
            columns = columns or scope.outer_columns

            if pseudocolumns:
                columns = [name for name in columns if name.upper() not in pseudocolumns]

            if not columns or "*" in columns:
                return

            table_id = id(table)
            columns_to_exclude = except_columns.get(table_id) or set()
            renamed_columns = rename_columns.get(table_id, {})
            replaced_columns = replace_columns.get(table_id, {})

            if pivot:
                if pivot_output_columns and pivot_exclude_columns:
                    pivot_columns = [c for c in columns if c not in pivot_exclude_columns]
                    pivot_columns.extend(pivot_output_columns)
                else:
                    pivot_columns = pivot.alias_column_names

                if pivot_columns:
                    new_selections.extend(
                        alias(exp.column(name, table=pivot.alias), name, copy=False)
                        for name in pivot_columns
                        if name not in columns_to_exclude
                    )
                    continue

            for name in columns:
                if name in columns_to_exclude or name in coalesced_columns:
                    continue
                if name in using_column_tables and table in using_column_tables[name]:
                    coalesced_columns.add(name)
                    tables = using_column_tables[name]
                    coalesce_args = [exp.column(name, table=table) for table in tables]

                    new_selections.append(
                        alias(exp.func("coalesce", *coalesce_args), alias=name, copy=False)
                    )
                else:
                    alias_ = renamed_columns.get(name, name)
                    selection_expr = replaced_columns.get(name) or exp.column(name, table=table)
                    new_selections.append(
                        alias(selection_expr, alias_, copy=False)
                        if alias_ != name
                        else selection_expr
                    )

    # Ensures we don't overwrite the initial selections with an empty list
    if new_selections and isinstance(scope.expression, exp.Select):
        scope.expression.set("expressions", new_selections)


def _add_except_columns(
    expression: exp.Expression, tables, except_columns: t.Dict[int, t.Set[str]]
) -> None:
    except_ = expression.args.get("except")

    if not except_:
        return

    columns = {e.name for e in except_}

    for table in tables:
        except_columns[id(table)] = columns


def _add_rename_columns(
    expression: exp.Expression, tables, rename_columns: t.Dict[int, t.Dict[str, str]]
) -> None:
    rename = expression.args.get("rename")

    if not rename:
        return

    columns = {e.this.name: e.alias for e in rename}

    for table in tables:
        rename_columns[id(table)] = columns


def _add_replace_columns(
    expression: exp.Expression, tables, replace_columns: t.Dict[int, t.Dict[str, exp.Alias]]
) -> None:
    replace = expression.args.get("replace")

    if not replace:
        return

    columns = {e.alias: e for e in replace}

    for table in tables:
        replace_columns[id(table)] = columns


def qualify_outputs(scope_or_expression: Scope | exp.Expression) -> None:
    """Ensure all output columns are aliased"""
    if isinstance(scope_or_expression, exp.Expression):
        scope = build_scope(scope_or_expression)
        if not isinstance(scope, Scope):
            return
    else:
        scope = scope_or_expression

    new_selections = []
    for i, (selection, aliased_column) in enumerate(
        itertools.zip_longest(scope.expression.selects, scope.outer_columns)
    ):
        if selection is None:
            break

        if isinstance(selection, exp.Subquery):
            if not selection.output_name:
                selection.set("alias", exp.TableAlias(this=exp.to_identifier(f"_col_{i}")))
        elif not isinstance(selection, exp.Alias) and not selection.is_star:
            selection = alias(
                selection,
                alias=selection.output_name or f"_col_{i}",
                copy=False,
            )
        if aliased_column:
            selection.set("alias", exp.to_identifier(aliased_column))

        new_selections.append(selection)

    if isinstance(scope.expression, exp.Select):
        scope.expression.set("expressions", new_selections)


def quote_identifiers(expression: E, dialect: DialectType = None, identify: bool = True) -> E:
    """Makes sure all identifiers that need to be quoted are quoted."""
    return expression.transform(
        Dialect.get_or_raise(dialect).quote_identifier, identify=identify, copy=False
    )  # type: ignore


def pushdown_cte_alias_columns(expression: exp.Expression) -> exp.Expression:
    """
    Pushes down the CTE alias columns into the projection,

    This step is useful in Snowflake where the CTE alias columns can be referenced in the HAVING.

    Example:
        >>> import sqlglot
        >>> expression = sqlglot.parse_one("WITH y (c) AS (SELECT SUM(a) FROM ( SELECT 1 a ) AS x HAVING c > 0) SELECT c FROM y")
        >>> pushdown_cte_alias_columns(expression).sql()
        'WITH y(c) AS (SELECT SUM(a) AS c FROM (SELECT 1 AS a) AS x HAVING c > 0) SELECT c FROM y'

    Args:
        expression: Expression to pushdown.

    Returns:
        The expression with the CTE aliases pushed down into the projection.
    """
    for cte in expression.find_all(exp.CTE):
        if cte.alias_column_names:
            new_expressions = []
            for _alias, projection in zip(cte.alias_column_names, cte.this.expressions):
                if isinstance(projection, exp.Alias):
                    projection.set("alias", _alias)
                else:
                    projection = alias(projection, alias=_alias)
                new_expressions.append(projection)
            cte.this.set("expressions", new_expressions)

    return expression


class Resolver:
    """
    Helper for resolving columns.

    This is a class so we can lazily load some things and easily share them across functions.
    """

    def __init__(self, scope: Scope, schema: Schema, infer_schema: bool = True):
        self.scope = scope
        self.schema = schema
        self._source_columns: t.Optional[t.Dict[str, t.Sequence[str]]] = None
        self._unambiguous_columns: t.Optional[t.Mapping[str, str]] = None
        self._all_columns: t.Optional[t.Set[str]] = None
        self._infer_schema = infer_schema
        self._get_source_columns_cache: t.Dict[t.Tuple[str, bool], t.Sequence[str]] = {}

    def get_table(self, column_name: str) -> t.Optional[exp.Identifier]:
        """
        Get the table for a column name.

        Args:
            column_name: The column name to find the table for.
        Returns:
            The table name if it can be found/inferred.
        """
        if self._unambiguous_columns is None:
            self._unambiguous_columns = self._get_unambiguous_columns(
                self._get_all_source_columns()
            )

        table_name = self._unambiguous_columns.get(column_name)

        if not table_name and self._infer_schema:
            sources_without_schema = tuple(
                source
                for source, columns in self._get_all_source_columns().items()
                if not columns or "*" in columns
            )
            if len(sources_without_schema) == 1:
                table_name = sources_without_schema[0]

        if table_name not in self.scope.selected_sources:
            return exp.to_identifier(table_name)

        node, _ = self.scope.selected_sources.get(table_name)

        if isinstance(node, exp.Query):
            while node and node.alias != table_name:
                node = node.parent

        node_alias = node.args.get("alias")
        if node_alias:
            return exp.to_identifier(node_alias.this)

        return exp.to_identifier(table_name)

    @property
    def all_columns(self) -> t.Set[str]:
        """All available columns of all sources in this scope"""
        if self._all_columns is None:
            self._all_columns = {
                column for columns in self._get_all_source_columns().values() for column in columns
            }
        return self._all_columns

    def get_source_columns(self, name: str, only_visible: bool = False) -> t.Sequence[str]:
        """Resolve the source columns for a given source `name`."""
        cache_key = (name, only_visible)
        if cache_key not in self._get_source_columns_cache:
            if name not in self.scope.sources:
                raise OptimizeError(f"Unknown table: {name}")

            source = self.scope.sources[name]

            if isinstance(source, exp.Table):
                columns = self.schema.column_names(source, only_visible)
            elif isinstance(source, Scope) and isinstance(
                source.expression, (exp.Values, exp.Unnest)
            ):
                columns = source.expression.named_selects

                # in bigquery, unnest structs are automatically scoped as tables, so you can
                # directly select a struct field in a query.
                # this handles the case where the unnest is statically defined.
                if self.schema.dialect == "bigquery":
                    if source.expression.is_type(exp.DataType.Type.STRUCT):
                        for k in source.expression.type.expressions:  # type: ignore
                            columns.append(k.name)
            else:
                columns = source.expression.named_selects

            node, _ = self.scope.selected_sources.get(name) or (None, None)
            if isinstance(node, Scope):
                column_aliases = node.expression.alias_column_names
            elif isinstance(node, exp.Expression):
                column_aliases = node.alias_column_names
            else:
                column_aliases = []

            if column_aliases:
                # If the source's columns are aliased, their aliases shadow the corresponding column names.
                # This can be expensive if there are lots of columns, so only do this if column_aliases exist.
                columns = [
                    alias or name
                    for (name, alias) in itertools.zip_longest(columns, column_aliases)
                ]

            self._get_source_columns_cache[cache_key] = columns

        return self._get_source_columns_cache[cache_key]

    def _get_all_source_columns(self) -> t.Dict[str, t.Sequence[str]]:
        if self._source_columns is None:
            self._source_columns = {
                source_name: self.get_source_columns(source_name)
                for source_name, source in itertools.chain(
                    self.scope.selected_sources.items(), self.scope.lateral_sources.items()
                )
            }
        return self._source_columns

    def _get_unambiguous_columns(
        self, source_columns: t.Dict[str, t.Sequence[str]]
    ) -> t.Mapping[str, str]:
        """
        Find all the unambiguous columns in sources.

        Args:
            source_columns: Mapping of names to source columns.

        Returns:
            Mapping of column name to source name.
        """
        if not source_columns:
            return {}

        source_columns_pairs = list(source_columns.items())

        first_table, first_columns = source_columns_pairs[0]

        if len(source_columns_pairs) == 1:
            # Performance optimization - avoid copying first_columns if there is only one table.
            return SingleValuedMapping(first_columns, first_table)

        unambiguous_columns = {col: first_table for col in first_columns}
        all_columns = set(unambiguous_columns)

        for table, columns in source_columns_pairs[1:]:
            unique = set(columns)
            ambiguous = all_columns.intersection(unique)
            all_columns.update(columns)

            for column in ambiguous:
                unambiguous_columns.pop(column, None)
            for column in unique.difference(ambiguous):
                unambiguous_columns[column] = table

        return unambiguous_columns
