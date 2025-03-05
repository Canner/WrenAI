"""
This module contains hashing functions for Python objects. It uses
functools.singledispatch to allow specialized implementations based on type.
Singledispatch automatically applies the most specific implementation

This module houses implementations for the Python standard library. Supporting
all types is considerable endeavor, so we'll add support as types are requested
by users.

Otherwise, 3rd party types can be supported via the `h_databackends` module.
This registers abstract types that can be checked without having to import the
3rd party library. For instance, there are implementations for pandas.DataFrame
and polars.DataFrame despite these libraries not being imported here.

IMPORTANT all container types that make a recursive call to `hash_value` or a specific
implementation should pass the `depth` parameter to prevent `RecursionError`.
"""

import base64
import datetime
import functools
import hashlib
import logging
import sys
from collections.abc import Mapping, Sequence, Set
from typing import Dict

from hamilton.experimental import h_databackends

# NoneType is introduced in Python 3.10
try:
    from types import NoneType
except ImportError:
    NoneType = type(None)


logger = logging.getLogger("hamilton.caching")


MAX_DEPTH = 6
UNHASHABLE = "<unhashable>"
NONE_HASH = "<none>"


def set_max_depth(depth: int) -> None:
    """Set the maximum recursion depth for fingerprinting non-supported types.

    :param depth: The maximum depth for fingerprinting.
    """
    global MAX_DEPTH
    MAX_DEPTH = depth


def _compact_hash(digest: bytes) -> str:
    """Compact the hash to a string that's safe to pass around.

    NOTE this is particularly relevant for the Hamilton UI and
    passing hashes/fingerprints through web services.
    """
    return base64.urlsafe_b64encode(digest).decode()


@functools.singledispatch
def hash_value(obj, *args, depth=0, **kwargs) -> str:
    """Fingerprinting strategy that computes a hash of the
    full Python object.

    The default case hashes the `__dict__` attribute of the
    object (recursive).
    """
    if depth > MAX_DEPTH:
        return UNHASHABLE

    # __dict__ attribute contains the instance attributes of the object.
    # this is typically sufficient to define the object and its behavior, so it's a good target
    # for a hash in the default case.
    # Objects that return an empty dict should be skipped (very odd behavior, happens with pandas type)
    if getattr(obj, "__dict__", {}) != {}:
        return hash_value(obj.__dict__, depth=depth + 1)

    # check if the object comes from a module part of the standard library
    # if it's the case, hash it's __repr__(), which is a string representation of the object
    # __repr__() from the standard library should be well-formed and offer a reliable basis
    # for fingerprinting.
    # for example, this will catch: pathlib.Path, enum.Enum, argparse.Namespace
    elif getattr(obj, "__module__", False):
        if obj.__module__.partition(".")[0] in sys.builtin_module_names:
            return hash_repr(obj, depth=depth)

    # cover the datetime module, which doesn't have a __module__ attribute
    elif type(obj) in vars(datetime).values():
        return hash_repr(obj, depth=depth)

    return UNHASHABLE


@hash_value.register(NoneType)
def hash_none(obj, *args, **kwargs) -> str:
    """Hash for None is <none>

    Primitive type returns a hash and doesn't have to handle depth.
    """
    return NONE_HASH


def hash_repr(obj, *args, **kwargs) -> str:
    """Use the built-in repr() to get a string representation of the object
    and hash it.

    While `.__repr__()` might not be implemented for all classes, the function
    `repr()` will handle it, along with exceptions, to always return a value.

    Primitive type returns a hash and doesn't have to handle depth.
    """
    return hash_primitive(repr(obj))


# we need to use explicit multiple registration because older Python
# versions don't support type annotations with Union types
@hash_value.register(str)
@hash_value.register(int)
@hash_value.register(float)
@hash_value.register(bool)
def hash_primitive(obj, *args, **kwargs) -> str:
    """Convert the primitive to a string and hash it

    Primitive type returns a hash and doesn't have to handle depth.
    """
    hash_object = hashlib.md5(str(obj).encode())
    return _compact_hash(hash_object.digest())


@hash_value.register(bytes)
def hash_bytes(obj, *args, **kwargs) -> str:
    """Convert the primitive to a string and hash it

    Primitive type returns a hash and doesn't have to handle depth.
    """
    hash_object = hashlib.md5(obj)
    return _compact_hash(hash_object.digest())


