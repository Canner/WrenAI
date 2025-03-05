from __future__ import annotations

import typing as t
from enum import auto

from sqlglot.helper import AutoName


class ErrorLevel(AutoName):
    IGNORE = auto()
    """Ignore all errors."""

    WARN = auto()
    """Log all errors."""

    RAISE = auto()
    """Collect all errors and raise a single exception."""

    IMMEDIATE = auto()
    """Immediately raise an exception on the first error found."""


class SqlglotError(Exception):
    pass


class UnsupportedError(SqlglotError):
    pass


class ParseError(SqlglotError):
    def __init__(
        self,
        message: str,
        errors: t.Optional[t.List[t.Dict[str, t.Any]]] = None,
    ):
        super().__init__(message)
        self.errors = errors or []

    @classmethod
    def new(
        cls,
        message: str,
        description: t.Optional[str] = None,
        line: t.Optional[int] = None,
        col: t.Optional[int] = None,
        start_context: t.Optional[str] = None,
        highlight: t.Optional[str] = None,
        end_context: t.Optional[str] = None,
        into_expression: t.Optional[str] = None,
    ) -> ParseError:
        return cls(
            message,
            [
                {
                    "description": description,
                    "line": line,
                    "col": col,
                    "start_context": start_context,
                    "highlight": highlight,
                    "end_context": end_context,
                    "into_expression": into_expression,
                }
            ],
        )


class TokenError(SqlglotError):
    pass


class OptimizeError(SqlglotError):
    pass


class SchemaError(SqlglotError):
    pass


class ExecuteError(SqlglotError):
    pass


def concat_messages(errors: t.Sequence[t.Any], maximum: int) -> str:
    msg = [str(e) for e in errors[:maximum]]
    remaining = len(errors) - maximum
    if remaining > 0:
        msg.append(f"... and {remaining} more")
    return "\n\n".join(msg)


def merge_errors(errors: t.Sequence[ParseError]) -> t.List[t.Dict[str, t.Any]]:
    return [e_dict for error in errors for e_dict in error.errors]
