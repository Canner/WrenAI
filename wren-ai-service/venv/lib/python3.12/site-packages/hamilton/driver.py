import abc
import functools
import importlib
import importlib.util
import json
import logging
import operator
import pathlib
import sys
import time

# required if we want to run this code stand alone.
import typing
import uuid
from datetime import datetime
from types import ModuleType
from typing import (
    Any,
    Callable,
    Collection,
    Dict,
    List,
    Literal,
    Optional,
    Sequence,
    Set,
    Tuple,
    Union,
)

import pandas as pd

from hamilton import common, graph_types, htypes
from hamilton.caching.adapter import HamiltonCacheAdapter
from hamilton.caching.stores.base import MetadataStore, ResultStore
from hamilton.dev_utils import deprecation
from hamilton.execution import executors, graph_functions, grouping, state
from hamilton.graph_types import HamiltonNode
from hamilton.io import materialization
from hamilton.io.materialization import ExtractorFactory, MaterializerFactory
from hamilton.lifecycle import base as lifecycle_base

SLACK_ERROR_MESSAGE = (
    "-------------------------------------------------------------------\n"
    "Oh no an error! Need help with Hamilton?\n"
    "Join our slack and ask for help! https://join.slack.com/t/hamilton-opensource/shared_invite/zt-2niepkra8-DGKGf_tTYhXuJWBTXtIs4g\n"
    "-------------------------------------------------------------------\n"
)

if __name__ == "__main__":
    import base
    import graph
    import node
    import telemetry
else:
    from . import base, graph, node, telemetry

logger = logging.getLogger(__name__)


def capture_function_usage(call_fn: Callable) -> Callable:
    """Decorator to wrap some driver functions for telemetry capture.

    We want to use this for non-constructor and non-execute functions.
    We don't capture information about the arguments at this stage,
    just the function name.

    :param call_fn: the Driver function to capture.
    :return: wrapped function.
    """

    @functools.wraps(call_fn)
    def wrapped_fn(*args, **kwargs):
        try:
            return call_fn(*args, **kwargs)
        finally:
            if telemetry.is_telemetry_enabled():
                try:
                    function_name = call_fn.__name__
                    event_json = telemetry.create_driver_function_invocation_event(function_name)
                    telemetry.send_event_json(event_json)
                except Exception as e:
                    if logger.isEnabledFor(logging.DEBUG):
                        logger.error(
                            f"Failed to send telemetry for function usage. Encountered: {e}\n"
                        )

    return wrapped_fn


# This is kept in here for backwards compatibility
# You will want to refer to graph_types.HamiltonNode
Variable = graph_types.HamiltonNode


class InvalidExecutorException(Exception):
    """Raised when the executor is invalid for the given graph."""

    pass


class GraphExecutor(abc.ABC):
    """Interface for the graph executor. This runs a function graph,
    given a function graph, inputs, and overrides."""

    @abc.abstractmethod
    def execute(
        self,
        fg: graph.FunctionGraph,
        final_vars: List[Union[str, Callable, Variable]],
        overrides: Dict[str, Any],
        inputs: Dict[str, Any],
        run_id: str,
    ) -> Dict[str, Any]:
        """Executes a graph in a blocking function.

        :param fg: Graph to execute
        :param final_vars: Variables we want
        :param overrides: Overrides --- these short-circuit computation
        :param inputs: Inputs to the Graph.
        :param adapter: Adapter to use for execution (optional).
        :param run_id: Run ID for the DAG run.
        :return: The output of the final variables, in dictionary form.
        """
        pass

    @abc.abstractmethod
    def validate(self, nodes_to_execute: List[node.Node]):
        """Validates whether the executor can execute the given graph.
        Some executors allow API constructs that others do not support
        (such as Parallelizable[]/Collect[])

        :param fg: Graph to execute
        :return: Whether or not the executor can execute the graph.
        """
        pass


class DefaultGraphExecutor(GraphExecutor):
    DEFAULT_TASK_NAME = "root"  # Not task-based, so we just assign a default name for a task

    def __init__(self, adapter: Optional[lifecycle_base.LifecycleAdapterSet] = None):
        """Constructor for the default graph executor.

        :param adapter: Adapter to use for execution (optional).
        """
        self.adapter = adapter

    def validate(self, nodes_to_execute: List[node.Node]):
        """The default graph executor cannot handle parallelizable[]/collect[] nodes.

        :param nodes_to_execute:
        :raises InvalidExecutorException: if the graph contains parallelizable[]/collect[] nodes.
        """
        for node_ in nodes_to_execute:
            if node_.node_role in (node.NodeType.EXPAND, node.NodeType.COLLECT):
                raise InvalidExecutorException(
                    f"Default graph executor cannot handle parallelizable[]/collect[] nodes. "
                    f"Node {node_.name} defined by functions: "
                    f"{[fn.__qualname__ for fn in node_.originating_functions]}"
                )

    def execute(
        self,
        fg: graph.FunctionGraph,
        final_vars: List[str],
        overrides: Dict[str, Any],
        inputs: Dict[str, Any],
        run_id: str,
    ) -> Dict[str, Any]:
        """Basic executor for a function graph. Does no task-based execution, just does a DFS
        and executes the graph in order, in memory."""
        memoized_computation = dict()  # memoized storage
        nodes = [fg.nodes[node_name] for node_name in final_vars if node_name in fg.nodes]
        fg.execute(nodes, memoized_computation, overrides, inputs, run_id=run_id)
        outputs = {
            # we do this here to enable inputs to also be used as outputs
            # putting inputs into memoized before execution doesn't work due to some graphadapter assumptions.
            final_var: memoized_computation.get(final_var, inputs.get(final_var))
            for final_var in final_vars
        }  # only want request variables in df.
        del memoized_computation  # trying to cleanup some memory
        return outputs


class TaskBasedGraphExecutor(GraphExecutor):
    def validate(self, nodes_to_execute: List[node.Node]):
        """Currently this can run every valid graph"""
        pass

    def __init__(
        self,
        execution_manager: executors.ExecutionManager,
        grouping_strategy: grouping.GroupingStrategy,
        adapter: lifecycle_base.LifecycleAdapterSet,
    ):
        """Executor for task-based execution. This enables grouping of nodes into tasks, as
        well as parallel execution/dynamic spawning of nodes.

        :param execution_manager: Utility to assign task executors to node groups
        :param grouping_strategy: Utility to group nodes into tasks
        :param result_builder: Utility to build the final result"""

        self.execution_manager = execution_manager
        self.grouping_strategy = grouping_strategy
        self.adapter = adapter

    def execute(
        self,
        fg: graph.FunctionGraph,
        final_vars: List[str],
        overrides: Dict[str, Any],
        inputs: Dict[str, Any],
        run_id: str,
    ) -> Dict[str, Any]:
        """Executes a graph, task by task. This blocks until completion.

        This does the following:
        1. Groups the nodes into tasks
        2. Creates an execution state and a results cache
        3. Runs it to completion, populating the results cache
        4. Returning the results from the results cache
        """
        inputs = graph_functions.combine_config_and_inputs(fg.config, inputs)
        (
            transform_nodes_required_for_execution,
            user_defined_nodes_required_for_execution,
        ) = fg.get_upstream_nodes(final_vars, runtime_inputs=inputs, runtime_overrides=overrides)

        all_nodes_required_for_execution = list(
            set(transform_nodes_required_for_execution).union(
                user_defined_nodes_required_for_execution
            )
        )
        grouped_nodes = self.grouping_strategy.group_nodes(
            all_nodes_required_for_execution
        )  # pure function transform
        # Instantiate a result cache so we can use later
        # Pass in inputs so we can pre-populate the results cache
        prehydrated_results = {**overrides, **inputs}
        results_cache = state.DictBasedResultCache(prehydrated_results)
        # Create tasks from the grouped nodes, filtering/pruning as we go
        tasks = grouping.create_task_plan(grouped_nodes, final_vars, overrides, self.adapter)
        # Create a task graph and execution state
        execution_state = state.ExecutionState(
            tasks, results_cache, run_id
        )  # Stateful storage for the DAG
        # Blocking call to run through until completion
        executors.run_graph_to_completion(execution_state, self.execution_manager)
        # Read the final variables from the result cache
        raw_result = results_cache.read(final_vars)
        return raw_result


