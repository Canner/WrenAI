import abc
import functools
import json
import logging
import time
import typing

import ray
from ray import workflow

from hamilton import base, htypes, lifecycle, node
from hamilton.execution import executors
from hamilton.execution.executors import TaskFuture
from hamilton.execution.grouping import TaskImplementation
from hamilton.function_modifiers.metadata import RAY_REMOTE_TAG_NAMESPACE

logger = logging.getLogger(__name__)


def raify(fn):
    """Makes the function into something ray-friendly.
    This is necessary due to https://github.com/ray-project/ray/issues/28146.

    :param fn: Function to make ray-friendly
    :return: The ray-friendly version
    """
    if isinstance(fn, functools.partial):

        def new_fn(*args, **kwargs):
            return fn(*args, **kwargs)

        return new_fn
    return fn


def parse_ray_remote_options_from_tags(tags: typing.Dict[str, str]) -> typing.Dict[str, typing.Any]:
    """DRY helper to parse ray.remote(**options) from Hamilton Tags

    Tags are added to nodes via the @ray_remote_options decorator

    :param tags: Full set of Tags for a Node
    :return: The ray-friendly version
    """

    ray_tags = {
        tag_name: tag_value
        for tag_name, tag_value in tags.items()
        if tag_name.startswith(f"{RAY_REMOTE_TAG_NAMESPACE}.")
    }
    ray_options = {name.split(".", 1)[1]: json.loads(value) for name, value in ray_tags.items()}

    return ray_options


