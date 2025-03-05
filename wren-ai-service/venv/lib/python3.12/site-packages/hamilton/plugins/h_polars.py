import sys
from types import ModuleType
from typing import Any, Callable, Collection, Dict, List, Tuple, Type, Union, get_type_hints

import polars as pl

_sys_version_info = sys.version_info
_version_tuple = (_sys_version_info.major, _sys_version_info.minor, _sys_version_info.micro)

if _version_tuple < (3, 11, 0):
    pass
else:
    pass

# Copied this over from function_graph
# TODO -- determine the best place to put this code
from hamilton import base, node, registry
from hamilton.function_modifiers.expanders import extract_columns
from hamilton.function_modifiers.recursive import (
    _default_inject_parameter,
    subdag,
    with_columns_base,
)
from hamilton.plugins.polars_extensions import DATAFRAME_TYPE


class PolarsDataFrameResult(base.ResultMixin):
    """A ResultBuilder that produces a polars dataframe.

    Use this when you want to create a polars dataframe from the outputs. Caveat: you need to ensure that the length
    of the outputs is the same, otherwise you will get an error; mixed outputs aren't that well handled.

    To use:

    .. code-block:: python

        from hamilton import base, driver
        from hamilton.plugins import polars_extensions

        polars_builder = polars_extensions.PolarsDataFrameResult()
        adapter = base.SimplePythonGraphAdapter(polars_builder)
        dr = driver.Driver(config, *modules, adapter=adapter)
        df = dr.execute([...], inputs=...)  # returns polars dataframe

    Note: this is just a first attempt at something for Polars. Think it should handle more? Come chat/open a PR!
    """

    def build_result(
        self, **outputs: Dict[str, Union[pl.Series, pl.DataFrame, Any]]
    ) -> pl.DataFrame:
        """This is the method that Hamilton will call to build the final result. It will pass in the results
        of the requested outputs that you passed in to the execute() method.

        Note: this function could do smarter things; looking for contributions here!

        :param outputs: The results of the requested outputs.
        :return: a polars DataFrame.
        """
        if len(outputs) == 1:
            (value,) = outputs.values()  # this works because it's length 1.
            if isinstance(value, pl.DataFrame):  # it's a dataframe
                return value
            if isinstance(value, pl.LazyFrame):  # it's a lazyframe
                return value.collect()
            elif not isinstance(value, pl.Series):  # it's a single scalar/object
                key, value = outputs.popitem()
                return pl.DataFrame({key: [value]})
            else:  # it's a series
                return pl.DataFrame(outputs)
        # TODO: check for length of outputs and determine what should
        # happen for mixed outputs that include scalars for example.
        return pl.DataFrame(outputs)

    def output_type(self) -> Type:
        return pl.DataFrame


