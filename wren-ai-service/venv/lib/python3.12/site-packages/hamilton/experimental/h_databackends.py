"""This module defines "databackends". They are essentially abstract types such as
`AbstractPandasDataFrame` or `AbstractPandasSeries` which can be used with
`isinstance()` or `issubclass()` without having to import pandas.

It is powerful when used with `@functools.singledispatch`

    ```python
    @functools.singledispatch
    def get_arrow_schema(df) -> pyarrow.Schema:
        if not hasattr(df, "__dataframe__"):
            raise NotImplementedError(f"Type {type(df)} is currently unsupported.")
        return from_dataframe(df, allow_copy=True).schema


    @get_arrow_schema.register
    def _(df: h_databackends.AbstractPandasDataFrame) -> pyarrow.Schema:
        return pyarrow.Table.from_pandas(df).schema


    @get_arrow_schema.register
    def _(df: h_databackends.AbstractIbisDataFrame) -> pyarrow.Schema:
        return df.schema().to_pyarrow()
    ```

Instead of centralizing code by library / dependency, we can now centralize it
by Hamilton feature. For example, we can have all the implementations to collect
schemas under `schema.py` instead of spread across `pandas_extension.py`,
polars_extension.py`, etc.
"""

import importlib
import inspect
from typing import Tuple

from hamilton.experimental.databackend import AbstractBackend

# TODO add a `_has__dataframe__` attribute for those that implement the
# dataframe interchange protocol


# PyArrow
class AbstractPyArrowDataFrame(AbstractBackend):
    _backends = [("pyarrow", "Table"), ("pyarrow", "RecordBatch")]


class AbstractPyarrowColumn(AbstractBackend):
    _backends = [("pyarrow", "Array"), ("pyarrow", "ChunkedArray")]


# Ibis
class AbstractIbisDataFrame(AbstractBackend):
    _backends = [("ibis.expr.types", "Table")]


class AbstractIbisColumn(AbstractBackend):
    _backends = [("ibis.expr.types", "Column")]


# Pandas
class AbstractPandasDataFrame(AbstractBackend):
    _backends = [("pandas", "DataFrame")]


class AbstractPandasColumn(AbstractBackend):
    _backends = [("pandas", "Series")]


# Polars
class AbstractPolarsDataFrame(AbstractBackend):
    _backends = [("polars", "DataFrame")]


class AbstractPolarsColumn(AbstractBackend):
    _backends = [("polars", "Series")]


# Polars Lazy
class AbstractLazyPolarsDataFrame(AbstractBackend):
    _backends = [("polars", "LazyFrame")]


# Vaex
class AbstractVaexDataFrame(AbstractBackend):
    _backends = [("vaex.dataframe", "DataFrame")]


class AbstractVaexColumn(AbstractBackend):
    _backends = [("vaex.expression", "Expression")]


# Dask
class AbstractDaskDataFrame(AbstractBackend):
    _backends = [("dask.dataframe", "DataFrame")]


class AbstractDaskColumn(AbstractBackend):
    _backends = [("dask.dataframe", "Series")]


# SparkSQL
class AbstractSparkSQLDataFrame(AbstractBackend):
    _backends = [("pyspark.sql", "DataFrame")]


# SparkPandas
class AbstractSparkPandasDataFrame(AbstractBackend):
    _backends = [("pyspark.pandas", "DataFrame")]


class AbstractSparkPandasColumn(AbstractBackend):
    _backends = [("pyspark.pandas", "Series")]


# Geopandas
class AbstractGeoPandasDataFrame(AbstractBackend):
    _backends = [("geopandas", "GeoDataFrame")]


class AbstractGeoPandasColumn(AbstractBackend):
    _backends = [("geopandas", "GeoSeries")]


# cuDF
class AbstractCuDFDataFrame(AbstractBackend):
    _backends = [("cudf", "DataFrame")]


# Modin
class AbstractModinDataFrame(AbstractBackend):
    _backends = [("modin.pandas", "DataFrame")]


# numpy
class AbstractNumpyArray(AbstractBackend):
    _backends = [("numpy", "ndarray")]


def register_backends() -> Tuple[Tuple[type], Tuple[type]]:
    """Register databackends defined in this module that
    include `DataFrame` and `Column` in their class name
    """
    abstract_dataframe_types = set()
    abstract_column_types = set()

    h_databackends_module = importlib.import_module(__name__)
    for name, cls in inspect.getmembers(h_databackends_module, inspect.isclass):
        if "DataFrame" in name:
            abstract_dataframe_types.add(cls)
        elif "Column" in name:
            abstract_column_types.add(cls)

    # Union[tuple()] creates a Union type object
    DATAFRAME_TYPES = tuple(abstract_dataframe_types)
    COLUMN_TYPES = tuple(abstract_column_types)
    return DATAFRAME_TYPES, COLUMN_TYPES


DATAFRAME_TYPES, COLUMN_TYPES = register_backends()