class RayGraphAdapter(
    lifecycle.base.BaseDoRemoteExecute,
    lifecycle.base.BaseDoBuildResult,
    lifecycle.base.BaseDoValidateInput,
    lifecycle.base.BaseDoCheckEdgeTypesMatch,
    lifecycle.base.BasePostGraphExecute,
    abc.ABC,
):
    """Class representing what's required to make Hamilton run on Ray.

    This walks the graph and translates it to run onto `Ray <https://ray.io/>`__.

    Use `pip install sf-hamilton[ray]` to get the dependencies required to run this.

    Use this if:

      * you want to utilize multiple cores on a single machine, or you want to scale to larger data set sizes with\
        a Ray cluster that you can connect to. Note (1): you are still constrained by machine memory size with Ray; you\
        can't just scale to any dataset size. Note (2): serialization costs can outweigh the benefits of parallelism \
        so you should benchmark your code to see if it's worth it.

    Notes on scaling:
    -----------------
      - Multi-core on single machine ✅
      - Distributed computation on a Ray cluster ✅
      - Scales to any size of data ⛔️; you are LIMITED by the memory on the instance/computer 💻.

    Function return object types supported:
    ---------------------------------------
      - Works for any python object that can be serialized by the Ray framework. ✅

    Pandas?
    --------
      - ⛔️ Ray DOES NOT do anything special about Pandas.

    CAVEATS
    -------
      - Serialization costs can outweigh the benefits of parallelism, so you should benchmark your code to see if it's\
      worth it.

    DISCLAIMER -- this class is experimental, so signature changes are a possibility!
    """

    def __init__(
        self,
        result_builder: base.ResultMixin,
        ray_init_config: typing.Dict[str, typing.Any] = None,
        shutdown_ray_on_completion: bool = False,
    ):
        """Constructor

        You have the ability to pass in a ResultMixin object to the constructor to control the return type that gets \
        produce by running on Ray.

        :param result_builder: Required. An implementation of base.ResultMixin.
        :param ray_init_config: allows to connect to an existing cluster or start a new one with custom configuration (https://docs.ray.io/en/latest/ray-core/api/doc/ray.init.html)
        :param shutdown_ray_on_completion: by default we leave the cluster open, but we can also shut it down

        """
        self.result_builder = result_builder
        if not self.result_builder:
            raise ValueError(
                "Error: ResultMixin object required. Please pass one in for `result_builder`."
            )

        self.shutdown_ray_on_completion = shutdown_ray_on_completion

        if ray_init_config is not None:
            ray.init(**ray_init_config)

    @staticmethod
    def do_validate_input(node_type: typing.Type, input_value: typing.Any) -> bool:
        # NOTE: the type of a raylet is unknown until they are computed
        if isinstance(input_value, ray._raylet.ObjectRef):
            return True
        return htypes.check_input_type(node_type, input_value)

    @staticmethod
    def do_check_edge_types_match(type_from: typing.Type, type_to: typing.Type) -> bool:
        return type_from == type_to

    def do_remote_execute(
        self,
        *,
        execute_lifecycle_for_node: typing.Callable,
        node: node.Node,
        **kwargs: typing.Dict[str, typing.Any],
    ) -> typing.Any:
        """Function that is called as we walk the graph to determine how to execute a hamilton function.

        :param execute_lifecycle_for_node: wrapper function that executes lifecycle hooks and methods
        :param kwargs: the arguments that should be passed to it.
        :return: returns a ray object reference.
        """
        ray_options = parse_ray_remote_options_from_tags(node.tags)
        return ray.remote(raify(execute_lifecycle_for_node)).options(**ray_options).remote(**kwargs)

    def do_build_result(self, outputs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Builds the result and brings it back to this running process.

        :param outputs: the dictionary of key -> Union[ray object reference | value]
        :return: The type of object returned by self.result_builder.
        """
        if logger.isEnabledFor(logging.DEBUG):
            for k, v in outputs.items():
                logger.debug(f"Got output {k}, with type [{type(v)}].")
        # need to wrap our result builder in a remote call and then pass in what we want to build from.
        remote_combine = ray.remote(self.result_builder.build_result).remote(**outputs)
        result = ray.get(remote_combine)  # this materializes the object locally
        return result

    def post_graph_execute(self, *args, **kwargs):
        """We have the option to close the cluster down after execution."""

        if self.shutdown_ray_on_completion:
            # In case we have Hamilton Tracker to have enough time to properly flush
            time.sleep(5)
            ray.shutdown()


class RayWorkflowGraphAdapter(base.HamiltonGraphAdapter, base.ResultMixin):
    """Class representing what's required to make Hamilton run Ray Workflows

    Use `pip install sf-hamilton[ray]` to get the dependencies required to run this.

    Ray workflows is a more robust way to scale computation for any type of Hamilton graph.

    What's the difference between this and RayGraphAdapter?
    --------------------------------------------------------
        * Ray workflows offer durable computation. That is, they save and checkpoint each function.
        * This enables one to run a workflow, and not have to restart it if something fails, assuming correct\
        Ray workflow usage.

    Tips
    ----
    See https://docs.ray.io/en/latest/workflows/basics.html for the source of the following:

        1. Functions should be idempotent.
        2. The workflow ID is what Ray uses to try to resume/restart if run a second time.
        3. Nothing is run until the entire DAG is walked and setup and build_result is called.

    Notes on scaling:
    -----------------
      - Multi-core on single machine ✅
      - Distributed computation on a Ray cluster ✅
      - Scales to any size of data ⛔️; you are LIMITED by the memory on the instance/computer 💻.

    Function return object types supported:
    ---------------------------------------
      - Works for any python object that can be serialized by the Ray framework. ✅

    Pandas?
    --------
      - ⛔️ Ray DOES NOT do anything special about Pandas.

    CAVEATS
    -------
      - Serialization costs can outweigh the benefits of parallelism, so you should benchmark your code to see if it's\
      worth it.

    DISCLAIMER -- this class is experimental, so signature changes are a possibility!
    """

    def __init__(self, result_builder: base.ResultMixin, workflow_id: str):
        """Constructor

        :param result_builder: Required. An implementation of base.ResultMixin.
        :param workflow_id: Required. An ID to give the ray workflow to identify it for durability purposes.
        :param max_retries: Optional. The function will be retried for the given number of times if an
            exception is raised.
        """
        self.result_builder = result_builder
        self.workflow_id = workflow_id
        if not self.result_builder:
            raise ValueError(
                "Error: ResultMixin object required. Please pass one in for `result_builder`."
            )

    @staticmethod
    def check_input_type(node_type: typing.Type, input_value: typing.Any) -> bool:
        # NOTE: the type of a raylet is unknown until they are computed
        if isinstance(input_value, ray._raylet.ObjectRef):
            return True
        return htypes.check_input_type(node_type, input_value)

    @staticmethod
    def check_node_type_equivalence(node_type: typing.Type, input_type: typing.Type) -> bool:
        return node_type == input_type

    def execute_node(self, node: node.Node, kwargs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Function that is called as we walk the graph to determine how to execute a hamilton function.

        :param node: the node from the graph.
        :param kwargs: the arguments that should be passed to it.
        :return: returns a ray object reference.
        """
        ray_options = parse_ray_remote_options_from_tags(node.tags)
        return ray.remote(raify(node.callable)).options(**ray_options).bind(**kwargs)

    def build_result(self, **outputs: typing.Dict[str, typing.Any]) -> typing.Any:
        """Builds the result and brings it back to this running process.

        :param outputs: the dictionary of key -> Union[ray object reference | value]
        :return: The type of object returned by self.result_builder.
        """
        if logger.isEnabledFor(logging.DEBUG):
            for k, v in outputs.items():
                logger.debug(f"Got output {k}, with type [{type(v)}].")
        # need to wrap our result builder in a remote call and then pass in what we want to build from.
        remote_combine = ray.remote(self.result_builder.build_result).bind(**outputs)
        result = workflow.run(
            remote_combine, workflow_id=self.workflow_id
        )  # this materializes the object locally
        return result


class RayTaskExecutor(executors.TaskExecutor):
    """Task executor using Ray for the new task-based execution mechanism in Hamilton.
    This is still experimental, so the API might change.
    """

    def __init__(
        self,
        num_cpus: int = None,
        ray_init_config: typing.Dict[str, typing.Any] = None,
        skip_init: bool = False,
    ):
        """Creates a ray task executor. Note this will likely take in more parameters. This is
        experimental, so the API will likely change, although we will do our best to make it
        backwards compatible.

        :param num_cpus: Number of cores to use for initialization, passed directly to ray.init. Defaults to all cores.
        :param ray_init_config: General configuration to pass to ray.init. Defaults to None.
        :param skip_init: Skips ray init if you already have Ray initialized. Default is False.
        """
        self.num_cpus = num_cpus
        self.ray_init_config = ray_init_config if ray_init_config else {}
        self.skip_init = skip_init

    def init(self):
        if self.skip_init:
            return
        ray.init(num_cpus=self.num_cpus, **self.ray_init_config)

    def finalize(self):
        if self.skip_init:
            # we assume that if we didn't init it, we don't need to shutdown either.
            return
        ray.shutdown()

    def submit_task(self, task: TaskImplementation) -> TaskFuture:
        """Submits a task, wrapping it in a TaskFuture (after getting the corresponding python
        future).

        :param task: Task to wrap
        :return: A future
        """

        return executors.TaskFutureWrappingPythonFuture(
            ray.remote(executors.base_execute_task).remote(task=task).future()
        )

    def can_submit_task(self) -> bool:
        """For now we can always submit a task -- it might just be delayed.

        :return: True
        """
        return True
