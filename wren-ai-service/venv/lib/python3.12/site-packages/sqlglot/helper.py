from __future__ import annotations

import datetime
import inspect
import logging
import re
import sys
import typing as t
from collections.abc import Collection, Set
from contextlib import contextmanager
from copy import copy
from enum import Enum
from itertools import count

if t.TYPE_CHECKING:
    from sqlglot import exp
    from sqlglot._typing import A, E, T
    from sqlglot.expressions import Expression


CAMEL_CASE_PATTERN = re.compile("(?<!^)(?=[A-Z])")
PYTHON_VERSION = sys.version_info[:2]
logger = logging.getLogger("sqlglot")


class AutoName(Enum):
    """
    This is used for creating Enum classes where `auto()` is the string form
    of the corresponding enum's identifier (e.g. FOO.value results in "FOO").

    Reference: https://docs.python.org/3/howto/enum.html#using-automatic-values
    """

    def _generate_next_value_(name, _start, _count, _last_values):
        return name


class classproperty(property):
    """
    Similar to a normal property but works for class methods
    """

    def __get__(self, obj: t.Any, owner: t.Any = None) -> t.Any:
        return classmethod(self.fget).__get__(None, owner)()  # type: ignore


def seq_get(seq: t.Sequence[T], index: int) -> t.Optional[T]:
    """Returns the value in `seq` at position `index`, or `None` if `index` is out of bounds."""
    try:
        return seq[index]
    except IndexError:
        return None


@t.overload
def ensure_list(value: t.Collection[T]) -> t.List[T]: ...


@t.overload
def ensure_list(value: None) -> t.List: ...


@t.overload
def ensure_list(value: T) -> t.List[T]: ...


def ensure_list(value):
    """
    Ensures that a value is a list, otherwise casts or wraps it into one.

    Args:
        value: The value of interest.

    Returns:
        The value cast as a list if it's a list or a tuple, or else the value wrapped in a list.
    """
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)

    return [value]


@t.overload
def ensure_collection(value: t.Collection[T]) -> t.Collection[T]: ...


@t.overload
def ensure_collection(value: T) -> t.Collection[T]: ...


def ensure_collection(value):
    """
    Ensures that a value is a collection (excluding `str` and `bytes`), otherwise wraps it into a list.

    Args:
        value: The value of interest.

    Returns:
        The value if it's a collection, or else the value wrapped in a list.
    """
    if value is None:
        return []
    return (
        value if isinstance(value, Collection) and not isinstance(value, (str, bytes)) else [value]
    )


def csv(*args: str, sep: str = ", ") -> str:
    """
    Formats any number of string arguments as CSV.

    Args:
        args: The string arguments to format.
        sep: The argument separator.

    Returns:
        The arguments formatted as a CSV string.
    """
    return sep.join(arg for arg in args if arg)


def subclasses(
    module_name: str,
    classes: t.Type | t.Tuple[t.Type, ...],
    exclude: t.Type | t.Tuple[t.Type, ...] = (),
) -> t.List[t.Type]:
    """
    Returns all subclasses for a collection of classes, possibly excluding some of them.

    Args:
        module_name: The name of the module to search for subclasses in.
        classes: Class(es) we want to find the subclasses of.
        exclude: Class(es) we want to exclude from the returned list.

    Returns:
        The target subclasses.
    """
    return [
        obj
        for _, obj in inspect.getmembers(
            sys.modules[module_name],
            lambda obj: inspect.isclass(obj) and issubclass(obj, classes) and obj not in exclude,
        )
    ]


def apply_index_offset(
    this: exp.Expression,
    expressions: t.List[E],
    offset: int,
) -> t.List[E]:
    """
    Applies an offset to a given integer literal expression.

    Args:
        this: The target of the index.
        expressions: The expression the offset will be applied to, wrapped in a list.
        offset: The offset that will be applied.

    Returns:
        The original expression with the offset applied to it, wrapped in a list. If the provided
        `expressions` argument contains more than one expression, it's returned unaffected.
    """
    if not offset or len(expressions) != 1:
        return expressions

    expression = expressions[0]

    from sqlglot import exp
    from sqlglot.optimizer.annotate_types import annotate_types
    from sqlglot.optimizer.simplify import simplify

    if not this.type:
        annotate_types(this)

    if t.cast(exp.DataType, this.type).this not in (
        exp.DataType.Type.UNKNOWN,
        exp.DataType.Type.ARRAY,
    ):
        return expressions

    if not expression.type:
        annotate_types(expression)

    if t.cast(exp.DataType, expression.type).this in exp.DataType.INTEGER_TYPES:
        logger.info("Applying array index offset (%s)", offset)
        expression = simplify(expression + offset)
        return [expression]

    return expressions


