from typing import Any, Type

import pyarrow
from pyarrow.interchange import from_dataframe

from hamilton.lifecycle.api import ResultBuilder


class PyarrowTableResult(ResultBuilder):
    """Add this result builder to a materializer's `combine` statement to convert your dataframe
    object to a pyarrow representation and make it compatible with pyarrow DataSavers.

    It implicitly support input_type == Any, but it expects dataframe objects implementing
    the dataframe interchange protocol: ref: https://arrow.apache.org/docs/python/interchange_protocol.html
    for example:
    - pandas
    - polars
    - dask
    - vaex
    - ibis
    - duckdb results
    """

    def output_type(self) -> Type:
        return pyarrow.Table

    def build_result(self, **outputs: Any) -> Any:
        """This function converts objects implementing the `__dataframe__` protocol to
        a pyarrow table. It doesn't support receiving multiple outputs because it can't
        handle any joining logic.

        ref: https://arrow.apache.org/docs/python/interchange_protocol.html
        """
        if len(outputs) != 1:
            raise AssertionError(
                "PyarrowTableResult can only receive 1 output, i.e., only one item in `to.SAVER(dependencies=[])`"
                f"It received {len(outputs)} outputs."
            )
        return from_dataframe(next(iter(outputs.values())))
