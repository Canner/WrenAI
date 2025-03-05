"""
## Expressions

Every AST node in SQLGlot is represented by a subclass of `Expression`.

This module contains the implementation of all supported `Expression` types. Additionally,
it exposes a number of helper functions, which are mainly used to programmatically build
SQL expressions, such as `sqlglot.expressions.select`.

----
"""

from __future__ import annotations
import datetime
import math
import numbers
import re
import textwrap
import typing as t
from collections import deque
from copy import deepcopy
from decimal import Decimal
from enum import auto
from functools import reduce

from sqlglot.errors import ErrorLevel, ParseError
from sqlglot.helper import (
    AutoName,
    camel_to_snake_case,
    ensure_collection,
    ensure_list,
    seq_get,
    subclasses,
    to_bool,
)
from sqlglot.tokens import Token, TokenError

if t.TYPE_CHECKING:
    from typing_extensions import Self
    from sqlglot._typing import E, Lit
    from sqlglot.dialects.dialect import DialectType

    Q = t.TypeVar("Q", bound="Query")
    S = t.TypeVar("S", bound="SetOperation")


class _Expression(type):
    def __new__(cls, clsname, bases, attrs):
        klass = super().__new__(cls, clsname, bases, attrs)

        # When an Expression class is created, its key is automatically set to be
        # the lowercase version of the class' name.
        klass.key = clsname.lower()

        # This is so that docstrings are not inherited in pdoc
        klass.__doc__ = klass.__doc__ or ""

        return klass


SQLGLOT_META = "sqlglot.meta"
TABLE_PARTS = ("this", "db", "catalog")
COLUMN_PARTS = ("this", "table", "db", "catalog")


