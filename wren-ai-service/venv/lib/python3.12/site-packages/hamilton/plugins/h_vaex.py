from typing import Any, Dict, List, Type, Union

import numpy as np
import pandas as pd

from hamilton import base

try:
    import vaex
except ImportError as e:
    raise NotImplementedError("Vaex is not installed.") from e


class VaexDataFrameResult(base.ResultMixin):
    """A ResultBuilder that produces a Vaex dataframe.

    Use this when you want to create a Vaex dataframe from the outputs.
    Caveat: you need to ensure that the length
    of the outputs is the same (except scalars), otherwise you will get an error;
    mixed outputs aren't that well handled.

    To use:

    .. code-block:: python

        from hamilton import base, driver
        from hamilton.plugins import h_vaex

        vaex_builder = h_vaex.VaexDataFrameResult()
        adapter = base.SimplePythonGraphAdapter(vaex_builder)
        dr = driver.Driver(config, *modules, adapter=adapter)
        df = dr.execute([...], inputs=...)  # returns vaex dataframe

    Note: this is just a first attempt at something for Vaex.
    Think it should handle more? Come chat/open a PR!
    """

    def build_result(
        self,
        **outputs: Dict[str, Union[vaex.expression.Expression, vaex.dataframe.DataFrame, Any]],
    ):
        """This is the method that Hamilton will call to build the final result.
        It will pass in the results of the requested outputs that
        you passed in to the execute() method.

        :param outputs: The results of the requested outputs.
        :return: a Vaex DataFrame.
        """

        # We split all outputs into DataFrames, arrays and scalars
        dfs: List[vaex.dataframe.DataFrame] = []  # Vaex DataFrames from outputs
        arrays: Dict[str, np.ndarray] = dict()  # arrays from outputs
        scalars: Dict[str, Any] = dict()  # scalars from outputs

        for name, value in outputs.items():
            if isinstance(value, vaex.dataframe.DataFrame):
                dfs.append(value)
            elif isinstance(value, vaex.expression.Expression):
                nparray = value.to_numpy()
                if nparray.ndim == 0:  # value is scalar
                    scalars[name] = nparray.item()
                elif nparray.shape == (1,):  # value is scalar
                    scalars[name] = nparray[0]
                else:  # value is array
                    arrays[name] = nparray
            elif isinstance(value, np.ndarray):
                if value.ndim == 0:  # value is scalar
                    scalars[name] = value.item()
                elif value.shape == (1,):  # value is scalar
                    scalars[name] = value[0]
                else:  # value is array
                    arrays[name] = value
            elif pd.api.types.is_scalar(value):  # value is scalar
                scalars[name] = value
            else:
                value_type = str(type(value))
                message = f"VaexDataFrameResult doesn't support {value_type}"
                raise NotImplementedError(message)

        df = None

        if arrays:
            # Check if all arrays have correct and identical shapes.
            first_expression_shape = next(arrays.values().__iter__()).shape
            if len(first_expression_shape) > 1:
                raise NotImplementedError(
                    "VaexDataFrameResult supports only one-dimensional Expression results"
                )
            for _name, a in arrays.items():
                if a.shape != first_expression_shape:
                    raise NotImplementedError(
                        "VaexDataFrameResult supports Expression results with same dimension only"
                    )

            # All scalars become arrays with the same shape as other arrays.
            for name, scalar in scalars.items():
                arrays[name] = np.full(first_expression_shape, scalar)

            df = vaex.from_arrays(**arrays)

        elif scalars:
            # There are not arrays in outputs,
            # so we construct Vaex DataFrame with one row consisting of scalars.
            df = vaex.from_arrays(**{name: np.array([value]) for name, value in scalars.items()})

        if df:
            dfs.append(df)

        return vaex.concat(dfs)

    def output_type(self) -> Type:
        return vaex.dataframe.DataFrame
