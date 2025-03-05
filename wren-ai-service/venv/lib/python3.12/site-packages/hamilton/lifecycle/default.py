"""A selection of default lifeycle hooks/methods that come with Hamilton. These carry no additional requirements"""

import hashlib
import logging
import pdb
import pickle
import pprint
import random
import shelve
import time
from functools import partial
from typing import Any, Callable, Dict, List, Optional, Type, Union

from hamilton import graph_types, htypes
from hamilton.graph_types import HamiltonGraph
from hamilton.lifecycle import (
    EdgeConnectionHook,
    GraphExecutionHook,
    NodeExecutionHook,
    NodeExecutionMethod,
)

logger = logging.getLogger(__name__)

NodeFilter = Union[
    Callable[
        [str, Dict[str, Any]], bool
    ],  # filter function for nodes, mapping node name to a boolean
    List[str],  # list of node names to run
    str,  # node name to run
    None,  # run all nodes
]  # filter function for nodes, mapping node name and node tags to a boolean


def should_run_node(node_name: str, node_tags: Dict[str, Any], node_filter: NodeFilter) -> bool:
    if node_filter is None:
        return True
    if isinstance(node_filter, str):
        return node_name == node_filter
    if isinstance(node_filter, list):
        return node_name in node_filter
    if callable(node_filter):
        return node_filter(node_name, node_tags)
    raise ValueError(f"Invalid node filter: {node_filter}")


class PrintLn(NodeExecutionHook):
    """Basic hook to print out information before/after node execution."""

    NODE_TIME_STATE = "node_time"

    @staticmethod
    def _format_time_delta(delta: float) -> str:
        """Formats a time delta into a human-readable string."""
        # Determine the appropriate unit and format
        if delta < 0.001:  # Less than 1 millisecond
            return f"{delta * 1e6:.3g}μs"
        elif delta < 1:  # Less than 1 second
            return f"{delta * 1e3:.3g}ms"
        return f"{delta:.3g}s"

    @staticmethod
    def _validate_verbosity(verbosity: int):
        """Validates that the verbosity is one of [1, 2]"""
        if verbosity not in [1, 2]:
            raise ValueError(f"Verbosity must be one of [1, 2], got {verbosity}")

    @staticmethod
    def _format_node_name(node_name: str, task_id: Optional[str]) -> str:
        """Formats a node name and task id into a unique node name."""
        if task_id is not None:
            return f"{task_id}:{node_name}"
        return node_name

    def __init__(
        self,
        verbosity: int = 1,
        print_fn: Callable[[str], None] = print,
        node_filter: NodeFilter = None,
    ):
        """Prints out information before/after node execution.

        :param verbosity: The verbosity level to print out at.
            `verbosity=1` Print out just the node name and time it took to execute
            `verbosity=2`. Print out inputs of the node + results on execute
        :param print_fn: A function that takes a string and prints it out -- defaults to print. Pass in a logger function, etc... if you so choose.
        :param node_filter: A function that takes a node name and a node tags dict and returns a boolean. If the boolean is True, the node will be printed out.
            If False, it will not be printed out.
        """
        PrintLn._validate_verbosity(verbosity)
        self.verbosity = verbosity
        self.print_fn = print_fn
        self.timer_dict = {}  # quick dict to track the time it took to execute a node
        if node_filter is None:
            node_filter = lambda node_name, node_tags: True  # noqa E731
        self.node_filter = node_filter

    def run_before_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        task_id: Optional[str],
        **future_kwargs: Any,
    ):
        """Runs before a node executes. Prints out the node name and inputs if verbosity is 2.

        :param node_name: Name of the node
        :param node_tags: Tags of the node
        :param node_kwargs: Keyword arguments of the node
        :param task_id: ID of the task that the node is in, if any
        :param future_kwargs: Additional keyword arguments that may be passed to the hook yet are ignored for now
        """
        if not should_run_node(node_name, node_tags, self.node_filter):
            return
        node_unique_id = self._format_node_name(node_name, task_id)
        self.timer_dict[node_unique_id] = time.time()
        message = f"Executing node: {node_unique_id}."
        if self.verbosity == 2:
            message += f" Inputs: \n{pprint.pformat(node_kwargs)}"
        self.print_fn(message)

    def run_after_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        result: Any,
        error: Optional[Exception],
        success: bool,
        task_id: Optional[str],
        **future_kwargs: Any,
    ):
        """Runs after a node executes. Prints out the node name and time it took, the output if verbosity is 1.

        :param node_name: Name of the node
        :param node_tags: Tags of the node
        :param node_kwargs: Keyword arguments passed to the node
        :param result: Result of the node
        :param error: Error of the node
        :param success: Whether the node was successful or not
        :param task_id: ID of the task that the node is in, if any
        :param future_kwargs: Additional keyword arguments that may be passed to the hook yet are ignored for now
        """
        if not should_run_node(node_name, node_tags, self.node_filter):
            return
        node_unique_id = self._format_node_name(node_name, task_id)
        time_delta = time.time() - self.timer_dict[node_unique_id]
        time_delta_formatted = self._format_time_delta(time_delta)
        message = f"Finished debugging node: {node_unique_id} in {time_delta_formatted}. Status: {'Success' if success else 'Failure'}."
        if self.verbosity == 2:
            if success:
                message += f" Result: \n{pprint.pformat(result)}\n"
            else:
                message += f" Error: \n{pprint.pformat(error)}"
        self.print_fn(message)
        del self.timer_dict[node_name]


