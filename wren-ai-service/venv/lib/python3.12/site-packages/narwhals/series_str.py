from __future__ import annotations

from typing import TYPE_CHECKING
from typing import Any
from typing import Generic
from typing import TypeVar

if TYPE_CHECKING:
    from typing_extensions import Self

    from narwhals.series import Series

SeriesT = TypeVar("SeriesT", bound="Series[Any]")


class SeriesStringNamespace(Generic[SeriesT]):
    def __init__(self: Self, series: SeriesT) -> None:
        self._narwhals_series = series

    def len_chars(self: Self) -> SeriesT:
        r"""Return the length of each string as the number of characters.

        Returns:
            A new Series containing the length of each string in characters.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["foo", "Café", "345", "東京", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_len_chars(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.len_chars().to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_len_chars`:

            >>> agnostic_len_chars(s_pd)
            0    3.0
            1    4.0
            2    3.0
            3    2.0
            4    NaN
            dtype: float64

            >>> agnostic_len_chars(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (5,)
            Series: '' [u32]
            [
               3
               4
               3
               2
               null
            ]

            >>> agnostic_len_chars(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                3,
                4,
                3,
                2,
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.len_chars()
        )

    def replace(
        self: Self, pattern: str, value: str, *, literal: bool = False, n: int = 1
    ) -> SeriesT:
        r"""Replace first matching regex/literal substring with a new string value.

        Arguments:
            pattern: A valid regular expression pattern.
            value: String that will replace the matched substring.
            literal: Treat `pattern` as a literal string.
            n: Number of matches to replace.

        Returns:
            A new Series with the regex/literal pattern replaced with the specified value.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["123abc", "abc abc123"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_replace(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     s = s.str.replace("abc", "")
            ...     return s.to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_replace`:

            >>> agnostic_replace(s_pd)
            0        123
            1     abc123
            dtype: object

            >>> agnostic_replace(s_pl)  # doctest:+NORMALIZE_WHITESPACE
            shape: (2,)
            Series: '' [str]
            [
                "123"
                " abc123"
            ]

            >>> agnostic_replace(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "123",
                " abc123"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.replace(
                pattern, value, literal=literal, n=n
            )
        )

    def replace_all(
        self: Self, pattern: str, value: str, *, literal: bool = False
    ) -> SeriesT:
        r"""Replace all matching regex/literal substring with a new string value.

        Arguments:
            pattern: A valid regular expression pattern.
            value: String that will replace the matched substring.
            literal: Treat `pattern` as a literal string.

        Returns:
            A new Series with all occurrences of pattern replaced with the specified value.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["123abc", "abc abc123"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_replace_all(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     s = s.str.replace_all("abc", "")
            ...     return s.to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_replace_all`:

            >>> agnostic_replace_all(s_pd)
            0     123
            1     123
            dtype: object

            >>> agnostic_replace_all(s_pl)  # doctest:+NORMALIZE_WHITESPACE
            shape: (2,)
            Series: '' [str]
            [
                "123"
                " 123"
            ]

            >>> agnostic_replace_all(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "123",
                " 123"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.replace_all(
                pattern, value, literal=literal
            )
        )

    def strip_chars(self: Self, characters: str | None = None) -> SeriesT:
        r"""Remove leading and trailing characters.

        Arguments:
            characters: The set of characters to be removed. All combinations of this set of characters will be stripped from the start and end of the string. If set to None (default), all leading and trailing whitespace is removed instead.

        Returns:
            A new Series with leading and trailing characters removed.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["apple", "\nmango"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_strip_chars(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     s = s.str.strip_chars()
            ...     return s.to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_strip_chars`:

            >>> agnostic_strip_chars(s_pd)
            0    apple
            1    mango
            dtype: object

            >>> agnostic_strip_chars(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (2,)
            Series: '' [str]
            [
                "apple"
                "mango"
            ]

            >>> agnostic_strip_chars(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "apple",
                "mango"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.strip_chars(characters)
        )

    def starts_with(self: Self, prefix: str) -> SeriesT:
        r"""Check if string values start with a substring.

        Arguments:
            prefix: prefix substring

        Returns:
            A new Series with boolean values indicating if each string starts with the prefix.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["apple", "mango", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_starts_with(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.starts_with("app").to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_starts_with`:

            >>> agnostic_starts_with(s_pd)
            0     True
            1    False
            2     None
            dtype: object

            >>> agnostic_starts_with(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (3,)
            Series: '' [bool]
            [
               true
               false
               null
            ]

            >>> agnostic_starts_with(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                true,
                false,
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.starts_with(prefix)
        )

    def ends_with(self: Self, suffix: str) -> SeriesT:
        r"""Check if string values end with a substring.

        Arguments:
            suffix: suffix substring

        Returns:
            A new Series with boolean values indicating if each string ends with the suffix.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["apple", "mango", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_ends_with(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.ends_with("ngo").to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_ends_with`:

            >>> agnostic_ends_with(s_pd)
            0    False
            1     True
            2     None
            dtype: object

            >>> agnostic_ends_with(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (3,)
            Series: '' [bool]
            [
               false
               true
               null
            ]

            >>> agnostic_ends_with(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                false,
                true,
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.ends_with(suffix)
        )

    def contains(self: Self, pattern: str, *, literal: bool = False) -> SeriesT:
        r"""Check if string contains a substring that matches a pattern.

        Arguments:
            pattern: A Character sequence or valid regular expression pattern.
            literal: If True, treats the pattern as a literal string.
                     If False, assumes the pattern is a regular expression.

        Returns:
            A new Series with boolean values indicating if each string contains the pattern.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["cat", "dog", "rabbit and parrot", "dove", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_contains(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.contains("parrot|dove").to_native()

            We can then pass any supported library such as pandas, Polars, or PyArrow to `agnostic_contains`:

            >>> agnostic_contains(s_pd)
            0    False
            1    False
            2     True
            3     True
            4     None
            dtype: object

            >>> agnostic_contains(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (5,)
            Series: '' [bool]
            [
               false
               false
               true
               true
               null
            ]

            >>> agnostic_contains(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                false,
                false,
                true,
                true,
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.contains(pattern, literal=literal)
        )

    def slice(self: Self, offset: int, length: int | None = None) -> SeriesT:
        r"""Create subslices of the string values of a Series.

        Arguments:
            offset: Start index. Negative indexing is supported.
            length: Length of the slice. If set to `None` (default), the slice is taken to the
                end of the string.

        Returns:
            A new Series containing subslices of each string.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["pear", None, "papaya", "dragonfruit"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_slice(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.slice(4, length=3).to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_slice`:

            >>> agnostic_slice(s_pd)  # doctest: +NORMALIZE_WHITESPACE
            0
            1    None
            2      ya
            3     onf
            dtype: object

            >>> agnostic_slice(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [str]
            [
               ""
               null
               "ya"
               "onf"
            ]

            >>> agnostic_slice(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "",
                null,
                "ya",
                "onf"
              ]
            ]

            Using negative indexes:

            >>> def agnostic_slice(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.slice(-3).to_native()

            >>> agnostic_slice(s_pd)  # doctest: +NORMALIZE_WHITESPACE
            0     ear
            1    None
            2     aya
            3     uit
            dtype: object

            >>> agnostic_slice(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [str]
            [
                "ear"
                null
                "aya"
                "uit"
            ]

            >>> agnostic_slice(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "ear",
                null,
                "aya",
                "uit"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.slice(
                offset=offset, length=length
            )
        )

    def head(self: Self, n: int = 5) -> SeriesT:
        r"""Take the first n elements of each string.

        Arguments:
            n: Number of elements to take. Negative indexing is supported (see note (1.))

        Returns:
            A new Series containing the first n characters of each string.

        Notes:
            1. When the `n` input is negative, `head` returns characters up to the n-th from the end of the string.
                For example, if `n = -3`, then all characters except the last three are returned.
            2. If the length of the string has fewer than `n` characters, the full string is returned.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["Atatata", "taata", "taatatata", "zukkyun"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_head(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.head().to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_head`:

            >>> agnostic_head(s_pd)
            0    Atata
            1    taata
            2    taata
            3    zukky
            dtype: object

            >>> agnostic_head(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [str]
            [
               "Atata"
               "taata"
               "taata"
               "zukky"
            ]

            >>> agnostic_head(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "Atata",
                "taata",
                "taata",
                "zukky"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.slice(offset=0, length=n)
        )

    def tail(self: Self, n: int = 5) -> SeriesT:
        r"""Take the last n elements of each string.

        Arguments:
            n: Number of elements to take. Negative indexing is supported (see note (1.))

        Returns:
            A new Series containing the last n characters of each string.

        Notes:
            1. When the `n` input is negative, `tail` returns characters starting from the n-th from the beginning of
                the string. For example, if `n = -3`, then all characters except the first three are returned.
            2. If the length of the string has fewer than `n` characters, the full string is returned.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["Atatata", "taata", "taatatata", "zukkyun"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_tail(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.tail().to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_tail`:

            >>> agnostic_tail(s_pd)
            0    atata
            1    taata
            2    atata
            3    kkyun
            dtype: object

            >>> agnostic_tail(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (4,)
            Series: '' [str]
            [
               "atata"
               "taata"
               "atata"
               "kkyun"
            ]

            >>> agnostic_tail(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "atata",
                "taata",
                "atata",
                "kkyun"
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.slice(offset=-n, length=None)
        )

    def to_uppercase(self) -> SeriesT:
        r"""Transform string to uppercase variant.

        Returns:
            A new Series with values converted to uppercase.

        Notes:
            The PyArrow backend will convert 'ß' to 'ẞ' instead of 'SS'.
            For more info see: https://github.com/apache/arrow/issues/34599
            There may be other unicode-edge-case-related variations across implementations.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["apple", "mango", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_to_uppercase(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.to_uppercase().to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_to_uppercase`:

            >>> agnostic_to_uppercase(s_pd)
            0    APPLE
            1    MANGO
            2     None
            dtype: object

            >>> agnostic_to_uppercase(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (3,)
            Series: '' [str]
            [
               "APPLE"
               "MANGO"
               null
            ]

            >>> agnostic_to_uppercase(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "APPLE",
                "MANGO",
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.to_uppercase()
        )

    def to_lowercase(self) -> SeriesT:
        r"""Transform string to lowercase variant.

        Returns:
            A new Series with values converted to lowercase.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["APPLE", "MANGO", None]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_to_lowercase(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.to_lowercase().to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_to_lowercase`:

            >>> agnostic_to_lowercase(s_pd)
            0    apple
            1    mango
            2     None
            dtype: object

            >>> agnostic_to_lowercase(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (3,)
            Series: '' [str]
            [
               "apple"
               "mango"
               null
            ]

            >>> agnostic_to_lowercase(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at ...>
            [
              [
                "apple",
                "mango",
                null
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.to_lowercase()
        )

    def to_datetime(self: Self, format: str | None = None) -> SeriesT:  # noqa: A002
        """Parse Series with strings to a Series with Datetime dtype.

        Notes:
            pandas defaults to nanosecond time unit, Polars to microsecond.
            Prior to pandas 2.0, nanoseconds were the only time unit supported
            in pandas, with no ability to set any other one. The ability to
            set the time unit in pandas, if the version permits, will arrive.

        Warning:
            As different backends auto-infer format in different ways, if `format=None`
            there is no guarantee that the result will be equal.

        Arguments:
            format: Format to use for conversion. If set to None (default), the format is
                inferred from the data.

        Returns:
            A new Series with datetime dtype.

        Examples:
            >>> import pandas as pd
            >>> import polars as pl
            >>> import pyarrow as pa
            >>> import narwhals as nw
            >>> from narwhals.typing import IntoSeriesT

            >>> data = ["2020-01-01", "2020-01-02"]
            >>> s_pd = pd.Series(data)
            >>> s_pl = pl.Series(data)
            >>> s_pa = pa.chunked_array([data])

            We define a dataframe-agnostic function:

            >>> def agnostic_to_datetime(s_native: IntoSeriesT) -> IntoSeriesT:
            ...     s = nw.from_native(s_native, series_only=True)
            ...     return s.str.to_datetime(format="%Y-%m-%d").to_native()

            We can then pass any supported library such as pandas, Polars, or
            PyArrow to `agnostic_to_datetime`:

            >>> agnostic_to_datetime(s_pd)
            0   2020-01-01
            1   2020-01-02
            dtype: datetime64[ns]

            >>> agnostic_to_datetime(s_pl)  # doctest: +NORMALIZE_WHITESPACE
            shape: (2,)
            Series: '' [datetime[μs]]
            [
               2020-01-01 00:00:00
               2020-01-02 00:00:00
            ]

            >>> agnostic_to_datetime(s_pa)  # doctest: +ELLIPSIS
            <pyarrow.lib.ChunkedArray object at 0x...>
            [
              [
                2020-01-01 00:00:00.000000,
                2020-01-02 00:00:00.000000
              ]
            ]
        """
        return self._narwhals_series._from_compliant_series(
            self._narwhals_series._compliant_series.str.to_datetime(format=format)
        )