# Do we need this here?
class with_columns(with_columns_base):
    """Initializes a with_columns decorator for polars.

    This allows you to efficiently run groups of map operations on a dataframe. We support
    both eager and lazy mode in polars. In case of using eager mode the type should be
    pl.DataFrame and the subsequent operations run on columns with type pl.Series.

    Here's an example of calling in eager mode -- if you've seen ``@subdag``, you should be familiar with
    the concepts:

    .. code-block:: python

        # my_module.py
        def a_b_average(a: pl.Series, b: pl.Series) -> pl.Series:
            return (a + b) / 2


    .. code-block:: python

        # with_columns_module.py
        def a_plus_b(a: pl.Series, b: pl.Series) -> pl.Series:
            return a + b


        # the with_columns call
        @with_columns(
            *[my_module], # Load from any module
            *[a_plus_b], # or list operations directly
            columns_to_pass=["a", "b"], # The columns to pass from the dataframe to
            # the subdag
            select=["a_plus_b", "a_b_average"], # The columns to append to the dataframe
        )
        def final_df(initial_df: pl.DataFrame) -> pl.DataFrame:
            # process, or just return unprocessed
            ...

    In this instance the ``initial_df`` would get two columns added: ``a_plus_b`` and ``a_b_average``.

    Note that the operation is "append", meaning that the columns that are selected are appended
    onto the dataframe.

    If the function takes multiple dataframes, the dataframe input to process will always be
    the first argument. This will be passed to the subdag, transformed, and passed back to the function.
    This follows the hamilton rule of reference by parameter name. To demonstarte this, in the code
    above, the dataframe that is passed to the subdag is `initial_df`. That is transformed
    by the subdag, and then returned as the final dataframe.

    You can read it as:

    "final_df is a function that transforms the upstream dataframe initial_df, running the transformations
    from my_module. It starts with the columns a_from_df and b_from_df, and then adds the columns
    a, b, and a_plus_b to the dataframe. It then returns the dataframe, and does some processing on it."

    In case you need more flexibility you can alternatively use ``on_input``, for example,

    .. code-block:: python

        # with_columns_module.py
        def a_from_df() -> pl.Expr:
            return pl.col(a).alias("a") / 100

        def b_from_df() -> pl.Expr:
            return pl.col(b).alias("b") / 100


        # the with_columns call
        @with_columns(
            *[my_module],
            on_input="initial_df",
            select=["a_from_df", "b_from_df", "a_plus_b", "a_b_average"],
        )
        def final_df(initial_df: pl.DataFrame) -> pl.DataFrame:
            # process, or just return unprocessed
            ...

    the above would output a dataframe where the two columns ``a`` and ``b`` get
    overwritten.
    """

    def __init__(
        self,
        *load_from: Union[Callable, ModuleType],
        columns_to_pass: List[str] = None,
        pass_dataframe_as: str = None,
        on_input: str = None,
        select: List[str] = None,
        namespace: str = None,
        config_required: List[str] = None,
    ):
        """Instantiates a ``@with_columns`` decorator.

        :param load_from: The functions or modules that will be used to generate the group of map operations.
        :param columns_to_pass: The initial schema of the dataframe. This is used to determine which
            upstream inputs should be taken from the dataframe, and which shouldn't. Note that, if this is
            left empty (and external_inputs is as well), we will assume that all dependencies come
            from the dataframe. This cannot be used in conjunction with on_input.
        :param on_input: The name of the dataframe that we're modifying, as known to the subdag.
            If you pass this in, you are responsible for extracting columns out. If not provided, you have
            to pass columns_to_pass in, and we will extract the columns out on the first parameter for you.
        :param select: The end nodes that represent columns to be appended to the original dataframe
            via with_columns. Existing columns will be overridden. The selected nodes need to have the
            corresponding column type, in this case pl.Series, to be appended to the original dataframe.
        :param namespace: The namespace of the nodes, so they don't clash with the global namespace
            and so this can be reused. If its left out, there will be no namespace (in which case you'll want
            to be careful about repeating it/reusing the nodes in other parts of the DAG.)
        :param config_required: the list of config keys that are required to resolve any functions. Pass in None\
            if you want the functions/modules to have access to all possible config.
        """

        if pass_dataframe_as is not None:
            raise NotImplementedError(
                "We currently do not support pass_dataframe_as for pandas. Please reach out if you need this "
                "functionality."
            )

        super().__init__(
            *load_from,
            columns_to_pass=columns_to_pass,
            on_input=on_input,
            select=select,
            namespace=namespace,
            config_required=config_required,
            dataframe_type=DATAFRAME_TYPE,
        )

    def _create_column_nodes(
        self, fn: Callable, inject_parameter: str, params: Dict[str, Type[Type]]
    ) -> List[node.Node]:
        output_type = params[inject_parameter]

        def temp_fn(**kwargs) -> Any:
            return kwargs[inject_parameter]

        # We recreate the df node to use extract columns
        temp_node = node.Node(
            name=inject_parameter,
            typ=output_type,
            callabl=temp_fn,
            input_types={inject_parameter: output_type},
        )

        extract_columns_decorator = extract_columns(*self.initial_schema)

        out_nodes = extract_columns_decorator.transform_node(temp_node, config={}, fn=temp_fn)
        return out_nodes[1:]

    def get_initial_nodes(
        self, fn: Callable, params: Dict[str, Type[Type]]
    ) -> Tuple[str, Collection[node.Node]]:
        """Selects the correct dataframe and optionally extracts out columns."""
        inject_parameter = _default_inject_parameter(fn=fn, target_dataframe=self.target_dataframe)
        with_columns_base.validate_dataframe(
            fn=fn,
            inject_parameter=inject_parameter,
            params=params,
            required_type=self.dataframe_type,
        )

        initial_nodes = (
            []
            if self.target_dataframe is not None
            else self._create_column_nodes(fn=fn, inject_parameter=inject_parameter, params=params)
        )

        return inject_parameter, initial_nodes

    def get_subdag_nodes(self, fn: Callable, config: Dict[str, Any]) -> Collection[node.Node]:
        return subdag.collect_nodes(config, self.subdag_functions)

    def chain_subdag_nodes(
        self, fn: Callable, inject_parameter: str, generated_nodes: Collection[node.Node]
    ) -> node.Node:
        "Node that adds to / overrides columns for the original dataframe based on selected output."

        if self.select is None:
            self.select = [
                sink_node.name
                for sink_node in generated_nodes
                if sink_node.type == registry.get_column_type_from_df_type(self.dataframe_type)
            ]

        def new_callable(**kwargs) -> Any:
            df = kwargs[inject_parameter]
            columns_to_append = {}
            for column in self.select:
                columns_to_append[column] = kwargs[column]

            return df.with_columns(**columns_to_append)

        column_type = registry.get_column_type_from_df_type(self.dataframe_type)
        input_map = {column: column_type for column in self.select}
        input_map[inject_parameter] = self.dataframe_type
        merge_node = node.Node(
            name="_append",
            typ=self.dataframe_type,
            callabl=new_callable,
            input_types=input_map,
        )
        output_nodes = generated_nodes + [merge_node]
        return output_nodes, merge_node.name

    def validate(self, fn: Callable):
        inject_parameter = _default_inject_parameter(fn=fn, target_dataframe=self.target_dataframe)
        params = get_type_hints(fn)
        with_columns_base.validate_dataframe(
            fn=fn,
            inject_parameter=inject_parameter,
            params=params,
            required_type=self.dataframe_type,
        )
