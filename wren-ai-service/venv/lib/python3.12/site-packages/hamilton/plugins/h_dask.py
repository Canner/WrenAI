import logging
import typing

import dask.array
import dask.dataframe
import numpy as np
import pandas as pd
from dask import compute
from dask.base import tokenize
from dask.delayed import Delayed, delayed
from dask.distributed import Client as DaskClient

from hamilton import base, htypes, node
from hamilton.execution import executors

logger = logging.getLogger(__name__)


class DaskGraphAdapter(base.HamiltonGraphAdapter):
    """Class representing what's required to make Hamilton run on Dask.

    This walks the graph and translates it to run onto `Dask <https://dask.org/>`__.

    Use `pip install sf-hamilton[dask]` to get the dependencies required to run this.

    Try this adapter when:

        1. Dask is a good choice to scale computation when you really can't do things in memory anymore with pandas. \
        For most simple pandas operations, you should not have to do anything to scale! You just need to load in \
        data via dask rather than pandas.
        2. Dask can help scale to larger data sets if running on a cluster -- you'll just have to switch to\
        natively using their object types if that's the case (set use_delayed=False, and compute_at_end=False).
        3. Use this adapter if you want to utilize multiple cores on a single machine, or you want to scale to large \
        data set sizes with a Dask cluster that you can connect to.
        4. The ONLY CAVEAT really is whether you use `delayed` or `dask datatypes` (or both).

    Please read the following notes about its limitations.

    Notes on scaling:
    -----------------
      - Multi-core on single machine ✅
      - Distributed computation on a Dask cluster ✅
      - Scales to any size of data supported by Dask ✅; assuming you load it appropriately via Dask loaders.
      - Works best with Pandas 2.0+ and pyarrow backend.

    Function return object types supported:
    ---------------------------------------
      - Works for any python object that can be serialized by the Dask framework. ✅

    Pandas?
    -------
    Dask implements a good subset of the Pandas API:
      - You might be able to get away with scaling without having to change your code at all!
      - See https://docs.dask.org/en/latest/dataframe-api.html for Pandas supported APIs.
      - If it is not supported by their API, you have to then read up and think about how to structure you hamilton\
      function computation -- https://docs.dask.org/en/latest/dataframe.html
      - if paired with DaskDataFrameResult & use_delayed=False & compute_at_end=False, it will help you produce a \
      dask dataframe as a result that you can then convert back to pandas if you want.

    Loading Data:
    -------------
      - see https://docs.dask.org/en/latest/best-practices.html#load-data-with-dask.
      - we recommend creating a python module specifically encapsulating functions that help you load data.

    CAVEATS with use_delayed=True:
    ------------------------------
      - If using `use_delayed=True` serialization costs can outweigh the benefits of parallelism, so you should \
       benchmark your code to see if it's worth it.
      - With this adapter & use_delayed=True, it can naively wrap all your functions with `delayed`, which will mean \
       they will be executed and scheduled across the dask workers. This is a good choice if your computation is slow, \
       or Hamilton graph is highly parallelizable.

    DISCLAIMER -- this class is experimental, so signature changes are a possibility! But we'll aim to be backwards
    compatible where possible.
    """

    def __init__(
        self,
        dask_client: DaskClient,
        result_builder: base.ResultMixin = None,
        visualize_kwargs: dict = None,
        use_delayed: bool = True,
        compute_at_end: bool = True,
    ):
        """Constructor

        You have the ability to pass in a ResultMixin object to the constructor to control the return type that gets\
        produced by running on Dask.

        :param dask_client: the dask client -- we don't do anything with it, but thought that it would be useful\
            to wire through here.
        :param result_builder: The function that will build the result. Optional, defaults to pandas dataframe.
        :param visualize_kwargs: Arguments to visualize the graph using dask's internals.\
            **None**, means no visualization.\
            **Dict**, means visualize -- see https://docs.dask.org/en/latest/api.html?highlight=visualize#dask.visualize\
            for what to pass in.
        :param use_delayed: Default is True for backwards compatibility. Whether to use dask.delayed to wrap every
            function. Note: it is probably not necessary to mix this with using dask objects, e.g. dataframes/series.
            They are by nature lazily computed and operate over the dask data types, so you don't need to wrap them
            with delayed. Use delayed if you want to farm out computation.
        :param compute_at_end: Default is True for backwards compatibility. Whether to compute() at the end.
            That is, should `.compute()` be called in the result builder to quick off computation.
        """
        self.client = dask_client
        self.result_builder = result_builder if result_builder else base.PandasDataFrameResult()
        self.visualize_kwargs = visualize_kwargs
        self.use_delayed = use_delayed
        self.compute_at_end = compute_at_end

    @staticmethod
    def check_input_type(node_type: typing.Type, input_value: typing.Any) -> bool:
        # NOTE: the type of dask Delayed is unknown until they are computed
        if isinstance(input_value, Delayed):
            return True
        elif node_type == pd.Series and isinstance(input_value, dask.dataframe.Series):
            return True
        elif node_type == np.array and isinstance(input_value, dask.array.Array):
            return True
        return htypes.check_input_type(node_type, input_value)

    @staticmethod
    def check_node_type_equivalence(node_type: typing.Type, input_type: typing.Type) -> bool:
        if node_type == dask.array.Array and input_type == pd.Series:
            return True
        elif node_type == dask.dataframe.Series and input_type == pd.Series:
            return True
        return node_type == input_type

    def execute_node(self, node: node.Node, kwargs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Function that is called as we walk the graph to determine how to execute a hamilton function.

        :param node: the node from the graph.
        :param kwargs: the arguments that should be passed to it.
        :return: returns a dask delayed object.
        """
        if not self.use_delayed:
            return node.callable(**kwargs)
        # we want to ensure the name in dask corresponds to the node name, and not the wrapped
        # function name that hamilton might have wrapped it with.
        hash = tokenize(kwargs)  # this is what the dask docs recommend.
        name = node.name + hash
        dask_key_name = str(node.name) + "_" + hash
        return delayed(node.callable, name=name)(
            **kwargs,
            dask_key_name=dask_key_name,  # this is what shows up in the dask console
        )

    def build_result(self, **outputs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Builds the result and brings it back to this running process.

        :param outputs: the dictionary of key -> Union[delayed object reference | value]
        :return: The type of object returned by self.result_builder. Note the following behaviors:
          - if you use_delayed=True, then the result will be a delayed object.
          - if you use_delayed=True & computed_at_end=True, then the result will be the return type
          of self.result_builder.
          - if you use_delayed=False & computed_at_end=True, this will only work if the self.result_builder
          returns a dask type, as we will try to compute it.
          - if you use_delayed=False & computed_at_end=False, this will return the result of self.result_builder.
        """
        if logger.isEnabledFor(logging.DEBUG):
            for k, v in outputs.items():
                logger.debug(f"Got column {k}, with type [{type(v)}].")
        if self.use_delayed:
            delayed_result = delayed(self.result_builder.build_result)(**outputs)
        else:
            delayed_result = self.result_builder.build_result(**outputs)
        if self.visualize_kwargs is not None:
            delayed_result.visualize(**self.visualize_kwargs)
        if self.compute_at_end:
            (result,) = compute(delayed_result)
            return result
        else:
            return delayed_result


class DaskDataFrameResult(base.ResultMixin):
    @staticmethod
    def build_result(**outputs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Builds a dask dataframe from the outputs.

        This has some assumptions:
         1. the order specified in the output will mirror the order of "joins" here.
         2. it tries to massage types into dask types where it can
         3. otherwise it duplicates any "scalars/objects" using the first valid input with an index as the
            template. It assumes a single partition.
        """

        def get_output_name(output_name: str, column_name: str) -> str:
            """Add function prefix to columns.
            Note this means that they stop being valid python identifiers due to the `.` in the string.
            """
            return f"{output_name}.{column_name}"

        if len(outputs) == 0:
            raise ValueError("No outputs were specified. Cannot build a dataframe.")
        if logger.isEnabledFor(logging.DEBUG):
            for k, v in outputs.items():
                logger.debug(f"Got column {k}, with type [{type(v)}].")

        length = 0
        index = None
        massaged_outputs = {}
        columns_expected = []
        for k, v in outputs.items():
            if isinstance(v, (dask.dataframe.Series, dask.dataframe.DataFrame)):
                if length == 0:
                    length = len(v)
                    index = v.index
                massaged_outputs[k] = v
                if isinstance(v, dask.dataframe.Series):
                    columns_expected.append(k)
                else:
                    columns_expected.extend([get_output_name(k, v_col) for v_col in v.columns])
            elif isinstance(v, (pd.Series, pd.DataFrame)):
                converted = dask.dataframe.from_pandas(v, npartitions=1)
                massaged_outputs[k] = converted
                if length == 0:
                    length = len(converted)
                    index = converted.index
                if isinstance(v, pd.Series):
                    columns_expected.append(k)
                else:
                    columns_expected.extend([get_output_name(k, v_col) for v_col in v.columns])
            elif isinstance(v, (np.ndarray, np.generic)):
                massaged_outputs[k] = dask.dataframe.from_array(v)
                columns_expected.append(k)
            elif isinstance(v, (list, tuple)):
                massaged_outputs[k] = dask.dataframe.from_array(dask.array.from_array(v))
                columns_expected.append(k)
            elif isinstance(v, (dask.dataframe.core.Scalar,)):
                scalar = v.compute()
                if length == 0:
                    massaged_outputs[k] = dask.dataframe.from_pandas(
                        pd.DataFrame([scalar], index=[0]), npartitions=1
                    )
                else:
                    massaged_outputs[k] = dask.dataframe.from_pandas(
                        pd.DataFrame([scalar] * length, index=index), npartitions=1
                    )
                columns_expected.append(k)
            elif isinstance(v, (int, float, str, bool, object)):
                scalar = v
                if length == 0:
                    massaged_outputs[k] = dask.dataframe.from_pandas(
                        pd.DataFrame([scalar], index=[0]), npartitions=1
                    )
                else:
                    massaged_outputs[k] = dask.dataframe.from_pandas(
                        pd.DataFrame([scalar] * length, index=index), npartitions=1
                    )
                columns_expected.append(k)
            else:
                raise ValueError(
                    f"Unknown type {type(v)} for output {k}. "
                    f"Do not know how to handle making a dataframe from this."
                )

        # assumption is that everything here is a dask series or dataframe
        # we assume that we do column concatenation and that it's an outer join (TBD: make this configurable)
        _df = dask.dataframe.multi.concat(
            [o for o in massaged_outputs.values()], axis=1, join="outer"
        )
        _df.columns = columns_expected
        return _df


# TODO: add ResultMixins for dask types


class DaskExecutor(executors.TaskExecutor):
    """A DaskExecutor for task-based execution on dask in the new Hamilton execution API."""

    def __init__(self, *, client: DaskClient):
        """Initializes the DaskExecutor. Note this currently takes in the client -- we will likely
        add the ability to make it take in parameters to instantiate/tear down a client on its own.
        This just allows full flexibility for now.

        """
        self.client = client

    def init(self):
        """No-op -- client already passed in by the user."""
        pass

    def finalize(self):
        """No-op -- client already passed in by the user, who is responsible for shutting it
        down."""
        pass

    def submit_task(self, task: executors.TaskImplementation) -> executors.TaskFuture:
        """Submits a task using the dask futures API. Note that we are not using dask delayed --
        as the idea is that tasks are potentially dynamic, meaning that we have to resolve some
        before we create others. That makes the delayed API a little messier -- we would have to
        call .compute() at certain steps. We *may* consider doing this, but for now, we are just
        utilizing the futures API, and grouping it into tasks.

        :param task: Task to execute (contains all arguments necessary)
        :return: The future for the task
        """

        return executors.TaskFutureWrappingPythonFuture(
            self.client.submit(executors.base_execute_task, task)
        )

    def can_submit_task(self) -> bool:
        """For now we always can -- it will block on the dask side.

        :return: True
        """
        return True
