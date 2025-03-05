import ast
import collections
import itertools
import math

from sqlglot import exp, generator, planner, tokens
from sqlglot.dialects.dialect import Dialect, inline_array_sql
from sqlglot.errors import ExecuteError
from sqlglot.executor.context import Context
from sqlglot.executor.env import ENV
from sqlglot.executor.table import RowReader, Table
from sqlglot.helper import csv_reader, ensure_list, subclasses


class PythonExecutor:
    def __init__(self, env=None, tables=None):
        self.generator = Python().generator(identify=True, comments=False)
        self.env = {**ENV, **(env or {})}
        self.tables = tables or {}

    def execute(self, plan):
        finished = set()
        queue = set(plan.leaves)
        contexts = {}

        while queue:
            node = queue.pop()
            try:
                context = self.context(
                    {
                        name: table
                        for dep in node.dependencies
                        for name, table in contexts[dep].tables.items()
                    }
                )

                if isinstance(node, planner.Scan):
                    contexts[node] = self.scan(node, context)
                elif isinstance(node, planner.Aggregate):
                    contexts[node] = self.aggregate(node, context)
                elif isinstance(node, planner.Join):
                    contexts[node] = self.join(node, context)
                elif isinstance(node, planner.Sort):
                    contexts[node] = self.sort(node, context)
                elif isinstance(node, planner.SetOperation):
                    contexts[node] = self.set_operation(node, context)
                else:
                    raise NotImplementedError

                finished.add(node)

                for dep in node.dependents:
                    if all(d in contexts for d in dep.dependencies):
                        queue.add(dep)

                for dep in node.dependencies:
                    if all(d in finished for d in dep.dependents):
                        contexts.pop(dep)
            except Exception as e:
                raise ExecuteError(f"Step '{node.id}' failed: {e}") from e

        root = plan.root
        return contexts[root].tables[root.name]

    def generate(self, expression):
        """Convert a SQL expression into literal Python code and compile it into bytecode."""
        if not expression:
            return None

        sql = self.generator.generate(expression)
        return compile(sql, sql, "eval", optimize=2)

    def generate_tuple(self, expressions):
        """Convert an array of SQL expressions into tuple of Python byte code."""
        if not expressions:
            return tuple()
        return tuple(self.generate(expression) for expression in expressions)

    def context(self, tables):
        return Context(tables, env=self.env)

    def table(self, expressions):
        return Table(
            expression.alias_or_name if isinstance(expression, exp.Expression) else expression
            for expression in expressions
        )

    def scan(self, step, context):
        source = step.source

        if source and isinstance(source, exp.Expression):
            source = source.name or source.alias

        if source is None:
            context, table_iter = self.static()
        elif source in context:
            if not step.projections and not step.condition:
                return self.context({step.name: context.tables[source]})
            table_iter = context.table_iter(source)
        elif isinstance(step.source, exp.Table) and isinstance(step.source.this, exp.ReadCSV):
            table_iter = self.scan_csv(step)
            context = next(table_iter)
        else:
            context, table_iter = self.scan_table(step)

        return self.context({step.name: self._project_and_filter(context, step, table_iter)})

    def _project_and_filter(self, context, step, table_iter):
        sink = self.table(step.projections if step.projections else context.columns)
        condition = self.generate(step.condition)
        projections = self.generate_tuple(step.projections)

        for reader in table_iter:
            if len(sink) >= step.limit:
                break

            if condition and not context.eval(condition):
                continue

            if projections:
                sink.append(context.eval_tuple(projections))
            else:
                sink.append(reader.row)

        return sink

    def static(self):
        return self.context({}), [RowReader(())]

    def scan_table(self, step):
        table = self.tables.find(step.source)
        context = self.context({step.source.alias_or_name: table})
        return context, iter(table)

    def scan_csv(self, step):
        alias = step.source.alias
        source = step.source.this

        with csv_reader(source) as reader:
            columns = next(reader)
            table = Table(columns)
            context = self.context({alias: table})
            yield context
            types = []
            for row in reader:
                if not types:
                    for v in row:
                        try:
                            types.append(type(ast.literal_eval(v)))
                        except (ValueError, SyntaxError):
                            types.append(str)

                # We can't cast empty values ('') to non-string types, so we convert them to None instead
                context.set_row(
                    tuple(None if (t is not str and v == "") else t(v) for t, v in zip(types, row))
                )
                yield context.table.reader

    def join(self, step, context):
        source = step.source_name

        source_table = context.tables[source]
        source_context = self.context({source: source_table})
        column_ranges = {source: range(0, len(source_table.columns))}

        for name, join in step.joins.items():
            table = context.tables[name]
            start = max(r.stop for r in column_ranges.values())
            column_ranges[name] = range(start, len(table.columns) + start)
            join_context = self.context({name: table})

            if join.get("source_key"):
                table = self.hash_join(join, source_context, join_context)
            else:
                table = self.nested_loop_join(join, source_context, join_context)

            source_context = self.context(
                {
                    name: Table(table.columns, table.rows, column_range)
                    for name, column_range in column_ranges.items()
                }
            )
            condition = self.generate(join["condition"])
            if condition:
                source_context.filter(condition)

        if not step.condition and not step.projections:
            return source_context

        sink = self._project_and_filter(
            source_context,
            step,
            (reader for reader, _ in iter(source_context)),
        )

        if step.projections:
            return self.context({step.name: sink})
        else:
            return self.context(
                {
                    name: Table(table.columns, sink.rows, table.column_range)
                    for name, table in source_context.tables.items()
                }
            )

    def nested_loop_join(self, _join, source_context, join_context):
        table = Table(source_context.columns + join_context.columns)

        for reader_a, _ in source_context:
            for reader_b, _ in join_context:
                table.append(reader_a.row + reader_b.row)

        return table

    def hash_join(self, join, source_context, join_context):
        source_key = self.generate_tuple(join["source_key"])
        join_key = self.generate_tuple(join["join_key"])
        left = join.get("side") == "LEFT"
        right = join.get("side") == "RIGHT"

        results = collections.defaultdict(lambda: ([], []))

        for reader, ctx in source_context:
            results[ctx.eval_tuple(source_key)][0].append(reader.row)
        for reader, ctx in join_context:
            results[ctx.eval_tuple(join_key)][1].append(reader.row)

        table = Table(source_context.columns + join_context.columns)
        nulls = [(None,) * len(join_context.columns if left else source_context.columns)]

        for a_group, b_group in results.values():
            if left:
                b_group = b_group or nulls
            elif right:
                a_group = a_group or nulls

            for a_row, b_row in itertools.product(a_group, b_group):
                table.append(a_row + b_row)

        return table

    def aggregate(self, step, context):
        group_by = self.generate_tuple(step.group.values())
        aggregations = self.generate_tuple(step.aggregations)
        operands = self.generate_tuple(step.operands)

        if operands:
            operand_table = Table(self.table(step.operands).columns)

            for reader, ctx in context:
                operand_table.append(ctx.eval_tuple(operands))

            for i, (a, b) in enumerate(zip(context.table.rows, operand_table.rows)):
                context.table.rows[i] = a + b

            width = len(context.columns)
            context.add_columns(*operand_table.columns)

            operand_table = Table(
                context.columns,
                context.table.rows,
                range(width, width + len(operand_table.columns)),
            )

            context = self.context(
                {
                    None: operand_table,
                    **context.tables,
                }
            )

        context.sort(group_by)

        group = None
        start = 0
        end = 1
        length = len(context.table)
        table = self.table(list(step.group) + step.aggregations)

        def add_row():
            table.append(group + context.eval_tuple(aggregations))

        if length:
            for i in range(length):
                context.set_index(i)
                key = context.eval_tuple(group_by)
                group = key if group is None else group
                end += 1
                if key != group:
                    context.set_range(start, end - 2)
                    add_row()
                    group = key
                    start = end - 2
                if len(table.rows) >= step.limit:
                    break
                if i == length - 1:
                    context.set_range(start, end - 1)
                    add_row()
        elif step.limit > 0 and not group_by:
            context.set_range(0, 0)
            table.append(context.eval_tuple(aggregations))

        context = self.context({step.name: table, **{name: table for name in context.tables}})

        if step.projections or step.condition:
            return self.scan(step, context)
        return context

    def sort(self, step, context):
        projections = self.generate_tuple(step.projections)
        projection_columns = [p.alias_or_name for p in step.projections]
        all_columns = list(context.columns) + projection_columns
        sink = self.table(all_columns)
        for reader, ctx in context:
            sink.append(reader.row + ctx.eval_tuple(projections))

        sort_ctx = self.context(
            {
                None: sink,
                **{table: sink for table in context.tables},
            }
        )
        sort_ctx.sort(self.generate_tuple(step.key))

        if not math.isinf(step.limit):
            sort_ctx.table.rows = sort_ctx.table.rows[0 : step.limit]

        output = Table(
            projection_columns,
            rows=[r[len(context.columns) : len(all_columns)] for r in sort_ctx.table.rows],
        )
        return self.context({step.name: output})

    def set_operation(self, step, context):
        left = context.tables[step.left]
        right = context.tables[step.right]

        sink = self.table(left.columns)

        if issubclass(step.op, exp.Intersect):
            sink.rows = list(set(left.rows).intersection(set(right.rows)))
        elif issubclass(step.op, exp.Except):
            sink.rows = list(set(left.rows).difference(set(right.rows)))
        elif issubclass(step.op, exp.Union) and step.distinct:
            sink.rows = list(set(left.rows).union(set(right.rows)))
        else:
            sink.rows = left.rows + right.rows

        if not math.isinf(step.limit):
            sink.rows = sink.rows[0 : step.limit]

        return self.context({step.name: sink})


