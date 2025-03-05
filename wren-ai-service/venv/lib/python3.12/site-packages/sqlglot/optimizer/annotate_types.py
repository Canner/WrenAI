from __future__ import annotations

import functools
import typing as t

from sqlglot import exp
from sqlglot.helper import (
    ensure_list,
    is_date_unit,
    is_iso_date,
    is_iso_datetime,
    seq_get,
)
from sqlglot.optimizer.scope import Scope, traverse_scope
from sqlglot.schema import Schema, ensure_schema
from sqlglot.dialects.dialect import Dialect

if t.TYPE_CHECKING:
    from sqlglot._typing import B, E

    BinaryCoercionFunc = t.Callable[[exp.Expression, exp.Expression], exp.DataType.Type]
    BinaryCoercions = t.Dict[
        t.Tuple[exp.DataType.Type, exp.DataType.Type],
        BinaryCoercionFunc,
    ]

    from sqlglot.dialects.dialect import DialectType, AnnotatorsType


def annotate_types(
    expression: E,
    schema: t.Optional[t.Dict | Schema] = None,
    annotators: t.Optional[AnnotatorsType] = None,
    coerces_to: t.Optional[t.Dict[exp.DataType.Type, t.Set[exp.DataType.Type]]] = None,
    dialect: t.Optional[DialectType] = None,
) -> E:
    """
    Infers the types of an expression, annotating its AST accordingly.

    Example:
        >>> import sqlglot
        >>> schema = {"y": {"cola": "SMALLINT"}}
        >>> sql = "SELECT x.cola + 2.5 AS cola FROM (SELECT y.cola AS cola FROM y AS y) AS x"
        >>> annotated_expr = annotate_types(sqlglot.parse_one(sql), schema=schema)
        >>> annotated_expr.expressions[0].type.this  # Get the type of "x.cola + 2.5 AS cola"
        <Type.DOUBLE: 'DOUBLE'>

    Args:
        expression: Expression to annotate.
        schema: Database schema.
        annotators: Maps expression type to corresponding annotation function.
        coerces_to: Maps expression type to set of types that it can be coerced into.

    Returns:
        The expression annotated with types.
    """

    schema = ensure_schema(schema)

    return TypeAnnotator(schema, annotators, coerces_to, dialect=dialect).annotate(expression)


def _coerce_date_literal(l: exp.Expression, unit: t.Optional[exp.Expression]) -> exp.DataType.Type:
    date_text = l.name
    is_iso_date_ = is_iso_date(date_text)

    if is_iso_date_ and is_date_unit(unit):
        return exp.DataType.Type.DATE

    # An ISO date is also an ISO datetime, but not vice versa
    if is_iso_date_ or is_iso_datetime(date_text):
        return exp.DataType.Type.DATETIME

    return exp.DataType.Type.UNKNOWN


def _coerce_date(l: exp.Expression, unit: t.Optional[exp.Expression]) -> exp.DataType.Type:
    if not is_date_unit(unit):
        return exp.DataType.Type.DATETIME
    return l.type.this if l.type else exp.DataType.Type.UNKNOWN


def swap_args(func: BinaryCoercionFunc) -> BinaryCoercionFunc:
    @functools.wraps(func)
    def _swapped(l: exp.Expression, r: exp.Expression) -> exp.DataType.Type:
        return func(r, l)

    return _swapped


def swap_all(coercions: BinaryCoercions) -> BinaryCoercions:
    return {**coercions, **{(b, a): swap_args(func) for (a, b), func in coercions.items()}}