class PDBDebugger(NodeExecutionHook, NodeExecutionMethod):
    """Class to inject a PDB debugger into a node execution. This is still somewhat experimental as it is a debugging utility.
    We reserve the right to change the API and the implementation of this class in the future.
    """

    CONTEXT = dict()

    def __init__(
        self,
        node_filter: NodeFilter,
        before: bool = False,
        during: bool = False,
        after: bool = False,
    ):
        """Creates a PDB debugger. This has three possible modes:
            1. Before -- places you in a function with (a) node information, and (b) inputs
            2. During -- runs the node with pdb.run. Note this may not always work or give what you expect as
                node functions are often wrapped in multiple levels of input modifications/whatnot. That said, it should give you something.
                Also note that this is not (currently) compatible with graph adapters.
            3. After -- places you in a function with (a) node information, (b) inputs, and (c) results


        :param node_filter: A function that takes a node name and a node tags dict and returns a boolean. If the boolean is True, the node will be printed out.
        :param before: Whether to place you in a PDB debugger before a node executes
        :param during: Whether to place you in a PDB debugger during a node's execution
        :param after: Whether to place you in a PDB debugger after a node executes
        """
        self.node_filter = node_filter
        self.run_before = before
        self.run_during = during
        self.run_after = after

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
        """Executes the node with a PDB debugger. This modifies the global PDBDebugger.CONTEXT variable to contain information about the node,
            so you can access it while debugging.


        :param node_name: Name of the node
        :param node_tags: Tags of the node
        :param node_callable: Callable function of the node
        :param node_kwargs: Keyword arguments passed to the node
        :param task_id: ID of the task that the node is in, if any
        :param future_kwargs: Additional keyword arguments that may be passed to the hook yet are ignored for now
        :return: Result of the node
        """
        if not should_run_node(node_name, node_tags, self.node_filter) or not self.run_during:
            return node_callable(**node_kwargs)
        PDBDebugger.CONTEXT = {
            "node_name": node_name,
            "node_tags": node_tags,
            "node_callable": node_callable,
            "node_kwargs": node_kwargs,
            "task_id": task_id,
            "future_kwargs": future_kwargs,
        }
        logging.warning(
            (
                f"Placing you in a PDB debugger for node {node_name}."
                "\nYou can access additional node information via PDBDebugger.CONTEXT. Data is:"
                f"\n - node_name: {PDBDebugger._truncate_repr(node_name)}"
                f"\n - node_tags: {PDBDebugger._truncate_repr(node_tags)}"
                f"\n - node_callable: {PDBDebugger._truncate_repr(node_callable)}"
                f"\n - node_kwargs: {PDBDebugger._truncate_repr(', '.join(list(node_kwargs.keys())))}"
                f"\n - task_id: {PDBDebugger._truncate_repr(task_id)}"
                f"\n - future_kwargs: {PDBDebugger._truncate_repr(future_kwargs)}"
            )
        )
        out = pdb.runcall(node_callable, **node_kwargs)
        logging.info(f"Finished executing node {node_name}.")
        return out

    @staticmethod
    def _truncate_repr(obj: Any, num_chars: int = 80) -> str:
        """Truncates the repr of an object to 100 characters."""
        if isinstance(obj, str):
            return obj[:num_chars]
        return repr(obj)[:num_chars]

    def run_before_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        task_id: Optional[str],
        **future_kwargs: Any,
    ):
        """Executes before a node executes. Does nothing, just runs pdb.set_trace()

        :param node_name: Name of the node
        :param node_tags: Tags of the node
        :param node_kwargs: Keyword arguments passed to the node
        :param node_return_type: Return type of the node
        :param task_id: ID of the task that the node is in, if any
        :param future_kwargs: Additional keyword arguments that may be passed to the hook yet are ignored for now
        :return: Result of the node
        """
        if should_run_node(node_name, node_tags, self.node_filter) and self.run_before:
            logging.warning(
                (
                    f"Placing you in a PDB debugger prior to execution of node: {node_name}."
                    "\nYou can access additional node information via the following variables:"
                    f"\n - node_name: {PDBDebugger._truncate_repr(node_name)}"
                    f"\n - node_tags: {PDBDebugger._truncate_repr(node_tags)}"
                    f"\n - node_kwargs: {PDBDebugger._truncate_repr(', '.join(list(node_kwargs.keys())))}"
                    f"\n - node_return_type: {PDBDebugger._truncate_repr(node_return_type)}"
                    f"\n - task_id: {PDBDebugger._truncate_repr(task_id)}"
                )
            )
            pdb.set_trace()

    def run_after_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        result: Any,
        error: Optional[Exception],
        success: bool,
        task_id: Optional[str],
        **future_kwargs: Any,
    ):
        """Executes after a node, whether or not it was successful. Does nothing, just runs pdb.set_trace().

        :param node_name: Name of the node
        :param node_tags:  Tags of the node
        :param node_kwargs:  Keyword arguments passed to the node
        :param node_return_type:  Return type of the node
        :param result: Result of the node, None if there was an error
        :param error: Error of the node, None if there was no error
        :param success:  Whether the node ran successful or not
        :param task_id: Task ID of the node, if any
        :param future_kwargs: Additional keyword arguments that may be passed to the hook yet are ignored for now
        """
        if should_run_node(node_name, node_tags, self.node_filter) and self.run_after:
            logging.warning(
                (
                    f"Placing you in a PDB debugger post execution of node: {node_name}."
                    "\nYou can access additional node information via the following variables:"
                    f"\n - node_name: {PDBDebugger._truncate_repr(node_name)}"
                    f"\n - node_tags: {PDBDebugger._truncate_repr(node_tags)}"
                    f"\n - node_kwargs: {PDBDebugger._truncate_repr(', '.join(list(node_kwargs.keys())))}"
                    f"\n - node_return_type: {PDBDebugger._truncate_repr(node_return_type)}"
                    f"\n - result: {PDBDebugger._truncate_repr(result)}"
                    f"\n - error: {PDBDebugger._truncate_repr(error)}"
                    f"\n - success: {PDBDebugger._truncate_repr(success)}"
                    f"\n - task_id: {PDBDebugger._truncate_repr(task_id)}"
                )
            )
            pdb.set_trace()


