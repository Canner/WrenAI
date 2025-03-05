import math
import string
from datetime import datetime, timedelta
from functools import lru_cache
from itertools import cycle

import numpy as np
import pandas as pd

try:
    import pytz
except ImportError:
    pytz = None

from .utils import find_package_file

COLUMN_TYPES = [
    "bool",
    "int",
    "float",
    "str",
    "categories",
    "boolean",
    "Int64",
    "date",
    "datetime",
    "timedelta",
]

PANDAS_VERSION_MAJOR, PANDAS_VERSION_MINOR, _ = pd.__version__.split(".", 2)
PANDAS_VERSION_MAJOR = int(PANDAS_VERSION_MAJOR)
PANDAS_VERSION_MINOR = int(PANDAS_VERSION_MINOR)
if PANDAS_VERSION_MAJOR == 0:
    COLUMN_TYPES = [type for type in COLUMN_TYPES if type != "boolean"]
if PANDAS_VERSION_MAJOR == 2 and PANDAS_VERSION_MINOR == 1:
    # https://github.com/pandas-dev/pandas/issues/55080
    COLUMN_TYPES = [type for type in COLUMN_TYPES if type != "timedelta"]


def get_countries(html=True):
    """A Pandas DataFrame with the world countries (from the world bank data)
    Flags are loaded from https://flagpedia.net/"""
    df = pd.read_csv(find_package_file("samples/countries.csv"))
    df = df.rename(columns={"capitalCity": "capital", "name": "country"})
    df["iso2Code"] = df["iso2Code"].fillna("NA")  # Namibia
    df = df.set_index("iso2Code")[
        ["region", "country", "capital", "longitude", "latitude"]
    ].dropna()
    df.index.name = "code"

    if not html:
        return df

    df["flag"] = [
        '<a href="https://flagpedia.net/{code}">'
        '<img src="https://flagpedia.net/data/flags/h80/{code}.webp" '
        'alt="Flag of {country}"></a>'.format(code=code.lower(), country=country)
        for code, country in zip(df.index, df["country"])
    ]
    df["country"] = [
        '<a href="https://en.wikipedia.org/wiki/{}">{}</a>'.format(country, country)
        for country in df["country"]
    ]
    df["capital"] = [
        '<a href="https://en.wikipedia.org/wiki/{}">{}</a>'.format(capital, capital)
        for capital in df["capital"]
    ]
    return df


def get_population():
    """A Pandas Series with the world population (from the world bank data)"""
    return pd.read_csv(find_package_file("samples/population.csv")).set_index(
        "Country"
    )["SP.POP.TOTL"]


def get_indicators():
    """A Pandas DataFrame with a subset of the world bank indicators"""
    return pd.read_csv(find_package_file("samples/indicators.csv"))


def get_df_complex_index():
    df = get_countries()
    df = df.reset_index().set_index(["region", "country"])
    df.columns = pd.MultiIndex.from_arrays(
        [
            [
                (
                    "code"
                    if col == "code"
                    else "localisation" if col in ["longitude", "latitude"] else "data"
                )
                for col in df.columns
            ],
            df.columns,
        ],
        names=["category", "detail"],
    )
    return df