class Driver:
    """This class orchestrates creating and executing the DAG to create a dataframe.

    .. code-block:: python

        from hamilton import driver
        from hamilton import base

        # 1. Setup config or invariant input.
        config = {}

        # 2. we need to tell hamilton where to load function definitions from
        import my_functions

        # or programmatically (e.g. you can script module loading)
        module_name = "my_functions"
        my_functions = importlib.import_module(module_name)

        # 3. Determine the return type -- default is a pandas.DataFrame.
        adapter = base.SimplePythonDataFrameGraphAdapter()  # See GraphAdapter docs for more details.

        # These all feed into creating the driver & thus DAG.
        dr = driver.Driver(config, module, adapter=adapter)
    """

    def __getstate__(self):
        """Used for serialization."""
        # Copy the object's state from self.__dict__
        state = self.__dict__.copy()
        # Remove the unpicklable entries -- right now it's the modules tracked.
        state["__graph_module_names"] = [
            importlib.util.find_spec(m.__name__).name for m in state["graph_modules"]
        ]
        del state["graph_modules"]  # remove from state
        return state

    def __setstate__(self, state):
        """Used for deserialization."""
        # Restore instance attributes
        self.__dict__.update(state)
        # Reinitialize the unpicklable entries
        # assumption is that the modules are importable in the new process
        self.graph_modules = []
        for n in state["__graph_module_names"]:
            try:
                g_module = importlib.import_module(n)
            except ImportError:
                logger.error(f"Could not import module {n}")
                continue
            else:
                self.graph_modules.append(g_module)

    @staticmethod
    def normalize_adapter_input(
        adapter: Optional[
            Union[
                lifecycle_base.LifecycleAdapter,
                List[lifecycle_base.LifecycleAdapter],
                lifecycle_base.LifecycleAdapterSet,
            ]
        ],
        use_legacy_adapter: bool = True,
    ) -> lifecycle_base.LifecycleAdapterSet:
        """Normalizes the adapter argument in the driver to a list of adapters. Adds back the legacy adapter if needed.

        Note that, in the past, hamilton required a graph adapter. Now it is only required to be included in the legacy case
        default behavior has been modified to handle anything a result builder did.

        :param adapter: Adapter to include
        :param use_legacy_adapter:  Whether to use the legacy adapter. Defaults to True.
        :return: A lifecycle adapter set.
        """
        if adapter is None:
            adapter = []
        if isinstance(adapter, lifecycle_base.LifecycleAdapterSet):
            return adapter
        if not isinstance(adapter, list):
            adapter = [adapter]
        # we have to have exactly one result builder
        contains_result_builder = False
        for adapter_impl in adapter:
            if isinstance(adapter_impl, lifecycle_base.BaseDoBuildResult):
                contains_result_builder = True
        if not contains_result_builder:
            if use_legacy_adapter:
                adapter.append(base.PandasDataFrameResult())
        return lifecycle_base.LifecycleAdapterSet(*adapter)

    @staticmethod
    def _perform_graph_validations(
        adapter: lifecycle_base.LifecycleAdapterSet,
        graph: graph.FunctionGraph,
        graph_modules: typing.Sequence[ModuleType],
    ):
        """Utility function to perform graph validations. Static so we're not stuck with local state

        :param adapter: Adapter to use for validation.
        :param graph: Graph to validate.
        :param graph_modules: Modules to validate.
        """

        if adapter.does_validation("validate_node"):
            node_validation_results = {}
            for node_ in graph.nodes.values():
                validation_results = [
                    result.error
                    for result in adapter.call_all_validators_sync(
                        "validate_node",
                        output_only_failures=True,  # just failures so we can just store messages
                        created_node=node_,
                    )
                    if not result.success
                ]
                if len(validation_results) > 0:
                    node_validation_results[node_.name] = validation_results
            # if any have failed
            if len(node_validation_results) > 0:
                error_delimiter = "\n\t"  # expression fragments not allowed in f-strings
                errors = [
                    f"{node_name}: {error_delimiter.join([item for item in messages])}"
                    for node_name, messages in sorted(
                        node_validation_results.items(), key=operator.itemgetter(0)
                    )
                ]
                error_str = (
                    f"Node validation failed! {len(errors)} errors encountered:\n  "
                    + "\n  ".join(errors)
                )
                raise lifecycle_base.ValidationException(error_str)
        if adapter.does_validation("validate_graph"):
            validation_results = adapter.call_all_validators_sync(
                "validate_graph",
                output_only_failures=True,
                graph=graph,
                modules=graph_modules,
                config=graph.config,
            )
            if validation_results:
                error_delimiter = "\t"
                errors = sorted([result.error for result in validation_results])
                error_str = (
                    f"Graph validation failed! {len(errors)} errors encountered:{error_delimiter}"
                    + error_delimiter.join(errors)
                )
                raise lifecycle_base.ValidationException(error_str)

    def __init__(
        self,
        config: Dict[str, Any],
        *modules: ModuleType,
        adapter: Optional[
            Union[lifecycle_base.LifecycleAdapter, List[lifecycle_base.LifecycleAdapter]]
        ] = None,
        allow_module_overrides: bool = False,
        _materializers: typing.Sequence[Union[ExtractorFactory, MaterializerFactory]] = None,
        _graph_executor: GraphExecutor = None,
        _use_legacy_adapter: bool = True,
    ):
        """Constructor: creates a DAG given the configuration & modules to crawl.

        :param config: This is a dictionary of initial data & configuration.
            The contents are used to help create the DAG.
        :param modules: Python module objects you want to inspect for Hamilton Functions.
        :param adapter: Optional. A way to wire in another way of "executing" a hamilton graph.
            Defaults to using original Hamilton adapter which is single threaded in memory python.
        :param allow_module_overrides: Optional. Same named functions get overridden by later modules.
            The order of listing the modules is important, since later ones will overwrite the previous ones.
            This is a global call affecting all imported modules.
            See https://github.com/DAGWorks-Inc/hamilton/tree/main/examples/module_overrides for more info.
        :param _materializers: Not public facing, do not use this parameter. This is injected by the builder.
        :param _graph_executor: Not public facing, do not use this parameter. This is injected by the builder.
            If you need to tune execution, use the builder to do so.
        :param _use_legacy_adapter: Not public facing, do not use this parameter.
            This represents whether or not to use the legacy adapter. Defaults to True, as this should be
            backwards compatible. In Hamilton 2.0.0, this will be removed.

        """

        self.driver_run_id = uuid.uuid4()
        adapter = self.normalize_adapter_input(adapter, use_legacy_adapter=_use_legacy_adapter)
        if adapter.does_hook("pre_do_anything", is_async=False):
            adapter.call_all_lifecycle_hooks_sync("pre_do_anything")
        error = None
        self.graph_modules = modules
        try:
            self.graph = graph.FunctionGraph.from_modules(
                *modules,
                config=config,
                adapter=adapter,
                allow_module_overrides=allow_module_overrides,
            )
            if _materializers:
                materializer_factories, extractor_factories = self._process_materializers(
                    _materializers
                )
                self.graph = materialization.modify_graph(
                    self.graph, materializer_factories, extractor_factories
                )
            Driver._perform_graph_validations(adapter, graph=self.graph, graph_modules=modules)
            if adapter.does_hook("post_graph_construct", is_async=False):
                adapter.call_all_lifecycle_hooks_sync(
                    "post_graph_construct", graph=self.graph, modules=modules, config=config
                )
            self.adapter = adapter
            if _graph_executor is None:
                _graph_executor = DefaultGraphExecutor(self.adapter)
            self.graph_executor = _graph_executor
            self.config = config
        except Exception as e:
            error = telemetry.sanitize_error(*sys.exc_info())
            logger.error(SLACK_ERROR_MESSAGE)
            raise e
        finally:
            # TODO -- update this to use the lifecycle methods
            self.capture_constructor_telemetry(error, modules, config, adapter)

    def _repr_mimebundle_(self, include=None, exclude=None, **kwargs):
        """Attribute read by notebook renderers
        This returns the attribute of the `graphviz.Digraph` returned by `self.display_all_functions()`

        The parameters `include`, `exclude`, and `**kwargs` are required, but not explicitly used
        ref: https://ipython.readthedocs.io/en/stable/config/integrating.html
        """
        dot = self.display_all_functions()
        return dot._repr_mimebundle_(include=include, exclude=exclude, **kwargs)

    def capture_constructor_telemetry(
        self,
        error: Optional[str],
        modules: Tuple[ModuleType],
        config: Dict[str, Any],
        adapter: lifecycle_base.LifecycleAdapterSet,
    ):
        """Captures constructor telemetry. Notes:
        (1) we want to do this in a way that does not break.
        (2) we need to account for all possible states, e.g. someone passing in None, or assuming that
        the entire constructor code ran without issue, e.g. `adapter` was assigned to `self`.

        :param error: the sanitized error string to send.
        :param modules: the list of modules, could be None.
        :param config: the config dict passed, could be None.
        :param adapter: the adapter passed in, might not be attached to `self` yet.
        """
        if telemetry.is_telemetry_enabled():
            try:
                # adapter_name = telemetry.get_adapter_name(adapter)
                lifecycle_adapter_names = telemetry.get_all_adapters_names(adapter)
                result_builder = telemetry.get_result_builder_name(adapter)
                # being defensive here with ensuring values exist
                payload = telemetry.create_start_event_json(
                    len(self.graph.nodes) if hasattr(self, "graph") else 0,
                    len(modules) if modules else 0,
                    len(config) if config else 0,
                    dict(self.graph.decorator_counter) if hasattr(self, "graph") else {},
                    "deprecated -- see lifecycle_adapters_used",
                    lifecycle_adapter_names,
                    result_builder,
                    self.driver_run_id,
                    error,
                    self.graph_executor.__class__.__name__,
                )
                telemetry.send_event_json(payload)
            except Exception as e:
                # we don't want this to fail at all!
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug(f"Error caught in processing telemetry: {e}")

    @staticmethod
    def validate_inputs(
        fn_graph: graph.FunctionGraph,
        adapter: Union[
            lifecycle_base.LifecycleAdapter,
            List[lifecycle_base.LifecycleAdapter],
            lifecycle_base.LifecycleAdapterSet,
        ],
        user_nodes: Collection[node.Node],
        inputs: typing.Optional[Dict[str, Any]] = None,
        nodes_set: Collection[node.Node] = None,
    ):
        """Validates that inputs meet our expectations. This means that:
        1. The runtime inputs don't clash with the graph's config
        2. All expected graph inputs are provided, either in config or at runtime

        :param fn_graph: The function graph to validate.
        :param adapter: The adapter to use for validation.
        :param user_nodes: The required nodes we need for computation.
        :param inputs: the user inputs provided.
        :param nodes_set: the set of nodes to use for validation; Optional.
        """
        # TODO -- determine whether or not we want to use the legacy adapter if nothing is here
        # We shouldn't need to do this (normalize the inputs), as we have already, but the bigger issue
        # is that we need to decide whether this method should be static or not
        # For now, it is internal-facing, so we have the ability to make changes
        adapter = Driver.normalize_adapter_input(adapter)
        if inputs is None:
            inputs = {}
        if nodes_set is None:
            nodes_set = set(fn_graph.nodes.values())
        (all_inputs,) = (graph_functions.combine_config_and_inputs(fn_graph.config, inputs),)
        errors = []
        for user_node in user_nodes:
            if user_node.name not in all_inputs:
                if graph_functions.node_is_required_by_anything(user_node, nodes_set):
                    errors.append(
                        f"Error: Required input {user_node.name} not provided "
                        f"for nodes: {[node.name for node in user_node.depended_on_by]}."
                    )
            else:
                valid = all_inputs[user_node.name] is None
                if adapter.does_method("do_validate_input", is_async=False):
                    # For now this is an or-gate, as are the rest.
                    # We may consider changing this/adding another method or type
                    valid |= adapter.call_lifecycle_method_sync(
                        "do_validate_input",
                        node_type=user_node.type,
                        input_value=all_inputs[user_node.name],
                    )
                else:
                    valid |= htypes.check_input_type(user_node.type, all_inputs[user_node.name])
                if not valid:
                    errors.append(
                        f"Error: Type requirement mismatch. Expected {user_node.name}:{user_node.type} "  # noqa: E231
                        f"got {all_inputs[user_node.name]}:{type(all_inputs[user_node.name])} instead."  # noqa: E231
                    )
        if errors:
            errors.sort()
            error_str = f"{len(errors)} errors encountered: \n  " + "\n  ".join(errors)
            raise ValueError(error_str)

    def execute(
        self,
        final_vars: List[Union[str, Callable, Variable]],
        overrides: Dict[str, Any] = None,
        display_graph: bool = False,
        inputs: Dict[str, Any] = None,
    ) -> Any:
        """Executes computation.

        :param final_vars: the final list of outputs we want to compute.
        :param overrides: values that will override "nodes" in the DAG.
        :param display_graph: DEPRECATED. Whether we want to display the graph being computed.
        :param inputs: Runtime inputs to the DAG.
        :return: an object consisting of the variables requested, matching the type returned by the GraphAdapter.
            See constructor for how the GraphAdapter is initialized. The default one right now returns a pandas
            dataframe.
        """
        if display_graph:
            logger.warning(
                "display_graph=True is deprecated. It will be removed in the 2.0.0 release. "
                "Please use visualize_execution()."
            )
        start_time = time.time()
        run_id = str(uuid.uuid4())
        run_successful = True
        error_execution = None
        error_telemetry = None
        outputs = None
        _final_vars = self._create_final_vars(final_vars)
        if self.adapter.does_hook("pre_graph_execute", is_async=False):
            self.adapter.call_all_lifecycle_hooks_sync(
                "pre_graph_execute",
                run_id=run_id,
                graph=self.graph,
                final_vars=_final_vars,
                inputs=inputs,
                overrides=overrides,
            )
        try:
            outputs = self.__raw_execute(
                _final_vars, overrides, display_graph, inputs=inputs, _run_id=run_id
            )
            if self.adapter.does_method("do_build_result", is_async=False):
                # Build the result if we have a result builder
                outputs = self.adapter.call_lifecycle_method_sync(
                    "do_build_result", outputs=outputs
                )
            # Otherwise just return a dict
        except Exception as e:
            run_successful = False
            logger.error(SLACK_ERROR_MESSAGE)
            error_execution = e
            error_telemetry = telemetry.sanitize_error(*sys.exc_info())
            raise e
        finally:
            if self.adapter.does_hook("post_graph_execute", is_async=False):
                self.adapter.call_all_lifecycle_hooks_sync(
                    "post_graph_execute",
                    run_id=run_id,
                    graph=self.graph,
                    success=run_successful,
                    error=error_execution,
                    results=outputs,
                )
            duration = time.time() - start_time
            self.capture_execute_telemetry(
                error_telemetry, _final_vars, inputs, overrides, run_successful, duration
            )
        return outputs

    def _create_final_vars(self, final_vars: List[Union[str, Callable, Variable]]) -> List[str]:
        """Creates the final variables list - converting functions names as required.

        :param final_vars:
        :return: list of strings in the order that final_vars was provided.
        """
        _module_set = {_module.__name__ for _module in self.graph_modules}
        _final_vars = common.convert_output_values(final_vars, _module_set)
        return _final_vars

    def capture_execute_telemetry(
        self,
        error: Optional[str],
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        run_successful: bool,
        duration: float,
    ):
        """Captures telemetry after execute has run.

        Notes:
        (1) we want to be quite defensive in not breaking anyone's code with things we do here.
        (2) thus we want to double-check that values exist before doing something with them.

        :param error: the sanitized error string to capture, if any.
        :param final_vars: the list of final variables to get.
        :param inputs: the inputs to the execute function.
        :param overrides: any overrides to the execute function.
        :param run_successful: whether this run was successful.
        :param duration: time it took to run execute.
        """
        if telemetry.is_telemetry_enabled():
            try:
                payload = telemetry.create_end_event_json(
                    run_successful,
                    duration,
                    len(final_vars) if final_vars else 0,
                    len(overrides) if isinstance(overrides, Dict) else 0,
                    len(inputs) if isinstance(overrides, Dict) else 0,
                    self.driver_run_id,
                    error,
                )
                telemetry.send_event_json(payload)
            except Exception as e:
                # we don't want this to fail at all!
                if logger.isEnabledFor(logging.DEBUG):
                    logger.debug(f"Error caught in processing telemetry: \n{e}")

    @deprecation.deprecated(
        warn_starting=(1, 0, 0),
        fail_starting=(2, 0, 0),
        use_this=None,
        explanation="This has become a private method and does not guarantee that all the adapters work correctly.",
        migration_guide="Don't use this entry point for execution directly. Always go through `.execute()`or `.materialize()`.",
    )
    def raw_execute(
        self,
        final_vars: List[str],
        overrides: Dict[str, Any] = None,
        display_graph: bool = False,
        inputs: Dict[str, Any] = None,
        _fn_graph: graph.FunctionGraph = None,
    ) -> Dict[str, Any]:
        """Raw execute function that does the meat of execute.

        Don't use this entry point for execution directly. Always go through `.execute()` or `.materialize()`.
        In case you are using `.raw_execute()` directly, please switch to `.execute()` using a
        `base.DictResult()`. Note: `base.DictResult()` is the default return of execute if you are
        using the `driver.Builder()` class to create a `Driver()` object.

        :param final_vars: Final variables to compute
        :param overrides: Overrides to run.
        :param display_graph: DEPRECATED. DO NOT USE. Whether or not to display the graph when running it
        :param inputs: Runtime inputs to the DAG
        :return:
        """
        function_graph = _fn_graph if _fn_graph is not None else self.graph
        run_id = str(uuid.uuid4())
        nodes, user_nodes = function_graph.get_upstream_nodes(final_vars, inputs, overrides)
        Driver.validate_inputs(
            function_graph, self.adapter, user_nodes, inputs, nodes
        )  # TODO -- validate within the function graph itself
        if display_graph:  # deprecated flow.
            logger.warning(
                "display_graph=True is deprecated. It will be removed in the 2.0.0 release. "
                "Please use visualize_execution()."
            )
            self.visualize_execution(final_vars, "test-output/execute.gv", {"view": True})
            if self.has_cycles(
                final_vars, function_graph
            ):  # here for backwards compatible driver behavior.
                raise ValueError("Error: cycles detected in your graph.")
        all_nodes = nodes | user_nodes
        self.graph_executor.validate(list(all_nodes))
        if self.adapter.does_hook("pre_graph_execute", is_async=False):
            self.adapter.call_all_lifecycle_hooks_sync(
                "pre_graph_execute",
                run_id=run_id,
                graph=function_graph,
                final_vars=final_vars,
                inputs=inputs,
                overrides=overrides,
            )
        results = None
        error = None
        success = False
        try:
            results = self.graph_executor.execute(
                function_graph,
                final_vars,
                overrides if overrides is not None else {},
                inputs if inputs is not None else {},
                run_id,
            )
            success = True
        except Exception as e:
            error = e
            success = False
            raise e
        finally:
            if self.adapter.does_hook("post_graph_execute", is_async=False):
                self.adapter.call_all_lifecycle_hooks_sync(
                    "post_graph_execute",
                    run_id=run_id,
                    graph=function_graph,
                    success=success,
                    error=error,
                    results=results,
                )
        return results

    def __raw_execute(
        self,
        final_vars: List[str],
        overrides: Dict[str, Any] = None,
        display_graph: bool = False,
        inputs: Dict[str, Any] = None,
        _fn_graph: graph.FunctionGraph = None,
        _run_id: str = None,
    ) -> Dict[str, Any]:
        """Raw execute function that does the meat of execute.

        Private method since the result building and post_graph_execute lifecycle hooks are performed outside and so this returns an incomplete result.

        :param final_vars: Final variables to compute
        :param overrides: Overrides to run.
        :param display_graph: DEPRECATED. DO NOT USE. Whether or not to display the graph when running it
        :param inputs: Runtime inputs to the DAG
        :return:
        """
        function_graph = _fn_graph if _fn_graph is not None else self.graph
        run_id = _run_id
        nodes, user_nodes = function_graph.get_upstream_nodes(final_vars, inputs, overrides)
        Driver.validate_inputs(
            function_graph, self.adapter, user_nodes, inputs, nodes
        )  # TODO -- validate within the function graph itself
        if display_graph:  # deprecated flow.
            logger.warning(
                "display_graph=True is deprecated. It will be removed in the 2.0.0 release. "
                "Please use visualize_execution()."
            )
            self.visualize_execution(final_vars, "test-output/execute.gv", {"view": True})
            if self.has_cycles(
                final_vars, function_graph
            ):  # here for backwards compatible driver behavior.
                raise ValueError("Error: cycles detected in your graph.")
        all_nodes = nodes | user_nodes
        self.graph_executor.validate(list(all_nodes))
        results = None
        try:
            results = self.graph_executor.execute(
                function_graph,
                final_vars,
                overrides if overrides is not None else {},
                inputs if inputs is not None else {},
                run_id,
            )
            return results
        except Exception as e:
            raise e

    @capture_function_usage
    def list_available_variables(
        self, *, tag_filter: Dict[str, Union[Optional[str], List[str]]] = None
    ) -> List[Variable]:
        """Returns available variables, i.e. outputs.

        These variables correspond 1:1 with nodes in the DAG, and contain the following information:

            1. name: the name of the node
            2. tags: the tags associated with this node
            3. type: The type of data this node returns
            4. is_external_input: Whether this node represents an external input (required from outside), \
            or not (has a function specifying its behavior).


        .. code-block:: python

            # gets all
            dr.list_available_variables()
            # gets exact matching tag name and tag value
            dr.list_available_variables({"TAG_NAME": "TAG_VALUE"})
            # gets all matching tag name and at least one of the values in the list
            dr.list_available_variables({"TAG_NAME": ["TAG_VALUE1", "TAG_VALUE2"]})
            # gets all with matching tag name, irrespective of value
            dr.list_available_variables({"TAG_NAME": None})
            # AND query between the two tags (i.e. both need to match)
            dr.list_available_variables({"TAG_NAME": "TAG_VALUE", "TAG_NAME2": "TAG_VALUE2"}

        :param tag_filter: A dictionary of tags to filter by. Only nodes matching the tags and their values will
            be returned. If the value for a tag is None, then we will return all nodes with that tag. If the value
            is non-empty we will return all nodes with that tag and that value.
        :return: list of available variables (i.e. outputs).
        """
        all_nodes = self.graph.get_nodes()
        if tag_filter:
            valid_filter_values = all(
                map(
                    lambda x: isinstance(x, str)
                    or (isinstance(x, list) and len(x) != 0)
                    or x is None,
                    tag_filter.values(),
                )
            )
            if not valid_filter_values:
                raise ValueError("All tag query values must be a string or list of strings")
            results = []
            for n in all_nodes:
                if node.matches_query(n.tags, tag_filter):
                    results.append(Variable.from_node(n))
        else:
            results = [Variable.from_node(n) for n in all_nodes]
        return results

    @capture_function_usage
    def display_all_functions(
        self,
        output_file_path: str = None,
        render_kwargs: dict = None,
        graphviz_kwargs: dict = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Displays the graph of all functions loaded!

        :param output_file_path: the full URI of path + file name to save the dot file to.
            E.g. 'some/path/graph-all.dot'. Optional. No need to pass it in if you're in a Jupyter Notebook.
        :param render_kwargs: a dictionary of values we'll pass to graphviz render function. Defaults to viewing.
            If you do not want to view the file, pass in `{'view':False}`.
            See https://graphviz.readthedocs.io/en/stable/api.html#graphviz.Graph.render for other options.
        :param graphviz_kwargs: Optional. Kwargs to be passed to the graphviz graph object to configure it.
            E.g. dict(graph_attr={'ratio': '1'}) will set the aspect ratio to be equal of the produced image.
            See https://graphviz.org/doc/info/attrs.html for options.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, display the schema of the DAG if
            the nodes have schema data provided
        :param custom_style_function: Optional. Custom style function. See example in repository for example use.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :return: the graphviz object if you want to do more with it.
            If returned as the result in a Jupyter Notebook cell, it will render.
        """
        try:
            return self.graph.display_all(
                output_file_path,
                render_kwargs,
                graphviz_kwargs,
                show_legend=show_legend,
                orient=orient,
                hide_inputs=hide_inputs,
                deduplicate_inputs=deduplicate_inputs,
                display_fields=show_schema,
                custom_style_function=custom_style_function,
                keep_dot=keep_dot,
            )
        except ImportError as e:
            logger.warning(f"Unable to import {e}", exc_info=True)

    @staticmethod
    def _visualize_execution_helper(
        fn_graph: graph.FunctionGraph,
        adapter: lifecycle_base.LifecycleAdapterSet,
        final_vars: List[str],
        output_file_path: str,
        render_kwargs: dict,
        inputs: Dict[str, Any] = None,
        graphviz_kwargs: dict = None,
        overrides: Dict[str, Any] = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        bypass_validation: bool = False,
        keep_dot: bool = False,
    ):
        """Helper function to visualize execution, using a passed-in function graph.

        :param final_vars: The final variables to compute.
        :param output_file_path: The path to save the graph to.
        :param render_kwargs: The kwargs to pass to the graphviz render function.
        :param inputs: The inputs to the DAG.
        :param graphviz_kwargs: The kwargs to pass to the graphviz graph object.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
        :param show_schema: If True, display the schema of the DAG if nodes have schema data provided
        :param custom_style_function: Optional. Custom style function.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :return: the graphviz object if you want to do more with it.
        """
        # TODO should determine if the visualization logic should live here or in the graph.py module
        nodes, user_nodes = fn_graph.get_upstream_nodes(final_vars, inputs, overrides)
        if not bypass_validation:
            try:
                Driver.validate_inputs(fn_graph, adapter, user_nodes, inputs, nodes)
            except ValueError as e:
                # Python 3.11 enables the more succinct `.add_note()` syntax
                error_note = "Use `bypass_validation=True` to skip validation"
                if e.args:
                    e.args = (f"{e.args[0]}; {error_note}",) + e.args[1:]
                else:
                    e.args = (error_note,)
                raise e

        node_modifiers = {fv: {graph.VisualizationNodeModifiers.IS_OUTPUT} for fv in final_vars}
        for user_node in user_nodes:
            if user_node.name not in node_modifiers:
                node_modifiers[user_node.name] = set()
            node_modifiers[user_node.name].add(graph.VisualizationNodeModifiers.IS_USER_INPUT)
        all_nodes = nodes | user_nodes
        if overrides is not None:
            for node_ in all_nodes:
                if node_.name in overrides:
                    # We don't want to display it if we're overriding it
                    # This is necessary as getting upstream nodes includes overrides
                    if node_.name not in node_modifiers:
                        node_modifiers[node_.name] = set()
                    node_modifiers[node_.name].add(graph.VisualizationNodeModifiers.IS_OVERRIDE)
        try:
            return fn_graph.display(
                all_nodes,
                output_file_path=output_file_path,
                render_kwargs=render_kwargs,
                graphviz_kwargs=graphviz_kwargs,
                node_modifiers=node_modifiers,
                strictly_display_only_passed_in_nodes=True,
                show_legend=show_legend,
                orient=orient,
                hide_inputs=hide_inputs,
                deduplicate_inputs=deduplicate_inputs,
                display_fields=show_schema,
                custom_style_function=custom_style_function,
                config=fn_graph._config,
                keep_dot=keep_dot,
            )
        except ImportError as e:
            logger.warning(f"Unable to import {e}", exc_info=True)

    @capture_function_usage
    def visualize_execution(
        self,
        final_vars: List[Union[str, Callable, Variable]],
        output_file_path: str = None,
        render_kwargs: dict = None,
        inputs: Dict[str, Any] = None,
        graphviz_kwargs: dict = None,
        overrides: Dict[str, Any] = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        bypass_validation: bool = False,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Visualizes Execution.

        Note: overrides are not handled at this time.

        Shapes:

         - ovals are nodes/functions
         - rectangles are nodes/functions that are requested as output
         - shapes with dotted lines are inputs required to run the DAG.

        :param final_vars: the outputs we want to compute. They will become rectangles in the graph.
        :param output_file_path: the full URI of path + file name to save the dot file to.
            E.g. 'some/path/graph.dot'. Optional. No need to pass it in if you're in a Jupyter Notebook.
        :param render_kwargs: a dictionary of values we'll pass to graphviz render function. Defaults to viewing.
            If you do not want to view the file, pass in `{'view':False}`.
            See https://graphviz.readthedocs.io/en/stable/api.html#graphviz.Graph.render for other options.
        :param inputs: Optional. Runtime inputs to the DAG.
        :param graphviz_kwargs: Optional. Kwargs to be passed to the graphviz graph object to configure it.
            E.g. dict(graph_attr={'ratio': '1'}) will set the aspect ratio to be equal of the produced image.
            See https://graphviz.org/doc/info/attrs.html for options.
        :param overrides: Optional. Overrides to the DAG.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, display the schema of the DAG if nodes have schema data provided
        :param custom_style_function: Optional. Custom style function.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :return: the graphviz object if you want to do more with it.
            If returned as the result in a Jupyter Notebook cell, it will render.
        """
        _final_vars = self._create_final_vars(final_vars)
        return self._visualize_execution_helper(
            self.graph,
            self.adapter,
            _final_vars,
            output_file_path,
            render_kwargs,
            inputs,
            graphviz_kwargs,
            overrides,
            show_legend=show_legend,
            orient=orient,
            hide_inputs=hide_inputs,
            deduplicate_inputs=deduplicate_inputs,
            show_schema=show_schema,
            custom_style_function=custom_style_function,
            bypass_validation=bypass_validation,
            keep_dot=keep_dot,
        )

    @capture_function_usage
    def export_execution(
        self,
        final_vars: List[str],
        inputs: Dict[str, Any] = None,
        overrides: Dict[str, Any] = None,
    ) -> str:
        """Method to create JSON representation of the Graph.

        :param final_vars: The final variables to compute.
        :param inputs: Optional. The inputs to the DAG.
        :param overrides: Optional. Overrides to the DAG.
        :return: JSON string representation of the graph.
        """
        nodes, user_nodes = self.graph.get_upstream_nodes(final_vars, inputs, overrides)
        Driver.validate_inputs(self.graph, self.adapter, user_nodes, inputs, nodes)
        all_nodes = nodes | user_nodes

        hamilton_nodes = [HamiltonNode.from_node(n).as_dict() for n in all_nodes]
        sorted_nodes = sorted(hamilton_nodes, key=lambda x: x["name"])
        return json.dumps({"nodes": sorted_nodes})

    @capture_function_usage
    def has_cycles(
        self,
        final_vars: List[Union[str, Callable, Variable]],
        _fn_graph: graph.FunctionGraph = None,
    ) -> bool:
        """Checks that the created graph does not have cycles.

        :param final_vars: the outputs we want to compute.
        :param _fn_graph: the function graph to check for cycles, used internally
        :return: boolean True for cycles, False for no cycles.
        """
        function_graph = _fn_graph if _fn_graph is not None else self.graph
        _final_vars = self._create_final_vars(final_vars)
        # get graph we'd be executing over
        nodes, user_nodes = function_graph.get_upstream_nodes(_final_vars)
        return self.graph.has_cycles(nodes, user_nodes)

    @capture_function_usage
    def what_is_downstream_of(self, *node_names: str) -> List[Variable]:
        """Tells you what is downstream of this function(s), i.e. node(s).

        :param node_names: names of function(s) that are starting points for traversing the graph.
        :return: list of "variables" (i.e. nodes), inclusive of the function names, that are downstream of the passed
                in function names.
        """
        downstream_nodes = self.graph.get_downstream_nodes(list(node_names))
        return [Variable.from_node(n) for n in downstream_nodes]

    @capture_function_usage
    def display_downstream_of(
        self,
        *node_names: str,
        output_file_path: str = None,
        render_kwargs: dict = None,
        graphviz_kwargs: dict = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Creates a visualization of the DAG starting from the passed in function name(s).

        Note: for any "node" visualized, we will also add its parents to the visualization as well, so
        there could be more nodes visualized than strictly what is downstream of the passed in function name(s).

        :param node_names: names of function(s) that are starting points for traversing the graph.
        :param output_file_path: the full URI of path + file name to save the dot file to.
            E.g. 'some/path/graph.dot'. Optional. No need to pass it in if you're in a Jupyter Notebook.
        :param render_kwargs: a dictionary of values we'll pass to graphviz render function. Defaults to viewing.
            If you do not want to view the file, pass in `{'view':False}`.
        :param graphviz_kwargs: Kwargs to be passed to the graphviz graph object to configure it.
            E.g. dict(graph_attr={'ratio': '1'}) will set the aspect ratio to be equal of the produced image.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, display the schema of the DAG if nodes have schema data provided
        :param custom_style_function: Optional. Custom style function.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :return: the graphviz object if you want to do more with it.
            If returned as the result in a Jupyter Notebook cell, it will render.
        """
        downstream_nodes = self.graph.get_downstream_nodes(list(node_names))

        nodes_to_display = set()
        for n in downstream_nodes:
            nodes_to_display.add(n)

            for d in n.dependencies:
                if d not in downstream_nodes:
                    nodes_to_display.add(d)

        try:
            return self.graph.display(
                nodes_to_display,
                output_file_path,
                render_kwargs=render_kwargs,
                graphviz_kwargs=graphviz_kwargs,
                strictly_display_only_passed_in_nodes=True,
                show_legend=show_legend,
                orient=orient,
                hide_inputs=hide_inputs,
                deduplicate_inputs=deduplicate_inputs,
                display_fields=show_schema,
                custom_style_function=custom_style_function,
                config=self.graph._config,
                keep_dot=keep_dot,
            )
        except ImportError as e:
            logger.warning(f"Unable to import {e}", exc_info=True)

    @capture_function_usage
    def display_upstream_of(
        self,
        *node_names: str,
        output_file_path: str = None,
        render_kwargs: dict = None,
        graphviz_kwargs: dict = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Creates a visualization of the DAG going backwards from the passed in function name(s).

        Note: for any "node" visualized, we will also add its parents to the visualization as well, so
        there could be more nodes visualized than strictly what is upstream of the passed in function name(s).

        :param node_names: names of function(s) that are starting points for traversing the graph.
        :param output_file_path: the full URI of path + file name to save the dot file to.
            E.g. 'some/path/graph.dot'. Optional. No need to pass it in if you're in a Jupyter Notebook.
        :param render_kwargs: a dictionary of values we'll pass to graphviz render function. Defaults to viewing.
            If you do not want to view the file, pass in `{'view':False}`. Optional.
        :param graphviz_kwargs: Kwargs to be passed to the graphviz graph object to configure it.
            E.g. dict(graph_attr={'ratio': '1'}) will set the aspect ratio to be equal of the produced image. Optional.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, display the schema of the DAG if nodes have schema data provided
        :param custom_style_function: Optional. Custom style function.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :return: the graphviz object if you want to do more with it.
            If returned as the result in a Jupyter Notebook cell, it will render.
        """
        upstream_nodes, user_nodes = self.graph.get_upstream_nodes(list(node_names))
        node_modifiers = {}
        for n in user_nodes:
            node_modifiers[n.name] = {graph.VisualizationNodeModifiers.IS_USER_INPUT}
        try:
            return self.graph.display(
                upstream_nodes,
                output_file_path,
                render_kwargs=render_kwargs,
                graphviz_kwargs=graphviz_kwargs,
                strictly_display_only_passed_in_nodes=True,
                node_modifiers=node_modifiers,
                show_legend=show_legend,
                orient=orient,
                hide_inputs=hide_inputs,
                deduplicate_inputs=deduplicate_inputs,
                display_fields=show_schema,
                custom_style_function=custom_style_function,
                config=self.graph._config,
                keep_dot=keep_dot,
            )
        except ImportError as e:
            logger.warning(f"Unable to import {e}", exc_info=True)

    @capture_function_usage
    def what_is_upstream_of(self, *node_names: str) -> List[Variable]:
        """Tells you what is upstream of this function(s), i.e. node(s).

        :param node_names: names of function(s) that are starting points for traversing the graph backwards.
        :return: list of "variables" (i.e. nodes), inclusive of the function names, that are upstream of the passed
                in function names.
        """
        upstream_nodes, _ = self.graph.get_upstream_nodes(list(node_names))
        return [Variable.from_node(n) for n in upstream_nodes]

    @capture_function_usage
    def what_is_the_path_between(
        self, upstream_node_name: str, downstream_node_name: str
    ) -> List[Variable]:
        """Tells you what nodes are on the path between two nodes.

        Note: this is inclusive of the two nodes, and returns an unsorted list of nodes.

        :param upstream_node_name: the name of the node that we want to start from.
        :param downstream_node_name: the name of the node that we want to end at.
        :return: Nodes representing the path between the two nodes, inclusive of the two nodes, unsorted.
            Returns empty list if no path exists.
        :raise ValueError: if the upstream or downstream node name is not in the graph.
        """
        all_variables = {n.name: n for n in self.graph.get_nodes()}
        # ensure that the nodes exist
        if upstream_node_name not in all_variables:
            raise ValueError(
                f"Upstream node {upstream_node_name} not found in graph."  # noqa: E713
            )
        if downstream_node_name not in all_variables:
            raise ValueError(
                f"Downstream node {downstream_node_name} not found in graph."  # noqa: E713
            )
        nodes_for_path = self._get_nodes_between(upstream_node_name, downstream_node_name)
        return [Variable.from_node(n) for n in nodes_for_path]

    def _get_nodes_between(
        self, upstream_node_name: str, downstream_node_name: str
    ) -> Set[node.Node]:
        """Gets the nodes representing the path between two nodes, inclusive of the two nodes.

        Assumes that the nodes exist in the graph.

        :param upstream_node_name: the name of the node that we want to start from.
        :param downstream_node_name: the name of the node that we want to end at.
        :return: set of nodes that comprise the path between the two nodes, inclusive of the two nodes.
        """
        downstream_nodes = self.graph.get_downstream_nodes([upstream_node_name])
        # we skip user_nodes because it'll be the upstream node, or it wont matter.
        upstream_nodes, _ = self.graph.get_upstream_nodes([downstream_node_name])
        nodes_for_path = set(downstream_nodes).intersection(set(upstream_nodes))
        return nodes_for_path

    @capture_function_usage
    def visualize_path_between(
        self,
        upstream_node_name: str,
        downstream_node_name: str,
        output_file_path: Optional[str] = None,
        render_kwargs: dict = None,
        graphviz_kwargs: dict = None,
        strict_path_visualization: bool = False,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Visualizes the path between two nodes.

        This is useful for debugging and understanding the path between two nodes.

        :param upstream_node_name: the name of the node that we want to start from.
        :param downstream_node_name: the name of the node that we want to end at.
        :param output_file_path: the full URI of path + file name to save the dot file to.
            E.g. 'some/path/graph.dot'. Pass in None to skip saving any file.
        :param render_kwargs: a dictionary of values we'll pass to graphviz render function. Defaults to viewing.
            If you do not want to view the file, pass in `{'view':False}`.
        :param graphviz_kwargs: Kwargs to be passed to the graphviz graph object to configure it.
            E.g. dict(graph_attr={'ratio': '1'}) will set the aspect ratio to be equal of the produced image.
        :param strict_path_visualization: If True, only the nodes in the path will be visualized. If False, the
            nodes in the path and their dependencies, i.e. parents, will be visualized.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, display the schema of the DAG if nodes have schema data provided
        :return: graphviz object.
        :param custom_style_function: Optional. Custom style function.
        :param keep_dot: If true, produce a DOT file (ref: https://graphviz.org/doc/info/lang.html)
        :raise ValueError: if the upstream or downstream node names are not found in the graph,
            or there is no path between them.
        """
        if render_kwargs is None:
            render_kwargs = {}
        if graphviz_kwargs is None:
            graphviz_kwargs = {}
        all_variables = {n.name: n for n in self.graph.get_nodes()}
        # ensure that the nodes exist
        if upstream_node_name not in all_variables:
            raise ValueError(
                f"Upstream node {upstream_node_name} not found in graph."  # noqa: E713
            )  # noqa: E713
        if downstream_node_name not in all_variables:
            raise ValueError(
                f"Downstream node {downstream_node_name} not found in graph."  # noqa: E713
            )  # noqa: E713

        # set whether the node is user input
        node_modifiers = {}
        for n in self.graph.get_nodes():
            if n.user_defined:
                node_modifiers[n.name] = {graph.VisualizationNodeModifiers.IS_USER_INPUT}

        # create nodes that constitute the path
        nodes_for_path = self._get_nodes_between(upstream_node_name, downstream_node_name)
        if len(nodes_for_path) == 0:
            raise ValueError(
                f"No path found between {upstream_node_name} and {downstream_node_name}."
            )
        # add is path for node_modifier's dict
        for n in nodes_for_path:
            if n.name not in node_modifiers:
                node_modifiers[n.name] = set()
            node_modifiers[n.name].add(graph.VisualizationNodeModifiers.IS_PATH)

        nodes_to_display = set()
        for n in nodes_for_path:
            nodes_to_display.add(n)

            if strict_path_visualization is False:
                for d in n.dependencies:
                    nodes_to_display.add(d)

        try:
            return self.graph.display(
                nodes_to_display,
                output_file_path,
                render_kwargs=render_kwargs,
                graphviz_kwargs=graphviz_kwargs,
                node_modifiers=node_modifiers,
                strictly_display_only_passed_in_nodes=True,
                show_legend=show_legend,
                orient=orient,
                hide_inputs=hide_inputs,
                deduplicate_inputs=deduplicate_inputs,
                display_fields=show_schema,
                custom_style_function=custom_style_function,
                config=self.graph._config,
                keep_dot=keep_dot,
            )
        except ImportError as e:
            logger.warning(f"Unable to import {e}", exc_info=True)

    def _process_materializers(
        self, materializers: typing.Sequence[Union[MaterializerFactory, ExtractorFactory]]
    ) -> Tuple[List[MaterializerFactory], List[ExtractorFactory]]:
        """Processes materializers, splitting them into materializers and extractors.
        Note that this also sanitizes the variable names in the materializer dependencies,
        so one can pass in functions instead of strings.

        :param materializers: Materializers to process
        :return: Tuple of materializers and extractors
        """
        module_set = {_module.__name__ for _module in self.graph_modules}
        materializer_factories = [
            m.sanitize_dependencies(module_set)
            for m in materializers
            if isinstance(m, MaterializerFactory)
        ]
        extractor_factories = [m for m in materializers if isinstance(m, ExtractorFactory)]
        return materializer_factories, extractor_factories

    @capture_function_usage
    def materialize(
        self,
        *materializers: Union[
            materialization.MaterializerFactory, materialization.ExtractorFactory
        ],
        additional_vars: List[Union[str, Callable, Variable]] = None,
        overrides: Dict[str, Any] = None,
        inputs: Dict[str, Any] = None,
    ) -> Tuple[Any, Dict[str, Any]]:
        """Executes and materializes with ad-hoc materializers (`to`) and extractors (`from_`).This does the following:

        1. Creates a new graph, appending the desired materialization nodes and prepending the desired extraction nodes
        2. Runs the portion of the DAG upstream of the materialization nodes outputted, as well as any additional nodes requested (which can be empty)
        3. Returns a Tuple[Materialization metadata, additional vars result]

        For instance, say you want to load data, process it, then materialize the output of a node to CSV:

        .. code-block:: python

             from hamilton import driver, base
             from hamilton.io.materialization import to
             dr = driver.Driver(my_module, {})
             # foo, bar are pd.Series
             metadata, result = dr.materialize(
                 from_.csv(
                     target="input_data",
                     path="./input.csv"
                 ),
                 to.csv(
                     path="./output.csv"
                     id="foo_bar_csv",
                     dependencies=["foo", "bar"],
                     combine=base.PandasDataFrameResult()
                 ),
                 additional_vars=["foo", "bar"]
             )

        The code above will do the following:

        1. Load the CSV at "./input.csv" and inject it into he DAG as input_data
        2. Run the nodes in the DAG on which "foo" and "bar" depend
        3. Materialize the dataframe with "foo" and "bar" as columns, saving it as a CSV file at "./output.csv". The metadata will contain any additional relevant information, and result will be a dictionary with the keys "foo" and "bar" containing the original data.

        Note that we pass in a `ResultBuilder` as the `combine` argument to `to`, as we may be materializing
        several nodes. This is not relevant in `from_` as we are only loading one dataset.

        additional_vars is used for debugging -- E.G. if you want to both realize side-effects and
        return an output for inspection. If left out, it will return an empty dictionary.

        You can bypass the `combine` keyword for `to` if only one output is required. In this circumstance
        "combining/joining" isn't required, e.g. you do that yourself in a function and/or the output of the function
        can be directly used. In the case below the output can be turned in to a CSV.

        .. code-block:: python

             from hamilton import driver, base
             from hamilton.io.materialization import to
             dr = driver.Driver(my_module, {})
             # foo, bar are pd.Series
             metadata, _ = dr.materialize(
                 from_.csv(
                     target="input_data",
                     path="./input.csv"
                 ),
                 to.csv(
                     path="./output.csv"
                     id="foo_bar_csv",
                     dependencies=["foo_bar_already_joined],
                 ),
             )

        This will just save it to a csv.

        Note that materializers can be any valid DataSaver -- these have an isomorphic relationship
        with the `@save_to` decorator, which means that any key utilizable in `save_to` can be used
        in a materializer. The constructor arguments for a materializer are the same as the
        arguments for `@save_to`, with an additional trick -- instead of requiring
        everything to be a `source` or `value`, you can pass in a literal, and it will be interpreted
        as a value.

        That said, if you want to parameterize your materializer based on input or some node in the
        DAG, you can easily do that as well:

        .. code-block:: python

             from hamilton import driver, base
             from hamilton.function_modifiers import source
             from hamilton.io.materialization import to

             dr = driver.Driver(my_module, {})
             # foo, bar are pd.Series
             metadata, result = dr.Materialize(
                 from_.csv(
                    target="input_data",
                    path=source("load_path")
                 ),
                 to.csv(
                     path=source("save_path"),
                     id="foo_bar_csv",
                     dependencies=["foo", "bar"],
                     combine=base.PandasDataFrameResult(),
                 ),
                 additional_vars=["foo", "bar"],
                 inputs={"save_path": "./output.csv"},
             )

        While this is a contrived example, you could imagine something more powerful. Say, for
        instance, say you have created and registered a custom `model_registry` materializer that
        applies to an argument of your model class, and requires `training_data` to infer the
        signature. You could call it like this:

        .. code-block:: python

            from hamilton import driver, base
            from hamilton.function_modifiers import source
            from hamilton.io.materialization import to
            dr = driver.Driver(my_module, {})
            metadata, _ = dr.Materialize(
                to.model_registry(
                    training_data=source("training_data"),
                    id="foo_model_registry",
                    tags={"run_id" : ..., "training_date" : ..., ...},
                    dependencies=["foo_model"]
                ),
            )

        In this case, we bypass a result builder (as there's only one model), the single
        node we depend on gets saved, and we pass in the training data as an input so the
        materializer can infer the signature.

        You could also imagine a driver that loads up a model, runs inference, then saves the result:

        .. code-block:: python

            from hamilton import driver, base
            from hamilton.function_modifiers import source
            from hamilton.io.materialization import to

            dr = driver.Driver(my_module, {})
            metadata, _ = dr.Materialize(
                from_.model_registry(
                    target="input_model",
                    query_tags={
                        "training_date": ...,
                        model_version: ...,
                    },  # query based on run_id, model_version
                ),
                to.csv(
                    path=source("save_path"),
                    id="save_inference_data",
                    dependencies=["inference_data"],
                ),
            )

        Note that the "from" extractor has an interesting property -- it effectively functions as overrides. This
        means that it can *replace* nodes within a DAG, short-circuiting their behavior. Similar to passing overrides, but they
        are dynamically computed with the DAG, rather than statically included from the beginning.

        This is customizable through a few APIs:
            1. Custom data savers ( :doc:`/concepts/function-modifiers`)
            2. Custom result builders
            3. Custom data loaders ( :doc:`/concepts/function-modifiers`)

        If you find yourself writing these, please consider contributing back! We would love
        to round out the set of available materialization tools.

        :param materializers: Materializer/extractors to use, created with to.xyz or `from.xyz`
        :param additional_vars: Additional variables to return from the graph
        :param overrides: Overrides to pass to execution
        :param inputs: Inputs to pass to execution
        :return: Tuple[Materialization metadata|data, additional_vars result]
        """
        if additional_vars is None:
            additional_vars = []
        start_time = time.time()
        run_successful = True
        error_execution = None
        error_telemetry = None
        run_id = str(uuid.uuid4())
        outputs = (None, None)
        final_vars = self._create_final_vars(additional_vars)
        # This is so the finally logging statement does not accidentally die
        materializer_vars = []
        try:
            materializer_factories, extractor_factories = self._process_materializers(materializers)
            if len(materializer_factories) == len(final_vars) == 0:
                raise ValueError(
                    "No output requested. Please either pass in materializers that will save data, or pass in `additional_vars` to compute."
                )
            function_graph = materialization.modify_graph(
                self.graph, materializer_factories, extractor_factories
            )
            Driver._perform_graph_validations(self.adapter, function_graph, self.graph_modules)
            if self.adapter.does_hook("post_graph_construct", is_async=False):
                self.adapter.call_all_lifecycle_hooks_sync(
                    "post_graph_construct",
                    graph=function_graph,
                    modules=self.graph_modules,
                    config=function_graph.config,
                )

            # need to validate the right inputs has been provided.
            # we do this on the modified graph.
            # Note we will not run the loaders if they're not upstream of the
            # materializers or additional_vars
            materializer_vars = [m.id for m in materializer_factories]
            if self.adapter.does_hook("pre_graph_execute", is_async=False):
                self.adapter.call_all_lifecycle_hooks_sync(
                    "pre_graph_execute",
                    run_id=run_id,
                    graph=function_graph,
                    final_vars=final_vars + materializer_vars,
                    inputs=inputs,
                    overrides=overrides,
                )

            nodes, user_nodes = function_graph.get_upstream_nodes(
                final_vars + materializer_vars, inputs, overrides
            )
            Driver.validate_inputs(function_graph, self.adapter, user_nodes, inputs, nodes)
            all_nodes = nodes | user_nodes
            self.graph_executor.validate(list(all_nodes))
            raw_results = self.__raw_execute(
                final_vars=final_vars + materializer_vars,
                inputs=inputs,
                overrides=overrides,
                _fn_graph=function_graph,
                _run_id=run_id,
            )
            materialization_output = {key: raw_results[key] for key in materializer_vars}
            raw_results_output = {key: raw_results[key] for key in final_vars}
            outputs = materialization_output, raw_results_output
        except Exception as e:
            run_successful = False
            logger.error(SLACK_ERROR_MESSAGE)
            error_telemetry = telemetry.sanitize_error(*sys.exc_info())
            error_execution = e
            raise e
        finally:
            if self.adapter.does_hook("post_graph_execute", is_async=False):
                self.adapter.call_all_lifecycle_hooks_sync(
                    "post_graph_execute",
                    run_id=run_id,
                    graph=function_graph,
                    success=run_successful,
                    error=error_execution,
                    results=outputs[1],
                )
            duration = time.time() - start_time
            self.capture_execute_telemetry(
                error_telemetry,
                final_vars + materializer_vars,
                inputs,
                overrides,
                run_successful,
                duration,
            )
        return outputs

    @capture_function_usage
    def visualize_materialization(
        self,
        *materializers: Union[MaterializerFactory, ExtractorFactory],
        output_file_path: str = None,
        render_kwargs: dict = None,
        additional_vars: List[Union[str, Callable, Variable]] = None,
        inputs: Dict[str, Any] = None,
        graphviz_kwargs: dict = None,
        overrides: Dict[str, Any] = None,
        show_legend: bool = True,
        orient: str = "LR",
        hide_inputs: bool = False,
        deduplicate_inputs: bool = False,
        show_schema: bool = True,
        custom_style_function: Callable = None,
        bypass_validation: bool = False,
        keep_dot: bool = False,
    ) -> Optional["graphviz.Digraph"]:  # noqa F821
        """Visualizes materialization. This helps give you a sense of how materialization
        will impact the DAG.

        :param materializers: Materializers/Extractors to use, see the materialize() function
        :param additional_vars: Additional variables to compute (in addition to materializers)
        :param output_file_path: Path to output file. Optional. Skip if in a Jupyter Notebook.
        :param render_kwargs: Arguments to pass to render. Optional.
        :param inputs: Inputs to pass to execution. Optional.
        :param graphviz_kwargs: Arguments to pass to graphviz. Optional.
        :param overrides: Overrides to pass to execution. Optional.
        :param show_legend: If True, add a legend to the visualization based on the DAG's nodes.
        :param orient: `LR` stands for "left to right". Accepted values are TB, LR, BT, RL.
            `orient` will be overwridden by the value of `graphviz_kwargs['graph_attr']['rankdir']`
            see (https://graphviz.org/docs/attr-types/rankdir/)
        :param hide_inputs: If True, no input nodes are displayed.
        :param deduplicate_inputs: If True, remove duplicate input nodes.
            Can improve readability depending on the specifics of the DAG.
        :param show_schema: If True, show the schema of the materialized nodes
            if nodes have schema metadata attached.
        :param custom_style_function: Optional. Custom style function.
        :param bypass_validation: If True, bypass validation. Optional.
        :return: The graphviz graph, if you want to do something with it
        """
        if additional_vars is None:
            additional_vars = []
        materializer_factories, extractor_factories = self._process_materializers(materializers)
        function_graph = materialization.modify_graph(
            self.graph, materializer_factories, extractor_factories
        )
        _final_vars = self._create_final_vars(additional_vars) + [
            materializer.id for materializer in materializer_factories
        ]
        return Driver._visualize_execution_helper(
            function_graph,
            self.adapter,
            _final_vars,
            output_file_path,
            render_kwargs,
            inputs,
            graphviz_kwargs,
            overrides,
            show_legend=show_legend,
            orient=orient,
            hide_inputs=hide_inputs,
            deduplicate_inputs=deduplicate_inputs,
            show_schema=show_schema,
            custom_style_function=custom_style_function,
            bypass_validation=bypass_validation,
            keep_dot=keep_dot,
        )

    def validate_execution(
        self,
        final_vars: List[Union[str, Callable, Variable]],
        overrides: Dict[str, Any] = None,
        inputs: Dict[str, Any] = None,
    ):
        """Validates execution of the graph. One can call this to validate execution, independently of actually executing.
        Note this has no return -- it will raise a ValueError if there is an issue.

        :param final_vars: Final variables to compute
        :param overrides: Overrides to pass to execution.
        :param inputs: Inputs to pass to execution.
        :raise ValueError: if any issues with executino can be detected.
        """
        nodes, user_nodes = self.graph.get_upstream_nodes(final_vars, inputs, overrides)
        Driver.validate_inputs(self.graph, self.adapter, user_nodes, inputs, nodes)
        self.graph_executor.validate(list(nodes | user_nodes))

    def validate_materialization(
        self,
        *materializers: materialization.MaterializerFactory,
        additional_vars: List[Union[str, Callable, Variable]] = None,
        overrides: Dict[str, Any] = None,
        inputs: Dict[str, Any] = None,
    ):
        """Validates materialization of the graph. Effectively .materialize() with a dry-run.
        Note this has no return -- it will raise a ValueError if there is an issue.

        :param materializers: Materializers to use, see the materialize() function
        :param additional_vars: Additional variables to compute (in addition to materializers)
        :param overrides: Overrides to pass to execution. Optional.
        :param inputs: Inputs to pass to execution. Optional.
        :raise ValueError: if any issues with materialization can be detected.
        """
        if additional_vars is None:
            additional_vars = []
        final_vars = self._create_final_vars(additional_vars)
        module_set = {_module.__name__ for _module in self.graph_modules}
        materializer_factories, extractor_factories = self._process_materializers(materializers)
        materializer_factories = [
            m.sanitize_dependencies(module_set) for m in materializer_factories
        ]
        materializer_vars = [m.id for m in materializer_factories]
        function_graph = materialization.modify_graph(
            self.graph, materializer_factories, extractor_factories
        )
        # need to validate the right inputs has been provided.
        # we do this on the modified graph.
        nodes, user_nodes = function_graph.get_upstream_nodes(
            final_vars + materializer_vars, inputs, overrides
        )
        Driver.validate_inputs(function_graph, self.adapter, user_nodes, inputs, nodes)
        all_nodes = nodes | user_nodes
        self.graph_executor.validate(list(all_nodes))

    @property
    def cache(self) -> HamiltonCacheAdapter:
        """Directly access the cache adapter"""
        if self.adapter:
            for adapter in self.adapter.adapters:
                if isinstance(adapter, HamiltonCacheAdapter):
                    return adapter
        else:
            raise KeyError(
                "Cache not yet set. Add a cache by using ``Builder().with_cache()`` when building the ``Driver``."
            )


class Builder:
    def __init__(self):
        """Constructs a driver builder. No parameters as you call methods to set fields."""
        # Toggling versions
        self.v2_executor = False

        # common fields
        self.config = {}
        self.modules = []
        self.materializers = []

        # Allow later modules to override nodes of the same name
        self._allow_module_overrides = False

        self.legacy_graph_adapter = None
        # Standard execution fields
        self.adapters: List[lifecycle_base.LifecycleAdapter] = []

        # Dynamic execution fields
        self.execution_manager = None
        self.local_executor = None
        self.remote_executor = None
        self.grouping_strategy = None

    def _require_v2(self, message: str):
        if not self.v2_executor:
            raise ValueError(message)

    def _require_field_unset(self, field: str, message: str, unset_value: Any = None):
        if getattr(self, field) != unset_value:
            raise ValueError(message)

    def _require_field_set(self, field: str, message: str, unset_value: Any = None):
        if getattr(self, field) == unset_value:
            raise ValueError(message)

    def enable_dynamic_execution(self, *, allow_experimental_mode: bool = False) -> "Builder":
        """Enables the Parallelizable[] type, which in turn enables:
        1. Grouped execution into tasks
        2. Parallel execution
        :return: self
        """
        if not allow_experimental_mode:
            raise ValueError(
                "Remote execution is currently experimental. "
                "Please set allow_experiemental_mode=True to enable it."
            )
        self.v2_executor = True
        return self

    def with_config(self, config: Dict[str, Any]) -> "Builder":
        """Adds the specified configuration to the config.
        This can be called multilple times -- later calls will take precedence.

        :param config: Config to use.
        :return: self
        """
        self.config.update(config)
        return self

    def with_modules(self, *modules: ModuleType) -> "Builder":
        """Adds the specified modules to the modules list.
        This can be called multiple times.

        :param modules: Modules to use.
        :return: self
        """
        self.modules.extend(modules)
        return self

    def with_adapter(self, adapter: base.HamiltonGraphAdapter) -> "Builder":
        """Sets the adapter to use.

        :param adapter: Adapter to use.
        :return: self
        """
        self._require_field_unset("legacy_graph_adapter", "Cannot set adapter twice.")
        self.legacy_graph_adapter = adapter
        return self

    def with_adapters(self, *adapters: lifecycle_base.LifecycleAdapter) -> "Builder":
        """Sets the adapter to use.

        :param adapter: Adapter to use.
        :return: self
        """
        if any(isinstance(adapter, HamiltonCacheAdapter) for adapter in adapters):
            self._require_field_unset(
                "cache", "Cannot use `.with_cache()` or with `.with_adapters(SmartCacheAdapter())`."
            )

        self.adapters.extend(adapters)
        return self

    def with_materializers(
        self, *materializers: Union[ExtractorFactory, MaterializerFactory]
    ) -> "Builder":
        """Add materializer nodes to the `Driver`
        The generated nodes can be referenced by name in `.execute()`

        :param materializers: materializers to add to the dataflow
        :return: self
        """
        if any(
            m for m in materializers if not isinstance(m, (ExtractorFactory, MaterializerFactory))
        ):
            if len(materializers) == 1 and isinstance(materializers[0], Sequence):
                raise ValueError(
                    "`.with_materializers()` received a sequence. Unpack it by prepending `*` e.g., `*[to.json(...), from_.parquet(...)]`"
                )
            else:
                raise ValueError(
                    f"`.with_materializers()` only accepts materializers. Received instead: {materializers}"
                )

        self.materializers.extend(materializers)
        return self

    def with_cache(
        self,
        path: Union[str, pathlib.Path] = ".hamilton_cache",
        metadata_store: Optional[MetadataStore] = None,
        result_store: Optional[ResultStore] = None,
        default: Optional[Union[Literal[True], Sequence[str]]] = None,
        recompute: Optional[Union[Literal[True], Sequence[str]]] = None,
        ignore: Optional[Union[Literal[True], Sequence[str]]] = None,
        disable: Optional[Union[Literal[True], Sequence[str]]] = None,
        default_behavior: Literal["default", "recompute", "disable", "ignore"] = "default",
        default_loader_behavior: Literal["default", "recompute", "disable", "ignore"] = "default",
        default_saver_behavior: Literal["default", "recompute", "disable", "ignore"] = "default",
        log_to_file: bool = False,
    ) -> "Builder":
        """Add the caching adapter to the `Driver`

        :param path: path where the cache metadata and results will be stored
        :param metadata_store: BaseStore handling metadata for the cache adapter
        :param result_store: BaseStore caching dataflow execution results
        :param default: Set caching behavior to DEFAULT for specified node names. If True, apply to all nodes.
        :param recompute: Set caching behavior to RECOMPUTE for specified node names. If True, apply to all nodes.
        :param ignore: Set caching behavior to IGNORE for specified node names. If True, apply to all nodes.
        :param disable: Set caching behavior to DISABLE for specified node names. If True, apply to all nodes.
        :param default_behavior: Set the default caching behavior.
        :param default_loader_behavior: Set the default caching behavior `DataLoader` nodes.
        :param default_saver_behavior: Set the default caching behavior `DataSaver` nodes.
        :log_to_file: If True, the cache adapter logs will be stored in JSONL format under the metadata_store directory
        :return: self


        Learn more on the :doc:`/concepts/caching` Concepts page.

        .. code-block:: python

            from hamilton import driver
            import my_dataflow

            dr = (
                driver.Builder()
                .with_module(my_dataflow)
                .with_cache()
                .build()
            )

            # execute twice
            dr.execute([...])
            dr.execute([...])

            # view cache logs
            dr.cache.logs()

        """
        self._require_field_unset(
            "cache", "Cannot use `.with_cache()` or with `.with_adapters(SmartCacheAdapter())`."
        )
        adapter = HamiltonCacheAdapter(
            path=path,
            metadata_store=metadata_store,
            result_store=result_store,
            default=default,
            recompute=recompute,
            ignore=ignore,
            disable=disable,
            default_behavior=default_behavior,
            default_loader_behavior=default_loader_behavior,
            default_saver_behavior=default_saver_behavior,
            log_to_file=log_to_file,
        )
        self.adapters.append(adapter)
        return self

    @property
    def cache(self) -> Optional[HamiltonCacheAdapter]:
        """Attribute to check if a cache was set, either via `.with_cache()` or
        `.with_adapters(SmartCacheAdapter())`

        Required for the check  `._require_field_unset()`
        """
        if self.adapters:
            for adapter in self.adapters:
                if isinstance(adapter, HamiltonCacheAdapter):
                    return adapter

    def with_execution_manager(self, execution_manager: executors.ExecutionManager) -> "Builder":
        """Sets the execution manager to use. Note that this cannot be used if local_executor
        or remote_executor are also set

        :param execution_manager:
        :return: self
        """
        self._require_v2("Cannot set execution manager without first enabling the V2 Driver")
        self._require_field_unset("execution_manager", "Cannot set execution manager twice")
        self._require_field_unset(
            "remote_executor",
            "Cannot set execution manager with remote " "executor set -- these are disjoint",
        )

        self.execution_manager = execution_manager
        return self

    def with_remote_executor(self, remote_executor: executors.TaskExecutor) -> "Builder":
        """Sets the execution manager to use. Note that this cannot be used if local_executor
        or remote_executor are also set

        :param remote_executor: Remote executor to use
        :return: self
        """
        self._require_v2("Cannot set execution manager without first enabling the V2 Driver")
        self._require_field_unset("remote_executor", "Cannot set remote executor twice")
        self._require_field_unset(
            "execution_manager",
            "Cannot set remote executor with execution " "manager set -- these are disjoint",
        )
        self.remote_executor = remote_executor
        return self

    def with_local_executor(self, local_executor: executors.TaskExecutor) -> "Builder":
        """Sets the execution manager to use. Note that this cannot be used if local_executor
        or remote_executor are also set

        :param local_executor: Local executor to use
        :return: self
        """
        self._require_v2("Cannot set execution manager without first enabling the V2 Driver")
        self._require_field_unset("local_executor", "Cannot set local executor twice")
        self._require_field_unset(
            "execution_manager",
            "Cannot set local executor with execution " "manager set -- these are disjoint",
        )
        self.local_executor = local_executor
        return self

    def with_grouping_strategy(self, grouping_strategy: grouping.GroupingStrategy) -> "Builder":
        """Sets a node grouper, which tells the driver how to group nodes into tasks for execution.

        :param node_grouper: Node grouper to use.
        :return: self
        """
        self._require_v2("Cannot set grouping strategy without first enabling the V2 Driver")
        self._require_field_unset("grouping_strategy", "Cannot set grouping strategy twice")
        self.grouping_strategy = grouping_strategy
        return self

    def allow_module_overrides(self) -> "Builder":
        """Same named functions in different modules get overwritten.
        If multiple modules have same named functions, the later module overrides the previous one(s).
        The order of listing the modules is important, since later ones will overwrite the previous ones. This is a global call affecting all imported modules.
        See https://github.com/DAGWorks-Inc/hamilton/tree/main/examples/module_overrides for more info.

        :return: self
        """
        self._allow_module_overrides = True
        return self

    def build(self) -> Driver:
        """Builds the driver -- note that this can return a different class, so you'll likely
        want to have a sense of what it returns.

        Note: this defaults to a dictionary adapter if no adapter is set.

        :return: The driver you specified.
        """

        adapter = self.adapters if self.adapters is not None else []
        if self.legacy_graph_adapter is not None:
            adapter.append(self.legacy_graph_adapter)

        graph_executor = None
        if self.v2_executor:
            execution_manager = self.execution_manager
            if execution_manager is None:
                local_executor = self.local_executor or executors.SynchronousLocalTaskExecutor()
                remote_executor = self.remote_executor or executors.MultiThreadingExecutor(
                    max_tasks=10
                )
                execution_manager = executors.DefaultExecutionManager(
                    local_executor=local_executor, remote_executor=remote_executor
                )
            grouping_strategy = self.grouping_strategy or grouping.GroupByRepeatableBlocks()
            graph_executor = TaskBasedGraphExecutor(
                execution_manager=execution_manager,
                grouping_strategy=grouping_strategy,
                adapter=lifecycle_base.LifecycleAdapterSet(*adapter),
            )

        return Driver(
            self.config,
            *self.modules,
            adapter=adapter,
            _materializers=self.materializers,
            _graph_executor=graph_executor,
            _use_legacy_adapter=False,
            allow_module_overrides=self._allow_module_overrides,
        )

    def copy(self) -> "Builder":
        """Creates a copy of the current state of this Builder.

        NOTE. The copied Builder currently holds reference of Builder attributes
        """
        new_builder = Builder()
        new_builder.v2_executor = self.v2_executor
        new_builder.config = self.config.copy()
        new_builder.modules = self.modules.copy()
        new_builder.legacy_graph_adapter = self.legacy_graph_adapter
        new_builder.adapters = self.adapters.copy()
        new_builder.materializers = self.materializers.copy()
        new_builder.execution_manager = self.execution_manager
        new_builder.local_executor = self.local_executor
        new_builder.remote_executor = self.remote_executor
        new_builder.grouping_strategy = self.grouping_strategy
        return new_builder


if __name__ == "__main__":
    """some example test code"""
    import importlib

    formatter = logging.Formatter("[%(levelname)s] %(asctime)s %(name)s(%(lineno)s): %(message)s")
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    logger.setLevel(logging.INFO)

    if len(sys.argv) < 2:
        logger.error("No modules passed")
        sys.exit(1)
    logger.info(f"Importing {sys.argv[1]}")
    module = importlib.import_module(sys.argv[1])

    x = pd.date_range("2019-01-05", "2020-12-31", freq="7D")
    x.index = x

    dr = Driver(
        {
            "VERSION": "kids",
            "as_of": datetime.strptime("2019-06-01", "%Y-%m-%d"),
            "end_date": "2020-12-31",
            "start_date": "2019-01-05",
            "start_date_d": datetime.strptime("2019-01-05", "%Y-%m-%d"),
            "end_date_d": datetime.strptime("2020-12-31", "%Y-%m-%d"),
            "segment_filters": {"business_line": "womens"},
        },
        module,
    )
    df = dr.execute(
        ["date_index", "some_column"],
        # ,overrides={'DATE': pd.Series(0)}
        display_graph=False,
    )
    print(df)