def camel_to_snake_case(name: str) -> str:
    """Converts `name` from camelCase to snake_case and returns the result."""
    return CAMEL_CASE_PATTERN.sub("_", name).upper()


def while_changing(expression: Expression, func: t.Callable[[Expression], E]) -> E:
    """
    Applies a transformation to a given expression until a fix point is reached.

    Args:
        expression: The expression to be transformed.
        func: The transformation to be applied.

    Returns:
        The transformed expression.
    """
    while True:
        for n in reversed(tuple(expression.walk())):
            n._hash = hash(n)

        start = hash(expression)
        expression = func(expression)

        for n in expression.walk():
            n._hash = None
        if start == hash(expression):
            break

    return expression


def tsort(dag: t.Dict[T, t.Set[T]]) -> t.List[T]:
    """
    Sorts a given directed acyclic graph in topological order.

    Args:
        dag: The graph to be sorted.

    Returns:
        A list that contains all of the graph's nodes in topological order.
    """
    result = []

    for node, deps in tuple(dag.items()):
        for dep in deps:
            if dep not in dag:
                dag[dep] = set()

    while dag:
        current = {node for node, deps in dag.items() if not deps}

        if not current:
            raise ValueError("Cycle error")

        for node in current:
            dag.pop(node)

        for deps in dag.values():
            deps -= current

        result.extend(sorted(current))  # type: ignore

    return result


def open_file(file_name: str) -> t.TextIO:
    """Open a file that may be compressed as gzip and return it in universal newline mode."""
    with open(file_name, "rb") as f:
        gzipped = f.read(2) == b"\x1f\x8b"

    if gzipped:
        import gzip

        return gzip.open(file_name, "rt", newline="")

    return open(file_name, encoding="utf-8", newline="")


@contextmanager
def csv_reader(read_csv: exp.ReadCSV) -> t.Any:
    """
    Returns a csv reader given the expression `READ_CSV(name, ['delimiter', '|', ...])`.

    Args:
        read_csv: A `ReadCSV` function call.

    Yields:
        A python csv reader.
    """
    args = read_csv.expressions
    file = open_file(read_csv.name)

    delimiter = ","
    args = iter(arg.name for arg in args)  # type: ignore
    for k, v in zip(args, args):
        if k == "delimiter":
            delimiter = v

    try:
        import csv as csv_

        yield csv_.reader(file, delimiter=delimiter)
    finally:
        file.close()


def find_new_name(taken: t.Collection[str], base: str) -> str:
    """
    Searches for a new name.

    Args:
        taken: A collection of taken names.
        base: Base name to alter.

    Returns:
        The new, available name.
    """
    if base not in taken:
        return base

    i = 2
    new = f"{base}_{i}"
    while new in taken:
        i += 1
        new = f"{base}_{i}"

    return new


def is_int(text: str) -> bool:
    return is_type(text, int)


def is_float(text: str) -> bool:
    return is_type(text, float)


def is_type(text: str, target_type: t.Type) -> bool:
    try:
        target_type(text)
        return True
    except ValueError:
        return False


def name_sequence(prefix: str) -> t.Callable[[], str]:
    """Returns a name generator given a prefix (e.g. a0, a1, a2, ... if the prefix is "a")."""
    sequence = count()
    return lambda: f"{prefix}{next(sequence)}"


def object_to_dict(obj: t.Any, **kwargs) -> t.Dict:
    """Returns a dictionary created from an object's attributes."""
    return {
        **{k: v.copy() if hasattr(v, "copy") else copy(v) for k, v in vars(obj).items()},
        **kwargs,
    }


def split_num_words(
    value: str, sep: str, min_num_words: int, fill_from_start: bool = True
) -> t.List[t.Optional[str]]:
    """
    Perform a split on a value and return N words as a result with `None` used for words that don't exist.

    Args:
        value: The value to be split.
        sep: The value to use to split on.
        min_num_words: The minimum number of words that are going to be in the result.
        fill_from_start: Indicates that if `None` values should be inserted at the start or end of the list.

    Examples:
        >>> split_num_words("db.table", ".", 3)
        [None, 'db', 'table']
        >>> split_num_words("db.table", ".", 3, fill_from_start=False)
        ['db', 'table', None]
        >>> split_num_words("db.table", ".", 1)
        ['db', 'table']

    Returns:
        The list of words returned by `split`, possibly augmented by a number of `None` values.
    """
    words = value.split(sep)
    if fill_from_start:
        return [None] * (min_num_words - len(words)) + words
    return words + [None] * (min_num_words - len(words))