class CacheAdapter(NodeExecutionHook, NodeExecutionMethod, GraphExecutionHook):
    """Class to cache node results on disk with a key based on the node code implementation and inputs.
    Following runs with the same key can load node results and skip computation.

    The cache `_nodes_history` entry returns an append-only list of results added to the cache.
    e.g., the last value in the list `cache["_node_history"][node_name]` is the most recent cached node.

    Notes:
        - It uses the stdlib `shelve` module and the pickle format, which makes results dependent
        on the Python version. Use materialization for persistent results
        - There are no utility to manage cache size so you'll have to delete it periodically. Look
        at the diskcache plugin for Hamilton `hamilton.plugins.h_diskcache` for better cache management.
    """

    nodes_history_key: str = "_nodes_history"

    def __init__(
        self, cache_vars: Union[List[str], None] = None, cache_path: str = "./hamilton-cache"
    ):
        """Initialize the cache

        :param cache_vars: List of nodes for which to store/load results. Passing None will use the cache
        for all nodes. Default is None.
        :param cache_path: File path to the cache. The file name doesn't need an extension.
        """
        self.cache_vars = cache_vars if cache_vars else []
        self.cache_path = cache_path
        self.cache = shelve.open(self.cache_path)
        self.nodes_history: Dict[str, List[str]] = self.cache.get(
            key=CacheAdapter.nodes_history_key, default=dict()
        )
        self.used_nodes_hash: Dict[str, str] = dict()
        self.cache.close()

        logger.warning(
            "The `CacheAdapter` is deprecated and will be removed in Hamilton 2.0. "
            "Consider enabling the core caching feature via `Builder.with_cache()`. "
            "This might not be 1-to-1 replacement, so please reach out if there are missing features. "
            "See https://hamilton.dagworks.io/en/latest/concepts/caching/ to learn more."
        )

    def run_before_graph_execution(self, *, graph: HamiltonGraph, **kwargs):
        """Set `cache_vars` to all nodes if received None during `__init__`"""
        self.cache = shelve.open(self.cache_path)
        if len(self.cache_vars) == 0:
            self.cache_vars = [n.name for n in graph.nodes]

    def run_to_execute_node(
        self, *, node_name: str, node_callable: Any, node_kwargs: Dict[str, Any], **kwargs
    ):
        """Create cache key based on node callable hash (equiv. to HamiltonNode.version) and
        the node inputs (`node_kwargs`).If key in cache (cache hit), load result; else (cache miss),
        compute the node and append node name to `used_nodes_hash`.

        Note:
            - the callable hash is stored  in `used_nodes_hash` because it's required to create the
            key in `run_after_node_execution` and the callable won't be accessible to recompute it
        """
        if node_name not in self.cache_vars:
            return node_callable(**node_kwargs)

        source_of_node_callable = node_callable
        while isinstance(source_of_node_callable, partial):  # handle partials
            source_of_node_callable = source_of_node_callable.func
        node_hash = graph_types.hash_source_code(source_of_node_callable, strip=True)
        cache_key = CacheAdapter.create_key(node_hash, node_kwargs)

        from_cache = self.cache.get(cache_key, None)
        if from_cache is not None:
            return from_cache

        self.used_nodes_hash[node_name] = node_hash
        self.nodes_history[node_name] = self.nodes_history.get(node_name, []) + [node_hash]
        return node_callable(**node_kwargs)

    def run_after_node_execution(
        self, *, node_name: str, node_kwargs: Dict[str, Any], result: Any, **kwargs
    ):
        """If `run_to_execute_node` was a cache miss (hash stored in `used_nodes_hash`),
        store the computed result in cache
        """
        if node_name not in self.cache_vars:
            return

        node_hash = self.used_nodes_hash.get(node_name)
        if node_hash is None:
            return

        cache_key = CacheAdapter.create_key(node_hash, node_kwargs)
        self.cache[cache_key] = result

    def run_after_graph_execution(self, *args, **kwargs):
        """After completing execution, overwrite nodes_history_key in cache and close"""
        # TODO updating `nodes_history` at graph completion instead of after node execution
        # means a desync is possible if the graph fails. Could lead to missing keys in
        # `nodes_history`
        self.cache[CacheAdapter.nodes_history_key] = self.nodes_history
        self.cache.close()

    def run_before_node_execution(self, *args, **kwargs):
        """Placeholder required to subclass `NodeExecutionMethod`"""
        pass

    @staticmethod
    def create_key(node_hash: str, node_inputs: Dict[str, Any]) -> str:
        """Pickle objects into bytes then get their hash value"""
        digest = hashlib.sha256()
        digest.update(node_hash.encode())

        for ins in node_inputs.values():
            digest.update(pickle.dumps(ins))

        return digest.hexdigest()


