"""Type aliases.

.. warning::

    This module is provisional. Types may be modified, added, and removed between minor releases.
"""

from __future__ import annotations

import typing

#: A type that can be either a sequence of strings or a set of strings
StrSequenceOrSet = typing.Union[typing.Sequence[str], typing.AbstractSet[str]]

#: Type for validator functions
Validator = typing.Callable[[typing.Any], typing.Any]
