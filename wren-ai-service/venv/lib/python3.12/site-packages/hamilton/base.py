"""This module contains base constructs for executing a hamilton graph.
It should only import hamilton.node, numpy, pandas.
It cannot import hamilton.graph, or hamilton.driver.
"""

import abc
import collections
import logging
from typing import Any, Dict, List, Optional, Tuple, Type, Union

import numpy as np
import pandas as pd
from pandas.core.indexes import extension as pd_extension

from hamilton.lifecycle import api as lifecycle_api

try:
    from . import htypes, node
except ImportError:
    import node

logger = logging.getLogger(__name__)


class ResultMixin(lifecycle_api.LegacyResultMixin):
    """Legacy result builder -- see lifecycle methods for more information."""

    pass


class DictResult(ResultMixin):
    """Simple function that returns the dict of column -> value results.

    It returns the results as a dictionary, where the keys map to outputs requested,
    and values map to what was computed for those values.

    Use this when you want to:

       1. debug dataflows.
       2. have heterogeneous return types.
       3. Want to manually transform the result into something of your choosing.


    .. code-block:: python

        from hamilton import base, driver

        dict_builder = base.DictResult()
        adapter = base.SimplePythonGraphAdapter(dict_builder)
        dr = driver.Driver(config, *modules, adapter=adapter)
        dict_result = dr.execute([...], inputs=...)

    Note, if you just want the dict result + the SimplePythonGraphAdapter, you can use the
    DefaultAdapter

    .. code-block:: python

        adapter = base.DefaultAdapter()
    """

    @staticmethod
    def build_result(**outputs: Dict[str, Any]) -> Dict:
        """This function builds a simple dict of output -> computed values."""
        return outputs

    def input_types(self) -> Optional[List[Type[Type]]]:
        return [Any]

    def output_type(self) -> Type:
        return Dict[str, Any]