def wait_random(mean: float, stddev: float):
    sleep_time = random.gauss(mu=mean, sigma=stddev)
    if sleep_time < 0:
        sleep_time = 0
    time.sleep(sleep_time)


class SlowDownYouMoveTooFast(NodeExecutionHook):
    """This hook makes your DAG run slower. Just pass in a negative value for the sleep time to make it go faster...
    In all seriousness though, there is absolutely no (good) reason to use this hook. Its dumb, and just for testing.
    """

    def __init__(self, sleep_time_mean: float, sleep_time_std: float):
        """In all seriousness, don't use this

        :param sleep_time_mean: Mean of sleep time
        :param sleep_time_std: Stddev of sleep time
        """
        self.sleep_time_mean = sleep_time_mean
        self.sleep_time_std = sleep_time_std

    def run_before_node_execution(self, **future_kwargs: Any):
        """Waits for a fixed set of time before node execution"""
        wait_random(self.sleep_time_mean, self.sleep_time_std)

    def run_after_node_execution(self, **future_kwargs: Any):
        """Does nothing"""
        pass


class FunctionInputOutputTypeChecker(NodeExecutionHook):
    """This lifecycle hook checks the input and output types of a function.

    It is a simple, but very strict type check against the declared type with what was actually received.
    E.g. if you don't want to check the types of a dictionary, don't annotate it with a type.
    """

    def __init__(self, check_input: bool = True, check_output: bool = True):
        """Constructor.

        :param check_input: check inputs to all functions
        :param check_output: check outputs to all functions
        """
        self.check_input = check_input
        self.check_output = check_output

    def run_before_node_execution(
        self,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        task_id: Optional[str],
        run_id: str,
        node_input_types: Dict[str, Any],
        **future_kwargs: Any,
    ):
        """Checks that the result type matches the expected node return type."""
        if self.check_input:
            for input_name, input_value in node_kwargs.items():
                if not htypes.check_instance(input_value, node_input_types[input_name]):
                    raise TypeError(
                        f"Node {node_name} received an input of type {type(input_value)} for {input_name}, expected {node_input_types[input_name]}"
                    )

    def run_after_node_execution(
        self,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        result: Any,
        error: Optional[Exception],
        success: bool,
        task_id: Optional[str],
        run_id: str,
        **future_kwargs: Any,
    ):
        """Checks that the result type matches the expected node return type."""
        if self.check_output:
            # Replace the isinstance check in your code with check_instance
            if not htypes.check_instance(result, node_return_type):
                raise TypeError(
                    f"Node {node_name} returned a result of type {type(result)}, expected {node_return_type}"
                )