def _ordered_py(self, expression):
    this = self.sql(expression, "this")
    desc = "True" if expression.args.get("desc") else "False"
    nulls_first = "True" if expression.args.get("nulls_first") else "False"
    return f"ORDERED({this}, {desc}, {nulls_first})"


def _rename(self, e):
    try:
        values = list(e.args.values())

        if len(values) == 1:
            values = values[0]
            if not isinstance(values, list):
                return self.func(e.key, values)
            return self.func(e.key, *values)

        if isinstance(e, exp.Func) and e.is_var_len_args:
            *head, tail = values
            return self.func(e.key, *head, *ensure_list(tail))

        return self.func(e.key, *values)
    except Exception as ex:
        raise Exception(f"Could not rename {repr(e)}") from ex


def _case_sql(self, expression):
    this = self.sql(expression, "this")
    chain = self.sql(expression, "default") or "None"

    for e in reversed(expression.args["ifs"]):
        true = self.sql(e, "true")
        condition = self.sql(e, "this")
        condition = f"{this} = ({condition})" if this else condition
        chain = f"{true} if {condition} else ({chain})"

    return chain


def _lambda_sql(self, e: exp.Lambda) -> str:
    names = {e.name.lower() for e in e.expressions}

    e = e.transform(
        lambda n: (
            exp.var(n.name) if isinstance(n, exp.Identifier) and n.name.lower() in names else n
        )
    ).assert_is(exp.Lambda)

    return f"lambda {self.expressions(e, flat=True)}: {self.sql(e, 'this')}"