class PandasDataFrameResult(ResultMixin):
    """Mixin for building a pandas dataframe from the result.

    It returns the results as a Pandas Dataframe, where the columns map to outputs requested, and values map to what\
    was computed for those values. Note: this only works if the computed values are pandas series, or scalar values.

    Use this when you want to create a pandas dataframe.

    Example:

    .. code-block:: python

        from hamilton import base, driver
        df_builder = base.PandasDataFrameResult()
        adapter = base.SimplePythonGraphAdapter(df_builder)
        dr =  driver.Driver(config, *modules, adapter=adapter)
        df = dr.execute([...], inputs=...)
    """

    @staticmethod
    def pandas_index_types(
        outputs: Dict[str, Any],
    ) -> Tuple[Dict[str, List[str]], Dict[str, List[str]], Dict[str, List[str]]]:
        """This function creates three dictionaries according to whether there is an index type or not.

        The three dicts we create are:
        1. Dict of index type to list of outputs that match it.
        2. Dict of time series / categorical index types to list of outputs that match it.
        3. Dict of `no-index` key to list of outputs with no index type.

        :param outputs: the dict we're trying to create a result from.
        :return: dict of all index types, dict of time series/categorical index types, dict if there is no index
        """
        all_index_types = collections.defaultdict(list)
        time_indexes = collections.defaultdict(list)
        no_indexes = collections.defaultdict(list)

        def index_key_name(pd_object: Union[pd.DataFrame, pd.Series]) -> str:
            """Creates a string helping identify the index and it's type.
            Useful for disambiguating time related indexes."""
            return f"{pd_object.index.__class__.__name__}:::{pd_object.index.dtype}"

        def get_parent_time_index_type():
            """Helper to pull the right time index parent class."""
            if hasattr(pd_extension, "NDArrayBackedExtensionIndex"):
                index_type = pd_extension.NDArrayBackedExtensionIndex
            else:
                index_type = None  # weird case, but not worth breaking for.
            return index_type

        for output_name, output_value in outputs.items():
            if isinstance(
                output_value, (pd.DataFrame, pd.Series)
            ):  # if it has an index -- let's grab it's type
                dict_key = index_key_name(output_value)
                if isinstance(output_value.index, get_parent_time_index_type()):
                    # it's a time index -- these will produce garbage if not aligned properly.
                    time_indexes[dict_key].append(output_name)
            elif isinstance(
                output_value, pd.Index
            ):  # there is no index on this - so it's just an integer one.
                int_index = pd.Series(
                    [1, 2, 3], index=[0, 1, 2]
                )  # dummy to get right values for string.
                dict_key = index_key_name(int_index)
            else:
                dict_key = "no-index"
                no_indexes[dict_key].append(output_name)
            all_index_types[dict_key].append(output_name)
        return all_index_types, time_indexes, no_indexes

    @staticmethod
    def check_pandas_index_types_match(
        all_index_types: Dict[str, List[str]],
        time_indexes: Dict[str, List[str]],
        no_indexes: Dict[str, List[str]],
    ) -> bool:
        """Checks that pandas index types match.

        This only logs warning errors, and if debug is enabled, a debug statement to list index types.
        """
        no_index_length = len(no_indexes)
        time_indexes_length = len(time_indexes)
        all_indexes_length = len(all_index_types)
        number_with_indexes = all_indexes_length - no_index_length
        types_match = True  # default to True
        # if there is more than one time index
        if time_indexes_length > 1:
            logger.warning(
                "WARNING: Time/Categorical index type mismatches detected - check output to ensure Pandas "
                "is doing what you intend to do. Else change the index types to match. Set logger to debug "
                "to see index types."
            )
            types_match = False
        # if there is more than one index type and it's not explained by the time indexes then
        if number_with_indexes > 1 and all_indexes_length > time_indexes_length:
            logger.warning(
                "WARNING: Multiple index types detected - check output to ensure Pandas is "
                "doing what you intend to do. Else change the index types to match. Set logger to debug to "
                "see index types."
            )
            types_match = False
        elif number_with_indexes == 1 and no_index_length > 0:
            logger.warning(
                f"WARNING: a single pandas index was found, but there are also {len(no_indexes['no-index'])} "
                "outputs without an index. Please check whether the dataframe created matches what what you "
                "expect to happen."
            )
            # Strictly speaking the index types match -- there is only one -- so setting to True.
            types_match = True
        # if all indexes matches no indexes
        elif no_index_length == all_indexes_length:
            logger.warning(
                "It appears no Pandas index type was detected (ignore this warning if you're using DASK for now.) "
                "Please check whether the dataframe created matches what what you expect to happen."
            )
            types_match = False
        if logger.isEnabledFor(logging.DEBUG):
            import pprint

            pretty_string = pprint.pformat(dict(all_index_types))
            logger.debug(f"Index types encountered:\n{pretty_string}.")
        return types_match

    @staticmethod
    def build_result(**outputs: Dict[str, Any]) -> pd.DataFrame:
        """Builds a Pandas DataFrame from the outputs.

        This function will check the index types of the outputs, and log warnings if they don't match.
        The behavior of pd.Dataframe(outputs) is that it will do an outer join based on indexes of the Series passed in.

        :param outputs: the outputs to build a dataframe from.
        """
        # TODO check inputs are pd.Series, arrays, or scalars -- else error
        output_index_type_tuple = PandasDataFrameResult.pandas_index_types(outputs)
        # this next line just log warnings
        # we don't actually care about the result since this is the current default behavior.
        PandasDataFrameResult.check_pandas_index_types_match(*output_index_type_tuple)

        if len(outputs) == 1:
            (value,) = outputs.values()  # this works because it's length 1.
            if isinstance(value, pd.DataFrame):
                return value

        if not any(pd.api.types.is_list_like(value) for value in outputs.values()):
            # If we're dealing with all values that don't have any "index" that could be created
            # (i.e. scalars, objects) coerce the output to a single-row, multi-column dataframe.
            return pd.DataFrame([outputs])
        #
        contains_df = any(isinstance(value, pd.DataFrame) for value in outputs.values())
        if contains_df:
            # build the dataframe from the outputs
            return PandasDataFrameResult.build_dataframe_with_dataframes(outputs)
        # don't do anything special if dataframes aren't in the output.
        return pd.DataFrame(outputs)  # this does an implicit outer join based on index.

    @staticmethod
    def build_dataframe_with_dataframes(outputs: Dict[str, Any]) -> pd.DataFrame:
        """Builds a dataframe from the outputs in an "outer join" manner based on index.

        The behavior of pd.Dataframe(outputs) is that it will do an outer join based on indexes of the Series passed in.
        To handle dataframes, we unpack the dataframe into a dict of series, check to ensure that no columns are
        redefined in a rolling fashion going in order of the outputs requested. This then results in an "enlarged"
        outputs dict that is then passed to pd.Dataframe(outputs) to get the final dataframe.

        :param outputs: The outputs to build the dataframe from.
        :return: A dataframe with the outputs.
        """

        def get_output_name(output_name: str, column_name: str) -> str:
            """Add function prefix to columns.
            Note this means that they stop being valid python identifiers due to the `.` in the string.
            """
            return f"{output_name}.{column_name}"

        flattened_outputs = {}
        for name, output in outputs.items():
            if isinstance(output, pd.DataFrame):
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug(
                        f"Unpacking dataframe {name} into dict of series with columns {list(output.columns)}."
                    )

                df_dict = {
                    get_output_name(name, col_name): col_value
                    for col_name, col_value in output.to_dict(orient="series").items()
                }
                flattened_outputs.update(df_dict)
            elif isinstance(output, pd.Series):
                if name in flattened_outputs:
                    raise ValueError(
                        f"Series {name} already exists in the output. "
                        f"Please rename the series to avoid this error, or determine from where the initial series is "
                        f"being added; it may be coming from a dataframe that is being unpacked."
                    )
                flattened_outputs[name] = output
            else:
                if name in flattened_outputs:
                    raise ValueError(
                        f"Non series output {name} already exists in the output. "
                        f"Please rename this output to avoid this error, or determine from where the initial value is "
                        f"being added; it may be coming from a dataframe that is being unpacked."
                    )
                flattened_outputs[name] = output

        return pd.DataFrame(flattened_outputs)

    def input_types(self) -> List[Type[Type]]:
        """Currently this just shoves anything into a dataframe. We should probably
        tighten this up."""
        return [Any]

    def output_type(self) -> Type:
        return pd.DataFrame