SENTINEL_DEFAULT = None  # sentinel value -- lazy for now
INJECTION_ALLOWED = "injection is requested"


def accept_error_sentinels(func: Callable):
    """Tag a function to allow passing in error sentinels.

    For use with ``GracefulErrorAdapter``. The standard adapter behavior is to skip a node
    when an error sentinel is one of its inputs. This decorator will cause the node to
    run, and place the error sentinel into the appropriate input.

    Take care to ensure your sentinels are easily distinguishable if you do this - see the
    note in the GracefulErrorAdapater docstring.

    A use case is any data or computation aggregation step that still wants partial results,
    or considers a failure interesting enough to log or notify.

    .. code-block:: python

        SENTINEL = object()

        ...

        @accept_error_sentinels
        def results_gathering(result_1: float, result_2: float) -> dict[str, Any]:
            answer = {}
            for name, res in zip(["result 1", "result 2"], [result_1, result_2])
                answer[name] = res
                if res is SENTINEL:
                    answer[name] = "Node failure: no result"
                    # You may want side-effects for a failure.
                    _send_text_that_your_runs_errored()
            return answer

        ...
        adapter = GracefulErrorAdapter(sentinel_value=SENTINEL)
        ...


    """
    # This inline import is not ideal -- we have to do this due to a circular reference
    # See PR + comments here https://github.com/DAGWorks-Inc/hamilton/pull/1017
    # TODO -- fix the circular reference -- we should be able to depend on this and no pull in lifecycle methods
    from hamilton.function_modifiers.metadata import tag

    _the_tag = tag(
        **{"hamilton.error_sentinel": INJECTION_ALLOWED}, bypass_reserved_namespaces_=True
    )
    return _the_tag(func)


