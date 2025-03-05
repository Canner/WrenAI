from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pyspark.sql import Column
    from typing_extensions import Self

    from narwhals._spark_like.expr import SparkLikeExpr


class SparkLikeExprStringNamespace:
    def __init__(self: Self, expr: SparkLikeExpr) -> None:
        self._compliant_expr = expr

    def len_chars(self: Self) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        return self._compliant_expr._from_call(
            F.char_length,
            "len",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def replace_all(
        self: Self, pattern: str, value: str, *, literal: bool = False
    ) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        def func(_input: Column, pattern: str, value: str, *, literal: bool) -> Column:
            replace_all_func = F.replace if literal else F.regexp_replace
            return replace_all_func(_input, F.lit(pattern), F.lit(value))

        return self._compliant_expr._from_call(
            func,
            "replace",
            pattern=pattern,
            value=value,
            literal=literal,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def strip_chars(self: Self, characters: str | None) -> SparkLikeExpr:
        import string

        from pyspark.sql import functions as F  # noqa: N812

        def func(_input: Column, characters: str | None) -> Column:
            to_remove = characters if characters is not None else string.whitespace
            return F.btrim(_input, F.lit(to_remove))

        return self._compliant_expr._from_call(
            func,
            "strip",
            characters=characters,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def starts_with(self: Self, prefix: str) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        return self._compliant_expr._from_call(
            lambda _input, prefix: F.startswith(_input, F.lit(prefix)),
            "starts_with",
            prefix=prefix,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def ends_with(self: Self, suffix: str) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        return self._compliant_expr._from_call(
            lambda _input, suffix: F.endswith(_input, F.lit(suffix)),
            "ends_with",
            suffix=suffix,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def contains(self: Self, pattern: str, *, literal: bool) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        def func(_input: Column, pattern: str, *, literal: bool) -> Column:
            contains_func = F.contains if literal else F.regexp
            return contains_func(_input, F.lit(pattern))

        return self._compliant_expr._from_call(
            func,
            "contains",
            pattern=pattern,
            literal=literal,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def slice(self: Self, offset: int, length: int | None = None) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        # From the docs: https://spark.apache.org/docs/latest/api/python/reference/pyspark.sql/api/pyspark.sql.functions.substring.html
        # The position is not zero based, but 1 based index.
        def func(_input: Column, offset: int, length: int | None) -> Column:
            col_length = F.char_length(_input)

            _offset = col_length + F.lit(offset + 1) if offset < 0 else F.lit(offset + 1)
            _length = F.lit(length) if length is not None else col_length
            return _input.substr(_offset, _length)

        return self._compliant_expr._from_call(
            func,
            "slice",
            offset=offset,
            length=length,
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_uppercase(self: Self) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        return self._compliant_expr._from_call(
            F.upper,
            "to_uppercase",
            returns_scalar=self._compliant_expr._returns_scalar,
        )

    def to_lowercase(self: Self) -> SparkLikeExpr:
        from pyspark.sql import functions as F  # noqa: N812

        return self._compliant_expr._from_call(
            F.lower,
            "to_lowercase",
            returns_scalar=self._compliant_expr._returns_scalar,
        )