class _TypeAnnotator(type):
    def __new__(cls, clsname, bases, attrs):
        klass = super().__new__(cls, clsname, bases, attrs)

        # Highest-to-lowest type precedence, as specified in Spark's docs (ANSI):
        # https://spark.apache.org/docs/3.2.0/sql-ref-ansi-compliance.html
        text_precedence = (
            exp.DataType.Type.TEXT,
            exp.DataType.Type.NVARCHAR,
            exp.DataType.Type.VARCHAR,
            exp.DataType.Type.NCHAR,
            exp.DataType.Type.CHAR,
        )
        numeric_precedence = (
            exp.DataType.Type.DOUBLE,
            exp.DataType.Type.FLOAT,
            exp.DataType.Type.DECIMAL,
            exp.DataType.Type.BIGINT,
            exp.DataType.Type.INT,
            exp.DataType.Type.SMALLINT,
            exp.DataType.Type.TINYINT,
        )
        timelike_precedence = (
            exp.DataType.Type.TIMESTAMPLTZ,
            exp.DataType.Type.TIMESTAMPTZ,
            exp.DataType.Type.TIMESTAMP,
            exp.DataType.Type.DATETIME,
            exp.DataType.Type.DATE,
        )

        for type_precedence in (text_precedence, numeric_precedence, timelike_precedence):
            coerces_to = set()
            for data_type in type_precedence:
                klass.COERCES_TO[data_type] = coerces_to.copy()
                coerces_to |= {data_type}

        # NULL can be coerced to any type, so e.g. NULL + 1 will have type INT
        klass.COERCES_TO[exp.DataType.Type.NULL] = {
            *text_precedence,
            *numeric_precedence,
            *timelike_precedence,
        }

        return klass