def get_dict_of_test_dfs(N=100, M=100, polars=False):
    NM_values = np.reshape(np.linspace(start=0.0, stop=1.0, num=N * M), (N, M))

    test_dfs = {
        "empty": pd.DataFrame(dtype=float),
        "no_rows": pd.DataFrame(dtype=float, columns=["a"]),
        "no_columns": pd.DataFrame(dtype=float, index=["a"]),
        "no_rows_one_column": pd.DataFrame([1.0], index=["a"], columns=["a"]).iloc[:0],
        "no_columns_one_row": pd.DataFrame([1.0], index=["a"], columns=["a"]).iloc[
            :, :0
        ],
        "bool": pd.DataFrame(
            [[True, True, False, False], [True, False, True, False]],
            columns=list("abcd"),
        ),
        "nullable_boolean": pd.DataFrame(
            [
                [True, True, False, None],
                [True, False, None, False],
                [None, False, True, False],
            ],
            columns=list("abcd"),
            dtype="bool" if PANDAS_VERSION_MAJOR == 0 else "boolean",
        ),
        "int": pd.DataFrame(
            [[-1, 2, -3, 4, -5], [6, -7, 8, -9, 10]], columns=list("abcde")
        ),
        "nullable_int": pd.DataFrame(
            [[-1, 2, -3], [4, -5, 6], [None, 7, None]],
            columns=list("abc"),
            dtype="Int64",
        ),
        "float": pd.DataFrame(
            {
                "int": [0.0, 1],
                "inf": [np.inf, -np.inf],
                "nan": [np.nan, -np.nan],
                "math": [math.pi, math.e],
            }
        ),
        "str": pd.DataFrame(
            {
                "text_column": ["some", "text"],
                "very_long_text_column": ["a " + "very " * 12 + "long text"] * 2,
            }
        ),
        "time": pd.DataFrame(
            {
                "datetime": [datetime(2000, 1, 1), datetime(2001, 1, 1), pd.NaT],
                "timestamp": [
                    pd.NaT,
                    datetime(2000, 1, 1, 18, 55, 33),
                    datetime(
                        2001,
                        1,
                        1,
                        18,
                        55,
                        55,
                        456654,
                        tzinfo=None if pytz is None else pytz.timezone("US/Eastern"),
                    ),
                ],
                "timedelta": [
                    timedelta(days=2),
                    timedelta(seconds=50),
                    pd.NaT - datetime(2000, 1, 1),
                ],
            }
        ),
        "date_range": pd.DataFrame(
            {"timestamps": pd.date_range("now", periods=5, freq="s")}
        ),
        "ordered_categories": pd.DataFrame(
            {"int": np.arange(4)},
            index=pd.CategoricalIndex(
                ["first", "second", "third", "fourth"],
                categories=["first", "second", "third", "fourth"],
                ordered=True,
                name="categorical_index",
            ),
        ),
        "ordered_categories_in_multiindex": pd.DataFrame(
            {"int": np.arange(4), "integer_index": np.arange(4)},
            index=pd.CategoricalIndex(
                ["first", "second", "third", "fourth"],
                categories=["first", "second", "third", "fourth"],
                ordered=True,
                name="categorical_index",
            ),
        ).set_index("integer_index", append=True),
        "object": pd.DataFrame(
            {"dict": [{"a": 1}, {"b": 2, "c": 3}], "list": [["a"], [1, 2]]}
        ),
        "multiindex": pd.DataFrame(
            np.arange(16).reshape((4, 4)),
            columns=pd.MultiIndex.from_product((["A", "B"], [1, 2])),
            index=pd.MultiIndex.from_product((["C", "D"], [3, 4])),
        ),
        "countries": get_countries(),
        "capital": get_countries().set_index(["region", "country"])[["capital"]],
        "complex_index": get_df_complex_index(),
        "int_float_str": pd.DataFrame(
            {
                "int": range(N),
                "float": np.linspace(5.0, 0.0, N),
                "str": [
                    letter for letter, _ in zip(cycle(string.ascii_lowercase), range(N))
                ],
            }
        ),
        "wide": pd.DataFrame(
            NM_values,
            index=["row_{}".format(i) for i in range(N)],
            columns=["column_{}".format(j) for j in range(M)],
        ),
        "long_column_names": pd.DataFrame(
            {
                "short name": [0] * 5,
                "very " * 5 + "long name": [0] * 5,
                "very " * 10 + "long name": [1] * 5,
                "very " * 20 + "long name": [2] * 5,
                "nospacein" + "very" * 50 + "longname": [3] * 5,
                "nospacein" + "very" * 100 + "longname": [3] * 5,
            }
        ),
        "sorted_index": pd.DataFrame(
            {"i": [0, 1, 2], "x": [0.0, 1.0, 2.0], "y": [0.0, 0.1, 0.2]}
        ).set_index(["i"]),
        "reverse_sorted_index": pd.DataFrame(
            {"i": [2, 1, 0], "x": [0.0, 1.0, 2.0], "y": [0.0, 0.1, 0.2]}
        ).set_index(["i"]),
        "sorted_multiindex": pd.DataFrame(
            {"i": [0, 1, 2], "j": [3, 4, 5], "x": [0.0, 1.0, 2.0], "y": [0.0, 0.1, 0.2]}
        ).set_index(["i", "j"]),
        "unsorted_index": pd.DataFrame(
            {"i": [0, 2, 1], "x": [0.0, 1.0, 2.0], "y": [0.0, 0.1, 0.2]}
        ).set_index(["i"]),
        "duplicated_columns": pd.DataFrame(
            np.arange(4, 8).reshape((2, 2)),
            columns=pd.Index(["A", "A"]),
            index=pd.MultiIndex.from_arrays(
                np.arange(4).reshape((2, 2)), names=["A", "A"]
            ),
        ),
        "named_column_index": pd.DataFrame({"a": [1]}).rename_axis("columns", axis=1),
        "big_integers": pd.DataFrame(
            {
                "bigint": [
                    1234567890123456789,
                    2345678901234567890,
                    3456789012345678901,
                ],
                "expected": [
                    "1234567890123456789",
                    "2345678901234567890",
                    "3456789012345678901",
                ],
            }
        ),
    }

    if polars:
        import polars as pl
        import pyarrow as pa

        polars_dfs = {}
        for key, df in test_dfs.items():
            if key == "multiindex":
                # Since Polars 1.2, pl.from_pandas fails with this error:
                # ValueError: Pandas dataframe contains non-unique indices and/or column names.
                # Polars dataframes require unique string names for columns.
                # See https://github.com/pola-rs/polars/issues/18130
                df.index = df.index.tolist()
            try:
                polars_dfs[key] = pl.from_pandas(df)
            except (pa.ArrowInvalid, ValueError):
                pass
        return polars_dfs

    return test_dfs