def _div_sql(self: generator.Generator, e: exp.Div) -> str:
    denominator = self.sql(e, "expression")

    if e.args.get("safe"):
        denominator += " or None"

    sql = f"DIV({self.sql(e, 'this')}, {denominator})"

    if e.args.get("typed"):
        sql = f"int({sql})"

    return sql


class Python(Dialect):
    class Tokenizer(tokens.Tokenizer):
        STRING_ESCAPES = ["\\"]

    class Generator(generator.Generator):
        TRANSFORMS = {
            **{klass: _rename for klass in subclasses(exp.__name__, exp.Binary)},
            **{klass: _rename for klass in exp.ALL_FUNCTIONS},
            exp.Case: _case_sql,
            exp.Alias: lambda self, e: self.sql(e.this),
            exp.Array: inline_array_sql,
            exp.And: lambda self, e: self.binary(e, "and"),
            exp.Between: _rename,
            exp.Boolean: lambda self, e: "True" if e.this else "False",
            exp.Cast: lambda self, e: f"CAST({self.sql(e.this)}, exp.DataType.Type.{e.args['to']})",
            exp.Column: lambda self,
            e: f"scope[{self.sql(e, 'table') or None}][{self.sql(e.this)}]",
            exp.Concat: lambda self, e: self.func(
                "SAFECONCAT" if e.args.get("safe") else "CONCAT", *e.expressions
            ),
            exp.Distinct: lambda self, e: f"set({self.sql(e, 'this')})",
            exp.Div: _div_sql,
            exp.Extract: lambda self,
            e: f"EXTRACT('{e.name.lower()}', {self.sql(e, 'expression')})",
            exp.In: lambda self,
            e: f"{self.sql(e, 'this')} in {{{self.expressions(e, flat=True)}}}",
            exp.Interval: lambda self, e: f"INTERVAL({self.sql(e.this)}, '{self.sql(e.unit)}')",
            exp.Is: lambda self, e: (
                self.binary(e, "==") if isinstance(e.this, exp.Literal) else self.binary(e, "is")
            ),
            exp.JSONExtract: lambda self, e: self.func(e.key, e.this, e.expression, *e.expressions),
            exp.JSONPath: lambda self, e: f"[{','.join(self.sql(p) for p in e.expressions[1:])}]",
            exp.JSONPathKey: lambda self, e: f"'{self.sql(e.this)}'",
            exp.JSONPathSubscript: lambda self, e: f"'{e.this}'",
            exp.Lambda: _lambda_sql,
            exp.Not: lambda self, e: f"not {self.sql(e.this)}",
            exp.Null: lambda *_: "None",
            exp.Or: lambda self, e: self.binary(e, "or"),
            exp.Ordered: _ordered_py,
            exp.Star: lambda *_: "1",
        }
