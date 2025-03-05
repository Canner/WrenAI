from typing import Any

try:
    import geopandas as gpd
except ImportError as e:
    raise NotImplementedError("geopandas is not installed.") from e

from hamilton import registry

DATAFRAME_TYPE = gpd.GeoDataFrame
COLUMN_TYPE = gpd.GeoSeries


@registry.get_column.register(gpd.GeoDataFrame)
def get_column_geopandas(df: gpd.GeoDataFrame, column_name: str) -> gpd.GeoSeries:
    return df[column_name]


@registry.fill_with_scalar.register(gpd.GeoDataFrame)
def fill_with_scalar_geopandas(
    df: gpd.GeoDataFrame, column_name: str, value: Any
) -> gpd.GeoDataFrame:
    df[column_name] = value
    return df


def register_types():
    """Function to register the types for this extension."""
    registry.register_types("geopandas", DATAFRAME_TYPE, COLUMN_TYPE)


register_types()
