from typing import Any

try:
    import pyspark.pandas as ps
except ImportError as e:
    raise NotImplementedError("Pyspark is not installed.") from e

from hamilton import registry

DATAFRAME_TYPE = ps.DataFrame
COLUMN_TYPE = ps.Series


@registry.get_column.register(ps.DataFrame)
def get_column_pyspark_pandas(df: ps.DataFrame, column_name: str) -> ps.Series:
    return df[column_name]


@registry.fill_with_scalar.register(ps.DataFrame)
def fill_with_scalar_pyspark_pandas(df: ps.DataFrame, column_name: str, value: Any) -> ps.DataFrame:
    df[column_name] = value
    return df


def register_types():
    """Function to register the types for this extension."""
    registry.register_types("pyspark_pandas", DATAFRAME_TYPE, COLUMN_TYPE)


register_types()
