from __future__ import annotations

import typing as t

import sqlglot

if t.TYPE_CHECKING:
    from typing_extensions import Literal as Lit  # noqa

# A little hack for backwards compatibility with Python 3.7.
# For example, we might want a TypeVar for objects that support comparison e.g. SupportsRichComparisonT from typeshed.
# But Python 3.7 doesn't support Protocols, so we'd also need typing_extensions, which we don't want as a dependency.
A = t.TypeVar("A", bound=t.Any)
B = t.TypeVar("B", bound="sqlglot.exp.Binary")
E = t.TypeVar("E", bound="sqlglot.exp.Expression")
F = t.TypeVar("F", bound="sqlglot.exp.Func")
T = t.TypeVar("T")