class Expression(metaclass=_Expression):
    """
    The base class for all expressions in a syntax tree. Each Expression encapsulates any necessary
    context, such as its child expressions, their names (arg keys), and whether a given child expression
    is optional or not.

    Attributes:
        key: a unique key for each class in the Expression hierarchy. This is useful for hashing
            and representing expressions as strings.
        arg_types: determines the arguments (child nodes) supported by an expression. It maps
            arg keys to booleans that indicate whether the corresponding args are optional.
        parent: a reference to the parent expression (or None, in case of root expressions).
        arg_key: the arg key an expression is associated with, i.e. the name its parent expression
            uses to refer to it.
        index: the index of an expression if it is inside of a list argument in its parent.
        comments: a list of comments that are associated with a given expression. This is used in
            order to preserve comments when transpiling SQL code.
        type: the `sqlglot.expressions.DataType` type of an expression. This is inferred by the
            optimizer, in order to enable some transformations that require type information.
        meta: a dictionary that can be used to store useful metadata for a given expression.

    Example:
        >>> class Foo(Expression):
        ...     arg_types = {"this": True, "expression": False}

        The above definition informs us that Foo is an Expression that requires an argument called
        "this" and may also optionally receive an argument called "expression".

    Args:
        args: a mapping used for retrieving the arguments of an expression, given their arg keys.
    """

    key = "expression"
    arg_types = {"this": True}
    __slots__ = ("args", "parent", "arg_key", "index", "comments", "_type", "_meta", "_hash")

    def __init__(self, **args: t.Any):
        self.args: t.Dict[str, t.Any] = args
        self.parent: t.Optional[Expression] = None
        self.arg_key: t.Optional[str] = None
        self.index: t.Optional[int] = None
        self.comments: t.Optional[t.List[str]] = None
        self._type: t.Optional[DataType] = None
        self._meta: t.Optional[t.Dict[str, t.Any]] = None
        self._hash: t.Optional[int] = None

        for arg_key, value in self.args.items():
            self._set_parent(arg_key, value)

    def __eq__(self, other) -> bool:
        return type(self) is type(other) and hash(self) == hash(other)

    @property
    def hashable_args(self) -> t.Any:
        return frozenset(
            (k, tuple(_norm_arg(a) for a in v) if type(v) is list else _norm_arg(v))
            for k, v in self.args.items()
            if not (v is None or v is False or (type(v) is list and not v))
        )

    def __hash__(self) -> int:
        if self._hash is not None:
            return self._hash

        return hash((self.__class__, self.hashable_args))

    @property
    def this(self) -> t.Any:
        """
        Retrieves the argument with key "this".
        """
        return self.args.get("this")

    @property
    def expression(self) -> t.Any:
        """
        Retrieves the argument with key "expression".
        """
        return self.args.get("expression")

    @property
    def expressions(self) -> t.List[t.Any]:
        """
        Retrieves the argument with key "expressions".
        """
        return self.args.get("expressions") or []

    def text(self, key) -> str:
        """
        Returns a textual representation of the argument corresponding to "key". This can only be used
        for args that are strings or leaf Expression instances, such as identifiers and literals.
        """
        field = self.args.get(key)
        if isinstance(field, str):
            return field
        if isinstance(field, (Identifier, Literal, Var)):
            return field.this
        if isinstance(field, (Star, Null)):
            return field.name
        return ""

    @property
    def is_string(self) -> bool:
        """
        Checks whether a Literal expression is a string.
        """
        return isinstance(self, Literal) and self.args["is_string"]

    @property
    def is_number(self) -> bool:
        """
        Checks whether a Literal expression is a number.
        """
        return (isinstance(self, Literal) and not self.args["is_string"]) or (
            isinstance(self, Neg) and self.this.is_number
        )

    def to_py(self) -> t.Any:
        """
        Returns a Python object equivalent of the SQL node.
        """
        raise ValueError(f"{self} cannot be converted to a Python object.")

    @property
    def is_int(self) -> bool:
        """
        Checks whether an expression is an integer.
        """
        return self.is_number and isinstance(self.to_py(), int)

    @property
    def is_star(self) -> bool:
        """Checks whether an expression is a star."""
        return isinstance(self, Star) or (isinstance(self, Column) and isinstance(self.this, Star))

    @property
    def alias(self) -> str:
        """
        Returns the alias of the expression, or an empty string if it's not aliased.
        """
        if isinstance(self.args.get("alias"), TableAlias):
            return self.args["alias"].name
        return self.text("alias")

    @property
    def alias_column_names(self) -> t.List[str]:
        table_alias = self.args.get("alias")
        if not table_alias:
            return []
        return [c.name for c in table_alias.args.get("columns") or []]

    @property
    def name(self) -> str:
        return self.text("this")

    @property
    def alias_or_name(self) -> str:
        return self.alias or self.name

    @property
    def output_name(self) -> str:
        """
        Name of the output column if this expression is a selection.

        If the Expression has no output name, an empty string is returned.

        Example:
            >>> from sqlglot import parse_one
            >>> parse_one("SELECT a").expressions[0].output_name
            'a'
            >>> parse_one("SELECT b AS c").expressions[0].output_name
            'c'
            >>> parse_one("SELECT 1 + 2").expressions[0].output_name
            ''
        """
        return ""

    @property
    def type(self) -> t.Optional[DataType]:
        return self._type

    @type.setter
    def type(self, dtype: t.Optional[DataType | DataType.Type | str]) -> None:
        if dtype and not isinstance(dtype, DataType):
            dtype = DataType.build(dtype)
        self._type = dtype  # type: ignore

    def is_type(self, *dtypes) -> bool:
        return self.type is not None and self.type.is_type(*dtypes)

    def is_leaf(self) -> bool:
        return not any(isinstance(v, (Expression, list)) for v in self.args.values())

    @property
    def meta(self) -> t.Dict[str, t.Any]:
        if self._meta is None:
            self._meta = {}
        return self._meta

    def __deepcopy__(self, memo):
        root = self.__class__()
        stack = [(self, root)]

        while stack:
            node, copy = stack.pop()

            if node.comments is not None:
                copy.comments = deepcopy(node.comments)
            if node._type is not None:
                copy._type = deepcopy(node._type)
            if node._meta is not None:
                copy._meta = deepcopy(node._meta)
            if node._hash is not None:
                copy._hash = node._hash

            for k, vs in node.args.items():
                if hasattr(vs, "parent"):
                    stack.append((vs, vs.__class__()))
                    copy.set(k, stack[-1][-1])
                elif type(vs) is list:
                    copy.args[k] = []

                    for v in vs:
                        if hasattr(v, "parent"):
                            stack.append((v, v.__class__()))
                            copy.append(k, stack[-1][-1])
                        else:
                            copy.append(k, v)
                else:
                    copy.args[k] = vs

        return root

    def copy(self) -> Self:
        """
        Returns a deep copy of the expression.
        """
        return deepcopy(self)

    def add_comments(self, comments: t.Optional[t.List[str]] = None, prepend: bool = False) -> None:
        if self.comments is None:
            self.comments = []

        if comments:
            for comment in comments:
                _, *meta = comment.split(SQLGLOT_META)
                if meta:
                    for kv in "".join(meta).split(","):
                        k, *v = kv.split("=")
                        value = v[0].strip() if v else True
                        self.meta[k.strip()] = to_bool(value)

                if not prepend:
                    self.comments.append(comment)

            if prepend:
                self.comments = comments + self.comments

    def pop_comments(self) -> t.List[str]:
        comments = self.comments or []
        self.comments = None
        return comments

    def append(self, arg_key: str, value: t.Any) -> None:
        """
        Appends value to arg_key if it's a list or sets it as a new list.

        Args:
            arg_key (str): name of the list expression arg
            value (Any): value to append to the list
        """
        if type(self.args.get(arg_key)) is not list:
            self.args[arg_key] = []
        self._set_parent(arg_key, value)
        values = self.args[arg_key]
        if hasattr(value, "parent"):
            value.index = len(values)
        values.append(value)

    def set(
        self,
        arg_key: str,
        value: t.Any,
        index: t.Optional[int] = None,
        overwrite: bool = True,
    ) -> None:
        """
        Sets arg_key to value.

        Args:
            arg_key: name of the expression arg.
            value: value to set the arg to.
            index: if the arg is a list, this specifies what position to add the value in it.
            overwrite: assuming an index is given, this determines whether to overwrite the
                list entry instead of only inserting a new value (i.e., like list.insert).
        """
        if index is not None:
            expressions = self.args.get(arg_key) or []

            if seq_get(expressions, index) is None:
                return
            if value is None:
                expressions.pop(index)
                for v in expressions[index:]:
                    v.index = v.index - 1
                return

            if isinstance(value, list):
                expressions.pop(index)
                expressions[index:index] = value
            elif overwrite:
                expressions[index] = value
            else:
                expressions.insert(index, value)

            value = expressions
        elif value is None:
            self.args.pop(arg_key, None)
            return

        self.args[arg_key] = value
        self._set_parent(arg_key, value, index)

    def _set_parent(self, arg_key: str, value: t.Any, index: t.Optional[int] = None) -> None:
        if hasattr(value, "parent"):
            value.parent = self
            value.arg_key = arg_key
            value.index = index
        elif type(value) is list:
            for index, v in enumerate(value):
                if hasattr(v, "parent"):
                    v.parent = self
                    v.arg_key = arg_key
                    v.index = index

    @property
    def depth(self) -> int:
        """
        Returns the depth of this tree.
        """
        if self.parent:
            return self.parent.depth + 1
        return 0

    def iter_expressions(self, reverse: bool = False) -> t.Iterator[Expression]:
        """Yields the key and expression for all arguments, exploding list args."""
        # remove tuple when python 3.7 is deprecated
        for vs in reversed(tuple(self.args.values())) if reverse else self.args.values():  # type: ignore
            if type(vs) is list:
                for v in reversed(vs) if reverse else vs:  # type: ignore
                    if hasattr(v, "parent"):
                        yield v
            else:
                if hasattr(vs, "parent"):
                    yield vs

    def find(self, *expression_types: t.Type[E], bfs: bool = True) -> t.Optional[E]:
        """
        Returns the first node in this tree which matches at least one of
        the specified types.

        Args:
            expression_types: the expression type(s) to match.
            bfs: whether to search the AST using the BFS algorithm (DFS is used if false).

        Returns:
            The node which matches the criteria or None if no such node was found.
        """
        return next(self.find_all(*expression_types, bfs=bfs), None)

    def find_all(self, *expression_types: t.Type[E], bfs: bool = True) -> t.Iterator[E]:
        """
        Returns a generator object which visits all nodes in this tree and only
        yields those that match at least one of the specified expression types.

        Args:
            expression_types: the expression type(s) to match.
            bfs: whether to search the AST using the BFS algorithm (DFS is used if false).

        Returns:
            The generator object.
        """
        for expression in self.walk(bfs=bfs):
            if isinstance(expression, expression_types):
                yield expression

    def find_ancestor(self, *expression_types: t.Type[E]) -> t.Optional[E]:
        """
        Returns a nearest parent matching expression_types.

        Args:
            expression_types: the expression type(s) to match.

        Returns:
            The parent node.
        """
        ancestor = self.parent
        while ancestor and not isinstance(ancestor, expression_types):
            ancestor = ancestor.parent
        return ancestor  # type: ignore

    @property
    def parent_select(self) -> t.Optional[Select]:
        """
        Returns the parent select statement.
        """
        return self.find_ancestor(Select)

    @property
    def same_parent(self) -> bool:
        """Returns if the parent is the same class as itself."""
        return type(self.parent) is self.__class__

    def root(self) -> Expression:
        """
        Returns the root expression of this tree.
        """
        expression = self
        while expression.parent:
            expression = expression.parent
        return expression

    def walk(
        self, bfs: bool = True, prune: t.Optional[t.Callable[[Expression], bool]] = None
    ) -> t.Iterator[Expression]:
        """
        Returns a generator object which visits all nodes in this tree.

        Args:
            bfs: if set to True the BFS traversal order will be applied,
                otherwise the DFS traversal will be used instead.
            prune: callable that returns True if the generator should stop traversing
                this branch of the tree.

        Returns:
            the generator object.
        """
        if bfs:
            yield from self.bfs(prune=prune)
        else:
            yield from self.dfs(prune=prune)

    def dfs(
        self, prune: t.Optional[t.Callable[[Expression], bool]] = None
    ) -> t.Iterator[Expression]:
        """
        Returns a generator object which visits all nodes in this tree in
        the DFS (Depth-first) order.

        Returns:
            The generator object.
        """
        stack = [self]

        while stack:
            node = stack.pop()

            yield node

            if prune and prune(node):
                continue

            for v in node.iter_expressions(reverse=True):
                stack.append(v)

    def bfs(
        self, prune: t.Optional[t.Callable[[Expression], bool]] = None
    ) -> t.Iterator[Expression]:
        """
        Returns a generator object which visits all nodes in this tree in
        the BFS (Breadth-first) order.

        Returns:
            The generator object.
        """
        queue = deque([self])

        while queue:
            node = queue.popleft()

            yield node

            if prune and prune(node):
                continue

            for v in node.iter_expressions():
                queue.append(v)

    def unnest(self):
        """
        Returns the first non parenthesis child or self.
        """
        expression = self
        while type(expression) is Paren:
            expression = expression.this
        return expression

    def unalias(self):
        """
        Returns the inner expression if this is an Alias.
        """
        if isinstance(self, Alias):
            return self.this
        return self

    def unnest_operands(self):
        """
        Returns unnested operands as a tuple.
        """
        return tuple(arg.unnest() for arg in self.iter_expressions())

    def flatten(self, unnest=True):
        """
        Returns a generator which yields child nodes whose parents are the same class.

        A AND B AND C -> [A, B, C]
        """
        for node in self.dfs(prune=lambda n: n.parent and type(n) is not self.__class__):
            if type(node) is not self.__class__:
                yield node.unnest() if unnest and not isinstance(node, Subquery) else node

    def __str__(self) -> str:
        return self.sql()

    def __repr__(self) -> str:
        return _to_s(self)

    def to_s(self) -> str:
        """
        Same as __repr__, but includes additional information which can be useful
        for debugging, like empty or missing args and the AST nodes' object IDs.
        """
        return _to_s(self, verbose=True)

    def sql(self, dialect: DialectType = None, **opts) -> str:
        """
        Returns SQL string representation of this tree.

        Args:
            dialect: the dialect of the output SQL string (eg. "spark", "hive", "presto", "mysql").
            opts: other `sqlglot.generator.Generator` options.

        Returns:
            The SQL string.
        """
        from sqlglot.dialects import Dialect

        return Dialect.get_or_raise(dialect).generate(self, **opts)

    def transform(self, fun: t.Callable, *args: t.Any, copy: bool = True, **kwargs) -> Expression:
        """
        Visits all tree nodes (excluding already transformed ones)
        and applies the given transformation function to each node.

        Args:
            fun: a function which takes a node as an argument and returns a
                new transformed node or the same node without modifications. If the function
                returns None, then the corresponding node will be removed from the syntax tree.
            copy: if set to True a new tree instance is constructed, otherwise the tree is
                modified in place.

        Returns:
            The transformed tree.
        """
        root = None
        new_node = None

        for node in (self.copy() if copy else self).dfs(prune=lambda n: n is not new_node):
            parent, arg_key, index = node.parent, node.arg_key, node.index
            new_node = fun(node, *args, **kwargs)

            if not root:
                root = new_node
            elif new_node is not node:
                parent.set(arg_key, new_node, index)

        assert root
        return root.assert_is(Expression)

    @t.overload
    def replace(self, expression: E) -> E: ...

    @t.overload
    def replace(self, expression: None) -> None: ...

    def replace(self, expression):
        """
        Swap out this expression with a new expression.

        For example::

            >>> tree = Select().select("x").from_("tbl")
            >>> tree.find(Column).replace(column("y"))
            Column(
              this=Identifier(this=y, quoted=False))
            >>> tree.sql()
            'SELECT y FROM tbl'

        Args:
            expression: new node

        Returns:
            The new expression or expressions.
        """
        parent = self.parent

        if not parent or parent is expression:
            return expression

        key = self.arg_key
        value = parent.args.get(key)

        if type(expression) is list and isinstance(value, Expression):
            # We are trying to replace an Expression with a list, so it's assumed that
            # the intention was to really replace the parent of this expression.
            value.parent.replace(expression)
        else:
            parent.set(key, expression, self.index)

        if expression is not self:
            self.parent = None
            self.arg_key = None
            self.index = None

        return expression

    def pop(self: E) -> E:
        """
        Remove this expression from its AST.

        Returns:
            The popped expression.
        """
        self.replace(None)
        return self

    def assert_is(self, type_: t.Type[E]) -> E:
        """
        Assert that this `Expression` is an instance of `type_`.

        If it is NOT an instance of `type_`, this raises an assertion error.
        Otherwise, this returns this expression.

        Examples:
            This is useful for type security in chained expressions:

            >>> import sqlglot
            >>> sqlglot.parse_one("SELECT x from y").assert_is(Select).select("z").sql()
            'SELECT x, z FROM y'
        """
        if not isinstance(self, type_):
            raise AssertionError(f"{self} is not {type_}.")
        return self

    def error_messages(self, args: t.Optional[t.Sequence] = None) -> t.List[str]:
        """
        Checks if this expression is valid (e.g. all mandatory args are set).

        Args:
            args: a sequence of values that were used to instantiate a Func expression. This is used
                to check that the provided arguments don't exceed the function argument limit.

        Returns:
            A list of error messages for all possible errors that were found.
        """
        errors: t.List[str] = []

        for k in self.args:
            if k not in self.arg_types:
                errors.append(f"Unexpected keyword: '{k}' for {self.__class__}")
        for k, mandatory in self.arg_types.items():
            v = self.args.get(k)
            if mandatory and (v is None or (isinstance(v, list) and not v)):
                errors.append(f"Required keyword: '{k}' missing for {self.__class__}")

        if (
            args
            and isinstance(self, Func)
            and len(args) > len(self.arg_types)
            and not self.is_var_len_args
        ):
            errors.append(
                f"The number of provided arguments ({len(args)}) is greater than "
                f"the maximum number of supported arguments ({len(self.arg_types)})"
            )

        return errors

    def dump(self):
        """
        Dump this Expression to a JSON-serializable dict.
        """
        from sqlglot.serde import dump

        return dump(self)

    @classmethod
    def load(cls, obj):
        """
        Load a dict (as returned by `Expression.dump`) into an Expression instance.
        """
        from sqlglot.serde import load

        return load(obj)

    def and_(
        self,
        *expressions: t.Optional[ExpOrStr],
        dialect: DialectType = None,
        copy: bool = True,
        wrap: bool = True,
        **opts,
    ) -> Condition:
        """
        AND this condition with one or multiple expressions.

        Example:
            >>> condition("x=1").and_("y=1").sql()
            'x = 1 AND y = 1'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            dialect: the dialect used to parse the input expression.
            copy: whether to copy the involved expressions (only applies to Expressions).
            wrap: whether to wrap the operands in `Paren`s. This is true by default to avoid
                precedence issues, but can be turned off when the produced AST is too deep and
                causes recursion-related issues.
            opts: other options to use to parse the input expressions.

        Returns:
            The new And condition.
        """
        return and_(self, *expressions, dialect=dialect, copy=copy, wrap=wrap, **opts)

    def or_(
        self,
        *expressions: t.Optional[ExpOrStr],
        dialect: DialectType = None,
        copy: bool = True,
        wrap: bool = True,
        **opts,
    ) -> Condition:
        """
        OR this condition with one or multiple expressions.

        Example:
            >>> condition("x=1").or_("y=1").sql()
            'x = 1 OR y = 1'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            dialect: the dialect used to parse the input expression.
            copy: whether to copy the involved expressions (only applies to Expressions).
            wrap: whether to wrap the operands in `Paren`s. This is true by default to avoid
                precedence issues, but can be turned off when the produced AST is too deep and
                causes recursion-related issues.
            opts: other options to use to parse the input expressions.

        Returns:
            The new Or condition.
        """
        return or_(self, *expressions, dialect=dialect, copy=copy, wrap=wrap, **opts)

    def not_(self, copy: bool = True):
        """
        Wrap this condition with NOT.

        Example:
            >>> condition("x=1").not_().sql()
            'NOT x = 1'

        Args:
            copy: whether to copy this object.

        Returns:
            The new Not instance.
        """
        return not_(self, copy=copy)

    def as_(
        self,
        alias: str | Identifier,
        quoted: t.Optional[bool] = None,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Alias:
        return alias_(self, alias, quoted=quoted, dialect=dialect, copy=copy, **opts)

    def _binop(self, klass: t.Type[E], other: t.Any, reverse: bool = False) -> E:
        this = self.copy()
        other = convert(other, copy=True)
        if not isinstance(this, klass) and not isinstance(other, klass):
            this = _wrap(this, Binary)
            other = _wrap(other, Binary)
        if reverse:
            return klass(this=other, expression=this)
        return klass(this=this, expression=other)

    def __getitem__(self, other: ExpOrStr | t.Tuple[ExpOrStr]) -> Bracket:
        return Bracket(
            this=self.copy(), expressions=[convert(e, copy=True) for e in ensure_list(other)]
        )

    def __iter__(self) -> t.Iterator:
        if "expressions" in self.arg_types:
            return iter(self.args.get("expressions") or [])
        # We define this because __getitem__ converts Expression into an iterable, which is
        # problematic because one can hit infinite loops if they do "for x in some_expr: ..."
        # See: https://peps.python.org/pep-0234/
        raise TypeError(f"'{self.__class__.__name__}' object is not iterable")

    def isin(
        self,
        *expressions: t.Any,
        query: t.Optional[ExpOrStr] = None,
        unnest: t.Optional[ExpOrStr] | t.Collection[ExpOrStr] = None,
        copy: bool = True,
        **opts,
    ) -> In:
        subquery = maybe_parse(query, copy=copy, **opts) if query else None
        if subquery and not isinstance(subquery, Subquery):
            subquery = subquery.subquery(copy=False)

        return In(
            this=maybe_copy(self, copy),
            expressions=[convert(e, copy=copy) for e in expressions],
            query=subquery,
            unnest=(
                Unnest(
                    expressions=[
                        maybe_parse(t.cast(ExpOrStr, e), copy=copy, **opts)
                        for e in ensure_list(unnest)
                    ]
                )
                if unnest
                else None
            ),
        )

    def between(self, low: t.Any, high: t.Any, copy: bool = True, **opts) -> Between:
        return Between(
            this=maybe_copy(self, copy),
            low=convert(low, copy=copy, **opts),
            high=convert(high, copy=copy, **opts),
        )

    def is_(self, other: ExpOrStr) -> Is:
        return self._binop(Is, other)

    def like(self, other: ExpOrStr) -> Like:
        return self._binop(Like, other)

    def ilike(self, other: ExpOrStr) -> ILike:
        return self._binop(ILike, other)

    def eq(self, other: t.Any) -> EQ:
        return self._binop(EQ, other)

    def neq(self, other: t.Any) -> NEQ:
        return self._binop(NEQ, other)

    def rlike(self, other: ExpOrStr) -> RegexpLike:
        return self._binop(RegexpLike, other)

    def div(self, other: ExpOrStr, typed: bool = False, safe: bool = False) -> Div:
        div = self._binop(Div, other)
        div.args["typed"] = typed
        div.args["safe"] = safe
        return div

    def asc(self, nulls_first: bool = True) -> Ordered:
        return Ordered(this=self.copy(), nulls_first=nulls_first)

    def desc(self, nulls_first: bool = False) -> Ordered:
        return Ordered(this=self.copy(), desc=True, nulls_first=nulls_first)

    def __lt__(self, other: t.Any) -> LT:
        return self._binop(LT, other)

    def __le__(self, other: t.Any) -> LTE:
        return self._binop(LTE, other)

    def __gt__(self, other: t.Any) -> GT:
        return self._binop(GT, other)

    def __ge__(self, other: t.Any) -> GTE:
        return self._binop(GTE, other)

    def __add__(self, other: t.Any) -> Add:
        return self._binop(Add, other)

    def __radd__(self, other: t.Any) -> Add:
        return self._binop(Add, other, reverse=True)

    def __sub__(self, other: t.Any) -> Sub:
        return self._binop(Sub, other)

    def __rsub__(self, other: t.Any) -> Sub:
        return self._binop(Sub, other, reverse=True)

    def __mul__(self, other: t.Any) -> Mul:
        return self._binop(Mul, other)

    def __rmul__(self, other: t.Any) -> Mul:
        return self._binop(Mul, other, reverse=True)

    def __truediv__(self, other: t.Any) -> Div:
        return self._binop(Div, other)

    def __rtruediv__(self, other: t.Any) -> Div:
        return self._binop(Div, other, reverse=True)

    def __floordiv__(self, other: t.Any) -> IntDiv:
        return self._binop(IntDiv, other)

    def __rfloordiv__(self, other: t.Any) -> IntDiv:
        return self._binop(IntDiv, other, reverse=True)

    def __mod__(self, other: t.Any) -> Mod:
        return self._binop(Mod, other)

    def __rmod__(self, other: t.Any) -> Mod:
        return self._binop(Mod, other, reverse=True)

    def __pow__(self, other: t.Any) -> Pow:
        return self._binop(Pow, other)

    def __rpow__(self, other: t.Any) -> Pow:
        return self._binop(Pow, other, reverse=True)

    def __and__(self, other: t.Any) -> And:
        return self._binop(And, other)

    def __rand__(self, other: t.Any) -> And:
        return self._binop(And, other, reverse=True)

    def __or__(self, other: t.Any) -> Or:
        return self._binop(Or, other)

    def __ror__(self, other: t.Any) -> Or:
        return self._binop(Or, other, reverse=True)

    def __neg__(self) -> Neg:
        return Neg(this=_wrap(self.copy(), Binary))

    def __invert__(self) -> Not:
        return not_(self.copy())


IntoType = t.Union[
    str,
    t.Type[Expression],
    t.Collection[t.Union[str, t.Type[Expression]]],
]
ExpOrStr = t.Union[str, Expression]


class Condition(Expression):
    """Logical conditions like x AND y, or simply x"""


class Predicate(Condition):
    """Relationships like x = y, x > 1, x >= y."""


class DerivedTable(Expression):
    @property
    def selects(self) -> t.List[Expression]:
        return self.this.selects if isinstance(self.this, Query) else []

    @property
    def named_selects(self) -> t.List[str]:
        return [select.output_name for select in self.selects]


class Query(Expression):
    def subquery(self, alias: t.Optional[ExpOrStr] = None, copy: bool = True) -> Subquery:
        """
        Returns a `Subquery` that wraps around this query.

        Example:
            >>> subquery = Select().select("x").from_("tbl").subquery()
            >>> Select().select("x").from_(subquery).sql()
            'SELECT x FROM (SELECT x FROM tbl)'

        Args:
            alias: an optional alias for the subquery.
            copy: if `False`, modify this expression instance in-place.
        """
        instance = maybe_copy(self, copy)
        if not isinstance(alias, Expression):
            alias = TableAlias(this=to_identifier(alias)) if alias else None

        return Subquery(this=instance, alias=alias)

    def limit(
        self: Q, expression: ExpOrStr | int, dialect: DialectType = None, copy: bool = True, **opts
    ) -> Q:
        """
        Adds a LIMIT clause to this query.

        Example:
            >>> select("1").union(select("1")).limit(1).sql()
            'SELECT 1 UNION SELECT 1 LIMIT 1'

        Args:
            expression: the SQL code string to parse.
                This can also be an integer.
                If a `Limit` instance is passed, it will be used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Limit`.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            A limited Select expression.
        """
        return _apply_builder(
            expression=expression,
            instance=self,
            arg="limit",
            into=Limit,
            prefix="LIMIT",
            dialect=dialect,
            copy=copy,
            into_arg="expression",
            **opts,
        )

    def offset(
        self: Q, expression: ExpOrStr | int, dialect: DialectType = None, copy: bool = True, **opts
    ) -> Q:
        """
        Set the OFFSET expression.

        Example:
            >>> Select().from_("tbl").select("x").offset(10).sql()
            'SELECT x FROM tbl OFFSET 10'

        Args:
            expression: the SQL code string to parse.
                This can also be an integer.
                If a `Offset` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Offset`.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_builder(
            expression=expression,
            instance=self,
            arg="offset",
            into=Offset,
            prefix="OFFSET",
            dialect=dialect,
            copy=copy,
            into_arg="expression",
            **opts,
        )

    def order_by(
        self: Q,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Q:
        """
        Set the ORDER BY expression.

        Example:
            >>> Select().from_("tbl").select("x").order_by("x DESC").sql()
            'SELECT x FROM tbl ORDER BY x DESC'

        Args:
            *expressions: the SQL code strings to parse.
                If a `Group` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Order`.
            append: if `True`, add to any existing expressions.
                Otherwise, this flattens all the `Order` expression into a single expression.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_child_list_builder(
            *expressions,
            instance=self,
            arg="order",
            append=append,
            copy=copy,
            prefix="ORDER BY",
            into=Order,
            dialect=dialect,
            **opts,
        )

    @property
    def ctes(self) -> t.List[CTE]:
        """Returns a list of all the CTEs attached to this query."""
        with_ = self.args.get("with")
        return with_.expressions if with_ else []

    @property
    def selects(self) -> t.List[Expression]:
        """Returns the query's projections."""
        raise NotImplementedError("Query objects must implement `selects`")

    @property
    def named_selects(self) -> t.List[str]:
        """Returns the output names of the query's projections."""
        raise NotImplementedError("Query objects must implement `named_selects`")

    def select(
        self: Q,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Q:
        """
        Append to or set the SELECT expressions.

        Example:
            >>> Select().select("x", "y").sql()
            'SELECT x, y'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Query expression.
        """
        raise NotImplementedError("Query objects must implement `select`")

    def with_(
        self: Q,
        alias: ExpOrStr,
        as_: ExpOrStr,
        recursive: t.Optional[bool] = None,
        materialized: t.Optional[bool] = None,
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Q:
        """
        Append to or set the common table expressions.

        Example:
            >>> Select().with_("tbl2", as_="SELECT * FROM tbl").select("x").from_("tbl2").sql()
            'WITH tbl2 AS (SELECT * FROM tbl) SELECT x FROM tbl2'

        Args:
            alias: the SQL code string to parse as the table name.
                If an `Expression` instance is passed, this is used as-is.
            as_: the SQL code string to parse as the table expression.
                If an `Expression` instance is passed, it will be used as-is.
            recursive: set the RECURSIVE part of the expression. Defaults to `False`.
            materialized: set the MATERIALIZED part of the expression.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified expression.
        """
        return _apply_cte_builder(
            self,
            alias,
            as_,
            recursive=recursive,
            materialized=materialized,
            append=append,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def union(
        self, *expressions: ExpOrStr, distinct: bool = True, dialect: DialectType = None, **opts
    ) -> Union:
        """
        Builds a UNION expression.

        Example:
            >>> import sqlglot
            >>> sqlglot.parse_one("SELECT * FROM foo").union("SELECT * FROM bla").sql()
            'SELECT * FROM foo UNION SELECT * FROM bla'

        Args:
            expressions: the SQL code strings.
                If `Expression` instances are passed, they will be used as-is.
            distinct: set the DISTINCT flag if and only if this is true.
            dialect: the dialect used to parse the input expression.
            opts: other options to use to parse the input expressions.

        Returns:
            The new Union expression.
        """
        return union(self, *expressions, distinct=distinct, dialect=dialect, **opts)

    def intersect(
        self, *expressions: ExpOrStr, distinct: bool = True, dialect: DialectType = None, **opts
    ) -> Intersect:
        """
        Builds an INTERSECT expression.

        Example:
            >>> import sqlglot
            >>> sqlglot.parse_one("SELECT * FROM foo").intersect("SELECT * FROM bla").sql()
            'SELECT * FROM foo INTERSECT SELECT * FROM bla'

        Args:
            expressions: the SQL code strings.
                If `Expression` instances are passed, they will be used as-is.
            distinct: set the DISTINCT flag if and only if this is true.
            dialect: the dialect used to parse the input expression.
            opts: other options to use to parse the input expressions.

        Returns:
            The new Intersect expression.
        """
        return intersect(self, *expressions, distinct=distinct, dialect=dialect, **opts)

    def except_(
        self, *expressions: ExpOrStr, distinct: bool = True, dialect: DialectType = None, **opts
    ) -> Except:
        """
        Builds an EXCEPT expression.

        Example:
            >>> import sqlglot
            >>> sqlglot.parse_one("SELECT * FROM foo").except_("SELECT * FROM bla").sql()
            'SELECT * FROM foo EXCEPT SELECT * FROM bla'

        Args:
            expressions: the SQL code strings.
                If `Expression` instance are passed, they will be used as-is.
            distinct: set the DISTINCT flag if and only if this is true.
            dialect: the dialect used to parse the input expression.
            opts: other options to use to parse the input expressions.

        Returns:
            The new Except expression.
        """
        return except_(self, *expressions, distinct=distinct, dialect=dialect, **opts)


class UDTF(DerivedTable):
    @property
    def selects(self) -> t.List[Expression]:
        alias = self.args.get("alias")
        return alias.columns if alias else []


class Cache(Expression):
    arg_types = {
        "this": True,
        "lazy": False,
        "options": False,
        "expression": False,
    }


class Uncache(Expression):
    arg_types = {"this": True, "exists": False}


class Refresh(Expression):
    pass


class DDL(Expression):
    @property
    def ctes(self) -> t.List[CTE]:
        """Returns a list of all the CTEs attached to this statement."""
        with_ = self.args.get("with")
        return with_.expressions if with_ else []

    @property
    def selects(self) -> t.List[Expression]:
        """If this statement contains a query (e.g. a CTAS), this returns the query's projections."""
        return self.expression.selects if isinstance(self.expression, Query) else []

    @property
    def named_selects(self) -> t.List[str]:
        """
        If this statement contains a query (e.g. a CTAS), this returns the output
        names of the query's projections.
        """
        return self.expression.named_selects if isinstance(self.expression, Query) else []


class DML(Expression):
    def returning(
        self,
        expression: ExpOrStr,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> "Self":
        """
        Set the RETURNING expression. Not supported by all dialects.

        Example:
            >>> delete("tbl").returning("*", dialect="postgres").sql()
            'DELETE FROM tbl RETURNING *'

        Args:
            expression: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Delete: the modified expression.
        """
        return _apply_builder(
            expression=expression,
            instance=self,
            arg="returning",
            prefix="RETURNING",
            dialect=dialect,
            copy=copy,
            into=Returning,
            **opts,
        )


class Create(DDL):
    arg_types = {
        "with": False,
        "this": True,
        "kind": True,
        "expression": False,
        "exists": False,
        "properties": False,
        "replace": False,
        "refresh": False,
        "unique": False,
        "indexes": False,
        "no_schema_binding": False,
        "begin": False,
        "end": False,
        "clone": False,
        "concurrently": False,
        "clustered": False,
    }

    @property
    def kind(self) -> t.Optional[str]:
        kind = self.args.get("kind")
        return kind and kind.upper()


class SequenceProperties(Expression):
    arg_types = {
        "increment": False,
        "minvalue": False,
        "maxvalue": False,
        "cache": False,
        "start": False,
        "owned": False,
        "options": False,
    }


class TruncateTable(Expression):
    arg_types = {
        "expressions": True,
        "is_database": False,
        "exists": False,
        "only": False,
        "cluster": False,
        "identity": False,
        "option": False,
        "partition": False,
    }


# https://docs.snowflake.com/en/sql-reference/sql/create-clone
# https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_table_clone_statement
# https://cloud.google.com/bigquery/docs/reference/standard-sql/data-definition-language#create_table_copy
class Clone(Expression):
    arg_types = {"this": True, "shallow": False, "copy": False}


class Describe(Expression):
    arg_types = {
        "this": True,
        "style": False,
        "kind": False,
        "expressions": False,
        "partition": False,
        "format": False,
    }


# https://duckdb.org/docs/sql/statements/attach.html#attach
class Attach(Expression):
    arg_types = {"this": True, "exists": False, "expressions": False}


# https://duckdb.org/docs/sql/statements/attach.html#detach
class Detach(Expression):
    arg_types = {"this": True, "exists": False}


# https://duckdb.org/docs/guides/meta/summarize.html
class Summarize(Expression):
    arg_types = {"this": True, "table": False}


class Kill(Expression):
    arg_types = {"this": True, "kind": False}


class Pragma(Expression):
    pass


class Declare(Expression):
    arg_types = {"expressions": True}


class DeclareItem(Expression):
    arg_types = {"this": True, "kind": True, "default": False}


class Set(Expression):
    arg_types = {"expressions": False, "unset": False, "tag": False}


class Heredoc(Expression):
    arg_types = {"this": True, "tag": False}


class SetItem(Expression):
    arg_types = {
        "this": False,
        "expressions": False,
        "kind": False,
        "collate": False,  # MySQL SET NAMES statement
        "global": False,
    }


class Show(Expression):
    arg_types = {
        "this": True,
        "history": False,
        "terse": False,
        "target": False,
        "offset": False,
        "starts_with": False,
        "limit": False,
        "from": False,
        "like": False,
        "where": False,
        "db": False,
        "scope": False,
        "scope_kind": False,
        "full": False,
        "mutex": False,
        "query": False,
        "channel": False,
        "global": False,
        "log": False,
        "position": False,
        "types": False,
    }


class UserDefinedFunction(Expression):
    arg_types = {"this": True, "expressions": False, "wrapped": False}


class CharacterSet(Expression):
    arg_types = {"this": True, "default": False}


class With(Expression):
    arg_types = {"expressions": True, "recursive": False}

    @property
    def recursive(self) -> bool:
        return bool(self.args.get("recursive"))


class WithinGroup(Expression):
    arg_types = {"this": True, "expression": False}


# clickhouse supports scalar ctes
# https://clickhouse.com/docs/en/sql-reference/statements/select/with
class CTE(DerivedTable):
    arg_types = {
        "this": True,
        "alias": True,
        "scalar": False,
        "materialized": False,
    }


class ProjectionDef(Expression):
    arg_types = {"this": True, "expression": True}


class TableAlias(Expression):
    arg_types = {"this": False, "columns": False}

    @property
    def columns(self):
        return self.args.get("columns") or []


class BitString(Condition):
    pass


class HexString(Condition):
    pass


class ByteString(Condition):
    pass


class RawString(Condition):
    pass


class UnicodeString(Condition):
    arg_types = {"this": True, "escape": False}


class Column(Condition):
    arg_types = {"this": True, "table": False, "db": False, "catalog": False, "join_mark": False}

    @property
    def table(self) -> str:
        return self.text("table")

    @property
    def db(self) -> str:
        return self.text("db")

    @property
    def catalog(self) -> str:
        return self.text("catalog")

    @property
    def output_name(self) -> str:
        return self.name

    @property
    def parts(self) -> t.List[Identifier]:
        """Return the parts of a column in order catalog, db, table, name."""
        return [
            t.cast(Identifier, self.args[part])
            for part in ("catalog", "db", "table", "this")
            if self.args.get(part)
        ]

    def to_dot(self) -> Dot | Identifier:
        """Converts the column into a dot expression."""
        parts = self.parts
        parent = self.parent

        while parent:
            if isinstance(parent, Dot):
                parts.append(parent.expression)
            parent = parent.parent

        return Dot.build(deepcopy(parts)) if len(parts) > 1 else parts[0]


class ColumnPosition(Expression):
    arg_types = {"this": False, "position": True}


class ColumnDef(Expression):
    arg_types = {
        "this": True,
        "kind": False,
        "constraints": False,
        "exists": False,
        "position": False,
    }

    @property
    def constraints(self) -> t.List[ColumnConstraint]:
        return self.args.get("constraints") or []

    @property
    def kind(self) -> t.Optional[DataType]:
        return self.args.get("kind")


class AlterColumn(Expression):
    arg_types = {
        "this": True,
        "dtype": False,
        "collate": False,
        "using": False,
        "default": False,
        "drop": False,
        "comment": False,
        "allow_null": False,
    }


# https://docs.aws.amazon.com/redshift/latest/dg/r_ALTER_TABLE.html
class AlterDistStyle(Expression):
    pass


class AlterSortKey(Expression):
    arg_types = {"this": False, "expressions": False, "compound": False}


class AlterSet(Expression):
    arg_types = {
        "expressions": False,
        "option": False,
        "tablespace": False,
        "access_method": False,
        "file_format": False,
        "copy_options": False,
        "tag": False,
        "location": False,
        "serde": False,
    }


class RenameColumn(Expression):
    arg_types = {"this": True, "to": True, "exists": False}


class AlterRename(Expression):
    pass


class SwapTable(Expression):
    pass


class Comment(Expression):
    arg_types = {
        "this": True,
        "kind": True,
        "expression": True,
        "exists": False,
        "materialized": False,
    }


class Comprehension(Expression):
    arg_types = {"this": True, "expression": True, "iterator": True, "condition": False}


# https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#mergetree-table-ttl
class MergeTreeTTLAction(Expression):
    arg_types = {
        "this": True,
        "delete": False,
        "recompress": False,
        "to_disk": False,
        "to_volume": False,
    }


# https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#mergetree-table-ttl
class MergeTreeTTL(Expression):
    arg_types = {
        "expressions": True,
        "where": False,
        "group": False,
        "aggregates": False,
    }


# https://dev.mysql.com/doc/refman/8.0/en/create-table.html
class IndexConstraintOption(Expression):
    arg_types = {
        "key_block_size": False,
        "using": False,
        "parser": False,
        "comment": False,
        "visible": False,
        "engine_attr": False,
        "secondary_engine_attr": False,
    }


class ColumnConstraint(Expression):
    arg_types = {"this": False, "kind": True}

    @property
    def kind(self) -> ColumnConstraintKind:
        return self.args["kind"]


class ColumnConstraintKind(Expression):
    pass


class AutoIncrementColumnConstraint(ColumnConstraintKind):
    pass


class PeriodForSystemTimeConstraint(ColumnConstraintKind):
    arg_types = {"this": True, "expression": True}


class CaseSpecificColumnConstraint(ColumnConstraintKind):
    arg_types = {"not_": True}


class CharacterSetColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": True}


class CheckColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": True, "enforced": False}


class ClusteredColumnConstraint(ColumnConstraintKind):
    pass


class CollateColumnConstraint(ColumnConstraintKind):
    pass


class CommentColumnConstraint(ColumnConstraintKind):
    pass


class CompressColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": False}


class DateFormatColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": True}


class DefaultColumnConstraint(ColumnConstraintKind):
    pass


class EncodeColumnConstraint(ColumnConstraintKind):
    pass


# https://www.postgresql.org/docs/current/sql-createtable.html#SQL-CREATETABLE-EXCLUDE
class ExcludeColumnConstraint(ColumnConstraintKind):
    pass


class EphemeralColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": False}


class WithOperator(Expression):
    arg_types = {"this": True, "op": True}


class GeneratedAsIdentityColumnConstraint(ColumnConstraintKind):
    # this: True -> ALWAYS, this: False -> BY DEFAULT
    arg_types = {
        "this": False,
        "expression": False,
        "on_null": False,
        "start": False,
        "increment": False,
        "minvalue": False,
        "maxvalue": False,
        "cycle": False,
    }


class GeneratedAsRowColumnConstraint(ColumnConstraintKind):
    arg_types = {"start": False, "hidden": False}


# https://dev.mysql.com/doc/refman/8.0/en/create-table.html
# https://github.com/ClickHouse/ClickHouse/blob/master/src/Parsers/ParserCreateQuery.h#L646
class IndexColumnConstraint(ColumnConstraintKind):
    arg_types = {
        "this": False,
        "expressions": False,
        "kind": False,
        "index_type": False,
        "options": False,
        "expression": False,  # Clickhouse
        "granularity": False,
    }


class InlineLengthColumnConstraint(ColumnConstraintKind):
    pass


class NonClusteredColumnConstraint(ColumnConstraintKind):
    pass


class NotForReplicationColumnConstraint(ColumnConstraintKind):
    arg_types = {}


# https://docs.snowflake.com/en/sql-reference/sql/create-table
class MaskingPolicyColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": True, "expressions": False}


class NotNullColumnConstraint(ColumnConstraintKind):
    arg_types = {"allow_null": False}


# https://dev.mysql.com/doc/refman/5.7/en/timestamp-initialization.html
class OnUpdateColumnConstraint(ColumnConstraintKind):
    pass


# https://docs.snowflake.com/en/sql-reference/sql/create-external-table#optional-parameters
class TransformColumnConstraint(ColumnConstraintKind):
    pass


class PrimaryKeyColumnConstraint(ColumnConstraintKind):
    arg_types = {"desc": False}


class TitleColumnConstraint(ColumnConstraintKind):
    pass


class UniqueColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": False, "index_type": False, "on_conflict": False, "nulls": False}


class UppercaseColumnConstraint(ColumnConstraintKind):
    arg_types: t.Dict[str, t.Any] = {}


# https://docs.risingwave.com/processing/watermarks#syntax
class WatermarkColumnConstraint(Expression):
    arg_types = {"this": True, "expression": True}


class PathColumnConstraint(ColumnConstraintKind):
    pass


# https://docs.snowflake.com/en/sql-reference/sql/create-table
class ProjectionPolicyColumnConstraint(ColumnConstraintKind):
    pass


# computed column expression
# https://learn.microsoft.com/en-us/sql/t-sql/statements/create-table-transact-sql?view=sql-server-ver16
class ComputedColumnConstraint(ColumnConstraintKind):
    arg_types = {"this": True, "persisted": False, "not_null": False}


class Constraint(Expression):
    arg_types = {"this": True, "expressions": True}


class Delete(DML):
    arg_types = {
        "with": False,
        "this": False,
        "using": False,
        "where": False,
        "returning": False,
        "limit": False,
        "tables": False,  # Multiple-Table Syntax (MySQL)
        "cluster": False,  # Clickhouse
    }

    def delete(
        self,
        table: ExpOrStr,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Delete:
        """
        Create a DELETE expression or replace the table on an existing DELETE expression.

        Example:
            >>> delete("tbl").sql()
            'DELETE FROM tbl'

        Args:
            table: the table from which to delete.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Delete: the modified expression.
        """
        return _apply_builder(
            expression=table,
            instance=self,
            arg="this",
            dialect=dialect,
            into=Table,
            copy=copy,
            **opts,
        )

    def where(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Delete:
        """
        Append to or set the WHERE expressions.

        Example:
            >>> delete("tbl").where("x = 'a' OR x < 'b'").sql()
            "DELETE FROM tbl WHERE x = 'a' OR x < 'b'"

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
                Multiple expressions are combined with an AND operator.
            append: if `True`, AND the new expressions to any existing expression.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Delete: the modified expression.
        """
        return _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="where",
            append=append,
            into=Where,
            dialect=dialect,
            copy=copy,
            **opts,
        )


class Drop(Expression):
    arg_types = {
        "this": False,
        "kind": False,
        "expressions": False,
        "exists": False,
        "temporary": False,
        "materialized": False,
        "cascade": False,
        "constraints": False,
        "purge": False,
        "cluster": False,
        "concurrently": False,
    }

    @property
    def kind(self) -> t.Optional[str]:
        kind = self.args.get("kind")
        return kind and kind.upper()


class Filter(Expression):
    arg_types = {"this": True, "expression": True}


class Check(Expression):
    pass


class Changes(Expression):
    arg_types = {"information": True, "at_before": False, "end": False}


# https://docs.snowflake.com/en/sql-reference/constructs/connect-by
class Connect(Expression):
    arg_types = {"start": False, "connect": True, "nocycle": False}


class CopyParameter(Expression):
    arg_types = {"this": True, "expression": False, "expressions": False}


class Copy(DML):
    arg_types = {
        "this": True,
        "kind": True,
        "files": True,
        "credentials": False,
        "format": False,
        "params": False,
    }


class Credentials(Expression):
    arg_types = {
        "credentials": False,
        "encryption": False,
        "storage": False,
        "iam_role": False,
        "region": False,
    }


class Prior(Expression):
    pass


class Directory(Expression):
    # https://spark.apache.org/docs/3.0.0-preview/sql-ref-syntax-dml-insert-overwrite-directory-hive.html
    arg_types = {"this": True, "local": False, "row_format": False}


class ForeignKey(Expression):
    arg_types = {
        "expressions": True,
        "reference": False,
        "delete": False,
        "update": False,
    }


class ColumnPrefix(Expression):
    arg_types = {"this": True, "expression": True}


class PrimaryKey(Expression):
    arg_types = {"expressions": True, "options": False}


# https://www.postgresql.org/docs/9.1/sql-selectinto.html
# https://docs.aws.amazon.com/redshift/latest/dg/r_SELECT_INTO.html#r_SELECT_INTO-examples
class Into(Expression):
    arg_types = {
        "this": False,
        "temporary": False,
        "unlogged": False,
        "bulk_collect": False,
        "expressions": False,
    }


class From(Expression):
    @property
    def name(self) -> str:
        return self.this.name

    @property
    def alias_or_name(self) -> str:
        return self.this.alias_or_name


class Having(Expression):
    pass


class Hint(Expression):
    arg_types = {"expressions": True}


class JoinHint(Expression):
    arg_types = {"this": True, "expressions": True}


class Identifier(Expression):
    arg_types = {"this": True, "quoted": False, "global": False, "temporary": False}

    @property
    def quoted(self) -> bool:
        return bool(self.args.get("quoted"))

    @property
    def hashable_args(self) -> t.Any:
        return (self.this, self.quoted)

    @property
    def output_name(self) -> str:
        return self.name


# https://www.postgresql.org/docs/current/indexes-opclass.html
class Opclass(Expression):
    arg_types = {"this": True, "expression": True}


class Index(Expression):
    arg_types = {
        "this": False,
        "table": False,
        "unique": False,
        "primary": False,
        "amp": False,  # teradata
        "params": False,
    }


class IndexParameters(Expression):
    arg_types = {
        "using": False,
        "include": False,
        "columns": False,
        "with_storage": False,
        "partition_by": False,
        "tablespace": False,
        "where": False,
        "on": False,
    }


class Insert(DDL, DML):
    arg_types = {
        "hint": False,
        "with": False,
        "is_function": False,
        "this": False,
        "expression": False,
        "conflict": False,
        "returning": False,
        "overwrite": False,
        "exists": False,
        "alternative": False,
        "where": False,
        "ignore": False,
        "by_name": False,
        "stored": False,
        "partition": False,
        "settings": False,
        "source": False,
    }

    def with_(
        self,
        alias: ExpOrStr,
        as_: ExpOrStr,
        recursive: t.Optional[bool] = None,
        materialized: t.Optional[bool] = None,
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Insert:
        """
        Append to or set the common table expressions.

        Example:
            >>> insert("SELECT x FROM cte", "t").with_("cte", as_="SELECT * FROM tbl").sql()
            'WITH cte AS (SELECT * FROM tbl) INSERT INTO t SELECT x FROM cte'

        Args:
            alias: the SQL code string to parse as the table name.
                If an `Expression` instance is passed, this is used as-is.
            as_: the SQL code string to parse as the table expression.
                If an `Expression` instance is passed, it will be used as-is.
            recursive: set the RECURSIVE part of the expression. Defaults to `False`.
            materialized: set the MATERIALIZED part of the expression.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified expression.
        """
        return _apply_cte_builder(
            self,
            alias,
            as_,
            recursive=recursive,
            materialized=materialized,
            append=append,
            dialect=dialect,
            copy=copy,
            **opts,
        )


class ConditionalInsert(Expression):
    arg_types = {"this": True, "expression": False, "else_": False}


class MultitableInserts(Expression):
    arg_types = {"expressions": True, "kind": True, "source": True}


class OnConflict(Expression):
    arg_types = {
        "duplicate": False,
        "expressions": False,
        "action": False,
        "conflict_keys": False,
        "constraint": False,
    }


class OnCondition(Expression):
    arg_types = {"error": False, "empty": False, "null": False}


class Returning(Expression):
    arg_types = {"expressions": True, "into": False}


# https://dev.mysql.com/doc/refman/8.0/en/charset-introducer.html
class Introducer(Expression):
    arg_types = {"this": True, "expression": True}


# national char, like n'utf8'
class National(Expression):
    pass


class LoadData(Expression):
    arg_types = {
        "this": True,
        "local": False,
        "overwrite": False,
        "inpath": True,
        "partition": False,
        "input_format": False,
        "serde": False,
    }


class Partition(Expression):
    arg_types = {"expressions": True}


class PartitionRange(Expression):
    arg_types = {"this": True, "expression": True}


# https://clickhouse.com/docs/en/sql-reference/statements/alter/partition#how-to-set-partition-expression
class PartitionId(Expression):
    pass


class Fetch(Expression):
    arg_types = {
        "direction": False,
        "count": False,
        "percent": False,
        "with_ties": False,
    }


class Grant(Expression):
    arg_types = {
        "privileges": True,
        "kind": False,
        "securable": True,
        "principals": True,
        "grant_option": False,
    }


class Group(Expression):
    arg_types = {
        "expressions": False,
        "grouping_sets": False,
        "cube": False,
        "rollup": False,
        "totals": False,
        "all": False,
    }


class Cube(Expression):
    arg_types = {"expressions": False}


class Rollup(Expression):
    arg_types = {"expressions": False}


class GroupingSets(Expression):
    arg_types = {"expressions": True}


class Lambda(Expression):
    arg_types = {"this": True, "expressions": True}


class Limit(Expression):
    arg_types = {"this": False, "expression": True, "offset": False, "expressions": False}


class Literal(Condition):
    arg_types = {"this": True, "is_string": True}

    @property
    def hashable_args(self) -> t.Any:
        return (self.this, self.args.get("is_string"))

    @classmethod
    def number(cls, number) -> Literal:
        return cls(this=str(number), is_string=False)

    @classmethod
    def string(cls, string) -> Literal:
        return cls(this=str(string), is_string=True)

    @property
    def output_name(self) -> str:
        return self.name

    def to_py(self) -> int | str | Decimal:
        if self.is_number:
            try:
                return int(self.this)
            except ValueError:
                return Decimal(self.this)
        return self.this


class Join(Expression):
    arg_types = {
        "this": True,
        "on": False,
        "side": False,
        "kind": False,
        "using": False,
        "method": False,
        "global": False,
        "hint": False,
        "match_condition": False,  # Snowflake
        "expressions": False,
    }

    @property
    def method(self) -> str:
        return self.text("method").upper()

    @property
    def kind(self) -> str:
        return self.text("kind").upper()

    @property
    def side(self) -> str:
        return self.text("side").upper()

    @property
    def hint(self) -> str:
        return self.text("hint").upper()

    @property
    def alias_or_name(self) -> str:
        return self.this.alias_or_name

    def on(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Join:
        """
        Append to or set the ON expressions.

        Example:
            >>> import sqlglot
            >>> sqlglot.parse_one("JOIN x", into=Join).on("y = 1").sql()
            'JOIN x ON y = 1'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
                Multiple expressions are combined with an AND operator.
            append: if `True`, AND the new expressions to any existing expression.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Join expression.
        """
        join = _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="on",
            append=append,
            dialect=dialect,
            copy=copy,
            **opts,
        )

        if join.kind == "CROSS":
            join.set("kind", None)

        return join

    def using(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Join:
        """
        Append to or set the USING expressions.

        Example:
            >>> import sqlglot
            >>> sqlglot.parse_one("JOIN x", into=Join).using("foo", "bla").sql()
            'JOIN x USING (foo, bla)'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            append: if `True`, concatenate the new expressions to the existing "using" list.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Join expression.
        """
        join = _apply_list_builder(
            *expressions,
            instance=self,
            arg="using",
            append=append,
            dialect=dialect,
            copy=copy,
            **opts,
        )

        if join.kind == "CROSS":
            join.set("kind", None)

        return join


class Lateral(UDTF):
    arg_types = {
        "this": True,
        "view": False,
        "outer": False,
        "alias": False,
        "cross_apply": False,  # True -> CROSS APPLY, False -> OUTER APPLY
    }


class MatchRecognizeMeasure(Expression):
    arg_types = {
        "this": True,
        "window_frame": False,
    }


class MatchRecognize(Expression):
    arg_types = {
        "partition_by": False,
        "order": False,
        "measures": False,
        "rows": False,
        "after": False,
        "pattern": False,
        "define": False,
        "alias": False,
    }


# Clickhouse FROM FINAL modifier
# https://clickhouse.com/docs/en/sql-reference/statements/select/from/#final-modifier
class Final(Expression):
    pass


class Offset(Expression):
    arg_types = {"this": False, "expression": True, "expressions": False}


class Order(Expression):
    arg_types = {"this": False, "expressions": True, "siblings": False}


# https://clickhouse.com/docs/en/sql-reference/statements/select/order-by#order-by-expr-with-fill-modifier
class WithFill(Expression):
    arg_types = {
        "from": False,
        "to": False,
        "step": False,
        "interpolate": False,
    }


# hive specific sorts
# https://cwiki.apache.org/confluence/display/Hive/LanguageManual+SortBy
class Cluster(Order):
    pass


class Distribute(Order):
    pass


class Sort(Order):
    pass


class Ordered(Expression):
    arg_types = {"this": True, "desc": False, "nulls_first": True, "with_fill": False}


class Property(Expression):
    arg_types = {"this": True, "value": True}


class GrantPrivilege(Expression):
    arg_types = {"this": True, "expressions": False}


class GrantPrincipal(Expression):
    arg_types = {"this": True, "kind": False}


class AllowedValuesProperty(Expression):
    arg_types = {"expressions": True}


class AlgorithmProperty(Property):
    arg_types = {"this": True}


class AutoIncrementProperty(Property):
    arg_types = {"this": True}


# https://docs.aws.amazon.com/prescriptive-guidance/latest/materialized-views-redshift/refreshing-materialized-views.html
class AutoRefreshProperty(Property):
    arg_types = {"this": True}


class BackupProperty(Property):
    arg_types = {"this": True}


class BlockCompressionProperty(Property):
    arg_types = {
        "autotemp": False,
        "always": False,
        "default": False,
        "manual": False,
        "never": False,
    }


class CharacterSetProperty(Property):
    arg_types = {"this": True, "default": True}


class ChecksumProperty(Property):
    arg_types = {"on": False, "default": False}


class CollateProperty(Property):
    arg_types = {"this": True, "default": False}


class CopyGrantsProperty(Property):
    arg_types = {}


class DataBlocksizeProperty(Property):
    arg_types = {
        "size": False,
        "units": False,
        "minimum": False,
        "maximum": False,
        "default": False,
    }


class DataDeletionProperty(Property):
    arg_types = {"on": True, "filter_col": False, "retention_period": False}


class DefinerProperty(Property):
    arg_types = {"this": True}


class DistKeyProperty(Property):
    arg_types = {"this": True}


# https://docs.starrocks.io/docs/sql-reference/sql-statements/data-definition/CREATE_TABLE/#distribution_desc
# https://doris.apache.org/docs/sql-manual/sql-statements/Data-Definition-Statements/Create/CREATE-TABLE?_highlight=create&_highlight=table#distribution_desc
class DistributedByProperty(Property):
    arg_types = {"expressions": False, "kind": True, "buckets": False, "order": False}


class DistStyleProperty(Property):
    arg_types = {"this": True}


class DuplicateKeyProperty(Property):
    arg_types = {"expressions": True}


class EngineProperty(Property):
    arg_types = {"this": True}


class HeapProperty(Property):
    arg_types = {}


class ToTableProperty(Property):
    arg_types = {"this": True}


class ExecuteAsProperty(Property):
    arg_types = {"this": True}


class ExternalProperty(Property):
    arg_types = {"this": False}


class FallbackProperty(Property):
    arg_types = {"no": True, "protection": False}


class FileFormatProperty(Property):
    arg_types = {"this": True}


class FreespaceProperty(Property):
    arg_types = {"this": True, "percent": False}


class GlobalProperty(Property):
    arg_types = {}


class IcebergProperty(Property):
    arg_types = {}


class InheritsProperty(Property):
    arg_types = {"expressions": True}


class InputModelProperty(Property):
    arg_types = {"this": True}


class OutputModelProperty(Property):
    arg_types = {"this": True}


class IsolatedLoadingProperty(Property):
    arg_types = {"no": False, "concurrent": False, "target": False}


class JournalProperty(Property):
    arg_types = {
        "no": False,
        "dual": False,
        "before": False,
        "local": False,
        "after": False,
    }


class LanguageProperty(Property):
    arg_types = {"this": True}


# spark ddl
class ClusteredByProperty(Property):
    arg_types = {"expressions": True, "sorted_by": False, "buckets": True}


class DictProperty(Property):
    arg_types = {"this": True, "kind": True, "settings": False}


class DictSubProperty(Property):
    pass


class DictRange(Property):
    arg_types = {"this": True, "min": True, "max": True}


class DynamicProperty(Property):
    arg_types = {}


# Clickhouse CREATE ... ON CLUSTER modifier
# https://clickhouse.com/docs/en/sql-reference/distributed-ddl
class OnCluster(Property):
    arg_types = {"this": True}


# Clickhouse EMPTY table "property"
class EmptyProperty(Property):
    arg_types = {}


class LikeProperty(Property):
    arg_types = {"this": True, "expressions": False}


class LocationProperty(Property):
    arg_types = {"this": True}


class LockProperty(Property):
    arg_types = {"this": True}


class LockingProperty(Property):
    arg_types = {
        "this": False,
        "kind": True,
        "for_or_in": False,
        "lock_type": True,
        "override": False,
    }


class LogProperty(Property):
    arg_types = {"no": True}


class MaterializedProperty(Property):
    arg_types = {"this": False}


class MergeBlockRatioProperty(Property):
    arg_types = {"this": False, "no": False, "default": False, "percent": False}


class NoPrimaryIndexProperty(Property):
    arg_types = {}


class OnProperty(Property):
    arg_types = {"this": True}


class OnCommitProperty(Property):
    arg_types = {"delete": False}


class PartitionedByProperty(Property):
    arg_types = {"this": True}


# https://www.postgresql.org/docs/current/sql-createtable.html
class PartitionBoundSpec(Expression):
    # this -> IN / MODULUS, expression -> REMAINDER, from_expressions -> FROM (...), to_expressions -> TO (...)
    arg_types = {
        "this": False,
        "expression": False,
        "from_expressions": False,
        "to_expressions": False,
    }


class PartitionedOfProperty(Property):
    # this -> parent_table (schema), expression -> FOR VALUES ... / DEFAULT
    arg_types = {"this": True, "expression": True}


class StreamingTableProperty(Property):
    arg_types = {}


class RemoteWithConnectionModelProperty(Property):
    arg_types = {"this": True}


class ReturnsProperty(Property):
    arg_types = {"this": False, "is_table": False, "table": False, "null": False}


class StrictProperty(Property):
    arg_types = {}


class RowFormatProperty(Property):
    arg_types = {"this": True}


class RowFormatDelimitedProperty(Property):
    # https://cwiki.apache.org/confluence/display/hive/languagemanual+dml
    arg_types = {
        "fields": False,
        "escaped": False,
        "collection_items": False,
        "map_keys": False,
        "lines": False,
        "null": False,
        "serde": False,
    }


class RowFormatSerdeProperty(Property):
    arg_types = {"this": True, "serde_properties": False}


# https://spark.apache.org/docs/3.1.2/sql-ref-syntax-qry-select-transform.html
class QueryTransform(Expression):
    arg_types = {
        "expressions": True,
        "command_script": True,
        "schema": False,
        "row_format_before": False,
        "record_writer": False,
        "row_format_after": False,
        "record_reader": False,
    }


class SampleProperty(Property):
    arg_types = {"this": True}


# https://prestodb.io/docs/current/sql/create-view.html#synopsis
class SecurityProperty(Property):
    arg_types = {"this": True}


class SchemaCommentProperty(Property):
    arg_types = {"this": True}


class SerdeProperties(Property):
    arg_types = {"expressions": True, "with": False}


class SetProperty(Property):
    arg_types = {"multi": True}


class SharingProperty(Property):
    arg_types = {"this": False}


class SetConfigProperty(Property):
    arg_types = {"this": True}


class SettingsProperty(Property):
    arg_types = {"expressions": True}


class SortKeyProperty(Property):
    arg_types = {"this": True, "compound": False}


class SqlReadWriteProperty(Property):
    arg_types = {"this": True}


class SqlSecurityProperty(Property):
    arg_types = {"definer": True}


class StabilityProperty(Property):
    arg_types = {"this": True}


class TemporaryProperty(Property):
    arg_types = {"this": False}


class SecureProperty(Property):
    arg_types = {}


# https://docs.snowflake.com/en/sql-reference/sql/create-table
class Tags(ColumnConstraintKind, Property):
    arg_types = {"expressions": True}


class TransformModelProperty(Property):
    arg_types = {"expressions": True}


class TransientProperty(Property):
    arg_types = {"this": False}


class UnloggedProperty(Property):
    arg_types = {}


# https://learn.microsoft.com/en-us/sql/t-sql/statements/create-view-transact-sql?view=sql-server-ver16
class ViewAttributeProperty(Property):
    arg_types = {"this": True}


class VolatileProperty(Property):
    arg_types = {"this": False}


class WithDataProperty(Property):
    arg_types = {"no": True, "statistics": False}


class WithJournalTableProperty(Property):
    arg_types = {"this": True}


class WithSchemaBindingProperty(Property):
    arg_types = {"this": True}


class WithSystemVersioningProperty(Property):
    arg_types = {
        "on": False,
        "this": False,
        "data_consistency": False,
        "retention_period": False,
        "with": True,
    }


class WithProcedureOptions(Property):
    arg_types = {"expressions": True}


class EncodeProperty(Property):
    arg_types = {"this": True, "properties": False, "key": False}


class IncludeProperty(Property):
    arg_types = {"this": True, "alias": False, "column_def": False}


class Properties(Expression):
    arg_types = {"expressions": True}

    NAME_TO_PROPERTY = {
        "ALGORITHM": AlgorithmProperty,
        "AUTO_INCREMENT": AutoIncrementProperty,
        "CHARACTER SET": CharacterSetProperty,
        "CLUSTERED_BY": ClusteredByProperty,
        "COLLATE": CollateProperty,
        "COMMENT": SchemaCommentProperty,
        "DEFINER": DefinerProperty,
        "DISTKEY": DistKeyProperty,
        "DISTRIBUTED_BY": DistributedByProperty,
        "DISTSTYLE": DistStyleProperty,
        "ENGINE": EngineProperty,
        "EXECUTE AS": ExecuteAsProperty,
        "FORMAT": FileFormatProperty,
        "LANGUAGE": LanguageProperty,
        "LOCATION": LocationProperty,
        "LOCK": LockProperty,
        "PARTITIONED_BY": PartitionedByProperty,
        "RETURNS": ReturnsProperty,
        "ROW_FORMAT": RowFormatProperty,
        "SORTKEY": SortKeyProperty,
        "ENCODE": EncodeProperty,
        "INCLUDE": IncludeProperty,
    }

    PROPERTY_TO_NAME = {v: k for k, v in NAME_TO_PROPERTY.items()}

    # CREATE property locations
    # Form: schema specified
    #   create [POST_CREATE]
    #     table a [POST_NAME]
    #     (b int) [POST_SCHEMA]
    #     with ([POST_WITH])
    #     index (b) [POST_INDEX]
    #
    # Form: alias selection
    #   create [POST_CREATE]
    #     table a [POST_NAME]
    #     as [POST_ALIAS] (select * from b) [POST_EXPRESSION]
    #     index (c) [POST_INDEX]
    class Location(AutoName):
        POST_CREATE = auto()
        POST_NAME = auto()
        POST_SCHEMA = auto()
        POST_WITH = auto()
        POST_ALIAS = auto()
        POST_EXPRESSION = auto()
        POST_INDEX = auto()
        UNSUPPORTED = auto()

    @classmethod
    def from_dict(cls, properties_dict: t.Dict) -> Properties:
        expressions = []
        for key, value in properties_dict.items():
            property_cls = cls.NAME_TO_PROPERTY.get(key.upper())
            if property_cls:
                expressions.append(property_cls(this=convert(value)))
            else:
                expressions.append(Property(this=Literal.string(key), value=convert(value)))

        return cls(expressions=expressions)


class Qualify(Expression):
    pass


class InputOutputFormat(Expression):
    arg_types = {"input_format": False, "output_format": False}


# https://www.ibm.com/docs/en/ias?topic=procedures-return-statement-in-sql
class Return(Expression):
    pass


class Reference(Expression):
    arg_types = {"this": True, "expressions": False, "options": False}


class Tuple(Expression):
    arg_types = {"expressions": False}

    def isin(
        self,
        *expressions: t.Any,
        query: t.Optional[ExpOrStr] = None,
        unnest: t.Optional[ExpOrStr] | t.Collection[ExpOrStr] = None,
        copy: bool = True,
        **opts,
    ) -> In:
        return In(
            this=maybe_copy(self, copy),
            expressions=[convert(e, copy=copy) for e in expressions],
            query=maybe_parse(query, copy=copy, **opts) if query else None,
            unnest=(
                Unnest(
                    expressions=[
                        maybe_parse(t.cast(ExpOrStr, e), copy=copy, **opts)
                        for e in ensure_list(unnest)
                    ]
                )
                if unnest
                else None
            ),
        )


QUERY_MODIFIERS = {
    "match": False,
    "laterals": False,
    "joins": False,
    "connect": False,
    "pivots": False,
    "prewhere": False,
    "where": False,
    "group": False,
    "having": False,
    "qualify": False,
    "windows": False,
    "distribute": False,
    "sort": False,
    "cluster": False,
    "order": False,
    "limit": False,
    "offset": False,
    "locks": False,
    "sample": False,
    "settings": False,
    "format": False,
    "options": False,
}


# https://learn.microsoft.com/en-us/sql/t-sql/queries/option-clause-transact-sql?view=sql-server-ver16
# https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-query?view=sql-server-ver16
class QueryOption(Expression):
    arg_types = {"this": True, "expression": False}


# https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table?view=sql-server-ver16
class WithTableHint(Expression):
    arg_types = {"expressions": True}


# https://dev.mysql.com/doc/refman/8.0/en/index-hints.html
class IndexTableHint(Expression):
    arg_types = {"this": True, "expressions": False, "target": False}


# https://docs.snowflake.com/en/sql-reference/constructs/at-before
class HistoricalData(Expression):
    arg_types = {"this": True, "kind": True, "expression": True}


class Table(Expression):
    arg_types = {
        "this": False,
        "alias": False,
        "db": False,
        "catalog": False,
        "laterals": False,
        "joins": False,
        "pivots": False,
        "hints": False,
        "system_time": False,
        "version": False,
        "format": False,
        "pattern": False,
        "ordinality": False,
        "when": False,
        "only": False,
        "partition": False,
        "changes": False,
        "rows_from": False,
        "sample": False,
    }

    @property
    def name(self) -> str:
        if isinstance(self.this, Func):
            return ""
        return self.this.name

    @property
    def db(self) -> str:
        return self.text("db")

    @property
    def catalog(self) -> str:
        return self.text("catalog")

    @property
    def selects(self) -> t.List[Expression]:
        return []

    @property
    def named_selects(self) -> t.List[str]:
        return []

    @property
    def parts(self) -> t.List[Expression]:
        """Return the parts of a table in order catalog, db, table."""
        parts: t.List[Expression] = []

        for arg in ("catalog", "db", "this"):
            part = self.args.get(arg)

            if isinstance(part, Dot):
                parts.extend(part.flatten())
            elif isinstance(part, Expression):
                parts.append(part)

        return parts

    def to_column(self, copy: bool = True) -> Alias | Column | Dot:
        parts = self.parts
        last_part = parts[-1]

        if isinstance(last_part, Identifier):
            col = column(*reversed(parts[0:4]), fields=parts[4:], copy=copy)  # type: ignore
        else:
            # This branch will be reached if a function or array is wrapped in a `Table`
            col = last_part

        alias = self.args.get("alias")
        if alias:
            col = alias_(col, alias.this, copy=copy)

        return col


class SetOperation(Query):
    arg_types = {
        "with": False,
        "this": True,
        "expression": True,
        "distinct": False,
        "by_name": False,
        **QUERY_MODIFIERS,
    }

    def select(
        self: S,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> S:
        this = maybe_copy(self, copy)
        this.this.unnest().select(*expressions, append=append, dialect=dialect, copy=False, **opts)
        this.expression.unnest().select(
            *expressions, append=append, dialect=dialect, copy=False, **opts
        )
        return this

    @property
    def named_selects(self) -> t.List[str]:
        return self.this.unnest().named_selects

    @property
    def is_star(self) -> bool:
        return self.this.is_star or self.expression.is_star

    @property
    def selects(self) -> t.List[Expression]:
        return self.this.unnest().selects

    @property
    def left(self) -> Query:
        return self.this

    @property
    def right(self) -> Query:
        return self.expression


class Union(SetOperation):
    pass


class Except(SetOperation):
    pass


class Intersect(SetOperation):
    pass


class Update(DML):
    arg_types = {
        "with": False,
        "this": False,
        "expressions": True,
        "from": False,
        "where": False,
        "returning": False,
        "order": False,
        "limit": False,
    }

    def table(
        self, expression: ExpOrStr, dialect: DialectType = None, copy: bool = True, **opts
    ) -> Update:
        """
        Set the table to update.

        Example:
            >>> Update().table("my_table").set_("x = 1").sql()
            'UPDATE my_table SET x = 1'

        Args:
            expression : the SQL code strings to parse.
                If a `Table` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Table`.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Update expression.
        """
        return _apply_builder(
            expression=expression,
            instance=self,
            arg="this",
            into=Table,
            prefix=None,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def set_(
        self,
        *expressions: ExpOrStr,
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Update:
        """
        Append to or set the SET expressions.

        Example:
            >>> Update().table("my_table").set_("x = 1").sql()
            'UPDATE my_table SET x = 1'

        Args:
            *expressions: the SQL code strings to parse.
                If `Expression` instance(s) are passed, they will be used as-is.
                Multiple expressions are combined with a comma.
            append: if `True`, add the new expressions to any existing SET expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.
        """
        return _apply_list_builder(
            *expressions,
            instance=self,
            arg="expressions",
            append=append,
            into=Expression,
            prefix=None,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def where(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Append to or set the WHERE expressions.

        Example:
            >>> Update().table("tbl").set_("x = 1").where("x = 'a' OR x < 'b'").sql()
            "UPDATE tbl SET x = 1 WHERE x = 'a' OR x < 'b'"

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
                Multiple expressions are combined with an AND operator.
            append: if `True`, AND the new expressions to any existing expression.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Select: the modified expression.
        """
        return _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="where",
            append=append,
            into=Where,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def from_(
        self,
        expression: t.Optional[ExpOrStr] = None,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Update:
        """
        Set the FROM expression.

        Example:
            >>> Update().table("my_table").set_("x = 1").from_("baz").sql()
            'UPDATE my_table SET x = 1 FROM baz'

        Args:
            expression : the SQL code strings to parse.
                If a `From` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `From`.
                If nothing is passed in then a from is not applied to the expression
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Update expression.
        """
        if not expression:
            return maybe_copy(self, copy)

        return _apply_builder(
            expression=expression,
            instance=self,
            arg="from",
            into=From,
            prefix="FROM",
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def with_(
        self,
        alias: ExpOrStr,
        as_: ExpOrStr,
        recursive: t.Optional[bool] = None,
        materialized: t.Optional[bool] = None,
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Update:
        """
        Append to or set the common table expressions.

        Example:
            >>> Update().table("my_table").set_("x = 1").from_("baz").with_("baz", "SELECT id FROM foo").sql()
            'WITH baz AS (SELECT id FROM foo) UPDATE my_table SET x = 1 FROM baz'

        Args:
            alias: the SQL code string to parse as the table name.
                If an `Expression` instance is passed, this is used as-is.
            as_: the SQL code string to parse as the table expression.
                If an `Expression` instance is passed, it will be used as-is.
            recursive: set the RECURSIVE part of the expression. Defaults to `False`.
            materialized: set the MATERIALIZED part of the expression.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified expression.
        """
        return _apply_cte_builder(
            self,
            alias,
            as_,
            recursive=recursive,
            materialized=materialized,
            append=append,
            dialect=dialect,
            copy=copy,
            **opts,
        )


class Values(UDTF):
    arg_types = {"expressions": True, "alias": False}


class Var(Expression):
    pass


class Version(Expression):
    """
    Time travel, iceberg, bigquery etc
    https://trino.io/docs/current/connector/iceberg.html?highlight=snapshot#using-snapshots
    https://www.databricks.com/blog/2019/02/04/introducing-delta-time-travel-for-large-scale-data-lakes.html
    https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#for_system_time_as_of
    https://learn.microsoft.com/en-us/sql/relational-databases/tables/querying-data-in-a-system-versioned-temporal-table?view=sql-server-ver16
    this is either TIMESTAMP or VERSION
    kind is ("AS OF", "BETWEEN")
    """

    arg_types = {"this": True, "kind": True, "expression": False}


class Schema(Expression):
    arg_types = {"this": False, "expressions": False}


# https://dev.mysql.com/doc/refman/8.0/en/select.html
# https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/SELECT.html
class Lock(Expression):
    arg_types = {"update": True, "expressions": False, "wait": False}


class Select(Query):
    arg_types = {
        "with": False,
        "kind": False,
        "expressions": False,
        "hint": False,
        "distinct": False,
        "into": False,
        "from": False,
        "operation_modifiers": False,
        **QUERY_MODIFIERS,
    }

    def from_(
        self, expression: ExpOrStr, dialect: DialectType = None, copy: bool = True, **opts
    ) -> Select:
        """
        Set the FROM expression.

        Example:
            >>> Select().from_("tbl").select("x").sql()
            'SELECT x FROM tbl'

        Args:
            expression : the SQL code strings to parse.
                If a `From` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `From`.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_builder(
            expression=expression,
            instance=self,
            arg="from",
            into=From,
            prefix="FROM",
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def group_by(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Set the GROUP BY expression.

        Example:
            >>> Select().from_("tbl").select("x", "COUNT(1)").group_by("x").sql()
            'SELECT x, COUNT(1) FROM tbl GROUP BY x'

        Args:
            *expressions: the SQL code strings to parse.
                If a `Group` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Group`.
                If nothing is passed in then a group by is not applied to the expression
            append: if `True`, add to any existing expressions.
                Otherwise, this flattens all the `Group` expression into a single expression.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        if not expressions:
            return self if not copy else self.copy()

        return _apply_child_list_builder(
            *expressions,
            instance=self,
            arg="group",
            append=append,
            copy=copy,
            prefix="GROUP BY",
            into=Group,
            dialect=dialect,
            **opts,
        )

    def sort_by(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Set the SORT BY expression.

        Example:
            >>> Select().from_("tbl").select("x").sort_by("x DESC").sql(dialect="hive")
            'SELECT x FROM tbl SORT BY x DESC'

        Args:
            *expressions: the SQL code strings to parse.
                If a `Group` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `SORT`.
            append: if `True`, add to any existing expressions.
                Otherwise, this flattens all the `Order` expression into a single expression.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_child_list_builder(
            *expressions,
            instance=self,
            arg="sort",
            append=append,
            copy=copy,
            prefix="SORT BY",
            into=Sort,
            dialect=dialect,
            **opts,
        )

    def cluster_by(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Set the CLUSTER BY expression.

        Example:
            >>> Select().from_("tbl").select("x").cluster_by("x DESC").sql(dialect="hive")
            'SELECT x FROM tbl CLUSTER BY x DESC'

        Args:
            *expressions: the SQL code strings to parse.
                If a `Group` instance is passed, this is used as-is.
                If another `Expression` instance is passed, it will be wrapped in a `Cluster`.
            append: if `True`, add to any existing expressions.
                Otherwise, this flattens all the `Order` expression into a single expression.
            dialect: the dialect used to parse the input expression.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_child_list_builder(
            *expressions,
            instance=self,
            arg="cluster",
            append=append,
            copy=copy,
            prefix="CLUSTER BY",
            into=Cluster,
            dialect=dialect,
            **opts,
        )

    def select(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        return _apply_list_builder(
            *expressions,
            instance=self,
            arg="expressions",
            append=append,
            dialect=dialect,
            into=Expression,
            copy=copy,
            **opts,
        )

    def lateral(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Append to or set the LATERAL expressions.

        Example:
            >>> Select().select("x").lateral("OUTER explode(y) tbl2 AS z").from_("tbl").sql()
            'SELECT x FROM tbl LATERAL VIEW OUTER EXPLODE(y) tbl2 AS z'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_list_builder(
            *expressions,
            instance=self,
            arg="laterals",
            append=append,
            into=Lateral,
            prefix="LATERAL VIEW",
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def join(
        self,
        expression: ExpOrStr,
        on: t.Optional[ExpOrStr] = None,
        using: t.Optional[ExpOrStr | t.Collection[ExpOrStr]] = None,
        append: bool = True,
        join_type: t.Optional[str] = None,
        join_alias: t.Optional[Identifier | str] = None,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Append to or set the JOIN expressions.

        Example:
            >>> Select().select("*").from_("tbl").join("tbl2", on="tbl1.y = tbl2.y").sql()
            'SELECT * FROM tbl JOIN tbl2 ON tbl1.y = tbl2.y'

            >>> Select().select("1").from_("a").join("b", using=["x", "y", "z"]).sql()
            'SELECT 1 FROM a JOIN b USING (x, y, z)'

            Use `join_type` to change the type of join:

            >>> Select().select("*").from_("tbl").join("tbl2", on="tbl1.y = tbl2.y", join_type="left outer").sql()
            'SELECT * FROM tbl LEFT OUTER JOIN tbl2 ON tbl1.y = tbl2.y'

        Args:
            expression: the SQL code string to parse.
                If an `Expression` instance is passed, it will be used as-is.
            on: optionally specify the join "on" criteria as a SQL string.
                If an `Expression` instance is passed, it will be used as-is.
            using: optionally specify the join "using" criteria as a SQL string.
                If an `Expression` instance is passed, it will be used as-is.
            append: if `True`, add to any existing expressions.
                Otherwise, this resets the expressions.
            join_type: if set, alter the parsed join type.
            join_alias: an optional alias for the joined source.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Select: the modified expression.
        """
        parse_args: t.Dict[str, t.Any] = {"dialect": dialect, **opts}

        try:
            expression = maybe_parse(expression, into=Join, prefix="JOIN", **parse_args)
        except ParseError:
            expression = maybe_parse(expression, into=(Join, Expression), **parse_args)

        join = expression if isinstance(expression, Join) else Join(this=expression)

        if isinstance(join.this, Select):
            join.this.replace(join.this.subquery())

        if join_type:
            method: t.Optional[Token]
            side: t.Optional[Token]
            kind: t.Optional[Token]

            method, side, kind = maybe_parse(join_type, into="JOIN_TYPE", **parse_args)  # type: ignore

            if method:
                join.set("method", method.text)
            if side:
                join.set("side", side.text)
            if kind:
                join.set("kind", kind.text)

        if on:
            on = and_(*ensure_list(on), dialect=dialect, copy=copy, **opts)
            join.set("on", on)

        if using:
            join = _apply_list_builder(
                *ensure_list(using),
                instance=join,
                arg="using",
                append=append,
                copy=copy,
                into=Identifier,
                **opts,
            )

        if join_alias:
            join.set("this", alias_(join.this, join_alias, table=True))

        return _apply_list_builder(
            join,
            instance=self,
            arg="joins",
            append=append,
            copy=copy,
            **opts,
        )

    def where(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Append to or set the WHERE expressions.

        Example:
            >>> Select().select("x").from_("tbl").where("x = 'a' OR x < 'b'").sql()
            "SELECT x FROM tbl WHERE x = 'a' OR x < 'b'"

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
                Multiple expressions are combined with an AND operator.
            append: if `True`, AND the new expressions to any existing expression.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            Select: the modified expression.
        """
        return _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="where",
            append=append,
            into=Where,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def having(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        """
        Append to or set the HAVING expressions.

        Example:
            >>> Select().select("x", "COUNT(y)").from_("tbl").group_by("x").having("COUNT(y) > 3").sql()
            'SELECT x, COUNT(y) FROM tbl GROUP BY x HAVING COUNT(y) > 3'

        Args:
            *expressions: the SQL code strings to parse.
                If an `Expression` instance is passed, it will be used as-is.
                Multiple expressions are combined with an AND operator.
            append: if `True`, AND the new expressions to any existing expression.
                Otherwise, this resets the expression.
            dialect: the dialect used to parse the input expressions.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input expressions.

        Returns:
            The modified Select expression.
        """
        return _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="having",
            append=append,
            into=Having,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def window(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        return _apply_list_builder(
            *expressions,
            instance=self,
            arg="windows",
            append=append,
            into=Window,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def qualify(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Select:
        return _apply_conjunction_builder(
            *expressions,
            instance=self,
            arg="qualify",
            append=append,
            into=Qualify,
            dialect=dialect,
            copy=copy,
            **opts,
        )

    def distinct(
        self, *ons: t.Optional[ExpOrStr], distinct: bool = True, copy: bool = True
    ) -> Select:
        """
        Set the OFFSET expression.

        Example:
            >>> Select().from_("tbl").select("x").distinct().sql()
            'SELECT DISTINCT x FROM tbl'

        Args:
            ons: the expressions to distinct on
            distinct: whether the Select should be distinct
            copy: if `False`, modify this expression instance in-place.

        Returns:
            Select: the modified expression.
        """
        instance = maybe_copy(self, copy)
        on = Tuple(expressions=[maybe_parse(on, copy=copy) for on in ons if on]) if ons else None
        instance.set("distinct", Distinct(on=on) if distinct else None)
        return instance

    def ctas(
        self,
        table: ExpOrStr,
        properties: t.Optional[t.Dict] = None,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Create:
        """
        Convert this expression to a CREATE TABLE AS statement.

        Example:
            >>> Select().select("*").from_("tbl").ctas("x").sql()
            'CREATE TABLE x AS SELECT * FROM tbl'

        Args:
            table: the SQL code string to parse as the table name.
                If another `Expression` instance is passed, it will be used as-is.
            properties: an optional mapping of table properties
            dialect: the dialect used to parse the input table.
            copy: if `False`, modify this expression instance in-place.
            opts: other options to use to parse the input table.

        Returns:
            The new Create expression.
        """
        instance = maybe_copy(self, copy)
        table_expression = maybe_parse(table, into=Table, dialect=dialect, **opts)

        properties_expression = None
        if properties:
            properties_expression = Properties.from_dict(properties)

        return Create(
            this=table_expression,
            kind="TABLE",
            expression=instance,
            properties=properties_expression,
        )

    def lock(self, update: bool = True, copy: bool = True) -> Select:
        """
        Set the locking read mode for this expression.

        Examples:
            >>> Select().select("x").from_("tbl").where("x = 'a'").lock().sql("mysql")
            "SELECT x FROM tbl WHERE x = 'a' FOR UPDATE"

            >>> Select().select("x").from_("tbl").where("x = 'a'").lock(update=False).sql("mysql")
            "SELECT x FROM tbl WHERE x = 'a' FOR SHARE"

        Args:
            update: if `True`, the locking type will be `FOR UPDATE`, else it will be `FOR SHARE`.
            copy: if `False`, modify this expression instance in-place.

        Returns:
            The modified expression.
        """
        inst = maybe_copy(self, copy)
        inst.set("locks", [Lock(update=update)])

        return inst

    def hint(self, *hints: ExpOrStr, dialect: DialectType = None, copy: bool = True) -> Select:
        """
        Set hints for this expression.

        Examples:
            >>> Select().select("x").from_("tbl").hint("BROADCAST(y)").sql(dialect="spark")
            'SELECT /*+ BROADCAST(y) */ x FROM tbl'

        Args:
            hints: The SQL code strings to parse as the hints.
                If an `Expression` instance is passed, it will be used as-is.
            dialect: The dialect used to parse the hints.
            copy: If `False`, modify this expression instance in-place.

        Returns:
            The modified expression.
        """
        inst = maybe_copy(self, copy)
        inst.set(
            "hint", Hint(expressions=[maybe_parse(h, copy=copy, dialect=dialect) for h in hints])
        )

        return inst

    @property
    def named_selects(self) -> t.List[str]:
        return [e.output_name for e in self.expressions if e.alias_or_name]

    @property
    def is_star(self) -> bool:
        return any(expression.is_star for expression in self.expressions)

    @property
    def selects(self) -> t.List[Expression]:
        return self.expressions


UNWRAPPED_QUERIES = (Select, SetOperation)


class Subquery(DerivedTable, Query):
    arg_types = {
        "this": True,
        "alias": False,
        "with": False,
        **QUERY_MODIFIERS,
    }

    def unnest(self):
        """Returns the first non subquery."""
        expression = self
        while isinstance(expression, Subquery):
            expression = expression.this
        return expression

    def unwrap(self) -> Subquery:
        expression = self
        while expression.same_parent and expression.is_wrapper:
            expression = t.cast(Subquery, expression.parent)
        return expression

    def select(
        self,
        *expressions: t.Optional[ExpOrStr],
        append: bool = True,
        dialect: DialectType = None,
        copy: bool = True,
        **opts,
    ) -> Subquery:
        this = maybe_copy(self, copy)
        this.unnest().select(*expressions, append=append, dialect=dialect, copy=False, **opts)
        return this

    @property
    def is_wrapper(self) -> bool:
        """
        Whether this Subquery acts as a simple wrapper around another expression.

        SELECT * FROM (((SELECT * FROM t)))
                      ^
                      This corresponds to a "wrapper" Subquery node
        """
        return all(v is None for k, v in self.args.items() if k != "this")

    @property
    def is_star(self) -> bool:
        return self.this.is_star

    @property
    def output_name(self) -> str:
        return self.alias


class TableSample(Expression):
    arg_types = {
        "expressions": False,
        "method": False,
        "bucket_numerator": False,
        "bucket_denominator": False,
        "bucket_field": False,
        "percent": False,
        "rows": False,
        "size": False,
        "seed": False,
    }


class Tag(Expression):
    """Tags are used for generating arbitrary sql like SELECT <span>x</span>."""

    arg_types = {
        "this": False,
        "prefix": False,
        "postfix": False,
    }


# Represents both the standard SQL PIVOT operator and DuckDB's "simplified" PIVOT syntax
# https://duckdb.org/docs/sql/statements/pivot
class Pivot(Expression):
    arg_types = {
        "this": False,
        "alias": False,
        "expressions": False,
        "field": False,
        "unpivot": False,
        "using": False,
        "group": False,
        "columns": False,
        "include_nulls": False,
        "default_on_null": False,
    }

    @property
    def unpivot(self) -> bool:
        return bool(self.args.get("unpivot"))


class Window(Condition):
    arg_types = {
        "this": True,
        "partition_by": False,
        "order": False,
        "spec": False,
        "alias": False,
        "over": False,
        "first": False,
    }


class WindowSpec(Expression):
    arg_types = {
        "kind": False,
        "start": False,
        "start_side": False,
        "end": False,
        "end_side": False,
    }


class PreWhere(Expression):
    pass


class Where(Expression):
    pass


class Star(Expression):
    arg_types = {"except": False, "replace": False, "rename": False}

    @property
    def name(self) -> str:
        return "*"

    @property
    def output_name(self) -> str:
        return self.name


class Parameter(Condition):
    arg_types = {"this": True, "expression": False}


class SessionParameter(Condition):
    arg_types = {"this": True, "kind": False}


class Placeholder(Condition):
    arg_types = {"this": False, "kind": False}

    @property
    def name(self) -> str:
        return self.this or "?"


class Null(Condition):
    arg_types: t.Dict[str, t.Any] = {}

    @property
    def name(self) -> str:
        return "NULL"

    def to_py(self) -> Lit[None]:
        return None


class Boolean(Condition):
    def to_py(self) -> bool:
        return self.this


class DataTypeParam(Expression):
    arg_types = {"this": True, "expression": False}

    @property
    def name(self) -> str:
        return self.this.name


# The `nullable` arg is helpful when transpiling types from other dialects to ClickHouse, which
# assumes non-nullable types by default. Values `None` and `True` mean the type is nullable.
class DataType(Expression):
    arg_types = {
        "this": True,
        "expressions": False,
        "nested": False,
        "values": False,
        "prefix": False,
        "kind": False,
        "nullable": False,
    }

    class Type(AutoName):
        ARRAY = auto()
        AGGREGATEFUNCTION = auto()
        SIMPLEAGGREGATEFUNCTION = auto()
        BIGDECIMAL = auto()
        BIGINT = auto()
        BIGSERIAL = auto()
        BINARY = auto()
        BIT = auto()
        BOOLEAN = auto()
        BPCHAR = auto()
        CHAR = auto()
        DATE = auto()
        DATE32 = auto()
        DATEMULTIRANGE = auto()
        DATERANGE = auto()
        DATETIME = auto()
        DATETIME64 = auto()
        DECIMAL = auto()
        DECIMAL32 = auto()
        DECIMAL64 = auto()
        DECIMAL128 = auto()
        DECIMAL256 = auto()
        DOUBLE = auto()
        ENUM = auto()
        ENUM8 = auto()
        ENUM16 = auto()
        FIXEDSTRING = auto()
        FLOAT = auto()
        GEOGRAPHY = auto()
        GEOMETRY = auto()
        POINT = auto()
        RING = auto()
        LINESTRING = auto()
        MULTILINESTRING = auto()
        POLYGON = auto()
        MULTIPOLYGON = auto()
        HLLSKETCH = auto()
        HSTORE = auto()
        IMAGE = auto()
        INET = auto()
        INT = auto()
        INT128 = auto()
        INT256 = auto()
        INT4MULTIRANGE = auto()
        INT4RANGE = auto()
        INT8MULTIRANGE = auto()
        INT8RANGE = auto()
        INTERVAL = auto()
        IPADDRESS = auto()
        IPPREFIX = auto()
        IPV4 = auto()
        IPV6 = auto()
        JSON = auto()
        JSONB = auto()
        LIST = auto()
        LONGBLOB = auto()
        LONGTEXT = auto()
        LOWCARDINALITY = auto()
        MAP = auto()
        MEDIUMBLOB = auto()
        MEDIUMINT = auto()
        MEDIUMTEXT = auto()
        MONEY = auto()
        NAME = auto()
        NCHAR = auto()
        NESTED = auto()
        NULL = auto()
        NUMMULTIRANGE = auto()
        NUMRANGE = auto()
        NVARCHAR = auto()
        OBJECT = auto()
        RANGE = auto()
        ROWVERSION = auto()
        SERIAL = auto()
        SET = auto()
        SMALLINT = auto()
        SMALLMONEY = auto()
        SMALLSERIAL = auto()
        STRUCT = auto()
        SUPER = auto()
        TEXT = auto()
        TINYBLOB = auto()
        TINYTEXT = auto()
        TIME = auto()
        TIMETZ = auto()
        TIMESTAMP = auto()
        TIMESTAMPNTZ = auto()
        TIMESTAMPLTZ = auto()
        TIMESTAMPTZ = auto()
        TIMESTAMP_S = auto()
        TIMESTAMP_MS = auto()
        TIMESTAMP_NS = auto()
        TINYINT = auto()
        TSMULTIRANGE = auto()
        TSRANGE = auto()
        TSTZMULTIRANGE = auto()
        TSTZRANGE = auto()
        UBIGINT = auto()
        UINT = auto()
        UINT128 = auto()
        UINT256 = auto()
        UMEDIUMINT = auto()
        UDECIMAL = auto()
        UNION = auto()
        UNIQUEIDENTIFIER = auto()
        UNKNOWN = auto()  # Sentinel value, useful for type annotation
        USERDEFINED = "USER-DEFINED"
        USMALLINT = auto()
        UTINYINT = auto()
        UUID = auto()
        VARBINARY = auto()
        VARCHAR = auto()
        VARIANT = auto()
        VECTOR = auto()
        XML = auto()
        YEAR = auto()
        TDIGEST = auto()

    STRUCT_TYPES = {
        Type.NESTED,
        Type.OBJECT,
        Type.STRUCT,
        Type.UNION,
    }

    ARRAY_TYPES = {
        Type.ARRAY,
        Type.LIST,
    }

    NESTED_TYPES = {
        *STRUCT_TYPES,
        *ARRAY_TYPES,
        Type.MAP,
    }

    TEXT_TYPES = {
        Type.CHAR,
        Type.NCHAR,
        Type.NVARCHAR,
        Type.TEXT,
        Type.VARCHAR,
        Type.NAME,
    }

    SIGNED_INTEGER_TYPES = {
        Type.BIGINT,
        Type.INT,
        Type.INT128,
        Type.INT256,
        Type.MEDIUMINT,
        Type.SMALLINT,
        Type.TINYINT,
    }

    UNSIGNED_INTEGER_TYPES = {
        Type.UBIGINT,
        Type.UINT,
        Type.UINT128,
        Type.UINT256,
        Type.UMEDIUMINT,
        Type.USMALLINT,
        Type.UTINYINT,
    }

    INTEGER_TYPES = {
        *SIGNED_INTEGER_TYPES,
        *UNSIGNED_INTEGER_TYPES,
        Type.BIT,
    }

    FLOAT_TYPES = {
        Type.DOUBLE,
        Type.FLOAT,
    }

    REAL_TYPES = {
        *FLOAT_TYPES,
        Type.BIGDECIMAL,
        Type.DECIMAL,
        Type.DECIMAL32,
        Type.DECIMAL64,
        Type.DECIMAL128,
        Type.DECIMAL256,
        Type.MONEY,
        Type.SMALLMONEY,
        Type.UDECIMAL,
    }

    NUMERIC_TYPES = {
        *INTEGER_TYPES,
        *REAL_TYPES,
    }

    TEMPORAL_TYPES = {
        Type.DATE,
        Type.DATE32,
        Type.DATETIME,
        Type.DATETIME64,
        Type.TIME,
        Type.TIMESTAMP,
        Type.TIMESTAMPNTZ,
        Type.TIMESTAMPLTZ,
        Type.TIMESTAMPTZ,
        Type.TIMESTAMP_MS,
        Type.TIMESTAMP_NS,
        Type.TIMESTAMP_S,
        Type.TIMETZ,
    }

    @classmethod
    def build(
        cls,
        dtype: DATA_TYPE,
        dialect: DialectType = None,
        udt: bool = False,
        copy: bool = True,
        **kwargs,
    ) -> DataType:
        """
        Constructs a DataType object.

        Args:
            dtype: the data type of interest.
            dialect: the dialect to use for parsing `dtype`, in case it's a string.
            udt: when set to True, `dtype` will be used as-is if it can't be parsed into a
                DataType, thus creating a user-defined type.
            copy: whether to copy the data type.
            kwargs: additional arguments to pass in the constructor of DataType.

        Returns:
            The constructed DataType object.
        """
        from sqlglot import parse_one

        if isinstance(dtype, str):
            if dtype.upper() == "UNKNOWN":
                return DataType(this=DataType.Type.UNKNOWN, **kwargs)

            try:
                data_type_exp = parse_one(
                    dtype, read=dialect, into=DataType, error_level=ErrorLevel.IGNORE
                )
            except ParseError:
                if udt:
                    return DataType(this=DataType.Type.USERDEFINED, kind=dtype, **kwargs)
                raise
        elif isinstance(dtype, DataType.Type):
            data_type_exp = DataType(this=dtype)
        elif isinstance(dtype, DataType):
            return maybe_copy(dtype, copy)
        else:
            raise ValueError(f"Invalid data type: {type(dtype)}. Expected str or DataType.Type")

        return DataType(**{**data_type_exp.args, **kwargs})

    def is_type(self, *dtypes: DATA_TYPE, check_nullable: bool = False) -> bool:
        """
        Checks whether this DataType matches one of the provided data types. Nested types or precision
        will be compared using "structural equivalence" semantics, so e.g. array<int> != array<float>.

        Args:
            dtypes: the data types to compare this DataType to.
            check_nullable: whether to take the NULLABLE type constructor into account for the comparison.
                If false, it means that NULLABLE<INT> is equivalent to INT.

        Returns:
            True, if and only if there is a type in `dtypes` which is equal to this DataType.
        """
        self_is_nullable = self.args.get("nullable")
        for dtype in dtypes:
            other_type = DataType.build(dtype, copy=False, udt=True)
            other_is_nullable = other_type.args.get("nullable")
            if (
                other_type.expressions
                or (check_nullable and (self_is_nullable or other_is_nullable))
                or self.this == DataType.Type.USERDEFINED
                or other_type.this == DataType.Type.USERDEFINED
            ):
                matches = self == other_type
            else:
                matches = self.this == other_type.this

            if matches:
                return True
        return False


DATA_TYPE = t.Union[str, DataType, DataType.Type]


# https://www.postgresql.org/docs/15/datatype-pseudo.html
class PseudoType(DataType):
    arg_types = {"this": True}


# https://www.postgresql.org/docs/15/datatype-oid.html
class ObjectIdentifier(DataType):
    arg_types = {"this": True}


# WHERE x <OP> EXISTS|ALL|ANY|SOME(SELECT ...)
class SubqueryPredicate(Predicate):
    pass


class All(SubqueryPredicate):
    pass


class Any(SubqueryPredicate):
    pass


# Commands to interact with the databases or engines. For most of the command
# expressions we parse whatever comes after the command's name as a string.
class Command(Expression):
    arg_types = {"this": True, "expression": False}


class Transaction(Expression):
    arg_types = {"this": False, "modes": False, "mark": False}


class Commit(Expression):
    arg_types = {"chain": False, "this": False, "durability": False}


class Rollback(Expression):
    arg_types = {"savepoint": False, "this": False}


class Alter(Expression):
    arg_types = {
        "this": True,
        "kind": True,
        "actions": True,
        "exists": False,
        "only": False,
        "options": False,
        "cluster": False,
        "not_valid": False,
    }

    @property
    def kind(self) -> t.Optional[str]:
        kind = self.args.get("kind")
        return kind and kind.upper()

    @property
    def actions(self) -> t.List[Expression]:
        return self.args.get("actions") or []


class AddConstraint(Expression):
    arg_types = {"expressions": True}


class AttachOption(Expression):
    arg_types = {"this": True, "expression": False}


class DropPartition(Expression):
    arg_types = {"expressions": True, "exists": False}


# https://clickhouse.com/docs/en/sql-reference/statements/alter/partition#replace-partition
class ReplacePartition(Expression):
    arg_types = {"expression": True, "source": True}


# Binary expressions like (ADD a b)
class Binary(Condition):
    arg_types = {"this": True, "expression": True}

    @property
    def left(self) -> Expression:
        return self.this

    @property
    def right(self) -> Expression:
        return self.expression


class Add(Binary):
    pass


class Connector(Binary):
    pass


class And(Connector):
    pass


class Or(Connector):
    pass


class BitwiseAnd(Binary):
    pass


class BitwiseLeftShift(Binary):
    pass


class BitwiseOr(Binary):
    pass


class BitwiseRightShift(Binary):
    pass


class BitwiseXor(Binary):
    pass


class Div(Binary):
    arg_types = {"this": True, "expression": True, "typed": False, "safe": False}


class Overlaps(Binary):
    pass


class Dot(Binary):
    @property
    def is_star(self) -> bool:
        return self.expression.is_star

    @property
    def name(self) -> str:
        return self.expression.name

    @property
    def output_name(self) -> str:
        return self.name

    @classmethod
    def build(self, expressions: t.Sequence[Expression]) -> Dot:
        """Build a Dot object with a sequence of expressions."""
        if len(expressions) < 2:
            raise ValueError("Dot requires >= 2 expressions.")

        return t.cast(Dot, reduce(lambda x, y: Dot(this=x, expression=y), expressions))

    @property
    def parts(self) -> t.List[Expression]:
        """Return the parts of a table / column in order catalog, db, table."""
        this, *parts = self.flatten()

        parts.reverse()

        for arg in COLUMN_PARTS:
            part = this.args.get(arg)

            if isinstance(part, Expression):
                parts.append(part)

        parts.reverse()
        return parts


class DPipe(Binary):
    arg_types = {"this": True, "expression": True, "safe": False}


class EQ(Binary, Predicate):
    pass


class NullSafeEQ(Binary, Predicate):
    pass


class NullSafeNEQ(Binary, Predicate):
    pass


# Represents e.g. := in DuckDB which is mostly used for setting parameters
class PropertyEQ(Binary):
    pass


class Distance(Binary):
    pass


class Escape(Binary):
    pass


class Glob(Binary, Predicate):
    pass


class GT(Binary, Predicate):
    pass


class GTE(Binary, Predicate):
    pass


class ILike(Binary, Predicate):
    pass


class ILikeAny(Binary, Predicate):
    pass


class IntDiv(Binary):
    pass


class Is(Binary, Predicate):
    pass


class Kwarg(Binary):
    """Kwarg in special functions like func(kwarg => y)."""


class Like(Binary, Predicate):
    pass


class LikeAny(Binary, Predicate):
    pass


class LT(Binary, Predicate):
    pass


class LTE(Binary, Predicate):
    pass


class Mod(Binary):
    pass


class Mul(Binary):
    pass


class NEQ(Binary, Predicate):
    pass


# https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH
class Operator(Binary):
    arg_types = {"this": True, "operator": True, "expression": True}


class SimilarTo(Binary, Predicate):
    pass


class Slice(Binary):
    arg_types = {"this": False, "expression": False}


class Sub(Binary):
    pass


# Unary Expressions
# (NOT a)
class Unary(Condition):
    pass


class BitwiseNot(Unary):
    pass


class Not(Unary):
    pass


class Paren(Unary):
    @property
    def output_name(self) -> str:
        return self.this.name


class Neg(Unary):
    def to_py(self) -> int | Decimal:
        if self.is_number:
            return self.this.to_py() * -1
        return super().to_py()


class Alias(Expression):
    arg_types = {"this": True, "alias": False}

    @property
    def output_name(self) -> str:
        return self.alias


# BigQuery requires the UNPIVOT column list aliases to be either strings or ints, but
# other dialects require identifiers. This enables us to transpile between them easily.
class PivotAlias(Alias):
    pass


# Represents Snowflake's ANY [ ORDER BY ... ] syntax
# https://docs.snowflake.com/en/sql-reference/constructs/pivot
class PivotAny(Expression):
    arg_types = {"this": False}


class Aliases(Expression):
    arg_types = {"this": True, "expressions": True}

    @property
    def aliases(self):
        return self.expressions


# https://docs.aws.amazon.com/redshift/latest/dg/query-super.html
class AtIndex(Expression):
    arg_types = {"this": True, "expression": True}


class AtTimeZone(Expression):
    arg_types = {"this": True, "zone": True}


class FromTimeZone(Expression):
    arg_types = {"this": True, "zone": True}


class Between(Predicate):
    arg_types = {"this": True, "low": True, "high": True}


class Bracket(Condition):
    # https://cloud.google.com/bigquery/docs/reference/standard-sql/operators#array_subscript_operator
    arg_types = {
        "this": True,
        "expressions": True,
        "offset": False,
        "safe": False,
        "returns_list_for_maps": False,
    }

    @property
    def output_name(self) -> str:
        if len(self.expressions) == 1:
            return self.expressions[0].output_name

        return super().output_name


class Distinct(Expression):
    arg_types = {"expressions": False, "on": False}


class In(Predicate):
    arg_types = {
        "this": True,
        "expressions": False,
        "query": False,
        "unnest": False,
        "field": False,
        "is_global": False,
    }


# https://cloud.google.com/bigquery/docs/reference/standard-sql/procedural-language#for-in
class ForIn(Expression):
    arg_types = {"this": True, "expression": True}


class TimeUnit(Expression):
    """Automatically converts unit arg into a var."""

    arg_types = {"unit": False}

    UNABBREVIATED_UNIT_NAME = {
        "D": "DAY",
        "H": "HOUR",
        "M": "MINUTE",
        "MS": "MILLISECOND",
        "NS": "NANOSECOND",
        "Q": "QUARTER",
        "S": "SECOND",
        "US": "MICROSECOND",
        "W": "WEEK",
        "Y": "YEAR",
    }

    VAR_LIKE = (Column, Literal, Var)

    def __init__(self, **args):
        unit = args.get("unit")
        if isinstance(unit, self.VAR_LIKE):
            args["unit"] = Var(
                this=(self.UNABBREVIATED_UNIT_NAME.get(unit.name) or unit.name).upper()
            )
        elif isinstance(unit, Week):
            unit.set("this", Var(this=unit.this.name.upper()))

        super().__init__(**args)

    @property
    def unit(self) -> t.Optional[Var | IntervalSpan]:
        return self.args.get("unit")


class IntervalOp(TimeUnit):
    arg_types = {"unit": False, "expression": True}

    def interval(self):
        return Interval(
            this=self.expression.copy(),
            unit=self.unit.copy() if self.unit else None,
        )


# https://www.oracletutorial.com/oracle-basics/oracle-interval/
# https://trino.io/docs/current/language/types.html#interval-day-to-second
# https://docs.databricks.com/en/sql/language-manual/data-types/interval-type.html
class IntervalSpan(DataType):
    arg_types = {"this": True, "expression": True}


class Interval(TimeUnit):
    arg_types = {"this": False, "unit": False}


class IgnoreNulls(Expression):
    pass


class RespectNulls(Expression):
    pass


# https://cloud.google.com/bigquery/docs/reference/standard-sql/aggregate-function-calls#max_min_clause
class HavingMax(Expression):
    arg_types = {"this": True, "expression": True, "max": True}


# Functions
class Func(Condition):
    """
    The base class for all function expressions.

    Attributes:
        is_var_len_args (bool): if set to True the last argument defined in arg_types will be
            treated as a variable length argument and the argument's value will be stored as a list.
        _sql_names (list): the SQL name (1st item in the list) and aliases (subsequent items) for this
            function expression. These values are used to map this node to a name during parsing as
            well as to provide the function's name during SQL string generation. By default the SQL
            name is set to the expression's class name transformed to snake case.
    """

    is_var_len_args = False

    @classmethod
    def from_arg_list(cls, args):
        if cls.is_var_len_args:
            all_arg_keys = list(cls.arg_types)
            # If this function supports variable length argument treat the last argument as such.
            non_var_len_arg_keys = all_arg_keys[:-1] if cls.is_var_len_args else all_arg_keys
            num_non_var = len(non_var_len_arg_keys)

            args_dict = {arg_key: arg for arg, arg_key in zip(args, non_var_len_arg_keys)}
            args_dict[all_arg_keys[-1]] = args[num_non_var:]
        else:
            args_dict = {arg_key: arg for arg, arg_key in zip(args, cls.arg_types)}

        return cls(**args_dict)

    @classmethod
    def sql_names(cls):
        if cls is Func:
            raise NotImplementedError(
                "SQL name is only supported by concrete function implementations"
            )
        if "_sql_names" not in cls.__dict__:
            cls._sql_names = [camel_to_snake_case(cls.__name__)]
        return cls._sql_names

    @classmethod
    def sql_name(cls):
        return cls.sql_names()[0]

    @classmethod
    def default_parser_mappings(cls):
        return {name: cls.from_arg_list for name in cls.sql_names()}


class AggFunc(Func):
    pass


class ParameterizedAgg(AggFunc):
    arg_types = {"this": True, "expressions": True, "params": True}


class Abs(Func):
    pass


class ArgMax(AggFunc):
    arg_types = {"this": True, "expression": True, "count": False}
    _sql_names = ["ARG_MAX", "ARGMAX", "MAX_BY"]


class ArgMin(AggFunc):
    arg_types = {"this": True, "expression": True, "count": False}
    _sql_names = ["ARG_MIN", "ARGMIN", "MIN_BY"]


class ApproxTopK(AggFunc):
    arg_types = {"this": True, "expression": False, "counters": False}


class Flatten(Func):
    pass


# https://spark.apache.org/docs/latest/api/sql/index.html#transform
class Transform(Func):
    arg_types = {"this": True, "expression": True}


class Anonymous(Func):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True

    @property
    def name(self) -> str:
        return self.this if isinstance(self.this, str) else self.this.name


class AnonymousAggFunc(AggFunc):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


# https://clickhouse.com/docs/en/sql-reference/aggregate-functions/combinators
class CombinedAggFunc(AnonymousAggFunc):
    arg_types = {"this": True, "expressions": False, "parts": True}


class CombinedParameterizedAgg(ParameterizedAgg):
    arg_types = {"this": True, "expressions": True, "params": True, "parts": True}


# https://docs.snowflake.com/en/sql-reference/functions/hll
# https://docs.aws.amazon.com/redshift/latest/dg/r_HLL_function.html
class Hll(AggFunc):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


class ApproxDistinct(AggFunc):
    arg_types = {"this": True, "accuracy": False}
    _sql_names = ["APPROX_DISTINCT", "APPROX_COUNT_DISTINCT"]


class Apply(Func):
    arg_types = {"this": True, "expression": True}


class Array(Func):
    arg_types = {"expressions": False, "bracket_notation": False}
    is_var_len_args = True


# https://docs.snowflake.com/en/sql-reference/functions/to_array
class ToArray(Func):
    pass


# https://materialize.com/docs/sql/types/list/
class List(Func):
    arg_types = {"expressions": False}
    is_var_len_args = True


# String pad, kind True -> LPAD, False -> RPAD
class Pad(Func):
    arg_types = {"this": True, "expression": True, "fill_pattern": False, "is_left": True}


# https://docs.snowflake.com/en/sql-reference/functions/to_char
# https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/TO_CHAR-number.html
class ToChar(Func):
    arg_types = {"this": True, "format": False, "nlsparam": False}


# https://docs.snowflake.com/en/sql-reference/functions/to_decimal
# https://docs.oracle.com/en/database/oracle/oracle-database/23/sqlrf/TO_NUMBER.html
class ToNumber(Func):
    arg_types = {
        "this": True,
        "format": False,
        "nlsparam": False,
        "precision": False,
        "scale": False,
    }


# https://docs.snowflake.com/en/sql-reference/functions/to_double
class ToDouble(Func):
    arg_types = {
        "this": True,
        "format": False,
    }


class Columns(Func):
    arg_types = {"this": True, "unpack": False}


# https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql?view=sql-server-ver16#syntax
class Convert(Func):
    arg_types = {"this": True, "expression": True, "style": False}


class ConvertTimezone(Func):
    arg_types = {"source_tz": False, "target_tz": True, "timestamp": True}


class GenerateSeries(Func):
    arg_types = {"start": True, "end": True, "step": False, "is_end_exclusive": False}


# Postgres' GENERATE_SERIES function returns a row set, i.e. it implicitly explodes when it's
# used in a projection, so this expression is a helper that facilitates transpilation to other
# dialects. For example, we'd generate UNNEST(GENERATE_SERIES(...)) in DuckDB
class ExplodingGenerateSeries(GenerateSeries):
    pass


class ArrayAgg(AggFunc):
    arg_types = {"this": True, "nulls_excluded": False}


class ArrayUniqueAgg(AggFunc):
    pass


class ArrayAll(Func):
    arg_types = {"this": True, "expression": True}


# Represents Python's `any(f(x) for x in array)`, where `array` is `this` and `f` is `expression`
class ArrayAny(Func):
    arg_types = {"this": True, "expression": True}


class ArrayConcat(Func):
    _sql_names = ["ARRAY_CONCAT", "ARRAY_CAT"]
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


class ArrayConstructCompact(Func):
    arg_types = {"expressions": True}
    is_var_len_args = True


class ArrayContains(Binary, Func):
    _sql_names = ["ARRAY_CONTAINS", "ARRAY_HAS"]


class ArrayContainsAll(Binary, Func):
    _sql_names = ["ARRAY_CONTAINS_ALL", "ARRAY_HAS_ALL"]


class ArrayFilter(Func):
    arg_types = {"this": True, "expression": True}
    _sql_names = ["FILTER", "ARRAY_FILTER"]


class ArrayToString(Func):
    arg_types = {"this": True, "expression": True, "null": False}
    _sql_names = ["ARRAY_TO_STRING", "ARRAY_JOIN"]


# https://cloud.google.com/bigquery/docs/reference/standard-sql/timestamp_functions#string
class String(Func):
    arg_types = {"this": True, "zone": False}


class StringToArray(Func):
    arg_types = {"this": True, "expression": True, "null": False}
    _sql_names = ["STRING_TO_ARRAY", "SPLIT_BY_STRING"]


class ArrayOverlaps(Binary, Func):
    pass


class ArraySize(Func):
    arg_types = {"this": True, "expression": False}
    _sql_names = ["ARRAY_SIZE", "ARRAY_LENGTH"]


class ArraySort(Func):
    arg_types = {"this": True, "expression": False}


class ArraySum(Func):
    arg_types = {"this": True, "expression": False}


class ArrayUnionAgg(AggFunc):
    pass


class Avg(AggFunc):
    pass


class AnyValue(AggFunc):
    pass


class Lag(AggFunc):
    arg_types = {"this": True, "offset": False, "default": False}


class Lead(AggFunc):
    arg_types = {"this": True, "offset": False, "default": False}


# some dialects have a distinction between first and first_value, usually first is an aggregate func
# and first_value is a window func
class First(AggFunc):
    pass


class Last(AggFunc):
    pass


class FirstValue(AggFunc):
    pass


class LastValue(AggFunc):
    pass


class NthValue(AggFunc):
    arg_types = {"this": True, "offset": True}


class Case(Func):
    arg_types = {"this": False, "ifs": True, "default": False}

    def when(self, condition: ExpOrStr, then: ExpOrStr, copy: bool = True, **opts) -> Case:
        instance = maybe_copy(self, copy)
        instance.append(
            "ifs",
            If(
                this=maybe_parse(condition, copy=copy, **opts),
                true=maybe_parse(then, copy=copy, **opts),
            ),
        )
        return instance

    def else_(self, condition: ExpOrStr, copy: bool = True, **opts) -> Case:
        instance = maybe_copy(self, copy)
        instance.set("default", maybe_parse(condition, copy=copy, **opts))
        return instance


class Cast(Func):
    arg_types = {
        "this": True,
        "to": True,
        "format": False,
        "safe": False,
        "action": False,
    }

    @property
    def name(self) -> str:
        return self.this.name

    @property
    def to(self) -> DataType:
        return self.args["to"]

    @property
    def output_name(self) -> str:
        return self.name

    def is_type(self, *dtypes: DATA_TYPE) -> bool:
        """
        Checks whether this Cast's DataType matches one of the provided data types. Nested types
        like arrays or structs will be compared using "structural equivalence" semantics, so e.g.
        array<int> != array<float>.

        Args:
            dtypes: the data types to compare this Cast's DataType to.

        Returns:
            True, if and only if there is a type in `dtypes` which is equal to this Cast's DataType.
        """
        return self.to.is_type(*dtypes)


class TryCast(Cast):
    pass


class Try(Func):
    pass


class CastToStrType(Func):
    arg_types = {"this": True, "to": True}


class Collate(Binary, Func):
    pass


class Ceil(Func):
    arg_types = {"this": True, "decimals": False}
    _sql_names = ["CEIL", "CEILING"]


class Coalesce(Func):
    arg_types = {"this": True, "expressions": False, "is_nvl": False}
    is_var_len_args = True
    _sql_names = ["COALESCE", "IFNULL", "NVL"]


class Chr(Func):
    arg_types = {"expressions": True, "charset": False}
    is_var_len_args = True
    _sql_names = ["CHR", "CHAR"]


class Concat(Func):
    arg_types = {"expressions": True, "safe": False, "coalesce": False}
    is_var_len_args = True


class ConcatWs(Concat):
    _sql_names = ["CONCAT_WS"]


class Contains(Func):
    arg_types = {"this": True, "expression": True}


# https://docs.oracle.com/cd/B13789_01/server.101/b10759/operators004.htm#i1035022
class ConnectByRoot(Func):
    pass


class Count(AggFunc):
    arg_types = {"this": False, "expressions": False, "big_int": False}
    is_var_len_args = True


class CountIf(AggFunc):
    _sql_names = ["COUNT_IF", "COUNTIF"]


# cube root
class Cbrt(Func):
    pass


class CurrentDate(Func):
    arg_types = {"this": False}


class CurrentDatetime(Func):
    arg_types = {"this": False}


class CurrentTime(Func):
    arg_types = {"this": False}


class CurrentTimestamp(Func):
    arg_types = {"this": False, "sysdate": False}


class CurrentUser(Func):
    arg_types = {"this": False}


class DateAdd(Func, IntervalOp):
    arg_types = {"this": True, "expression": True, "unit": False}


class DateSub(Func, IntervalOp):
    arg_types = {"this": True, "expression": True, "unit": False}


class DateDiff(Func, TimeUnit):
    _sql_names = ["DATEDIFF", "DATE_DIFF"]
    arg_types = {"this": True, "expression": True, "unit": False}


class DateTrunc(Func):
    arg_types = {"unit": True, "this": True, "zone": False}

    def __init__(self, **args):
        # Across most dialects it's safe to unabbreviate the unit (e.g. 'Q' -> 'QUARTER') except Oracle
        # https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/ROUND-and-TRUNC-Date-Functions.html
        unabbreviate = args.pop("unabbreviate", True)

        unit = args.get("unit")
        if isinstance(unit, TimeUnit.VAR_LIKE):
            unit_name = unit.name.upper()
            if unabbreviate and unit_name in TimeUnit.UNABBREVIATED_UNIT_NAME:
                unit_name = TimeUnit.UNABBREVIATED_UNIT_NAME[unit_name]

            args["unit"] = Literal.string(unit_name)
        elif isinstance(unit, Week):
            unit.set("this", Literal.string(unit.this.name.upper()))

        super().__init__(**args)

    @property
    def unit(self) -> Expression:
        return self.args["unit"]


# https://cloud.google.com/bigquery/docs/reference/standard-sql/datetime_functions#datetime
# expression can either be time_expr or time_zone
class Datetime(Func):
    arg_types = {"this": True, "expression": False}


class DatetimeAdd(Func, IntervalOp):
    arg_types = {"this": True, "expression": True, "unit": False}


class DatetimeSub(Func, IntervalOp):
    arg_types = {"this": True, "expression": True, "unit": False}


class DatetimeDiff(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class DatetimeTrunc(Func, TimeUnit):
    arg_types = {"this": True, "unit": True, "zone": False}


class DayOfWeek(Func):
    _sql_names = ["DAY_OF_WEEK", "DAYOFWEEK"]


# https://duckdb.org/docs/sql/functions/datepart.html#part-specifiers-only-usable-as-date-part-specifiers
# ISO day of week function in duckdb is ISODOW
class DayOfWeekIso(Func):
    _sql_names = ["DAYOFWEEK_ISO", "ISODOW"]


class DayOfMonth(Func):
    _sql_names = ["DAY_OF_MONTH", "DAYOFMONTH"]


class DayOfYear(Func):
    _sql_names = ["DAY_OF_YEAR", "DAYOFYEAR"]


class ToDays(Func):
    pass


class WeekOfYear(Func):
    _sql_names = ["WEEK_OF_YEAR", "WEEKOFYEAR"]


class MonthsBetween(Func):
    arg_types = {"this": True, "expression": True, "roundoff": False}


class MakeInterval(Func):
    arg_types = {
        "year": False,
        "month": False,
        "day": False,
        "hour": False,
        "minute": False,
        "second": False,
    }


class LastDay(Func, TimeUnit):
    _sql_names = ["LAST_DAY", "LAST_DAY_OF_MONTH"]
    arg_types = {"this": True, "unit": False}


class Extract(Func):
    arg_types = {"this": True, "expression": True}


class Exists(Func, SubqueryPredicate):
    arg_types = {"this": True, "expression": False}


class Timestamp(Func):
    arg_types = {"this": False, "zone": False, "with_tz": False}


class TimestampAdd(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TimestampSub(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TimestampDiff(Func, TimeUnit):
    _sql_names = ["TIMESTAMPDIFF", "TIMESTAMP_DIFF"]
    arg_types = {"this": True, "expression": True, "unit": False}


class TimestampTrunc(Func, TimeUnit):
    arg_types = {"this": True, "unit": True, "zone": False}


class TimeAdd(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TimeSub(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TimeDiff(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TimeTrunc(Func, TimeUnit):
    arg_types = {"this": True, "unit": True, "zone": False}


class DateFromParts(Func):
    _sql_names = ["DATE_FROM_PARTS", "DATEFROMPARTS"]
    arg_types = {"year": True, "month": True, "day": True}


class TimeFromParts(Func):
    _sql_names = ["TIME_FROM_PARTS", "TIMEFROMPARTS"]
    arg_types = {
        "hour": True,
        "min": True,
        "sec": True,
        "nano": False,
        "fractions": False,
        "precision": False,
    }


class DateStrToDate(Func):
    pass


class DateToDateStr(Func):
    pass


class DateToDi(Func):
    pass


# https://cloud.google.com/bigquery/docs/reference/standard-sql/date_functions#date
class Date(Func):
    arg_types = {"this": False, "zone": False, "expressions": False}
    is_var_len_args = True


class Day(Func):
    pass


class Decode(Func):
    arg_types = {"this": True, "charset": True, "replace": False}


class DiToDate(Func):
    pass


class Encode(Func):
    arg_types = {"this": True, "charset": True}


class Exp(Func):
    pass


# https://docs.snowflake.com/en/sql-reference/functions/flatten
class Explode(Func, UDTF):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


# https://spark.apache.org/docs/latest/api/sql/#inline
class Inline(Func):
    pass


class ExplodeOuter(Explode):
    pass


class Posexplode(Explode):
    pass


class PosexplodeOuter(Posexplode, ExplodeOuter):
    pass


class Unnest(Func, UDTF):
    arg_types = {
        "expressions": True,
        "alias": False,
        "offset": False,
        "explode_array": False,
    }

    @property
    def selects(self) -> t.List[Expression]:
        columns = super().selects
        offset = self.args.get("offset")
        if offset:
            columns = columns + [to_identifier("offset") if offset is True else offset]
        return columns


class Floor(Func):
    arg_types = {"this": True, "decimals": False}


class FromBase64(Func):
    pass


class FeaturesAtTime(Func):
    arg_types = {"this": True, "time": False, "num_rows": False, "ignore_feature_nulls": False}


class ToBase64(Func):
    pass


# https://trino.io/docs/current/functions/datetime.html#from_iso8601_timestamp
class FromISO8601Timestamp(Func):
    _sql_names = ["FROM_ISO8601_TIMESTAMP"]


class GapFill(Func):
    arg_types = {
        "this": True,
        "ts_column": True,
        "bucket_width": True,
        "partitioning_columns": False,
        "value_columns": False,
        "origin": False,
        "ignore_nulls": False,
    }


# https://cloud.google.com/bigquery/docs/reference/standard-sql/array_functions#generate_date_array
class GenerateDateArray(Func):
    arg_types = {"start": True, "end": True, "step": False}


# https://cloud.google.com/bigquery/docs/reference/standard-sql/array_functions#generate_timestamp_array
class GenerateTimestampArray(Func):
    arg_types = {"start": True, "end": True, "step": True}


class Greatest(Func):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


# Trino's `ON OVERFLOW TRUNCATE [filler_string] {WITH | WITHOUT} COUNT`
# https://trino.io/docs/current/functions/aggregate.html#listagg
class OverflowTruncateBehavior(Expression):
    arg_types = {"this": False, "with_count": True}


class GroupConcat(AggFunc):
    arg_types = {"this": True, "separator": False, "on_overflow": False}


class Hex(Func):
    pass


class LowerHex(Hex):
    pass


class Xor(Connector, Func):
    arg_types = {"this": False, "expression": False, "expressions": False}


class If(Func):
    arg_types = {"this": True, "true": True, "false": False}
    _sql_names = ["IF", "IIF"]


class Nullif(Func):
    arg_types = {"this": True, "expression": True}


class Initcap(Func):
    arg_types = {"this": True, "expression": False}


class IsNan(Func):
    _sql_names = ["IS_NAN", "ISNAN"]


# https://cloud.google.com/bigquery/docs/reference/standard-sql/json_functions#int64_for_json
class Int64(Func):
    pass


class IsInf(Func):
    _sql_names = ["IS_INF", "ISINF"]


# https://www.postgresql.org/docs/current/functions-json.html
class JSON(Expression):
    arg_types = {"this": False, "with": False, "unique": False}


class JSONPath(Expression):
    arg_types = {"expressions": True, "escape": False}

    @property
    def output_name(self) -> str:
        last_segment = self.expressions[-1].this
        return last_segment if isinstance(last_segment, str) else ""


class JSONPathPart(Expression):
    arg_types = {}


class JSONPathFilter(JSONPathPart):
    arg_types = {"this": True}


class JSONPathKey(JSONPathPart):
    arg_types = {"this": True}


class JSONPathRecursive(JSONPathPart):
    arg_types = {"this": False}


class JSONPathRoot(JSONPathPart):
    pass


class JSONPathScript(JSONPathPart):
    arg_types = {"this": True}


class JSONPathSlice(JSONPathPart):
    arg_types = {"start": False, "end": False, "step": False}


class JSONPathSelector(JSONPathPart):
    arg_types = {"this": True}


class JSONPathSubscript(JSONPathPart):
    arg_types = {"this": True}


class JSONPathUnion(JSONPathPart):
    arg_types = {"expressions": True}


class JSONPathWildcard(JSONPathPart):
    pass


class FormatJson(Expression):
    pass


class JSONKeyValue(Expression):
    arg_types = {"this": True, "expression": True}


class JSONObject(Func):
    arg_types = {
        "expressions": False,
        "null_handling": False,
        "unique_keys": False,
        "return_type": False,
        "encoding": False,
    }


class JSONObjectAgg(AggFunc):
    arg_types = {
        "expressions": False,
        "null_handling": False,
        "unique_keys": False,
        "return_type": False,
        "encoding": False,
    }


# https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/JSON_ARRAY.html
class JSONArray(Func):
    arg_types = {
        "expressions": True,
        "null_handling": False,
        "return_type": False,
        "strict": False,
    }


# https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/JSON_ARRAYAGG.html
class JSONArrayAgg(Func):
    arg_types = {
        "this": True,
        "order": False,
        "null_handling": False,
        "return_type": False,
        "strict": False,
    }


class JSONExists(Func):
    arg_types = {"this": True, "path": True, "passing": False, "on_condition": False}


# https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/JSON_TABLE.html
# Note: parsing of JSON column definitions is currently incomplete.
class JSONColumnDef(Expression):
    arg_types = {"this": False, "kind": False, "path": False, "nested_schema": False}


class JSONSchema(Expression):
    arg_types = {"expressions": True}


# https://dev.mysql.com/doc/refman/8.4/en/json-search-functions.html#function_json-value
class JSONValue(Expression):
    arg_types = {
        "this": True,
        "path": True,
        "returning": False,
        "on_condition": False,
    }


class JSONValueArray(Func):
    arg_types = {"this": True, "expression": False}


# # https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/JSON_TABLE.html
class JSONTable(Func):
    arg_types = {
        "this": True,
        "schema": True,
        "path": False,
        "error_handling": False,
        "empty_handling": False,
    }


# https://docs.snowflake.com/en/sql-reference/functions/object_insert
class ObjectInsert(Func):
    arg_types = {
        "this": True,
        "key": True,
        "value": True,
        "update_flag": False,
    }


class OpenJSONColumnDef(Expression):
    arg_types = {"this": True, "kind": True, "path": False, "as_json": False}


class OpenJSON(Func):
    arg_types = {"this": True, "path": False, "expressions": False}


class JSONBContains(Binary, Func):
    _sql_names = ["JSONB_CONTAINS"]


class JSONBExists(Func):
    arg_types = {"this": True, "path": True}
    _sql_names = ["JSONB_EXISTS"]


class JSONExtract(Binary, Func):
    arg_types = {
        "this": True,
        "expression": True,
        "only_json_types": False,
        "expressions": False,
        "variant_extract": False,
        "json_query": False,
        "option": False,
    }
    _sql_names = ["JSON_EXTRACT"]
    is_var_len_args = True

    @property
    def output_name(self) -> str:
        return self.expression.output_name if not self.expressions else ""


class JSONExtractArray(Func):
    arg_types = {"this": True, "expression": False}
    _sql_names = ["JSON_EXTRACT_ARRAY"]


class JSONExtractScalar(Binary, Func):
    arg_types = {"this": True, "expression": True, "only_json_types": False, "expressions": False}
    _sql_names = ["JSON_EXTRACT_SCALAR"]
    is_var_len_args = True

    @property
    def output_name(self) -> str:
        return self.expression.output_name


class JSONBExtract(Binary, Func):
    _sql_names = ["JSONB_EXTRACT"]


class JSONBExtractScalar(Binary, Func):
    _sql_names = ["JSONB_EXTRACT_SCALAR"]


class JSONFormat(Func):
    arg_types = {"this": False, "options": False}
    _sql_names = ["JSON_FORMAT"]


# https://dev.mysql.com/doc/refman/8.0/en/json-search-functions.html#operator_member-of
class JSONArrayContains(Binary, Predicate, Func):
    _sql_names = ["JSON_ARRAY_CONTAINS"]


class ParseJSON(Func):
    # BigQuery, Snowflake have PARSE_JSON, Presto has JSON_PARSE
    # Snowflake also has TRY_PARSE_JSON, which is represented using `safe`
    _sql_names = ["PARSE_JSON", "JSON_PARSE"]
    arg_types = {"this": True, "expression": False, "safe": False}


class Least(Func):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


class Left(Func):
    arg_types = {"this": True, "expression": True}


class Right(Func):
    arg_types = {"this": True, "expression": True}


class Length(Func):
    arg_types = {"this": True, "binary": False}
    _sql_names = ["LENGTH", "LEN"]


class Levenshtein(Func):
    arg_types = {
        "this": True,
        "expression": False,
        "ins_cost": False,
        "del_cost": False,
        "sub_cost": False,
        "max_dist": False,
    }


class Ln(Func):
    pass


class Log(Func):
    arg_types = {"this": True, "expression": False}


class LogicalOr(AggFunc):
    _sql_names = ["LOGICAL_OR", "BOOL_OR", "BOOLOR_AGG"]


class LogicalAnd(AggFunc):
    _sql_names = ["LOGICAL_AND", "BOOL_AND", "BOOLAND_AGG"]


class Lower(Func):
    _sql_names = ["LOWER", "LCASE"]


class Map(Func):
    arg_types = {"keys": False, "values": False}

    @property
    def keys(self) -> t.List[Expression]:
        keys = self.args.get("keys")
        return keys.expressions if keys else []

    @property
    def values(self) -> t.List[Expression]:
        values = self.args.get("values")
        return values.expressions if values else []


# Represents the MAP {...} syntax in DuckDB - basically convert a struct to a MAP
class ToMap(Func):
    pass


class MapFromEntries(Func):
    pass


# https://learn.microsoft.com/en-us/sql/t-sql/language-elements/scope-resolution-operator-transact-sql?view=sql-server-ver16
class ScopeResolution(Expression):
    arg_types = {"this": False, "expression": True}


class Stream(Expression):
    pass


class StarMap(Func):
    pass


class VarMap(Func):
    arg_types = {"keys": True, "values": True}
    is_var_len_args = True

    @property
    def keys(self) -> t.List[Expression]:
        return self.args["keys"].expressions

    @property
    def values(self) -> t.List[Expression]:
        return self.args["values"].expressions


# https://dev.mysql.com/doc/refman/8.0/en/fulltext-search.html
class MatchAgainst(Func):
    arg_types = {"this": True, "expressions": True, "modifier": False}


class Max(AggFunc):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


class MD5(Func):
    _sql_names = ["MD5"]


# Represents the variant of the MD5 function that returns a binary value
class MD5Digest(Func):
    _sql_names = ["MD5_DIGEST"]


class Median(AggFunc):
    pass


class Min(AggFunc):
    arg_types = {"this": True, "expressions": False}
    is_var_len_args = True


class Month(Func):
    pass


class AddMonths(Func):
    arg_types = {"this": True, "expression": True}


class Nvl2(Func):
    arg_types = {"this": True, "true": True, "false": False}


class Normalize(Func):
    arg_types = {"this": True, "form": False}


class Overlay(Func):
    arg_types = {"this": True, "expression": True, "from": True, "for": False}


# https://cloud.google.com/bigquery/docs/reference/standard-sql/bigqueryml-syntax-predict#mlpredict_function
class Predict(Func):
    arg_types = {"this": True, "expression": True, "params_struct": False}


class Pow(Binary, Func):
    _sql_names = ["POWER", "POW"]


class PercentileCont(AggFunc):
    arg_types = {"this": True, "expression": False}


class PercentileDisc(AggFunc):
    arg_types = {"this": True, "expression": False}


class Quantile(AggFunc):
    arg_types = {"this": True, "quantile": True}


class ApproxQuantile(Quantile):
    arg_types = {"this": True, "quantile": True, "accuracy": False, "weight": False}


class Quarter(Func):
    pass


# https://docs.teradata.com/r/Enterprise_IntelliFlex_VMware/SQL-Functions-Expressions-and-Predicates/Arithmetic-Trigonometric-Hyperbolic-Operators/Functions/RANDOM/RANDOM-Function-Syntax
# teradata lower and upper bounds
class Rand(Func):
    _sql_names = ["RAND", "RANDOM"]
    arg_types = {"this": False, "lower": False, "upper": False}


class Randn(Func):
    arg_types = {"this": False}


class RangeN(Func):
    arg_types = {"this": True, "expressions": True, "each": False}


class ReadCSV(Func):
    _sql_names = ["READ_CSV"]
    is_var_len_args = True
    arg_types = {"this": True, "expressions": False}


class Reduce(Func):
    arg_types = {"this": True, "initial": True, "merge": True, "finish": False}


class RegexpExtract(Func):
    arg_types = {
        "this": True,
        "expression": True,
        "position": False,
        "occurrence": False,
        "parameters": False,
        "group": False,
    }


class RegexpExtractAll(Func):
    arg_types = {
        "this": True,
        "expression": True,
        "position": False,
        "occurrence": False,
        "parameters": False,
        "group": False,
    }


class RegexpReplace(Func):
    arg_types = {
        "this": True,
        "expression": True,
        "replacement": False,
        "position": False,
        "occurrence": False,
        "modifiers": False,
    }


class RegexpLike(Binary, Func):
    arg_types = {"this": True, "expression": True, "flag": False}


class RegexpILike(Binary, Func):
    arg_types = {"this": True, "expression": True, "flag": False}


# https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.functions.split.html
# limit is the number of times a pattern is applied
class RegexpSplit(Func):
    arg_types = {"this": True, "expression": True, "limit": False}


class Repeat(Func):
    arg_types = {"this": True, "times": True}


# https://learn.microsoft.com/en-us/sql/t-sql/functions/round-transact-sql?view=sql-server-ver16
# tsql third argument function == trunctaion if not 0
class Round(Func):
    arg_types = {"this": True, "decimals": False, "truncate": False}


class RowNumber(Func):
    arg_types = {"this": False}


class SafeDivide(Func):
    arg_types = {"this": True, "expression": True}


class SHA(Func):
    _sql_names = ["SHA", "SHA1"]


class SHA2(Func):
    _sql_names = ["SHA2"]
    arg_types = {"this": True, "length": False}


class Sign(Func):
    _sql_names = ["SIGN", "SIGNUM"]


class SortArray(Func):
    arg_types = {"this": True, "asc": False}


class Split(Func):
    arg_types = {"this": True, "expression": True, "limit": False}


# https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.functions.split_part.html
class SplitPart(Func):
    arg_types = {"this": True, "delimiter": True, "part_index": True}


# Start may be omitted in the case of postgres
# https://www.postgresql.org/docs/9.1/functions-string.html @ Table 9-6
class Substring(Func):
    _sql_names = ["SUBSTRING", "SUBSTR"]
    arg_types = {"this": True, "start": False, "length": False}


class StandardHash(Func):
    arg_types = {"this": True, "expression": False}


class StartsWith(Func):
    _sql_names = ["STARTS_WITH", "STARTSWITH"]
    arg_types = {"this": True, "expression": True}


class StrPosition(Func):
    arg_types = {
        "this": True,
        "substr": True,
        "position": False,
        "instance": False,
    }


class StrToDate(Func):
    arg_types = {"this": True, "format": False, "safe": False}


class StrToTime(Func):
    arg_types = {"this": True, "format": True, "zone": False, "safe": False}


# Spark allows unix_timestamp()
# https://spark.apache.org/docs/3.1.3/api/python/reference/api/pyspark.sql.functions.unix_timestamp.html
class StrToUnix(Func):
    arg_types = {"this": False, "format": False}


# https://prestodb.io/docs/current/functions/string.html
# https://spark.apache.org/docs/latest/api/sql/index.html#str_to_map
class StrToMap(Func):
    arg_types = {
        "this": True,
        "pair_delim": False,
        "key_value_delim": False,
        "duplicate_resolution_callback": False,
    }


class NumberToStr(Func):
    arg_types = {"this": True, "format": True, "culture": False}


class FromBase(Func):
    arg_types = {"this": True, "expression": True}


class Struct(Func):
    arg_types = {"expressions": False}
    is_var_len_args = True


class StructExtract(Func):
    arg_types = {"this": True, "expression": True}


# https://learn.microsoft.com/en-us/sql/t-sql/functions/stuff-transact-sql?view=sql-server-ver16
# https://docs.snowflake.com/en/sql-reference/functions/insert
class Stuff(Func):
    _sql_names = ["STUFF", "INSERT"]
    arg_types = {"this": True, "start": True, "length": True, "expression": True}


class Sum(AggFunc):
    pass


class Sqrt(Func):
    pass


class Stddev(AggFunc):
    _sql_names = ["STDDEV", "STDEV"]


class StddevPop(AggFunc):
    pass


class StddevSamp(AggFunc):
    pass


# https://cloud.google.com/bigquery/docs/reference/standard-sql/time_functions#time
class Time(Func):
    arg_types = {"this": False, "zone": False}


class TimeToStr(Func):
    arg_types = {"this": True, "format": True, "culture": False, "zone": False}


class TimeToTimeStr(Func):
    pass


class TimeToUnix(Func):
    pass


class TimeStrToDate(Func):
    pass


class TimeStrToTime(Func):
    arg_types = {"this": True, "zone": False}


class TimeStrToUnix(Func):
    pass


class Trim(Func):
    arg_types = {
        "this": True,
        "expression": False,
        "position": False,
        "collation": False,
    }


class TsOrDsAdd(Func, TimeUnit):
    # return_type is used to correctly cast the arguments of this expression when transpiling it
    arg_types = {"this": True, "expression": True, "unit": False, "return_type": False}

    @property
    def return_type(self) -> DataType:
        return DataType.build(self.args.get("return_type") or DataType.Type.DATE)


class TsOrDsDiff(Func, TimeUnit):
    arg_types = {"this": True, "expression": True, "unit": False}


class TsOrDsToDateStr(Func):
    pass


class TsOrDsToDate(Func):
    arg_types = {"this": True, "format": False, "safe": False}


class TsOrDsToDatetime(Func):
    pass


class TsOrDsToTime(Func):
    pass


class TsOrDsToTimestamp(Func):
    pass


class TsOrDiToDi(Func):
    pass


class Unhex(Func):
    pass


# https://cloud.google.com/bigquery/docs/reference/standard-sql/date_functions#unix_date
class UnixDate(Func):
    pass


class UnixToStr(Func):
    arg_types = {"this": True, "format": False}


# https://prestodb.io/docs/current/functions/datetime.html
# presto has weird zone/hours/minutes
class UnixToTime(Func):
    arg_types = {
        "this": True,
        "scale": False,
        "zone": False,
        "hours": False,
        "minutes": False,
        "format": False,
    }

    SECONDS = Literal.number(0)
    DECIS = Literal.number(1)
    CENTIS = Literal.number(2)
    MILLIS = Literal.number(3)
    DECIMILLIS = Literal.number(4)
    CENTIMILLIS = Literal.number(5)
    MICROS = Literal.number(6)
    DECIMICROS = Literal.number(7)
    CENTIMICROS = Literal.number(8)
    NANOS = Literal.number(9)


class UnixToTimeStr(Func):
    pass


class UnixSeconds(Func):
    pass


class Uuid(Func):
    _sql_names = ["UUID", "GEN_RANDOM_UUID", "GENERATE_UUID", "UUID_STRING"]

    arg_types = {"this": False, "name": False}


class TimestampFromParts(Func):
    _sql_names = ["TIMESTAMP_FROM_PARTS", "TIMESTAMPFROMPARTS"]
    arg_types = {
        "year": True,
        "month": True,
        "day": True,
        "hour": True,
        "min": True,
        "sec": True,
        "nano": False,
        "zone": False,
        "milli": False,
    }


class Upper(Func):
    _sql_names = ["UPPER", "UCASE"]


class Corr(Binary, AggFunc):
    pass


class Variance(AggFunc):
    _sql_names = ["VARIANCE", "VARIANCE_SAMP", "VAR_SAMP"]


class VariancePop(AggFunc):
    _sql_names = ["VARIANCE_POP", "VAR_POP"]


class CovarSamp(Binary, AggFunc):
    pass


class CovarPop(Binary, AggFunc):
    pass


class Week(Func):
    arg_types = {"this": True, "mode": False}


class XMLTable(Func):
    arg_types = {"this": True, "passing": False, "columns": False, "by_ref": False}


class Year(Func):
    pass


class Use(Expression):
    arg_types = {"this": True, "kind": False}


class Merge(DML):
    arg_types = {
        "this": True,
        "using": True,
        "on": True,
        "expressions": True,
        "with": False,
        "returning": False,
    }


class When(Func):
    arg_types = {"matched": True, "source": False, "condition": False, "then": True}


# https://docs.oracle.com/javadb/10.8.3.0/ref/rrefsqljnextvaluefor.html
# https://learn.microsoft.com/en-us/sql/t-sql/functions/next-value-for-transact-sql?view=sql-server-ver16
class NextValueFor(Func):
    arg_types = {"this": True, "order": False}


# Refers to a trailing semi-colon. This is only used to preserve trailing comments
# select 1; -- my comment
class Semicolon(Expression):
    arg_types = {}


def _norm_arg(arg):
    return arg.lower() if type(arg) is str else arg


ALL_FUNCTIONS = subclasses(__name__, Func, (AggFunc, Anonymous, Func))
FUNCTION_BY_NAME = {name: func for func in ALL_FUNCTIONS for name in func.sql_names()}

JSON_PATH_PARTS = subclasses(__name__, JSONPathPart, (JSONPathPart,))

PERCENTILES = (PercentileCont, PercentileDisc)


# Helpers
@t.overload
def maybe_parse(
    sql_or_expression: ExpOrStr,
    *,
    into: t.Type[E],
    dialect: DialectType = None,
    prefix: t.Optional[str] = None,
    copy: bool = False,
    **opts,
) -> E: ...


@t.overload
def maybe_parse(
    sql_or_expression: str | E,
    *,
    into: t.Optional[IntoType] = None,
    dialect: DialectType = None,
    prefix: t.Optional[str] = None,
    copy: bool = False,
    **opts,
) -> E: ...


def maybe_parse(
    sql_or_expression: ExpOrStr,
    *,
    into: t.Optional[IntoType] = None,
    dialect: DialectType = None,
    prefix: t.Optional[str] = None,
    copy: bool = False,
    **opts,
) -> Expression:
    """Gracefully handle a possible string or expression.

    Example:
        >>> maybe_parse("1")
        Literal(this=1, is_string=False)
        >>> maybe_parse(to_identifier("x"))
        Identifier(this=x, quoted=False)

    Args:
        sql_or_expression: the SQL code string or an expression
        into: the SQLGlot Expression to parse into
        dialect: the dialect used to parse the input expressions (in the case that an
            input expression is a SQL string).
        prefix: a string to prefix the sql with before it gets parsed
            (automatically includes a space)
        copy: whether to copy the expression.
        **opts: other options to use to parse the input expressions (again, in the case
            that an input expression is a SQL string).

    Returns:
        Expression: the parsed or given expression.
    """
    if isinstance(sql_or_expression, Expression):
        if copy:
            return sql_or_expression.copy()
        return sql_or_expression

    if sql_or_expression is None:
        raise ParseError("SQL cannot be None")

    import sqlglot

    sql = str(sql_or_expression)
    if prefix:
        sql = f"{prefix} {sql}"

    return sqlglot.parse_one(sql, read=dialect, into=into, **opts)


@t.overload
def maybe_copy(instance: None, copy: bool = True) -> None: ...


@t.overload
def maybe_copy(instance: E, copy: bool = True) -> E: ...


def maybe_copy(instance, copy=True):
    return instance.copy() if copy and instance else instance


def _to_s(node: t.Any, verbose: bool = False, level: int = 0) -> str:
    """Generate a textual representation of an Expression tree"""
    indent = "\n" + ("  " * (level + 1))
    delim = f",{indent}"

    if isinstance(node, Expression):
        args = {k: v for k, v in node.args.items() if (v is not None and v != []) or verbose}

        if (node.type or verbose) and not isinstance(node, DataType):
            args["_type"] = node.type
        if node.comments or verbose:
            args["_comments"] = node.comments

        if verbose:
            args["_id"] = id(node)

        # Inline leaves for a more compact representation
        if node.is_leaf():
            indent = ""
            delim = ", "

        items = delim.join([f"{k}={_to_s(v, verbose, level + 1)}" for k, v in args.items()])
        return f"{node.__class__.__name__}({indent}{items})"

    if isinstance(node, list):
        items = delim.join(_to_s(i, verbose, level + 1) for i in node)
        items = f"{indent}{items}" if items else ""
        return f"[{items}]"

    # Indent multiline strings to match the current level
    return indent.join(textwrap.dedent(str(node).strip("\n")).splitlines())


def _is_wrong_expression(expression, into):
    return isinstance(expression, Expression) and not isinstance(expression, into)


def _apply_builder(
    expression,
    instance,
    arg,
    copy=True,
    prefix=None,
    into=None,
    dialect=None,
    into_arg="this",
    **opts,
):
    if _is_wrong_expression(expression, into):
        expression = into(**{into_arg: expression})
    instance = maybe_copy(instance, copy)
    expression = maybe_parse(
        sql_or_expression=expression,
        prefix=prefix,
        into=into,
        dialect=dialect,
        **opts,
    )
    instance.set(arg, expression)
    return instance


def _apply_child_list_builder(
    *expressions,
    instance,
    arg,
    append=True,
    copy=True,
    prefix=None,
    into=None,
    dialect=None,
    properties=None,
    **opts,
):
    instance = maybe_copy(instance, copy)
    parsed = []
    properties = {} if properties is None else properties

    for expression in expressions:
        if expression is not None:
            if _is_wrong_expression(expression, into):
                expression = into(expressions=[expression])

            expression = maybe_parse(
                expression,
                into=into,
                dialect=dialect,
                prefix=prefix,
                **opts,
            )
            for k, v in expression.args.items():
                if k == "expressions":
                    parsed.extend(v)
                else:
                    properties[k] = v

    existing = instance.args.get(arg)
    if append and existing:
        parsed = existing.expressions + parsed

    child = into(expressions=parsed)
    for k, v in properties.items():
        child.set(k, v)
    instance.set(arg, child)

    return instance


def _apply_list_builder(
    *expressions,
    instance,
    arg,
    append=True,
    copy=True,
    prefix=None,
    into=None,
    dialect=None,
    **opts,
):
    inst = maybe_copy(instance, copy)

    expressions = [
        maybe_parse(
            sql_or_expression=expression,
            into=into,
            prefix=prefix,
            dialect=dialect,
            **opts,
        )
        for expression in expressions
        if expression is not None
    ]

    existing_expressions = inst.args.get(arg)
    if append and existing_expressions:
        expressions = existing_expressions + expressions

    inst.set(arg, expressions)
    return inst


def _apply_conjunction_builder(
    *expressions,
    instance,
    arg,
    into=None,
    append=True,
    copy=True,
    dialect=None,
    **opts,
):
    expressions = [exp for exp in expressions if exp is not None and exp != ""]
    if not expressions:
        return instance

    inst = maybe_copy(instance, copy)

    existing = inst.args.get(arg)
    if append and existing is not None:
        expressions = [existing.this if into else existing] + list(expressions)

    node = and_(*expressions, dialect=dialect, copy=copy, **opts)

    inst.set(arg, into(this=node) if into else node)
    return inst


def _apply_cte_builder(
    instance: E,
    alias: ExpOrStr,
    as_: ExpOrStr,
    recursive: t.Optional[bool] = None,
    materialized: t.Optional[bool] = None,
    append: bool = True,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> E:
    alias_expression = maybe_parse(alias, dialect=dialect, into=TableAlias, **opts)
    as_expression = maybe_parse(as_, dialect=dialect, **opts)
    cte = CTE(this=as_expression, alias=alias_expression, materialized=materialized)
    return _apply_child_list_builder(
        cte,
        instance=instance,
        arg="with",
        append=append,
        copy=copy,
        into=With,
        properties={"recursive": recursive or False},
    )


def _combine(
    expressions: t.Sequence[t.Optional[ExpOrStr]],
    operator: t.Type[Connector],
    dialect: DialectType = None,
    copy: bool = True,
    wrap: bool = True,
    **opts,
) -> Expression:
    conditions = [
        condition(expression, dialect=dialect, copy=copy, **opts)
        for expression in expressions
        if expression is not None
    ]

    this, *rest = conditions
    if rest and wrap:
        this = _wrap(this, Connector)
    for expression in rest:
        this = operator(this=this, expression=_wrap(expression, Connector) if wrap else expression)

    return this


@t.overload
def _wrap(expression: None, kind: t.Type[Expression]) -> None: ...


@t.overload
def _wrap(expression: E, kind: t.Type[Expression]) -> E | Paren: ...


def _wrap(expression: t.Optional[E], kind: t.Type[Expression]) -> t.Optional[E] | Paren:
    return Paren(this=expression) if isinstance(expression, kind) else expression


def _apply_set_operation(
    *expressions: ExpOrStr,
    set_operation: t.Type[S],
    distinct: bool = True,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> S:
    return reduce(
        lambda x, y: set_operation(this=x, expression=y, distinct=distinct),
        (maybe_parse(e, dialect=dialect, copy=copy, **opts) for e in expressions),
    )


def union(
    *expressions: ExpOrStr,
    distinct: bool = True,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> Union:
    """
    Initializes a syntax tree for the `UNION` operation.

    Example:
        >>> union("SELECT * FROM foo", "SELECT * FROM bla").sql()
        'SELECT * FROM foo UNION SELECT * FROM bla'

    Args:
        expressions: the SQL code strings, corresponding to the `UNION`'s operands.
            If `Expression` instances are passed, they will be used as-is.
        distinct: set the DISTINCT flag if and only if this is true.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy the expression.
        opts: other options to use to parse the input expressions.

    Returns:
        The new Union instance.
    """
    assert len(expressions) >= 2, "At least two expressions are required by `union`."
    return _apply_set_operation(
        *expressions, set_operation=Union, distinct=distinct, dialect=dialect, copy=copy, **opts
    )


def intersect(
    *expressions: ExpOrStr,
    distinct: bool = True,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> Intersect:
    """
    Initializes a syntax tree for the `INTERSECT` operation.

    Example:
        >>> intersect("SELECT * FROM foo", "SELECT * FROM bla").sql()
        'SELECT * FROM foo INTERSECT SELECT * FROM bla'

    Args:
        expressions: the SQL code strings, corresponding to the `INTERSECT`'s operands.
            If `Expression` instances are passed, they will be used as-is.
        distinct: set the DISTINCT flag if and only if this is true.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy the expression.
        opts: other options to use to parse the input expressions.

    Returns:
        The new Intersect instance.
    """
    assert len(expressions) >= 2, "At least two expressions are required by `intersect`."
    return _apply_set_operation(
        *expressions, set_operation=Intersect, distinct=distinct, dialect=dialect, copy=copy, **opts
    )


def except_(
    *expressions: ExpOrStr,
    distinct: bool = True,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> Except:
    """
    Initializes a syntax tree for the `EXCEPT` operation.

    Example:
        >>> except_("SELECT * FROM foo", "SELECT * FROM bla").sql()
        'SELECT * FROM foo EXCEPT SELECT * FROM bla'

    Args:
        expressions: the SQL code strings, corresponding to the `EXCEPT`'s operands.
            If `Expression` instances are passed, they will be used as-is.
        distinct: set the DISTINCT flag if and only if this is true.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy the expression.
        opts: other options to use to parse the input expressions.

    Returns:
        The new Except instance.
    """
    assert len(expressions) >= 2, "At least two expressions are required by `except_`."
    return _apply_set_operation(
        *expressions, set_operation=Except, distinct=distinct, dialect=dialect, copy=copy, **opts
    )


def select(*expressions: ExpOrStr, dialect: DialectType = None, **opts) -> Select:
    """
    Initializes a syntax tree from one or multiple SELECT expressions.

    Example:
        >>> select("col1", "col2").from_("tbl").sql()
        'SELECT col1, col2 FROM tbl'

    Args:
        *expressions: the SQL code string to parse as the expressions of a
            SELECT statement. If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expressions (in the case that an
            input expression is a SQL string).
        **opts: other options to use to parse the input expressions (again, in the case
            that an input expression is a SQL string).

    Returns:
        Select: the syntax tree for the SELECT statement.
    """
    return Select().select(*expressions, dialect=dialect, **opts)


def from_(expression: ExpOrStr, dialect: DialectType = None, **opts) -> Select:
    """
    Initializes a syntax tree from a FROM expression.

    Example:
        >>> from_("tbl").select("col1", "col2").sql()
        'SELECT col1, col2 FROM tbl'

    Args:
        *expression: the SQL code string to parse as the FROM expressions of a
            SELECT statement. If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression (in the case that the
            input expression is a SQL string).
        **opts: other options to use to parse the input expressions (again, in the case
            that the input expression is a SQL string).

    Returns:
        Select: the syntax tree for the SELECT statement.
    """
    return Select().from_(expression, dialect=dialect, **opts)


def update(
    table: str | Table,
    properties: t.Optional[dict] = None,
    where: t.Optional[ExpOrStr] = None,
    from_: t.Optional[ExpOrStr] = None,
    with_: t.Optional[t.Dict[str, ExpOrStr]] = None,
    dialect: DialectType = None,
    **opts,
) -> Update:
    """
    Creates an update statement.

    Example:
        >>> update("my_table", {"x": 1, "y": "2", "z": None}, from_="baz_cte", where="baz_cte.id > 1 and my_table.id = baz_cte.id", with_={"baz_cte": "SELECT id FROM foo"}).sql()
        "WITH baz_cte AS (SELECT id FROM foo) UPDATE my_table SET x = 1, y = '2', z = NULL FROM baz_cte WHERE baz_cte.id > 1 AND my_table.id = baz_cte.id"

    Args:
        properties: dictionary of properties to SET which are
            auto converted to sql objects eg None -> NULL
        where: sql conditional parsed into a WHERE statement
        from_: sql statement parsed into a FROM statement
        with_: dictionary of CTE aliases / select statements to include in a WITH clause.
        dialect: the dialect used to parse the input expressions.
        **opts: other options to use to parse the input expressions.

    Returns:
        Update: the syntax tree for the UPDATE statement.
    """
    update_expr = Update(this=maybe_parse(table, into=Table, dialect=dialect))
    if properties:
        update_expr.set(
            "expressions",
            [
                EQ(this=maybe_parse(k, dialect=dialect, **opts), expression=convert(v))
                for k, v in properties.items()
            ],
        )
    if from_:
        update_expr.set(
            "from",
            maybe_parse(from_, into=From, dialect=dialect, prefix="FROM", **opts),
        )
    if isinstance(where, Condition):
        where = Where(this=where)
    if where:
        update_expr.set(
            "where",
            maybe_parse(where, into=Where, dialect=dialect, prefix="WHERE", **opts),
        )
    if with_:
        cte_list = [
            alias_(CTE(this=maybe_parse(qry, dialect=dialect, **opts)), alias, table=True)
            for alias, qry in with_.items()
        ]
        update_expr.set(
            "with",
            With(expressions=cte_list),
        )
    return update_expr


def delete(
    table: ExpOrStr,
    where: t.Optional[ExpOrStr] = None,
    returning: t.Optional[ExpOrStr] = None,
    dialect: DialectType = None,
    **opts,
) -> Delete:
    """
    Builds a delete statement.

    Example:
        >>> delete("my_table", where="id > 1").sql()
        'DELETE FROM my_table WHERE id > 1'

    Args:
        where: sql conditional parsed into a WHERE statement
        returning: sql conditional parsed into a RETURNING statement
        dialect: the dialect used to parse the input expressions.
        **opts: other options to use to parse the input expressions.

    Returns:
        Delete: the syntax tree for the DELETE statement.
    """
    delete_expr = Delete().delete(table, dialect=dialect, copy=False, **opts)
    if where:
        delete_expr = delete_expr.where(where, dialect=dialect, copy=False, **opts)
    if returning:
        delete_expr = delete_expr.returning(returning, dialect=dialect, copy=False, **opts)
    return delete_expr


def insert(
    expression: ExpOrStr,
    into: ExpOrStr,
    columns: t.Optional[t.Sequence[str | Identifier]] = None,
    overwrite: t.Optional[bool] = None,
    returning: t.Optional[ExpOrStr] = None,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> Insert:
    """
    Builds an INSERT statement.

    Example:
        >>> insert("VALUES (1, 2, 3)", "tbl").sql()
        'INSERT INTO tbl VALUES (1, 2, 3)'

    Args:
        expression: the sql string or expression of the INSERT statement
        into: the tbl to insert data to.
        columns: optionally the table's column names.
        overwrite: whether to INSERT OVERWRITE or not.
        returning: sql conditional parsed into a RETURNING statement
        dialect: the dialect used to parse the input expressions.
        copy: whether to copy the expression.
        **opts: other options to use to parse the input expressions.

    Returns:
        Insert: the syntax tree for the INSERT statement.
    """
    expr = maybe_parse(expression, dialect=dialect, copy=copy, **opts)
    this: Table | Schema = maybe_parse(into, into=Table, dialect=dialect, copy=copy, **opts)

    if columns:
        this = Schema(this=this, expressions=[to_identifier(c, copy=copy) for c in columns])

    insert = Insert(this=this, expression=expr, overwrite=overwrite)

    if returning:
        insert = insert.returning(returning, dialect=dialect, copy=False, **opts)

    return insert


def merge(
    *when_exprs: ExpOrStr,
    into: ExpOrStr,
    using: ExpOrStr,
    on: ExpOrStr,
    returning: t.Optional[ExpOrStr] = None,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
) -> Merge:
    """
    Builds a MERGE statement.

    Example:
        >>> merge("WHEN MATCHED THEN UPDATE SET col1 = source_table.col1",
        ...       "WHEN NOT MATCHED THEN INSERT (col1) VALUES (source_table.col1)",
        ...       into="my_table",
        ...       using="source_table",
        ...       on="my_table.id = source_table.id").sql()
        'MERGE INTO my_table USING source_table ON my_table.id = source_table.id WHEN MATCHED THEN UPDATE SET col1 = source_table.col1 WHEN NOT MATCHED THEN INSERT (col1) VALUES (source_table.col1)'

    Args:
        *when_exprs: The WHEN clauses specifying actions for matched and unmatched rows.
        into: The target table to merge data into.
        using: The source table to merge data from.
        on: The join condition for the merge.
        returning: The columns to return from the merge.
        dialect: The dialect used to parse the input expressions.
        copy: Whether to copy the expression.
        **opts: Other options to use to parse the input expressions.

    Returns:
        Merge: The syntax tree for the MERGE statement.
    """
    merge = Merge(
        this=maybe_parse(into, dialect=dialect, copy=copy, **opts),
        using=maybe_parse(using, dialect=dialect, copy=copy, **opts),
        on=maybe_parse(on, dialect=dialect, copy=copy, **opts),
        expressions=[
            maybe_parse(when_expr, dialect=dialect, copy=copy, into=When, **opts)
            for when_expr in when_exprs
        ],
    )
    if returning:
        merge = merge.returning(returning, dialect=dialect, copy=False, **opts)

    return merge


def condition(
    expression: ExpOrStr, dialect: DialectType = None, copy: bool = True, **opts
) -> Condition:
    """
    Initialize a logical condition expression.

    Example:
        >>> condition("x=1").sql()
        'x = 1'

        This is helpful for composing larger logical syntax trees:
        >>> where = condition("x=1")
        >>> where = where.and_("y=1")
        >>> Select().from_("tbl").select("*").where(where).sql()
        'SELECT * FROM tbl WHERE x = 1 AND y = 1'

    Args:
        *expression: the SQL code string to parse.
            If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression (in the case that the
            input expression is a SQL string).
        copy: Whether to copy `expression` (only applies to expressions).
        **opts: other options to use to parse the input expressions (again, in the case
            that the input expression is a SQL string).

    Returns:
        The new Condition instance
    """
    return maybe_parse(
        expression,
        into=Condition,
        dialect=dialect,
        copy=copy,
        **opts,
    )


def and_(
    *expressions: t.Optional[ExpOrStr],
    dialect: DialectType = None,
    copy: bool = True,
    wrap: bool = True,
    **opts,
) -> Condition:
    """
    Combine multiple conditions with an AND logical operator.

    Example:
        >>> and_("x=1", and_("y=1", "z=1")).sql()
        'x = 1 AND (y = 1 AND z = 1)'

    Args:
        *expressions: the SQL code strings to parse.
            If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy `expressions` (only applies to Expressions).
        wrap: whether to wrap the operands in `Paren`s. This is true by default to avoid
            precedence issues, but can be turned off when the produced AST is too deep and
            causes recursion-related issues.
        **opts: other options to use to parse the input expressions.

    Returns:
        The new condition
    """
    return t.cast(Condition, _combine(expressions, And, dialect, copy=copy, wrap=wrap, **opts))


def or_(
    *expressions: t.Optional[ExpOrStr],
    dialect: DialectType = None,
    copy: bool = True,
    wrap: bool = True,
    **opts,
) -> Condition:
    """
    Combine multiple conditions with an OR logical operator.

    Example:
        >>> or_("x=1", or_("y=1", "z=1")).sql()
        'x = 1 OR (y = 1 OR z = 1)'

    Args:
        *expressions: the SQL code strings to parse.
            If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy `expressions` (only applies to Expressions).
        wrap: whether to wrap the operands in `Paren`s. This is true by default to avoid
            precedence issues, but can be turned off when the produced AST is too deep and
            causes recursion-related issues.
        **opts: other options to use to parse the input expressions.

    Returns:
        The new condition
    """
    return t.cast(Condition, _combine(expressions, Or, dialect, copy=copy, wrap=wrap, **opts))


def xor(
    *expressions: t.Optional[ExpOrStr],
    dialect: DialectType = None,
    copy: bool = True,
    wrap: bool = True,
    **opts,
) -> Condition:
    """
    Combine multiple conditions with an XOR logical operator.

    Example:
        >>> xor("x=1", xor("y=1", "z=1")).sql()
        'x = 1 XOR (y = 1 XOR z = 1)'

    Args:
        *expressions: the SQL code strings to parse.
            If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy `expressions` (only applies to Expressions).
        wrap: whether to wrap the operands in `Paren`s. This is true by default to avoid
            precedence issues, but can be turned off when the produced AST is too deep and
            causes recursion-related issues.
        **opts: other options to use to parse the input expressions.

    Returns:
        The new condition
    """
    return t.cast(Condition, _combine(expressions, Xor, dialect, copy=copy, wrap=wrap, **opts))


def not_(expression: ExpOrStr, dialect: DialectType = None, copy: bool = True, **opts) -> Not:
    """
    Wrap a condition with a NOT operator.

    Example:
        >>> not_("this_suit='black'").sql()
        "NOT this_suit = 'black'"

    Args:
        expression: the SQL code string to parse.
            If an Expression instance is passed, this is used as-is.
        dialect: the dialect used to parse the input expression.
        copy: whether to copy the expression or not.
        **opts: other options to use to parse the input expressions.

    Returns:
        The new condition.
    """
    this = condition(
        expression,
        dialect=dialect,
        copy=copy,
        **opts,
    )
    return Not(this=_wrap(this, Connector))


def paren(expression: ExpOrStr, copy: bool = True) -> Paren:
    """
    Wrap an expression in parentheses.

    Example:
        >>> paren("5 + 3").sql()
        '(5 + 3)'

    Args:
        expression: the SQL code string to parse.
            If an Expression instance is passed, this is used as-is.
        copy: whether to copy the expression or not.

    Returns:
        The wrapped expression.
    """
    return Paren(this=maybe_parse(expression, copy=copy))


SAFE_IDENTIFIER_RE: t.Pattern[str] = re.compile(r"^[_a-zA-Z][\w]*$")


@t.overload
def to_identifier(name: None, quoted: t.Optional[bool] = None, copy: bool = True) -> None: ...


@t.overload
def to_identifier(
    name: str | Identifier, quoted: t.Optional[bool] = None, copy: bool = True
) -> Identifier: ...


def to_identifier(name, quoted=None, copy=True):
    """Builds an identifier.

    Args:
        name: The name to turn into an identifier.
        quoted: Whether to force quote the identifier.
        copy: Whether to copy name if it's an Identifier.

    Returns:
        The identifier ast node.
    """

    if name is None:
        return None

    if isinstance(name, Identifier):
        identifier = maybe_copy(name, copy)
    elif isinstance(name, str):
        identifier = Identifier(
            this=name,
            quoted=not SAFE_IDENTIFIER_RE.match(name) if quoted is None else quoted,
        )
    else:
        raise ValueError(f"Name needs to be a string or an Identifier, got: {name.__class__}")
    return identifier


def parse_identifier(name: str | Identifier, dialect: DialectType = None) -> Identifier:
    """
    Parses a given string into an identifier.

    Args:
        name: The name to parse into an identifier.
        dialect: The dialect to parse against.

    Returns:
        The identifier ast node.
    """
    try:
        expression = maybe_parse(name, dialect=dialect, into=Identifier)
    except (ParseError, TokenError):
        expression = to_identifier(name)

    return expression


INTERVAL_STRING_RE = re.compile(r"\s*([0-9]+)\s*([a-zA-Z]+)\s*")


def to_interval(interval: str | Literal) -> Interval:
    """Builds an interval expression from a string like '1 day' or '5 months'."""
    if isinstance(interval, Literal):
        if not interval.is_string:
            raise ValueError("Invalid interval string.")

        interval = interval.this

    interval = maybe_parse(f"INTERVAL {interval}")
    assert isinstance(interval, Interval)
    return interval


def to_table(
    sql_path: str | Table, dialect: DialectType = None, copy: bool = True, **kwargs
) -> Table:
    """
    Create a table expression from a `[catalog].[schema].[table]` sql path. Catalog and schema are optional.
    If a table is passed in then that table is returned.

    Args:
        sql_path: a `[catalog].[schema].[table]` string.
        dialect: the source dialect according to which the table name will be parsed.
        copy: Whether to copy a table if it is passed in.
        kwargs: the kwargs to instantiate the resulting `Table` expression with.

    Returns:
        A table expression.
    """
    if isinstance(sql_path, Table):
        return maybe_copy(sql_path, copy=copy)

    table = maybe_parse(sql_path, into=Table, dialect=dialect)

    for k, v in kwargs.items():
        table.set(k, v)

    return table


def to_column(
    sql_path: str | Column,
    quoted: t.Optional[bool] = None,
    dialect: DialectType = None,
    copy: bool = True,
    **kwargs,
) -> Column:
    """
    Create a column from a `[table].[column]` sql path. Table is optional.
    If a column is passed in then that column is returned.

    Args:
        sql_path: a `[table].[column]` string.
        quoted: Whether or not to force quote identifiers.
        dialect: the source dialect according to which the column name will be parsed.
        copy: Whether to copy a column if it is passed in.
        kwargs: the kwargs to instantiate the resulting `Column` expression with.

    Returns:
        A column expression.
    """
    if isinstance(sql_path, Column):
        return maybe_copy(sql_path, copy=copy)

    try:
        col = maybe_parse(sql_path, into=Column, dialect=dialect)
    except ParseError:
        return column(*reversed(sql_path.split(".")), quoted=quoted, **kwargs)

    for k, v in kwargs.items():
        col.set(k, v)

    if quoted:
        for i in col.find_all(Identifier):
            i.set("quoted", True)

    return col


def alias_(
    expression: ExpOrStr,
    alias: t.Optional[str | Identifier],
    table: bool | t.Sequence[str | Identifier] = False,
    quoted: t.Optional[bool] = None,
    dialect: DialectType = None,
    copy: bool = True,
    **opts,
):
    """Create an Alias expression.

    Example:
        >>> alias_('foo', 'bar').sql()
        'foo AS bar'

        >>> alias_('(select 1, 2)', 'bar', table=['a', 'b']).sql()
        '(SELECT 1, 2) AS bar(a, b)'

    Args:
        expression: the SQL code strings to parse.
            If an Expression instance is passed, this is used as-is.
        alias: the alias name to use. If the name has
            special characters it is quoted.
        table: Whether to create a table alias, can also be a list of columns.
        quoted: whether to quote the alias
        dialect: the dialect used to parse the input expression.
        copy: Whether to copy the expression.
        **opts: other options to use to parse the input expressions.

    Returns:
        Alias: the aliased expression
    """
    exp = maybe_parse(expression, dialect=dialect, copy=copy, **opts)
    alias = to_identifier(alias, quoted=quoted)

    if table:
        table_alias = TableAlias(this=alias)
        exp.set("alias", table_alias)

        if not isinstance(table, bool):
            for column in table:
                table_alias.append("columns", to_identifier(column, quoted=quoted))

        return exp

    # We don't set the "alias" arg for Window expressions, because that would add an IDENTIFIER node in
    # the AST, representing a "named_window" [1] construct (eg. bigquery). What we want is an ALIAS node
    # for the complete Window expression.
    #
    # [1]: https://cloud.google.com/bigquery/docs/reference/standard-sql/window-function-calls

    if "alias" in exp.arg_types and not isinstance(exp, Window):
        exp.set("alias", alias)
        return exp
    return Alias(this=exp, alias=alias)


def subquery(
    expression: ExpOrStr,
    alias: t.Optional[Identifier | str] = None,
    dialect: DialectType = None,
    **opts,
) -> Select:
    """
    Build a subquery expression that's selected from.

    Example:
        >>> subquery('select x from tbl', 'bar').select('x').sql()
        'SELECT x FROM (SELECT x FROM tbl) AS bar'

    Args:
        expression: the SQL code strings to parse.
            If an Expression instance is passed, this is used as-is.
        alias: the alias name to use.
        dialect: the dialect used to parse the input expression.
        **opts: other options to use to parse the input expressions.

    Returns:
        A new Select instance with the subquery expression included.
    """

    expression = maybe_parse(expression, dialect=dialect, **opts).subquery(alias, **opts)
    return Select().from_(expression, dialect=dialect, **opts)


@t.overload
def column(
    col: str | Identifier,
    table: t.Optional[str | Identifier] = None,
    db: t.Optional[str | Identifier] = None,
    catalog: t.Optional[str | Identifier] = None,
    *,
    fields: t.Collection[t.Union[str, Identifier]],
    quoted: t.Optional[bool] = None,
    copy: bool = True,
) -> Dot:
    pass


@t.overload
def column(
    col: str | Identifier,
    table: t.Optional[str | Identifier] = None,
    db: t.Optional[str | Identifier] = None,
    catalog: t.Optional[str | Identifier] = None,
    *,
    fields: Lit[None] = None,
    quoted: t.Optional[bool] = None,
    copy: bool = True,
) -> Column:
    pass


def column(
    col,
    table=None,
    db=None,
    catalog=None,
    *,
    fields=None,
    quoted=None,
    copy=True,
):
    """
    Build a Column.

    Args:
        col: Column name.
        table: Table name.
        db: Database name.
        catalog: Catalog name.
        fields: Additional fields using dots.
        quoted: Whether to force quotes on the column's identifiers.
        copy: Whether to copy identifiers if passed in.

    Returns:
        The new Column instance.
    """
    this = Column(
        this=to_identifier(col, quoted=quoted, copy=copy),
        table=to_identifier(table, quoted=quoted, copy=copy),
        db=to_identifier(db, quoted=quoted, copy=copy),
        catalog=to_identifier(catalog, quoted=quoted, copy=copy),
    )

    if fields:
        this = Dot.build(
            (this, *(to_identifier(field, quoted=quoted, copy=copy) for field in fields))
        )
    return this


def cast(
    expression: ExpOrStr, to: DATA_TYPE, copy: bool = True, dialect: DialectType = None, **opts
) -> Cast:
    """Cast an expression to a data type.

    Example:
        >>> cast('x + 1', 'int').sql()
        'CAST(x + 1 AS INT)'

    Args:
        expression: The expression to cast.
        to: The datatype to cast to.
        copy: Whether to copy the supplied expressions.
        dialect: The target dialect. This is used to prevent a re-cast in the following scenario:
            - The expression to be cast is already a exp.Cast expression
            - The existing cast is to a type that is logically equivalent to new type

            For example, if :expression='CAST(x as DATETIME)' and :to=Type.TIMESTAMP,
            but in the target dialect DATETIME is mapped to TIMESTAMP, then we will NOT return `CAST(x (as DATETIME) as TIMESTAMP)`
            and instead just return the original expression `CAST(x as DATETIME)`.

            This is to prevent it being output as a double cast `CAST(x (as TIMESTAMP) as TIMESTAMP)` once the DATETIME -> TIMESTAMP
            mapping is applied in the target dialect generator.

    Returns:
        The new Cast instance.
    """
    expr = maybe_parse(expression, copy=copy, dialect=dialect, **opts)
    data_type = DataType.build(to, copy=copy, dialect=dialect, **opts)

    # dont re-cast if the expression is already a cast to the correct type
    if isinstance(expr, Cast):
        from sqlglot.dialects.dialect import Dialect

        target_dialect = Dialect.get_or_raise(dialect)
        type_mapping = target_dialect.generator_class.TYPE_MAPPING

        existing_cast_type: DataType.Type = expr.to.this
        new_cast_type: DataType.Type = data_type.this
        types_are_equivalent = type_mapping.get(
            existing_cast_type, existing_cast_type.value
        ) == type_mapping.get(new_cast_type, new_cast_type.value)

        if expr.is_type(data_type) or types_are_equivalent:
            return expr

    expr = Cast(this=expr, to=data_type)
    expr.type = data_type

    return expr


def table_(
    table: Identifier | str,
    db: t.Optional[Identifier | str] = None,
    catalog: t.Optional[Identifier | str] = None,
    quoted: t.Optional[bool] = None,
    alias: t.Optional[Identifier | str] = None,
) -> Table:
    """Build a Table.

    Args:
        table: Table name.
        db: Database name.
        catalog: Catalog name.
        quote: Whether to force quotes on the table's identifiers.
        alias: Table's alias.

    Returns:
        The new Table instance.
    """
    return Table(
        this=to_identifier(table, quoted=quoted) if table else None,
        db=to_identifier(db, quoted=quoted) if db else None,
        catalog=to_identifier(catalog, quoted=quoted) if catalog else None,
        alias=TableAlias(this=to_identifier(alias)) if alias else None,
    )


def values(
    values: t.Iterable[t.Tuple[t.Any, ...]],
    alias: t.Optional[str] = None,
    columns: t.Optional[t.Iterable[str] | t.Dict[str, DataType]] = None,
) -> Values:
    """Build VALUES statement.

    Example:
        >>> values([(1, '2')]).sql()
        "VALUES (1, '2')"

    Args:
        values: values statements that will be converted to SQL
        alias: optional alias
        columns: Optional list of ordered column names or ordered dictionary of column names to types.
         If either are provided then an alias is also required.

    Returns:
        Values: the Values expression object
    """
    if columns and not alias:
        raise ValueError("Alias is required when providing columns")

    return Values(
        expressions=[convert(tup) for tup in values],
        alias=(
            TableAlias(this=to_identifier(alias), columns=[to_identifier(x) for x in columns])
            if columns
            else (TableAlias(this=to_identifier(alias)) if alias else None)
        ),
    )


def var(name: t.Optional[ExpOrStr]) -> Var:
    """Build a SQL variable.

    Example:
        >>> repr(var('x'))
        'Var(this=x)'

        >>> repr(var(column('x', table='y')))
        'Var(this=x)'

    Args:
        name: The name of the var or an expression who's name will become the var.

    Returns:
        The new variable node.
    """
    if not name:
        raise ValueError("Cannot convert empty name into var.")

    if isinstance(name, Expression):
        name = name.name
    return Var(this=name)


def rename_table(
    old_name: str | Table,
    new_name: str | Table,
    dialect: DialectType = None,
) -> Alter:
    """Build ALTER TABLE... RENAME... expression

    Args:
        old_name: The old name of the table
        new_name: The new name of the table
        dialect: The dialect to parse the table.

    Returns:
        Alter table expression
    """
    old_table = to_table(old_name, dialect=dialect)
    new_table = to_table(new_name, dialect=dialect)
    return Alter(
        this=old_table,
        kind="TABLE",
        actions=[
            AlterRename(this=new_table),
        ],
    )


def rename_column(
    table_name: str | Table,
    old_column_name: str | Column,
    new_column_name: str | Column,
    exists: t.Optional[bool] = None,
    dialect: DialectType = None,
) -> Alter:
    """Build ALTER TABLE... RENAME COLUMN... expression

    Args:
        table_name: Name of the table
        old_column: The old name of the column
        new_column: The new name of the column
        exists: Whether to add the `IF EXISTS` clause
        dialect: The dialect to parse the table/column.

    Returns:
        Alter table expression
    """
    table = to_table(table_name, dialect=dialect)
    old_column = to_column(old_column_name, dialect=dialect)
    new_column = to_column(new_column_name, dialect=dialect)
    return Alter(
        this=table,
        kind="TABLE",
        actions=[
            RenameColumn(this=old_column, to=new_column, exists=exists),
        ],
    )


def convert(value: t.Any, copy: bool = False) -> Expression:
    """Convert a python value into an expression object.

    Raises an error if a conversion is not possible.

    Args:
        value: A python object.
        copy: Whether to copy `value` (only applies to Expressions and collections).

    Returns:
        The equivalent expression object.
    """
    if isinstance(value, Expression):
        return maybe_copy(value, copy)
    if isinstance(value, str):
        return Literal.string(value)
    if isinstance(value, bool):
        return Boolean(this=value)
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return null()
    if isinstance(value, numbers.Number):
        return Literal.number(value)
    if isinstance(value, bytes):
        return HexString(this=value.hex())
    if isinstance(value, datetime.datetime):
        datetime_literal = Literal.string(value.isoformat(sep=" "))

        tz = None
        if value.tzinfo:
            # this works for zoneinfo.ZoneInfo, pytz.timezone and datetime.datetime.utc to return IANA timezone names like "America/Los_Angeles"
            # instead of abbreviations like "PDT". This is for consistency with other timezone handling functions in SQLGlot
            tz = Literal.string(str(value.tzinfo))

        return TimeStrToTime(this=datetime_literal, zone=tz)
    if isinstance(value, datetime.date):
        date_literal = Literal.string(value.strftime("%Y-%m-%d"))
        return DateStrToDate(this=date_literal)
    if isinstance(value, tuple):
        if hasattr(value, "_fields"):
            return Struct(
                expressions=[
                    PropertyEQ(
                        this=to_identifier(k), expression=convert(getattr(value, k), copy=copy)
                    )
                    for k in value._fields
                ]
            )
        return Tuple(expressions=[convert(v, copy=copy) for v in value])
    if isinstance(value, list):
        return Array(expressions=[convert(v, copy=copy) for v in value])
    if isinstance(value, dict):
        return Map(
            keys=Array(expressions=[convert(k, copy=copy) for k in value]),
            values=Array(expressions=[convert(v, copy=copy) for v in value.values()]),
        )
    if hasattr(value, "__dict__"):
        return Struct(
            expressions=[
                PropertyEQ(this=to_identifier(k), expression=convert(v, copy=copy))
                for k, v in value.__dict__.items()
            ]
        )
    raise ValueError(f"Cannot convert {value}")


def replace_children(expression: Expression, fun: t.Callable, *args, **kwargs) -> None:
    """
    Replace children of an expression with the result of a lambda fun(child) -> exp.
    """
    for k, v in tuple(expression.args.items()):
        is_list_arg = type(v) is list

        child_nodes = v if is_list_arg else [v]
        new_child_nodes = []

        for cn in child_nodes:
            if isinstance(cn, Expression):
                for child_node in ensure_collection(fun(cn, *args, **kwargs)):
                    new_child_nodes.append(child_node)
            else:
                new_child_nodes.append(cn)

        expression.set(k, new_child_nodes if is_list_arg else seq_get(new_child_nodes, 0))


def replace_tree(
    expression: Expression,
    fun: t.Callable,
    prune: t.Optional[t.Callable[[Expression], bool]] = None,
) -> Expression:
    """
    Replace an entire tree with the result of function calls on each node.

    This will be traversed in reverse dfs, so leaves first.
    If new nodes are created as a result of function calls, they will also be traversed.
    """
    stack = list(expression.dfs(prune=prune))

    while stack:
        node = stack.pop()
        new_node = fun(node)

        if new_node is not node:
            node.replace(new_node)

            if isinstance(new_node, Expression):
                stack.append(new_node)

    return new_node


def column_table_names(expression: Expression, exclude: str = "") -> t.Set[str]:
    """
    Return all table names referenced through columns in an expression.

    Example:
        >>> import sqlglot
        >>> sorted(column_table_names(sqlglot.parse_one("a.b AND c.d AND c.e")))
        ['a', 'c']

    Args:
        expression: expression to find table names.
        exclude: a table name to exclude

    Returns:
        A list of unique names.
    """
    return {
        table
        for table in (column.table for column in expression.find_all(Column))
        if table and table != exclude
    }


def table_name(table: Table | str, dialect: DialectType = None, identify: bool = False) -> str:
    """Get the full name of a table as a string.

    Args:
        table: Table expression node or string.
        dialect: The dialect to generate the table name for.
        identify: Determines when an identifier should be quoted. Possible values are:
            False (default): Never quote, except in cases where it's mandatory by the dialect.
            True: Always quote.

    Examples:
        >>> from sqlglot import exp, parse_one
        >>> table_name(parse_one("select * from a.b.c").find(exp.Table))
        'a.b.c'

    Returns:
        The table name.
    """

    table = maybe_parse(table, into=Table, dialect=dialect)

    if not table:
        raise ValueError(f"Cannot parse {table}")

    return ".".join(
        (
            part.sql(dialect=dialect, identify=True, copy=False, comments=False)
            if identify or not SAFE_IDENTIFIER_RE.match(part.name)
            else part.name
        )
        for part in table.parts
    )


def normalize_table_name(table: str | Table, dialect: DialectType = None, copy: bool = True) -> str:
    """Returns a case normalized table name without quotes.

    Args:
        table: the table to normalize
        dialect: the dialect to use for normalization rules
        copy: whether to copy the expression.

    Examples:
        >>> normalize_table_name("`A-B`.c", dialect="bigquery")
        'A-B.c'
    """
    from sqlglot.optimizer.normalize_identifiers import normalize_identifiers

    return ".".join(
        p.name
        for p in normalize_identifiers(
            to_table(table, dialect=dialect, copy=copy), dialect=dialect
        ).parts
    )


def replace_tables(
    expression: E, mapping: t.Dict[str, str], dialect: DialectType = None, copy: bool = True
) -> E:
    """Replace all tables in expression according to the mapping.

    Args:
        expression: expression node to be transformed and replaced.
        mapping: mapping of table names.
        dialect: the dialect of the mapping table
        copy: whether to copy the expression.

    Examples:
        >>> from sqlglot import exp, parse_one
        >>> replace_tables(parse_one("select * from a.b"), {"a.b": "c"}).sql()
        'SELECT * FROM c /* a.b */'

    Returns:
        The mapped expression.
    """

    mapping = {normalize_table_name(k, dialect=dialect): v for k, v in mapping.items()}

    def _replace_tables(node: Expression) -> Expression:
        if isinstance(node, Table) and node.meta.get("replace") is not False:
            original = normalize_table_name(node, dialect=dialect)
            new_name = mapping.get(original)

            if new_name:
                table = to_table(
                    new_name,
                    **{k: v for k, v in node.args.items() if k not in TABLE_PARTS},
                    dialect=dialect,
                )
                table.add_comments([original])
                return table
        return node

    return expression.transform(_replace_tables, copy=copy)  # type: ignore


def replace_placeholders(expression: Expression, *args, **kwargs) -> Expression:
    """Replace placeholders in an expression.

    Args:
        expression: expression node to be transformed and replaced.
        args: positional names that will substitute unnamed placeholders in the given order.
        kwargs: keyword arguments that will substitute named placeholders.

    Examples:
        >>> from sqlglot import exp, parse_one
        >>> replace_placeholders(
        ...     parse_one("select * from :tbl where ? = ?"),
        ...     exp.to_identifier("str_col"), "b", tbl=exp.to_identifier("foo")
        ... ).sql()
        "SELECT * FROM foo WHERE str_col = 'b'"

    Returns:
        The mapped expression.
    """

    def _replace_placeholders(node: Expression, args, **kwargs) -> Expression:
        if isinstance(node, Placeholder):
            if node.this:
                new_name = kwargs.get(node.this)
                if new_name is not None:
                    return convert(new_name)
            else:
                try:
                    return convert(next(args))
                except StopIteration:
                    pass
        return node

    return expression.transform(_replace_placeholders, iter(args), **kwargs)


def expand(
    expression: Expression,
    sources: t.Dict[str, Query],
    dialect: DialectType = None,
    copy: bool = True,
) -> Expression:
    """Transforms an expression by expanding all referenced sources into subqueries.

    Examples:
        >>> from sqlglot import parse_one
        >>> expand(parse_one("select * from x AS z"), {"x": parse_one("select * from y")}).sql()
        'SELECT * FROM (SELECT * FROM y) AS z /* source: x */'

        >>> expand(parse_one("select * from x AS z"), {"x": parse_one("select * from y"), "y": parse_one("select * from z")}).sql()
        'SELECT * FROM (SELECT * FROM (SELECT * FROM z) AS y /* source: y */) AS z /* source: x */'

    Args:
        expression: The expression to expand.
        sources: A dictionary of name to Queries.
        dialect: The dialect of the sources dict.
        copy: Whether to copy the expression during transformation. Defaults to True.

    Returns:
        The transformed expression.
    """
    sources = {normalize_table_name(k, dialect=dialect): v for k, v in sources.items()}

    def _expand(node: Expression):
        if isinstance(node, Table):
            name = normalize_table_name(node, dialect=dialect)
            source = sources.get(name)
            if source:
                subquery = source.subquery(node.alias or name)
                subquery.comments = [f"source: {name}"]
                return subquery.transform(_expand, copy=False)
        return node

    return expression.transform(_expand, copy=copy)


def func(name: str, *args, copy: bool = True, dialect: DialectType = None, **kwargs) -> Func:
    """
    Returns a Func expression.

    Examples:
        >>> func("abs", 5).sql()
        'ABS(5)'

        >>> func("cast", this=5, to=DataType.build("DOUBLE")).sql()
        'CAST(5 AS DOUBLE)'

    Args:
        name: the name of the function to build.
        args: the args used to instantiate the function of interest.
        copy: whether to copy the argument expressions.
        dialect: the source dialect.
        kwargs: the kwargs used to instantiate the function of interest.

    Note:
        The arguments `args` and `kwargs` are mutually exclusive.

    Returns:
        An instance of the function of interest, or an anonymous function, if `name` doesn't
        correspond to an existing `sqlglot.expressions.Func` class.
    """
    if args and kwargs:
        raise ValueError("Can't use both args and kwargs to instantiate a function.")

    from sqlglot.dialects.dialect import Dialect

    dialect = Dialect.get_or_raise(dialect)

    converted: t.List[Expression] = [maybe_parse(arg, dialect=dialect, copy=copy) for arg in args]
    kwargs = {key: maybe_parse(value, dialect=dialect, copy=copy) for key, value in kwargs.items()}

    constructor = dialect.parser_class.FUNCTIONS.get(name.upper())
    if constructor:
        if converted:
            if "dialect" in constructor.__code__.co_varnames:
                function = constructor(converted, dialect=dialect)
            else:
                function = constructor(converted)
        elif constructor.__name__ == "from_arg_list":
            function = constructor.__self__(**kwargs)  # type: ignore
        else:
            constructor = FUNCTION_BY_NAME.get(name.upper())
            if constructor:
                function = constructor(**kwargs)
            else:
                raise ValueError(
                    f"Unable to convert '{name}' into a Func. Either manually construct "
                    "the Func expression of interest or parse the function call."
                )
    else:
        kwargs = kwargs or {"expressions": converted}
        function = Anonymous(this=name, **kwargs)

    for error_message in function.error_messages(converted):
        raise ValueError(error_message)

    return function


def case(
    expression: t.Optional[ExpOrStr] = None,
    **opts,
) -> Case:
    """
    Initialize a CASE statement.

    Example:
        case().when("a = 1", "foo").else_("bar")

    Args:
        expression: Optionally, the input expression (not all dialects support this)
        **opts: Extra keyword arguments for parsing `expression`
    """
    if expression is not None:
        this = maybe_parse(expression, **opts)
    else:
        this = None
    return Case(this=this, ifs=[])


def array(
    *expressions: ExpOrStr, copy: bool = True, dialect: DialectType = None, **kwargs
) -> Array:
    """
    Returns an array.

    Examples:
        >>> array(1, 'x').sql()
        'ARRAY(1, x)'

    Args:
        expressions: the expressions to add to the array.
        copy: whether to copy the argument expressions.
        dialect: the source dialect.
        kwargs: the kwargs used to instantiate the function of interest.

    Returns:
        An array expression.
    """
    return Array(
        expressions=[
            maybe_parse(expression, copy=copy, dialect=dialect, **kwargs)
            for expression in expressions
        ]
    )


def tuple_(
    *expressions: ExpOrStr, copy: bool = True, dialect: DialectType = None, **kwargs
) -> Tuple:
    """
    Returns an tuple.

    Examples:
        >>> tuple_(1, 'x').sql()
        '(1, x)'

    Args:
        expressions: the expressions to add to the tuple.
        copy: whether to copy the argument expressions.
        dialect: the source dialect.
        kwargs: the kwargs used to instantiate the function of interest.

    Returns:
        A tuple expression.
    """
    return Tuple(
        expressions=[
            maybe_parse(expression, copy=copy, dialect=dialect, **kwargs)
            for expression in expressions
        ]
    )


def true() -> Boolean:
    """
    Returns a true Boolean expression.
    """
    return Boolean(this=True)


def false() -> Boolean:
    """
    Returns a false Boolean expression.
    """
    return Boolean(this=False)


def null() -> Null:
    """
    Returns a Null expression.
    """
    return Null()


NONNULL_CONSTANTS = (
    Literal,
    Boolean,
)

CONSTANTS = (
    Literal,
    Boolean,
    Null,
)