class StrictIndexTypePandasDataFrameResult(PandasDataFrameResult):
    """A ResultBuilder that produces a dataframe only if the index types match exactly.

    Note: If there is no index type on some outputs, e.g. the value is a scalar, as long as there exists a single \
    pandas index type, no error will be thrown, because a dataframe can be easily created.

    Use this when you want to create a pandas dataframe from the outputs, but you want to ensure that the index types \
    match exactly.

    To use:

    .. code-block:: python

        from hamilton import base, driver
        strict_builder = base.StrictIndexTypePandasDataFrameResult()
        adapter = base.SimplePythonGraphAdapter(strict_builder)
        dr =  driver.Driver(config, *modules, adapter=adapter)
        df = dr.execute([...], inputs=...)  # this will now error if index types mismatch.
    """

    @staticmethod
    def build_result(**outputs: Dict[str, Any]) -> pd.DataFrame:
        # TODO check inputs are pd.Series, arrays, or scalars -- else error
        output_index_type_tuple = PandasDataFrameResult.pandas_index_types(outputs)
        indexes_match = PandasDataFrameResult.check_pandas_index_types_match(
            *output_index_type_tuple
        )
        if not indexes_match:
            import pprint

            pretty_string = pprint.pformat(dict(output_index_type_tuple[0]))
            raise ValueError(
                "Error: pandas index types did not match exactly. "
                f"Found the following indexes:\n{pretty_string}"
            )

        return PandasDataFrameResult.build_result(**outputs)