@hash_value.register(Sequence)
def hash_sequence(obj, *args, depth: int = 0, **kwargs) -> str:
    """Hash each object of the sequence.

    Orders matters for the hash since orders matters in a sequence.
    """
    hash_object = hashlib.sha224()
    for elem in obj:
        hash_object.update(hash_value(elem, depth=depth + 1).encode())

    return _compact_hash(hash_object.digest())


def hash_unordered_mapping(obj, *args, depth: int = 0, **kwargs) -> str:
    """

    When hashing an unordered mapping, the two following dict have the same hash.

    .. code-block:: python

        foo = {"key": 3, "key2": 13}
        bar = {"key2": 13, "key": 3}

        hash_mapping(foo) == hash_mapping(bar)
    """

    hashed_mapping: Dict[str, str] = {}
    for key, value in obj.items():
        hashed_mapping[hash_value(key, depth=depth + 1)] = hash_value(value, depth=depth + 1)

    hash_object = hashlib.sha224()
    for key, value in sorted(hashed_mapping.items()):
        hash_object.update(key.encode())
        hash_object.update(value.encode())

    return _compact_hash(hash_object.digest())


@hash_value.register(Mapping)
def hash_mapping(obj, *, ignore_order: bool = True, depth: int = 0, **kwargs) -> str:
    """Hash each key then its value.

    The mapping is always sorted first because order shouldn't matter
    in a mapping.

    NOTE Since Python 3.7, dictionary store insertion order. However, this
    function assumes that they key order doesn't matter to uniquely identify
    the dictionary.

    .. code-block:: python

        foo = {"key": 3, "key2": 13}
        bar = {"key2": 13, "key": 3}

        hash_mapping(foo) == hash_mapping(bar)

    """
    if ignore_order:
        # use the same depth because we're simply dispatching to another implementation
        return hash_unordered_mapping(obj, depth=depth)

    hash_object = hashlib.sha224()
    for key, value in obj.items():
        hash_object.update(hash_value(key, depth=depth + 1).encode())
        hash_object.update(hash_value(value, depth=depth + 1).encode())

    return _compact_hash(hash_object.digest())


@hash_value.register(Set)
def hash_set(obj, *args, depth: int = 0, **kwargs) -> str:
    """Hash each element of the set, then sort hashes, and
    create a hash of hashes.

    For the same objects in the set, the hashes will be the
    same.
    """
    hashes = [hash_value(elem, depth=depth + 1) for elem in obj]
    sorted_hashes = sorted(hashes)

    hash_object = hashlib.sha224()
    for hash in sorted_hashes:
        hash_object.update(hash.encode())

    return _compact_hash(hash_object.digest())


@hash_value.register(h_databackends.AbstractPandasDataFrame)
@hash_value.register(h_databackends.AbstractPandasColumn)
def hash_pandas_obj(obj, *args, depth: int = 0, **kwargs) -> str:
    """Convert a pandas dataframe, series, or index to
    a dictionary of {index: row_hash} then hash it.

    Given the hashing for mappings, the physical ordering or rows doesn't matter.
    For example, if the index is a date, the hash will represent the {date: row_hash},
    and won't preserve how dates were ordered in the DataFrame.
    """
    from pandas.util import hash_pandas_object

    hash_per_row = hash_pandas_object(obj)
    return hash_mapping(hash_per_row.to_dict(), ignore_order=False, depth=depth + 1)


@hash_value.register(h_databackends.AbstractPolarsDataFrame)
def hash_polars_dataframe(obj, *args, depth: int = 0, **kwargs) -> str:
    """Convert a polars dataframe, series, or index to
    a list of hashes then hash it.
    """
    hash_per_row = obj.hash_rows()
    return hash_sequence(hash_per_row.to_list(), depth=depth + 1)


@hash_value.register(h_databackends.AbstractPolarsColumn)
def hash_polars_column(obj, *args, depth: int = 0, **kwargs) -> str:
    """Promote the single Series to a dataframe and hash it"""
    # use the same depth because we're simply dispatching to another implementation
    return hash_polars_dataframe(obj.to_frame(), depth=depth)


@hash_value.register(h_databackends.AbstractNumpyArray)
def hash_numpy_array(obj, *args, depth: int = 0, **kwargs) -> str:
    """Get the bytes representation of the array raw data and hash it.

    Might not be ideal because different higher-level numpy objects could have
    the same underlying array representation (e.g., masked arrays).
    Unsure, but it's an area to investigate.
    """
    # use the same depth because we're simply dispatching to another implementation
    return hash_bytes(obj.tobytes(), depth=depth)