def is_iterable(value: t.Any) -> bool:
    """
    Checks if the value is an iterable, excluding the types `str` and `bytes`.

    Examples:
        >>> is_iterable([1,2])
        True
        >>> is_iterable("test")
        False

    Args:
        value: The value to check if it is an iterable.

    Returns:
        A `bool` value indicating if it is an iterable.
    """
    from sqlglot import Expression

    return hasattr(value, "__iter__") and not isinstance(value, (str, bytes, Expression))


def flatten(values: t.Iterable[t.Iterable[t.Any] | t.Any]) -> t.Iterator[t.Any]:
    """
    Flattens an iterable that can contain both iterable and non-iterable elements. Objects of
    type `str` and `bytes` are not regarded as iterables.

    Examples:
        >>> list(flatten([[1, 2], 3, {4}, (5, "bla")]))
        [1, 2, 3, 4, 5, 'bla']
        >>> list(flatten([1, 2, 3]))
        [1, 2, 3]

    Args:
        values: The value to be flattened.

    Yields:
        Non-iterable elements in `values`.
    """
    for value in values:
        if is_iterable(value):
            yield from flatten(value)
        else:
            yield value


def dict_depth(d: t.Dict) -> int:
    """
    Get the nesting depth of a dictionary.

    Example:
        >>> dict_depth(None)
        0
        >>> dict_depth({})
        1
        >>> dict_depth({"a": "b"})
        1
        >>> dict_depth({"a": {}})
        2
        >>> dict_depth({"a": {"b": {}}})
        3
    """
    try:
        return 1 + dict_depth(next(iter(d.values())))
    except AttributeError:
        # d doesn't have attribute "values"
        return 0
    except StopIteration:
        # d.values() returns an empty sequence
        return 1


def first(it: t.Iterable[T]) -> T:
    """Returns the first element from an iterable (useful for sets)."""
    return next(i for i in it)


def to_bool(value: t.Optional[str | bool]) -> t.Optional[str | bool]:
    if isinstance(value, bool) or value is None:
        return value

    # Coerce the value to boolean if it matches to the truthy/falsy values below
    value_lower = value.lower()
    if value_lower in ("true", "1"):
        return True
    if value_lower in ("false", "0"):
        return False

    return value


def merge_ranges(ranges: t.List[t.Tuple[A, A]]) -> t.List[t.Tuple[A, A]]:
    """
    Merges a sequence of ranges, represented as tuples (low, high) whose values
    belong to some totally-ordered set.

    Example:
        >>> merge_ranges([(1, 3), (2, 6)])
        [(1, 6)]
    """
    if not ranges:
        return []

    ranges = sorted(ranges)

    merged = [ranges[0]]

    for start, end in ranges[1:]:
        last_start, last_end = merged[-1]

        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged


def is_iso_date(text: str) -> bool:
    try:
        datetime.date.fromisoformat(text)
        return True
    except ValueError:
        return False


def is_iso_datetime(text: str) -> bool:
    try:
        datetime.datetime.fromisoformat(text)
        return True
    except ValueError:
        return False


# Interval units that operate on date components
DATE_UNITS = {"day", "week", "month", "quarter", "year", "year_month"}


def is_date_unit(expression: t.Optional[exp.Expression]) -> bool:
    return expression is not None and expression.name.lower() in DATE_UNITS


K = t.TypeVar("K")
V = t.TypeVar("V")


class SingleValuedMapping(t.Mapping[K, V]):
    """
    Mapping where all keys return the same value.

    This rigamarole is meant to avoid copying keys, which was originally intended
    as an optimization while qualifying columns for tables with lots of columns.
    """

    def __init__(self, keys: t.Collection[K], value: V):
        self._keys = keys if isinstance(keys, Set) else set(keys)
        self._value = value

    def __getitem__(self, key: K) -> V:
        if key in self._keys:
            return self._value
        raise KeyError(key)

    def __len__(self) -> int:
        return len(self._keys)

    def __iter__(self) -> t.Iterator[K]:
        return iter(self._keys)