class NumpyMatrixResult(ResultMixin):
    """Mixin for building a Numpy Matrix from the result of walking the graph.

    All inputs to the build_result function are expected to be numpy arrays.

    .. code-block:: python

        from hamilton import base, driver

        adapter = base.SimplePythonGraphAdapter(base.NumpyMatrixResult())
        dr = driver.Driver(config, *modules, adapter=adapter)
        numpy_matrix = dr.execute([...], inputs=...)
    """

    @staticmethod
    def build_result(**outputs: Dict[str, Any]) -> np.matrix:
        """Builds a numpy matrix from the passed in, inputs.

        Note: this does not check that the inputs are all numpy arrays/array like things.

        :param outputs: function_name -> np.array.
        :return: numpy matrix
        """
        # TODO check inputs are all numpy arrays/array like things -- else error
        num_rows = -1
        columns_with_lengths = collections.OrderedDict()
        for col, val in outputs.items():  # assumption is fixed order
            if isinstance(val, (int, float)):  # TODO add more things here
                columns_with_lengths[(col, 1)] = val
            else:
                length = len(val)
                if num_rows == -1:
                    num_rows = length
                elif length == num_rows:
                    # we're good
                    pass
                else:
                    raise ValueError(
                        f"Error, got non scalar result that mismatches length of other vector. "
                        f"Got {length} for {col} instead of {num_rows}."
                    )
                columns_with_lengths[(col, num_rows)] = val
        list_of_columns = []
        for (col, length), val in columns_with_lengths.items():
            if length != num_rows and length == 1:
                list_of_columns.append([val] * num_rows)  # expand single values into a full row
            elif length == num_rows:
                list_of_columns.append(list(val))
            else:
                raise ValueError(
                    f"Do not know how to make this column {col} with length {length} have {num_rows} rows"
                )
        # Create the matrix with columns as rows and then transpose
        return np.asmatrix(list_of_columns).T

    def input_types(self) -> List[Type[Type]]:
        """Currently returns anything as numpy types are relatively new and"""
        return [Any]  # Typing

    def output_type(self) -> Type:
        return pd.DataFrame


class HamiltonGraphAdapter(lifecycle_api.GraphAdapter, abc.ABC):
    """Legacy graph adapter -- see lifecycle methods for more information."""

    pass


class SimplePythonDataFrameGraphAdapter(HamiltonGraphAdapter, PandasDataFrameResult):
    """This is the original Hamilton graph adapter. It uses plain python and builds a dataframe result.

    This executes the Hamilton dataflow locally on a machine in a single threaded,
    single process fashion. It assumes a pandas dataframe as a result.

    Use this when you want to execute on a single machine, without parallelization, and you want a
    pandas dataframe as output.
    """

    @staticmethod
    def check_input_type(node_type: Type, input_value: Any) -> bool:
        return htypes.check_input_type(node_type, input_value)

    @staticmethod
    def check_node_type_equivalence(node_type: Type, input_type: Type) -> bool:
        return node_type == input_type

    def execute_node(self, node: node.Node, kwargs: Dict[str, Any]) -> Any:
        return node.callable(**kwargs)


class SimplePythonGraphAdapter(SimplePythonDataFrameGraphAdapter):
    """This class allows you to swap out the build_result very easily.

    This executes the Hamilton dataflow locally on a machine in a single threaded, single process fashion. It allows\
    you to specify a ResultBuilder to control the return type of what ``execute()`` returns.

    Currently this extends SimplePythonDataFrameGraphAdapter, although that's largely for legacy reasons (and can probably be changed).

    TODO -- change this to extend the right class.
    """

    def __init__(self, result_builder: ResultMixin = None):
        """Allows you to swap out the build_result very easily.

        :param result_builder: A ResultMixin object that will be used to build the result.
        """
        if result_builder is None:
            result_builder = DictResult()
        self.result_builder = result_builder

    def build_result(self, **outputs: Dict[str, Any]) -> Any:
        """Delegates to the result builder function supplied."""
        return self.result_builder.build_result(**outputs)

    def output_type(self) -> Type:
        return self.result_builder.output_type()


class DefaultAdapter(SimplePythonGraphAdapter):
    """This is a shortcut for the SimplePythonGraphAdapter. It does the exact same thing,
    but allows for easier access/naming."""
