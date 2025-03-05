from typing import List

import pandas as pd

from hamilton.function_modifiers import (
    UpstreamDependency,
    base,
    parameterize_extract_columns,
    source,
    value,
)
from hamilton.function_modifiers.expanders import ParameterizedExtract


def _get_dep_type(dep_type: str) -> UpstreamDependency:
    """Converts dependency type to the type known by function_modifier"""
    if dep_type == "out":
        return None
    if dep_type == "value":
        return value
    if dep_type == "source":
        return source
    raise ValueError(f"Invalid dep type: {dep_type}")


def _get_index_levels(index: pd.MultiIndex) -> List[list]:
    out = [[] for _ in index[0]]
    for specific_index in index:
        for i, key in enumerate(specific_index):
            out[i].append(key)
    return out


def _validate_df_parameterization(parameterization: pd.DataFrame):
    # TODO -- validate that its a multi-index
    columns = _get_index_levels(parameterization.columns)
    if (not len(columns) == 2) or "out" not in columns[1]:
        raise base.InvalidDecoratorException(
            "Decorator must have a double-index -- first index should be a "
            "list of {output, source, value} strs. Second must be a list of "
            "arguments in your function."
        )


def _convert_params_from_df(parameterization: pd.DataFrame) -> List[ParameterizedExtract]:
    _validate_df_parameterization(parameterization)
    args, dep_types = _get_index_levels(parameterization.columns)
    dep_types_converted = [_get_dep_type(val) for val in dep_types]
    out = []
    for _, column_set in parameterization.iterrows():
        parameterization = {
            arg: dep_type(col_value)
            for arg, col_value, dep_type in zip(args, column_set, dep_types_converted)
            if dep_type is not None
        }
        extracted_columns = [
            col for col, dep_type in zip(column_set, dep_types) if dep_type == "out"
        ]
        out.append(ParameterizedExtract(tuple(extracted_columns), parameterization))
    return out


class parameterize_frame(parameterize_extract_columns):
    """EXPERIMENTAL! Instantiates a parameterize_extract decorator using a dataframe to specify a set of extracts + \
    parameterizations.

    This is an experimental decorator and the API may change in the future; please provide feedback \
    whether this API does or does not work for you.

    :param parameterization: Parameterization dataframe. See below.

    This is of a specific shape:

        1. Index - Level 0: list of parameter names
        2. Index - Level 1: types of things to inject, either:

            - "out" (meaning this is an output),
            - "value" (meaning this is a literal value)
            - "source" (meaning this node comes from an upstream value)

        3. Contents:

          - Each row corresponds to the index. Each of these corresponds to an output node from this.


    Note your function has to take in the column-names and output a dataframe with those names -- \
    we will likely change it so that's not the case, and it can just use the position of the columns.

    Example usage:

    .. code-block:: python

        from hamilton.experimental.decorators.parameterize_frame import parameterize_frame
        df = pd.DataFrame(
        [
           ["outseries1a", "outseries2a", "inseries1a", "inseries2a", 5.0],
           ["outseries1b", "outseries2b", "inseries1b", "inseries2b", 0.2],
        ],
        # specify column names corresponding to function arguments and
        # if outputting multiple columns, output dataframe columns.
        columns=[
           ["output1", "output2", "input1", "input2", "input3"],
           ["out", "out", "source", "source", "value"],
        ])

        @parameterize_frame(df)
        def my_func(
            input1: pd.Series, input2: pd.Series, input3: float
        ) -> pd.DataFrame:
           ...

    """

    def __init__(self, parameterization: pd.DataFrame):
        super(parameterize_frame, self).__init__(*_convert_params_from_df(parameterization))


# Examples below
if __name__ == "__main__":
    df = pd.DataFrame(
        [
            ["outseries1a", "outseries2a", "inseries1a", "inseries2a", 5.0],
            ["outseries1b", "outseries2b", "inseries1b", "inseries2b", 0.2],
            # ...
        ],
        # Have to switch as indices have to be unique
        columns=[
            [
                "output1",
                "output2",
                "input1",
                "input2",
                "input3",
            ],
            # configure whether column is source or value and also whether it's input ("source", "value") or output ("out")
            ["out", "out", "source", "source", "value"],
        ],
    )  # specify column names (corresponding to function arguments and (if outputting multiple columns) output dataframe columns)

    @parameterize_frame(df)
    def my_func(input1: pd.Series, input2: pd.Series, input3: float) -> pd.DataFrame:
        return pd.DataFrame(
            [input1 * input2 * input3, input1 + input2 + input3]
        )  # if there's a single column it could maybe just return a series instead and pick up the name from the first column of the dataframe

    @parameterize_extract_columns(
        ParameterizedExtract(
            ("outseries1a", "outseries2a"),
            {"input1": source("inseries1a"), "input2": source("inseries2a"), "input3": value(5.0)},
        ),
        ParameterizedExtract(
            ("outseries1b", "outseries2b"),
            {"input1": source("inseries1b"), "input2": source("inseries2b"), "input3": value(0.2)},
        ),
    )
    def my_func_parameterized_extract(
        input1: pd.Series, input2: pd.Series, input3: float
    ) -> pd.DataFrame:
        print("running my_func_parameterized_extract")
        return pd.concat([input1 * input2 * input3, input1 + input2 + input3], axis=1)

    my_func_parameterized_extract.decorated = "false"

    # Test by running the @parameterized_extract decorator
    from hamilton.ad_hoc_utils import create_temporary_module
    from hamilton.driver import Driver

    dr = Driver({}, create_temporary_module(my_func_parameterized_extract))
    dr.visualize_execution(
        final_vars=["outseries1a", "outseries1b", "outseries2a", "outseries2b"],
        output_file_path="./out1.pdf",
        render_kwargs={},
        inputs={
            "inseries1a": pd.Series([1, 2]),
            "inseries1b": pd.Series([2, 3]),
            "inseries2a": pd.Series([3, 4]),
            "inseries2b": pd.Series([4, 5]),
        },
    )

    df_1 = dr.execute(
        final_vars=["outseries1a", "outseries1b", "outseries2a", "outseries2b"],
        # final_vars=["outseries1a", "outseries2a"],
        inputs={
            "inseries1a": pd.Series([1, 2]),
            "inseries1b": pd.Series([2, 3]),
            "inseries2a": pd.Series([3, 4]),
            "inseries2b": pd.Series([4, 5]),
        },
    )
    print(df_1)

    # Test by running the @parameterized_extract decorator
    dr = Driver({}, create_temporary_module(my_func))
    dr.visualize_execution(
        final_vars=["outseries1a", "outseries1b", "outseries2a", "outseries2b"],
        output_file_path="./out2.pdf",
        render_kwargs={},
        inputs={
            "inseries1a": pd.Series([1, 2]),
            "inseries1b": pd.Series([2, 3]),
            "inseries2a": pd.Series([3, 4]),
            "inseries2b": pd.Series([4, 5]),
        },
    )

    df_2 = dr.execute(
        final_vars=["outseries1a", "outseries1b", "outseries2a", "outseries2b"],
        # final_vars=["outseries1a", "outseries2a"],
        inputs={
            "inseries1a": pd.Series([1, 2]),
            "inseries1b": pd.Series([2, 3]),
            "inseries2a": pd.Series([3, 4]),
            "inseries2b": pd.Series([4, 5]),
        },
    )
    print(df_2)