class GracefulErrorAdapter(NodeExecutionMethod):
    """Gracefully handles errors in a graph's execution. This allows you to proceed despite failure,
    dynamically pruning branches. While it still runs every node, it replaces them with no-ops if any upstream
    required dependencies fail (including optional dependencies).
    """

    def __init__(
        self,
        error_to_catch: Type[Exception],
        sentinel_value: Any = SENTINEL_DEFAULT,
        try_all_parallel: bool = True,
        allow_injection: bool = True,
    ):
        """Initializes the adapter. Allows you to customize the error to catch (which exception
        your graph will throw to indicate failure), as well as the sentinel value to use in place of
        a node's result if it fails (this defaults to ``None``).

        Note that this is currently only compatible with the dict-based result builder (use at your
        own risk with pandas series, etc...).

        Be careful using ``None`` as the default -- feel free to replace it with a sentinel value
        of your choice (this could negatively impact your graph's execution if you actually *do* intend
        to use ``None`` return values).

        You can use this as follows:

        .. code-block:: python

            # my_module.py
            # custom exception
            class DoNotProceed(Exception):
                pass


            def wont_proceed() -> int:
                raise DoNotProceed()


            def will_proceed() -> int:
                return 1


            def never_reached(wont_proceed: int) -> int:
                return 1  # this should not be reached


            dr = (
                driver.Builder()
                .with_modules(my_module)
                .with_adapters(
                    default.GracefulErrorAdapter(
                        error_to_catch=DoNotProceed,
                        sentinel_value=None
                    )
                )
                .build()
            )
            dr.execute(
                ["will_proceed", "never_reached"]
            )  # will return {'will_proceed': 1, 'never_reached': None}

        Note you can customize the error you want it to fail on and the sentinel value to use in place of a node's result if it fails.

        For Parallelizable nodes, this adapter will attempt to iterate over the node outputs.
        If an error occurs, the sentinel value is returned and no more iterations over the node
        will occur. Meaning if item (3) fails out of 1,2,3,4,5, 4/5 will not run. If you set
        ``try_all_parallel`` to be False, it only sends one sentinel value into the parallelize sub-dag.

        Here's an example for parallelizable to demonstrate try_all_parallel:

        .. code-block:: python

            # parallel_module.py
            # custom exception
            class DoNotProceed(Exception):
                pass


            def start_point() -> Parallelizable[int]:
                for i in range(5):
                    if i == 3:
                        raise DoNotProceed()
                    yield i


            def inner(start_point: int) -> int:
                return start_point


            def gather(inner: Collect[int]) -> list[int]:
                return inner


            dr = (
                driver.Builder()
                .with_modules(parallel_module)
                .with_adapters(
                    default.GracefulErrorAdapter(
                        error_to_catch=DoNotProceed,
                        sentinel_value=None,
                        try_all_parallel=True,
                    )
                )
                .build()
            )
            dr.execute(["gather"])  # will return {'gather': [0,1,2,None]}

            dr = (
                driver.Builder()
                .with_modules(parallel_module)
                .with_adapters(
                    default.GracefulErrorAdapter(
                        error_to_catch=DoNotProceed,
                        sentinel_value=None,
                        try_all_parallel=False,
                    )
                )
                .build()
            )
            dr.execute(["gather"])  # will return {'gather': [None]}


        :param error_to_catch: The error to catch
        :param sentinel_value: The sentinel value to use in place of a node's result if it fails
        :param try_all_parallel: Gather parallelizable outputs until a failure, then add a Sentinel.
        :param allow_injection: Flag for considering the ``accept_error_sentinels`` tag. Defaults to True.
        """
        self.error_to_catch = error_to_catch
        self.sentinel_value = sentinel_value
        self.try_all_parallel = try_all_parallel
        self.allow_injection = allow_injection

    def run_to_execute_node(
        self,
        *,
        node_callable: Any,
        node_kwargs: Dict[str, Any],
        is_expand: bool,
        is_collect: bool,
        **future_kwargs: Any,
    ) -> Any:
        # You can use the `is_expand` to see if the node is parallelizable
        # You can use the `is_collect` to see if the node is a collect node
        # TODO -- if it is parallelizable, run the generator in a special way (E.G. loop through the node callable
        # and truncate it/provide sentinels for every failure)
        # TODO -- decide what to do with collect
        """Executes a node. If the node fails, returns the sentinel value."""
        default_return = [self.sentinel_value] if is_expand else self.sentinel_value
        _node_tags = future_kwargs["node_tags"]
        can_inject = _node_tags.get("hamilton.error_sentinel", "") == INJECTION_ALLOWED
        can_inject = can_inject and self.allow_injection

        if not can_inject:
            for _key, value in node_kwargs.items():
                if type(self.sentinel_value) is type(value):
                    if self.sentinel_value == value:  # == versus is
                        return default_return
        if not is_expand:
            try:
                return node_callable(**node_kwargs)
            except self.error_to_catch:
                return self.sentinel_value

        if not self.try_all_parallel:
            gen_func = node_callable
        else:
            # Grab the partial-ized function that is a parallelizable.
            gen_func = node_callable.keywords["_callable"]
        try:
            gen = gen_func(**node_kwargs)
        except self.error_to_catch:
            return [self.sentinel_value]
        results: list[Any] = []
        try:
            for _res in gen:
                results.append(_res)
        except self.error_to_catch:
            if self.try_all_parallel:
                results.append(self.sentinel_value)
            else:
                results = [self.sentinel_value]
        return results


class NoEdgeAndInputTypeChecking(EdgeConnectionHook):
    """Permissive adapter to help you skip edge and input type checking.

    Useful for development.

    .. code-block:: python

        from hamilton import driver
        from hamilton.lifecycle import NoEdgeAndInputTypeChecking

        dr = driver.Builder().with_adapters(NoEdgeAndInputTypeChecking()).build()

        # now driver is built without any type checking
        dr.execute([...], ...)

    """

    def check_edge_types_match(self, type_from: type, type_to: type, **kwargs: Any) -> bool:
        """This is run to check if edge types match. Note that this is an OR functionality
        -- this is run after we do some default checks, so this can only be permissive.
        Return True - always
        """
        return True

    def validate_input(self, node_type: type, input_value: Any, **kwargs: Any) -> bool:
        """This is run to check if the input is valid for the node type. Note that this is an OR functionality
        -- this is run after we do some default checks, so this can only be permissive.
        Returns True - always.
        """
        return True
