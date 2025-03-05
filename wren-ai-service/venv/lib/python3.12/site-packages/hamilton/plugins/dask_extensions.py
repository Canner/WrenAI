from typing import Any

try:
    import dask.dataframe as dd
except ImportError as e:
    raise NotImplementedError("Dask is not installed.") from e

from hamilton import registry

DATAFRAME_TYPE = dd.DataFrame
COLUMN_TYPE = dd.Series


@registry.get_column.register(dd.DataFrame)
def get_column_dask(df: dd.DataFrame, column_name: str) -> dd.Series:
    return df[column_name]


@registry.fill_with_scalar.register(dd.DataFrame)
def fill_with_scalar_dask(df: dd.DataFrame, column_name: str, value: Any) -> dd.DataFrame:
    df[column_name] = value
    return df


def register_types():
    """Function to register the types for this extension."""
    registry.register_types("dask", DATAFRAME_TYPE, COLUMN_TYPE)


register_types()