def get_dict_of_test_series(polars=False):
    series = {}
    for df_name, df in get_dict_of_test_dfs().items():
        if len(df.columns) > 6:
            continue
        for col in df.columns:
            # Case of duplicate columns
            if not isinstance(df[col], pd.Series):
                continue
            series["{}.{}".format(df_name, col)] = df[col]

    if polars:
        import polars as pl
        import pyarrow as pa

        polars_series = {}
        for key in series:
            try:
                polars_series[key] = pl.from_pandas(series[key])
            except (pa.ArrowInvalid, ValueError):
                pass

        # Add a Polar table with unsigned integers
        # https://github.com/mwouts/itables/issues/192
        # https://github.com/mwouts/itables/issues/299
        polars_series["u32"] = pl.Series([1, 2, 5]).cast(pl.UInt32)
        polars_series["u64"] = pl.Series([1, 2, 2**40]).cast(pl.UInt64)

        return polars_series

    return series


@lru_cache()
def generate_date_series():
    if pd.__version__ >= "2.2.0":
        # https://github.com/pandas-dev/pandas/issues/55080 is back in 2.2.0?
        return pd.Series(pd.date_range("1970-01-01", "2099-12-31", freq="D"))
    return pd.Series(pd.date_range("1677-09-23", "2262-04-10", freq="D"))


def generate_random_series(rows, type):
    if type == "bool":
        return pd.Series(np.random.binomial(n=1, p=0.5, size=rows), dtype=bool)
    if type == "boolean":
        x = generate_random_series(rows, "bool").astype(type)
        x.loc[np.random.binomial(n=1, p=0.1, size=rows) == 0] = pd.NA
        return x
    if type == "int":
        return pd.Series(np.random.geometric(p=0.1, size=rows), dtype=int)
    if type == "Int64":
        x = generate_random_series(rows, "int").astype(type)
        if PANDAS_VERSION_MAJOR >= 1:
            x.loc[np.random.binomial(n=1, p=0.1, size=rows) == 0] = pd.NA
        return x
    if type == "float":
        x = pd.Series(np.random.normal(size=rows), dtype=float)
        x.loc[np.random.binomial(n=1, p=0.05, size=rows) == 0] = float("nan")
        x.loc[np.random.binomial(n=1, p=0.05, size=rows) == 0] = float("inf")
        x.loc[np.random.binomial(n=1, p=0.05, size=rows) == 0] = float("-inf")
        return x
    if type == "str":
        return get_countries()["region"].sample(n=rows, replace=True)
    if type == "categories":
        x = generate_random_series(rows, "str")
        return pd.Series(x, dtype="category")
    if type == "date":
        x = generate_date_series().sample(rows, replace=True)
        x.loc[np.random.binomial(n=1, p=0.1, size=rows) == 0] = pd.NaT
        return x
    if type == "datetime":
        x = generate_random_series(rows, "date") + np.random.uniform(
            0, 1, rows
        ) * pd.Timedelta(1, unit="D")
        return x
    if type == "timedelta":
        x = generate_random_series(rows, "datetime").sample(frac=1)
        return x.diff()
    raise NotImplementedError(type)


def generate_random_df(rows, columns, column_types=COLUMN_TYPES):
    rows = int(rows)
    types = np.random.choice(column_types, size=columns)
    columns = [
        "Column{}OfType{}".format(col, type.title()) for col, type in enumerate(types)
    ]

    series = {
        col: generate_random_series(rows, type) for col, type in zip(columns, types)
    }
    index = pd.Index(range(rows))
    for x in series.values():
        x.index = index

    return pd.DataFrame(series)


def get_pandas_styler():
    """This function returns a Pandas Styler object

    Cf. https://pandas.pydata.org/docs/user_guide/style.html
    """
    x = np.linspace(0, math.pi, 21)
    df = pd.DataFrame(
        {"sin": np.sin(x), "cos": np.cos(x)}, index=pd.Index(x, name="alpha")
    )

    s = df.style
    s.background_gradient(axis=None, cmap="YlOrRd")
    s.format("{:.3f}")
    try:
        s.format_index("{:.3f}")
    except AttributeError:
        # Python 3.7 AttributeError: 'Styler' object has no attribute 'format_index'
        pass

    s.set_caption(
        "A Pandas Styler object with background colors and tooltips"
    ).set_table_styles(
        [{"selector": "caption", "props": "caption-side: bottom; font-size:1.25em;"}],
    )

    ttips = pd.DataFrame(
        {
            "sin": ["The sinus of {:.6f} is {:.6f}".format(t, np.sin(t)) for t in x],
            "cos": ["The cosinus of {:.6f} is {:.6f}".format(t, np.cos(t)) for t in x],
        },
        index=df.index,
    )
    try:
        s.set_tooltips(ttips)
    except AttributeError:
        pass

    return s
