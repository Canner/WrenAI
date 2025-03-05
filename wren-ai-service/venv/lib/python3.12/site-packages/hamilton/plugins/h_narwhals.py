from typing import Any, Dict, Optional, Type, Union

import narwhals as nw

from hamilton.lifecycle import api


class NarwhalsAdapter(api.NodeExecutionMethod):
    """Adapter to make it simpler to use narwhals with Hamilton.

    .. code-block:: python

            from hamilton import base, driver
            from hamilton.plugins import h_narwhals
            import example

            # pandas
            dr = (
                driver.Builder()
                .with_config({"load": "pandas"})
                .with_modules(example)
                .with_adapters(
                    h_narwhals.NarwhalsAdapter(),
                    h_narwhals.NarwhalsDataFrameResultBuilder(
                        base.PandasDataFrameResult()
                    ),
                )
                .build()
            )
            result = dr.execute(
                 [example.group_by_mean, example.example1],
                 inputs={"col_name": "a"}
            )

    """

    def run_to_execute_node(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_callable: Any,
        node_kwargs: Dict[str, Any],
        task_id: Optional[str],
        **future_kwargs: Any,
    ) -> Any:
        """This method is responsible for executing the node and returning the result.

        It uses `nw_kwargs` from the node tags to know if any special flags should be passed to the narwhals
        decorator function.

        :param node_name: Name of the node.
        :param node_tags: Tags of the node.
        :param node_callable: Callable of the node.
        :param node_kwargs: Keyword arguments to pass to the node.
        :param task_id: The ID of the task, none if not in a task-based environment
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        :return: The result of the node execution -- up to you to return this.
        """
        nw_kwargs = {}
        if "nw_kwargs" in node_tags:
            nw_kwargs = {k: True for k in node_tags["nw_kwargs"]}
        nw_func = nw.narwhalify(node_callable, **nw_kwargs)
        return nw_func(**node_kwargs)


class NarwhalsDataFrameResultBuilder(api.ResultBuilder):
    """Builds the result. It unwraps the narwhals parts of it and delegates to the passed in result builder.

    .. code-block:: python

        from hamilton import base, driver
        from hamilton.plugins import h_narwhals, h_polars
        import example

        # polars
        dr = (
            driver.Builder()
            .with_config({"load": "polars"})
            .with_modules(example)
            .with_adapters(
                h_narwhals.NarwhalsAdapter(),
                h_narwhals.NarwhalsDataFrameResultBuilder(
                   h_polars.PolarsDataFrameResult()
                ),
            )
            .build()
        )
        result = dr.execute(
            ["group_by_mean", "example1"],
            inputs={"col_name": "a"}
        )
    """

    def __init__(self, result_builder: Union[api.ResultBuilder, api.LegacyResultMixin]):
        self.result_builder = result_builder

    def build_result(self, **outputs: Any) -> Any:
        """Given a set of outputs, build the result.

        :param outputs: the outputs from the execution of the graph.
        :return: the result of the execution of the graph.
        """
        de_narwhaled_outputs = {}
        for key, value in outputs.items():
            if isinstance(value, (nw.DataFrame, nw.Series)):
                de_narwhaled_outputs[key] = nw.to_native(value)
            else:
                de_narwhaled_outputs[key] = value

        return self.result_builder.build_result(**de_narwhaled_outputs)

    def output_type(self) -> Type:
        """Returns the output type of this result builder
        :return: the type that this creates
        """
        return self.result_builder.output_type()