class TypeAnnotator(metaclass=_TypeAnnotator):
    NESTED_TYPES = {
        exp.DataType.Type.ARRAY,
    }

    # Specifies what types a given type can be coerced into (autofilled)
    COERCES_TO: t.Dict[exp.DataType.Type, t.Set[exp.DataType.Type]] = {}

    # Coercion functions for binary operations.
    # Map of type pairs to a callable that takes both sides of the binary operation and returns the resulting type.
    BINARY_COERCIONS: BinaryCoercions = {
        **swap_all(
            {
                (t, exp.DataType.Type.INTERVAL): lambda l, r: _coerce_date_literal(
                    l, r.args.get("unit")
                )
                for t in exp.DataType.TEXT_TYPES
            }
        ),
        **swap_all(
            {
                # text + numeric will yield the numeric type to match most dialects' semantics
                (text, numeric): lambda l, r: t.cast(
                    exp.DataType.Type, l.type if l.type in exp.DataType.NUMERIC_TYPES else r.type
                )
                for text in exp.DataType.TEXT_TYPES
                for numeric in exp.DataType.NUMERIC_TYPES
            }
        ),
        **swap_all(
            {
                (exp.DataType.Type.DATE, exp.DataType.Type.INTERVAL): lambda l, r: _coerce_date(
                    l, r.args.get("unit")
                ),
            }
        ),
    }

    def __init__(
        self,
        schema: Schema,
        annotators: t.Optional[AnnotatorsType] = None,
        coerces_to: t.Optional[t.Dict[exp.DataType.Type, t.Set[exp.DataType.Type]]] = None,
        binary_coercions: t.Optional[BinaryCoercions] = None,
        dialect: t.Optional[DialectType] = None,
    ) -> None:
        self.schema = schema
        self.annotators = annotators or Dialect.get_or_raise(dialect).ANNOTATORS
        self.coerces_to = coerces_to or self.COERCES_TO
        self.binary_coercions = binary_coercions or self.BINARY_COERCIONS

        # Caches the ids of annotated sub-Expressions, to ensure we only visit them once
        self._visited: t.Set[int] = set()

        # Maps an exp.SetOperation's id (e.g. UNION) to its projection types. This is computed if the
        # exp.SetOperation is the expression of a scope source, as selecting from it multiple times
        # would reprocess the entire subtree to coerce the types of its operands' projections
        self._setop_column_types: t.Dict[int, t.Dict[str, exp.DataType.Type]] = {}

    def _set_type(
        self, expression: exp.Expression, target_type: t.Optional[exp.DataType | exp.DataType.Type]
    ) -> None:
        expression.type = target_type or exp.DataType.Type.UNKNOWN  # type: ignore
        self._visited.add(id(expression))

    def annotate(self, expression: E) -> E:
        for scope in traverse_scope(expression):
            self.annotate_scope(scope)
        return self._maybe_annotate(expression)  # This takes care of non-traversable expressions

    def annotate_scope(self, scope: Scope) -> None:
        selects = {}
        for name, source in scope.sources.items():
            if not isinstance(source, Scope):
                continue

            expression = source.expression
            if isinstance(expression, exp.UDTF):
                values = []

                if isinstance(expression, exp.Lateral):
                    if isinstance(expression.this, exp.Explode):
                        values = [expression.this.this]
                elif isinstance(expression, exp.Unnest):
                    values = [expression]
                else:
                    values = expression.expressions[0].expressions

                if not values:
                    continue

                selects[name] = {
                    alias: column.type
                    for alias, column in zip(expression.alias_column_names, values)
                }
            elif isinstance(expression, exp.SetOperation) and len(expression.left.selects) == len(
                expression.right.selects
            ):
                selects[name] = col_types = self._setop_column_types.setdefault(id(expression), {})

                if not col_types:
                    # Process a chain / sub-tree of set operations
                    for set_op in expression.walk(
                        prune=lambda n: not isinstance(n, (exp.SetOperation, exp.Subquery))
                    ):
                        if not isinstance(set_op, exp.SetOperation):
                            continue

                        if set_op.args.get("by_name"):
                            r_type_by_select = {
                                s.alias_or_name: s.type for s in set_op.right.selects
                            }
                            setop_cols = {
                                s.alias_or_name: self._maybe_coerce(
                                    t.cast(exp.DataType, s.type),
                                    r_type_by_select.get(s.alias_or_name)
                                    or exp.DataType.Type.UNKNOWN,
                                )
                                for s in set_op.left.selects
                            }
                        else:
                            setop_cols = {
                                ls.alias_or_name: self._maybe_coerce(
                                    t.cast(exp.DataType, ls.type), t.cast(exp.DataType, rs.type)
                                )
                                for ls, rs in zip(set_op.left.selects, set_op.right.selects)
                            }

                        # Coerce intermediate results with the previously registered types, if they exist
                        for col_name, col_type in setop_cols.items():
                            col_types[col_name] = self._maybe_coerce(
                                col_type, col_types.get(col_name, exp.DataType.Type.NULL)
                            )

            else:
                selects[name] = {s.alias_or_name: s.type for s in expression.selects}

        # First annotate the current scope's column references
        for col in scope.columns:
            if not col.table:
                continue

            source = scope.sources.get(col.table)
            if isinstance(source, exp.Table):
                self._set_type(col, self.schema.get_column_type(source, col))
            elif source:
                if col.table in selects and col.name in selects[col.table]:
                    self._set_type(col, selects[col.table][col.name])
                elif isinstance(source.expression, exp.Unnest):
                    self._set_type(col, source.expression.type)

        # Then (possibly) annotate the remaining expressions in the scope
        self._maybe_annotate(scope.expression)

    def _maybe_annotate(self, expression: E) -> E:
        if id(expression) in self._visited:
            return expression  # We've already inferred the expression's type

        annotator = self.annotators.get(expression.__class__)

        return (
            annotator(self, expression)
            if annotator
            else self._annotate_with_type(expression, exp.DataType.Type.UNKNOWN)
        )

    def _annotate_args(self, expression: E) -> E:
        for value in expression.iter_expressions():
            self._maybe_annotate(value)

        return expression

    def _maybe_coerce(
        self, type1: exp.DataType | exp.DataType.Type, type2: exp.DataType | exp.DataType.Type
    ) -> exp.DataType.Type:
        type1_value = type1.this if isinstance(type1, exp.DataType) else type1
        type2_value = type2.this if isinstance(type2, exp.DataType) else type2

        # We propagate the UNKNOWN type upwards if found
        if exp.DataType.Type.UNKNOWN in (type1_value, type2_value):
            return exp.DataType.Type.UNKNOWN

        return t.cast(
            exp.DataType.Type,
            type2_value if type2_value in self.coerces_to.get(type1_value, {}) else type1_value,
        )

    def _annotate_binary(self, expression: B) -> B:
        self._annotate_args(expression)

        left, right = expression.left, expression.right
        left_type, right_type = left.type.this, right.type.this  # type: ignore

        if isinstance(expression, (exp.Connector, exp.Predicate)):
            self._set_type(expression, exp.DataType.Type.BOOLEAN)
        elif (left_type, right_type) in self.binary_coercions:
            self._set_type(expression, self.binary_coercions[(left_type, right_type)](left, right))
        else:
            self._set_type(expression, self._maybe_coerce(left_type, right_type))

        return expression

    def _annotate_unary(self, expression: E) -> E:
        self._annotate_args(expression)

        if isinstance(expression, exp.Not):
            self._set_type(expression, exp.DataType.Type.BOOLEAN)
        else:
            self._set_type(expression, expression.this.type)

        return expression

    def _annotate_literal(self, expression: exp.Literal) -> exp.Literal:
        if expression.is_string:
            self._set_type(expression, exp.DataType.Type.VARCHAR)
        elif expression.is_int:
            self._set_type(expression, exp.DataType.Type.INT)
        else:
            self._set_type(expression, exp.DataType.Type.DOUBLE)

        return expression

    def _annotate_with_type(
        self, expression: E, target_type: exp.DataType | exp.DataType.Type
    ) -> E:
        self._set_type(expression, target_type)
        return self._annotate_args(expression)

    @t.no_type_check
    def _annotate_by_args(
        self,
        expression: E,
        *args: str,
        promote: bool = False,
        array: bool = False,
    ) -> E:
        self._annotate_args(expression)

        expressions: t.List[exp.Expression] = []
        for arg in args:
            arg_expr = expression.args.get(arg)
            expressions.extend(expr for expr in ensure_list(arg_expr) if expr)

        last_datatype = None
        for expr in expressions:
            expr_type = expr.type

            # Stop at the first nested data type found - we don't want to _maybe_coerce nested types
            if expr_type.args.get("nested"):
                last_datatype = expr_type
                break

            if not expr_type.is_type(exp.DataType.Type.UNKNOWN):
                last_datatype = self._maybe_coerce(last_datatype or expr_type, expr_type)

        self._set_type(expression, last_datatype or exp.DataType.Type.UNKNOWN)

        if promote:
            if expression.type.this in exp.DataType.INTEGER_TYPES:
                self._set_type(expression, exp.DataType.Type.BIGINT)
            elif expression.type.this in exp.DataType.FLOAT_TYPES:
                self._set_type(expression, exp.DataType.Type.DOUBLE)

        if array:
            self._set_type(
                expression,
                exp.DataType(
                    this=exp.DataType.Type.ARRAY, expressions=[expression.type], nested=True
                ),
            )

        return expression

    def _annotate_timeunit(
        self, expression: exp.TimeUnit | exp.DateTrunc
    ) -> exp.TimeUnit | exp.DateTrunc:
        self._annotate_args(expression)

        if expression.this.type.this in exp.DataType.TEXT_TYPES:
            datatype = _coerce_date_literal(expression.this, expression.unit)
        elif expression.this.type.this in exp.DataType.TEMPORAL_TYPES:
            datatype = _coerce_date(expression.this, expression.unit)
        else:
            datatype = exp.DataType.Type.UNKNOWN

        self._set_type(expression, datatype)
        return expression

    def _annotate_bracket(self, expression: exp.Bracket) -> exp.Bracket:
        self._annotate_args(expression)

        bracket_arg = expression.expressions[0]
        this = expression.this

        if isinstance(bracket_arg, exp.Slice):
            self._set_type(expression, this.type)
        elif this.type.is_type(exp.DataType.Type.ARRAY):
            self._set_type(expression, seq_get(this.type.expressions, 0))
        elif isinstance(this, (exp.Map, exp.VarMap)) and bracket_arg in this.keys:
            index = this.keys.index(bracket_arg)
            value = seq_get(this.values, index)
            self._set_type(expression, value.type if value else None)
        else:
            self._set_type(expression, exp.DataType.Type.UNKNOWN)

        return expression

    def _annotate_div(self, expression: exp.Div) -> exp.Div:
        self._annotate_args(expression)

        left_type, right_type = expression.left.type.this, expression.right.type.this  # type: ignore

        if (
            expression.args.get("typed")
            and left_type in exp.DataType.INTEGER_TYPES
            and right_type in exp.DataType.INTEGER_TYPES
        ):
            self._set_type(expression, exp.DataType.Type.BIGINT)
        else:
            self._set_type(expression, self._maybe_coerce(left_type, right_type))
            if expression.type and expression.type.this not in exp.DataType.REAL_TYPES:
                self._set_type(
                    expression, self._maybe_coerce(expression.type, exp.DataType.Type.DOUBLE)
                )

        return expression

    def _annotate_dot(self, expression: exp.Dot) -> exp.Dot:
        self._annotate_args(expression)
        self._set_type(expression, None)
        this_type = expression.this.type

        if this_type and this_type.is_type(exp.DataType.Type.STRUCT):
            for e in this_type.expressions:
                if e.name == expression.expression.name:
                    self._set_type(expression, e.kind)
                    break

        return expression

    def _annotate_explode(self, expression: exp.Explode) -> exp.Explode:
        self._annotate_args(expression)
        self._set_type(expression, seq_get(expression.this.type.expressions, 0))
        return expression

    def _annotate_unnest(self, expression: exp.Unnest) -> exp.Unnest:
        self._annotate_args(expression)
        child = seq_get(expression.expressions, 0)

        if child and child.is_type(exp.DataType.Type.ARRAY):
            expr_type = seq_get(child.type.expressions, 0)
        else:
            expr_type = None

        self._set_type(expression, expr_type)
        return expression

    def _annotate_struct_value(
        self, expression: exp.Expression
    ) -> t.Optional[exp.DataType] | exp.ColumnDef:
        alias = expression.args.get("alias")
        if alias:
            return exp.ColumnDef(this=alias.copy(), kind=expression.type)

        # Case: key = value or key := value
        if expression.expression:
            return exp.ColumnDef(this=expression.this.copy(), kind=expression.expression.type)

        return expression.type

    def _annotate_struct(self, expression: exp.Struct) -> exp.Struct:
        self._annotate_args(expression)
        self._set_type(
            expression,
            exp.DataType(
                this=exp.DataType.Type.STRUCT,
                expressions=[self._annotate_struct_value(expr) for expr in expression.expressions],
                nested=True,
            ),
        )
        return expression

    @t.overload
    def _annotate_map(self, expression: exp.Map) -> exp.Map: ...

    @t.overload
    def _annotate_map(self, expression: exp.VarMap) -> exp.VarMap: ...

    def _annotate_map(self, expression):
        self._annotate_args(expression)

        keys = expression.args.get("keys")
        values = expression.args.get("values")

        map_type = exp.DataType(this=exp.DataType.Type.MAP)
        if isinstance(keys, exp.Array) and isinstance(values, exp.Array):
            key_type = seq_get(keys.type.expressions, 0) or exp.DataType.Type.UNKNOWN
            value_type = seq_get(values.type.expressions, 0) or exp.DataType.Type.UNKNOWN

            if key_type != exp.DataType.Type.UNKNOWN and value_type != exp.DataType.Type.UNKNOWN:
                map_type.set("expressions", [key_type, value_type])
                map_type.set("nested", True)

        self._set_type(expression, map_type)
        return expression

    def _annotate_to_map(self, expression: exp.ToMap) -> exp.ToMap:
        self._annotate_args(expression)

        map_type = exp.DataType(this=exp.DataType.Type.MAP)
        arg = expression.this
        if arg.is_type(exp.DataType.Type.STRUCT):
            for coldef in arg.type.expressions:
                kind = coldef.kind
                if kind != exp.DataType.Type.UNKNOWN:
                    map_type.set("expressions", [exp.DataType.build("varchar"), kind])
                    map_type.set("nested", True)
                    break

        self._set_type(expression, map_type)
        return expression

    def _annotate_extract(self, expression: exp.Extract) -> exp.Extract:
        self._annotate_args(expression)
        part = expression.name
        if part == "TIME":
            self._set_type(expression, exp.DataType.Type.TIME)
        elif part == "DATE":
            self._set_type(expression, exp.DataType.Type.DATE)
        else:
            self._set_type(expression, exp.DataType.Type.INT)
        return expression
