import collections
import dataclasses
import enum
import functools
import json
import logging
import pathlib
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Collection, Dict, List, Literal, Optional, TypeVar, Union

import hamilton.node
from hamilton import graph_types
from hamilton.caching import fingerprinting
from hamilton.caching.cache_key import create_cache_key
from hamilton.caching.stores.base import (
    MetadataStore,
    ResultRetrievalError,
    ResultStore,
    search_data_adapter_registry,
)
from hamilton.caching.stores.file import FileResultStore
from hamilton.caching.stores.sqlite import SQLiteMetadataStore
from hamilton.function_modifiers.metadata import cache as cache_decorator
from hamilton.graph import FunctionGraph
from hamilton.lifecycle.base import (
    BaseDoNodeExecute,
    BasePostNodeExecute,
    BasePreGraphExecute,
    BasePreNodeExecute,
)

logger = logging.getLogger("hamilton.caching")

SENTINEL = object()
S = TypeVar("S", object, object)


CACHING_BEHAVIORS = Literal["default", "recompute", "disable", "ignore"]


class CachingBehavior(enum.Enum):
    """Behavior applied by the caching adapter

    DEFAULT:
        Try to retrieve result from cache instead of executing the node. If the node is executed, store the result.
        Compute the result data version and store it too.

    RECOMPUTE:
        Don't try to retrieve result from cache and always execute the node. Otherwise, behaves as default.
        Useful when nodes are stochastic (e.g., model training) or interact with external
        components (e.g., read from database).

    DISABLE:
        Node is executed as if the caching feature wasn't enabled.
        It never tries to retrieve results. Results are never stored nor versioned.
        Behaves like IGNORE, but the node remains a dependency for downstream nodes.
        This means downstream cache lookup will likely fail systematically (i.e., if the cache is empty).

    IGNORE:
        Node is executed as if the caching feature wasn't enable.
        It never tries to retrieve results. Results are never stored nor versioned.
        IGNORE means downstream nodes will ignore this node as a dependency for lookup.
        Ignoring clients and connections can be useful since they shouldn't directly impact the downstream results.
    """

    DEFAULT = 1
    RECOMPUTE = 2
    DISABLE = 3
    IGNORE = 4

    @classmethod
    def from_string(cls, string: str) -> "CachingBehavior":
        """Create a caching behavior from a string of the enum value. This is
        leveraged by the ``hamilton.lifecycle.caching.SmartCacheAdapter`` and
        the ``hamilton.function_modifiers.metadata.cache`` decorator.

        .. code-block::

            CachingBehavior.from_string("recompute")

        """
        try:
            return cls[string.upper()]
        except KeyError as e:
            raise KeyError(f"{string} is an invalid `CachingBehavior` value") from e


class NodeRoleInTaskExecution(enum.Enum):
    """Identify the role of a node in task-based execution, in particular when
    ``Parallelizable/Collect`` are used.

    NOTE This is an internal construct and it will likely change in the future.

    STANDARD: when task-based execution is not used. All nodes and dependencies are STANDARD.
    EXPAND: node with type ``Parallelizable``. It returns an iterator where individual items need to be handled.
        Dependencies can only be OUTSIDE.
    COLLECT: node with type ``Collect``. It returns an iterable where individual items need to be handled.
        Dependencies can be INSIDE, OUTSIDE, or EXPAND
    OUTSIDE: "outside" of ``Parallelizable/Collect`` paths; handled like STANDARD in most cases.
        Dependencies can be OUTSIDE or COLLECT
    INSIDE: "inside" or "between" a ``Parallelizable/Collect`` nodes.
        Dependencies can be INSIDE, OUTSIDE, or EXPAND.
    """

    STANDARD = 1
    EXPAND = 2
    COLLECT = 3
    OUTSIDE = 4
    INSIDE = 5


class CachingEventType(enum.Enum):
    """Event types logged by the caching adapter"""

    GET_DATA_VERSION = "get_data_version"
    SET_DATA_VERSION = "set_data_version"
    GET_CACHE_KEY = "get_cache_key"
    SET_CACHE_KEY = "set_cache_key"
    GET_RESULT = "get_result"
    SET_RESULT = "set_result"
    MISSING_RESULT = "missing_result"
    FAILED_RETRIEVAL = "failed_retrieval"
    EXECUTE_NODE = "execute_node"
    FAILED_EXECUTION = "failed_execution"
    RESOLVE_BEHAVIOR = "resolve_behavior"
    UNHASHABLE_DATA_VERSION = "unhashable_data_version"
    IS_OVERRIDE = "is_override"
    IS_INPUT = "is_input"
    IS_FINAL_VAR = "is_final_var"
    IS_DEFAULT_PARAMETER_VALUE = "is_default_parameter_value"


@dataclasses.dataclass(frozen=True)
class CachingEvent:
    """Event logged by the caching adapter"""

    run_id: str
    actor: Literal["adapter", "metadata_store", "result_store"]
    event_type: CachingEventType
    node_name: str
    task_id: Optional[str] = None
    msg: Optional[str] = None
    value: Optional[Any] = None
    timestamp: float = dataclasses.field(
        default_factory=lambda: datetime.now(timezone.utc).timestamp()
    )

    def __str__(self) -> str:
        """Create a human-readable string format for `print()`"""

        string = self.node_name
        if self.task_id is not None:
            string += f"::{self.task_id}"
        string += f"::{self.actor}"
        string += f"::{self.event_type.value}"
        if self.msg:  # this catches None and empty strings
            string += f"::{self.msg}"

        return string

    def as_dict(self):
        return dict(
            run_id=self.run_id,
            timestamp=self.timestamp,
            node_name=self.node_name,
            task_id=self.task_id,
            actor=self.actor,
            event_type=self.event_type.value,
            msg=self.msg,
            value=str(self.value) if self.value else self.value,
        )


# TODO we could add a "driver-level" kwarg to specify the cache format (e.g., parquet, JSON, etc.)
class HamiltonCacheAdapter(
    BaseDoNodeExecute, BasePreGraphExecute, BasePostNodeExecute, BasePreNodeExecute
):
    """Adapter enabling Hamilton's caching feature through ``Builder.with_cache()``

    .. code-block:: python

        from hamilton import driver
        import my_dataflow

        dr = (
            driver.Builder()
            .with_modules(my_dataflow)
            .with_cache()
            .build()
        )

        # then, you can access the adapter via
        dr.cache

    """

    def __init__(
        self,
        path: Union[str, pathlib.Path] = ".hamilton_cache",
        metadata_store: Optional[MetadataStore] = None,
        result_store: Optional[ResultStore] = None,
        default: Optional[Union[Literal[True], Collection[str]]] = None,
        recompute: Optional[Union[Literal[True], Collection[str]]] = None,
        ignore: Optional[Union[Literal[True], Collection[str]]] = None,
        disable: Optional[Union[Literal[True], Collection[str]]] = None,
        default_behavior: Optional[CACHING_BEHAVIORS] = None,
        default_loader_behavior: Optional[CACHING_BEHAVIORS] = None,
        default_saver_behavior: Optional[CACHING_BEHAVIORS] = None,
        log_to_file: bool = False,
        **kwargs,
    ):
        """Initialize the cache adapter.

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
        :param log_to_file: If True, append cache event logs as they happen in JSONL format.
        """
        self._path = path
        self.metadata_store = (
            metadata_store if metadata_store is not None else SQLiteMetadataStore(path=path)
        )
        self.result_store = (
            result_store if result_store is not None else FileResultStore(path=str(path))
        )
        self.log_to_file = log_to_file

        if sum([default is True, recompute is True, disable is True, ignore is True]) > 1:
            raise ValueError(
                "Can only set one of (`default`, `recompute`, `disable`, `ignore`) to True. Please pass mutually exclusive sets of node names"
            )
        self._default = default
        self._recompute = recompute
        self._disable = disable
        self._ignore = ignore
        self.default_behavior = default_behavior
        self.default_loader_behavior = default_loader_behavior
        self.default_saver_behavior = default_saver_behavior

        # attributes populated at execution time
        self.run_ids: List[str] = []
        self._fn_graphs: Dict[str, FunctionGraph] = {}  # {run_id: graph}
        self._data_savers: Dict[str, Collection[str]] = {}  # {run_id: list[node_name]}
        self._data_loaders: Dict[str, Collection[str]] = {}  # {run_id: list[node_name]}
        self.behaviors: Dict[
            str, Dict[str, CachingBehavior]
        ] = {}  # {run_id: {node_name: behavior}}
        self.data_versions: Dict[
            str, Dict[str, Union[str, Dict[str, str]]]
        ] = {}  # {run_id: {node_name: version}} or {run_id: {node_name: {task_id: version}}}
        self.code_versions: Dict[str, Dict[str, str]] = {}  # {run_id: {node_name: version}}
        self.cache_keys: Dict[
            str, Dict[str, Union[str, Dict[str, str]]]
        ] = {}  # {run_id: {node_name: key}} or {run_id: {node_name: {task_id: key}}}
        self._logs: Dict[str, List[CachingEvent]] = {}  # {run_id: [logs]}

    @property
    def last_run_id(self):
        """Run id of the last started run. Not necessarily the last to complete."""
        return self.run_ids[-1]

    def __getstate__(self) -> dict:
        """Serialization method required for multiprocessing and multithreading
        when using task-based execution with `Parallelizable/Collect`
        """
        state = self.__dict__.copy()
        # store the classes to reinstantiate the same backend in __setstate__
        state["metadata_store_cls"] = self.metadata_store.__class__
        state["metadata_store_init"] = self.metadata_store.__getstate__()
        state["result_store_cls"] = self.result_store.__class__
        state["result_store_init"] = self.result_store.__getstate__()
        del state["metadata_store"]
        del state["result_store"]
        return state

    def __setstate__(self, state: dict) -> None:
        """Serialization method required for multiprocessing and multithreading
        when using task-based execution with `Parallelizable/Collect`.

        Create new instances of metadata and result stores to have one connection
        per thread.
        """
        # instantiate the backend from the class, then delete the attribute before
        # setting it on the adapter instance.
        self.metadata_store = state["metadata_store_cls"](**state["metadata_store_init"])
        self.result_store = state["result_store_cls"](**state["result_store_init"])
        del state["metadata_store_cls"]
        del state["result_store_cls"]
        self.__dict__.update(state)

    def _log_event(
        self,
        run_id: str,
        node_name: str,
        actor: Literal["adapter", "metadata_store", "result_store"],
        event_type: CachingEventType,
        msg: Optional[str] = None,
        value: Optional[Any] = None,
        task_id: Optional[str] = None,
    ) -> None:
        """Add a single event to logs stored in state, keyed by run_id

        If global log level is set to logging.INFO, only log if event type is GET_RESULT or EXECUTE_NODE;
        If it is set to logging.DEBUG, log all events.

        If `SmartCacheAdapter.log_to_file` is set to True, log all events to a file in JSONL format.

        :param node_name: name of the node associated with the event
        :param task_id: optional identifier when using task-based execution. (node_name, task_id) is a primary key
        :param actor: component responsible for the event
        :param event_type: enum specifying what type of event (execute, retrieve, etc.)
        :param msg: additional message to display in the logs (e.g., via terminal)
        :param value: arbitrary value to include (typically a string for data version, code version, cache_key). Must be small and JSON-serializable.
        """
        event = CachingEvent(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor=actor,
            event_type=event_type,
            msg=msg,
            value=value,
        )
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug(f"{event.__str__()}")
        elif logger.isEnabledFor(logging.INFO):
            if event.event_type in (CachingEventType.GET_RESULT, CachingEventType.EXECUTE_NODE):
                logger.info(f"{event.__str__()}")

        self._logs[run_id].append(event)

        if self.log_to_file:
            log_file_path = pathlib.Path(self.metadata_store._directory, "cache_logs.jsonl")
            json_line = json.dumps(event.as_dict())
            with log_file_path.open("a") as f:
                f.write(json_line + "\n")

    def _log_by_node_name(
        self, run_id: str, level: Literal["debug", "info"] = "info"
    ) -> Dict[str, List[str]]:
        """For a given run, group logs to key them by ``node_name`` or ``(node_name, run_id)`` if applicable."""
        run_logs = collections.defaultdict(list)
        for event in self._logs[run_id]:
            if level == "info":
                if event.event_type not in (
                    CachingEventType.GET_RESULT,
                    CachingEventType.EXECUTE_NODE,
                ):
                    continue

            key = (event.node_name, event.task_id) if event.task_id else event.node_name
            run_logs[key].append(event)
        return dict(run_logs)

    def logs(self, run_id: Optional[str] = None, level: Literal["debug", "info"] = "info") -> dict:
        """Execution logs of the cache adapter.

        :param run_id: If ``None``, return all logged runs. If provided a ``run_id``, group logs by node.
        :param level: If ``"debug"`` log all events. If ``"info"`` only log if result is retrieved or executed.
        :return: a mapping between node/task and a list of logged events

        .. code-block:: python

            from hamilton import driver
            import my_dataflow

            dr = driver.Builder().with_modules(my_dataflow).with_cache().build()
            dr.execute(...)
            dr.execute(...)

            all_logs = dr.cache.logs()
            # all_logs is a dictionary with run_ids as keys and lists of CachingEvent as values.
            # {
            #    run_id_1: [CachingEvent(...), CachingEvent(...)],
            #    run_id_2: [CachingEvent(...), CachingEvent(...)],
            # }


            run_logs = dr.cache.logs(run_id=dr.last_run_id)
            # run_logs are keyed by ``node_name``
            # {node_name: [CachingEvent(...), CachingEvent(...)], ...}
            # or ``(node_name, task_id)`` if task-based execution is used.
            # {(node_name_1, task_id_1): [CachingEvent(...), CachingEvent(...)], ...}

        """
        if run_id:
            return self._log_by_node_name(run_id=run_id, level=level)

        logs = collections.defaultdict(list)
        for run_id, run_logs in self._logs.items():
            for event in run_logs:
                if level == "info" and event.event_type not in (
                    CachingEventType.GET_RESULT,
                    CachingEventType.EXECUTE_NODE,
                ):
                    continue

                logs[run_id].append(event)

        return dict(logs)

    @staticmethod
    def _view_run(
        fn_graph: FunctionGraph,
        logs,
        final_vars: List[str],
        inputs: dict,
        overrides: dict,
        output_file_path: Optional[str] = None,
    ):
        """Create a Hamilton visualization of the execution and the cache hits/misses.

        This leverages the ``custom_style_function`` feature internally.
        """
        from hamilton.driver import Driver  # avoid circular import

        def _visualization_styling_function(*, node, node_class, logs):
            """Custom style function for the visualization."""
            if any(
                event.event_type == CachingEventType.GET_RESULT for event in logs.get(node.name, [])
            ):
                style = (
                    {"penwidth": "3", "color": "#F06449", "fillcolor": "#ffffff"},
                    node_class,
                    "from cache",
                )
            else:
                style = ({}, node_class, None)

            return style

        return Driver._visualize_execution_helper(
            adapter=None,
            bypass_validation=True,
            render_kwargs={},
            output_file_path=output_file_path,
            fn_graph=fn_graph,
            final_vars=final_vars,
            inputs=inputs,
            overrides=overrides,
            custom_style_function=functools.partial(_visualization_styling_function, logs=logs),
        )

    # TODO make this work directly from the metadata_store too
    # visualization from logs is convenient when debugging someone else's issue
    def view_run(self, run_id: Optional[str] = None, output_file_path: Optional[str] = None):
        """View the dataflow execution, including cache hits/misses.

        :param run_id: If ``None``, view the last run. If provided a ``run_id``, view that run.
        :param output_file_path: If provided a path, save the visualization to a file.

        .. code-block:: python

            from hamilton import driver
            import my_dataflow

            dr = driver.Builder().with_modules(my_dataflow).with_cache().build()

            # execute 3 times
            dr.execute(...)
            dr.execute(...)
            dr.execute(...)

            # view the last run
            dr.cache.view_run()
            # this is equivalent to
            dr.cache.view_run(run_id=dr.last_run_id)

            # get a specific run id
            run_id = dr.cache.run_ids[1]
            dr.cache.view_run(run_id=run_id)

        """
        if run_id is None:
            run_id = self.last_run_id

        fn_graph = self._fn_graphs[run_id]
        logs = self.logs(run_id, level="debug")

        final_vars = []
        inputs = {}
        overrides = {}
        for key, events in logs.items():
            if isinstance(key, tuple):
                raise ValueError(
                    "`.view()` is currently not supported for task-based execution. "
                    "Please inspect the logs directly via `.logs(run_id=...)` for debugging."
                )

            node_name = key
            if any(e.event_type == CachingEventType.IS_FINAL_VAR for e in events):
                final_vars.append(node_name)

            if any(e.event_type == CachingEventType.IS_INPUT for e in events):
                inputs[node_name] = None  # the value doesn't matter, only the key of the dict
                continue

            elif any(e.event_type == CachingEventType.IS_OVERRIDE for e in events):
                overrides[node_name] = None  # the value doesn't matter, only the key of the dict
                continue

        return self._view_run(
            fn_graph=fn_graph,
            logs=logs,
            final_vars=final_vars,
            inputs=inputs,
            overrides=overrides,
            output_file_path=output_file_path,
        )

    def _get_node_role(
        self, run_id: str, node_name: str, task_id: Optional[str]
    ) -> NodeRoleInTaskExecution:
        """Determine based on the node name and task_id if a node is part of parallel execution."""
        if task_id is None:
            role = NodeRoleInTaskExecution.STANDARD
        else:
            node_type: hamilton.node.NodeType = self._fn_graphs[run_id].nodes[node_name].node_role
            if node_type == hamilton.node.NodeType.EXPAND:
                role = NodeRoleInTaskExecution.EXPAND
            elif node_type == hamilton.node.NodeType.COLLECT:
                role = NodeRoleInTaskExecution.COLLECT
            elif node_name == task_id:
                role = NodeRoleInTaskExecution.OUTSIDE
            else:
                role = NodeRoleInTaskExecution.INSIDE

        return role

    def get_cache_key(
        self, run_id: str, node_name: str, task_id: Optional[str] = None
    ) -> Union[str, S]:
        """Get the ``cache_key`` stored in-memory for a specific ``run_id``, ``node_name``, and ``task_id``.

        This method is public-facing and can be used directly to inspect the cache.

        :param run_id: Id of the Hamilton execution run.
        :param node_name: Name of the node associated with the cache key. ``node_name`` is a unique identifier
            if task-based execution is not used.
        :param task_id: Id of the task when task-based execution is used. Then, the tuple ``(node_name, task_id)``
            is a unique identifier.
        :return: The cache key if it exists, otherwise return a sentinel value.

        .. code-block:: python

            from hamilton import driver
            import my_dataflow

            dr = driver.Builder().with_modules(my_dataflow).with_cache().build()
            dr.execute(...)

            dr.cache.get_cache_key(run_id=dr.last_run_id, node_name="my_node", task_id=None)

        """
        node_role = self._get_node_role(run_id=run_id, node_name=node_name, task_id=task_id)

        if node_role == NodeRoleInTaskExecution.INSIDE:
            cache_key = self.cache_keys[run_id].get(node_name, {}).get(task_id, SENTINEL)  # type: ignore ; `task_id` can't be None
        else:
            cache_key = self.cache_keys[run_id].get(node_name, SENTINEL)

        cache_key = cache_key if cache_key is not SENTINEL else None
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="adapter",
            event_type=CachingEventType.GET_CACHE_KEY,
            msg="hit" if cache_key is not SENTINEL else "miss",
            value=cache_key,
        )
        return cache_key

    def _set_cache_key(
        self, run_id: str, node_name: str, cache_key: str, task_id: Optional[str] = None
    ) -> None:
        """Set the ``cache_key`` stored in-memory for a specific ``run_id``, ``node_name``, and ``task_id``.

        When calling this method, ``cache_key`` must not be ``None``.
        """
        assert cache_key is not None
        node_role = self._get_node_role(run_id=run_id, node_name=node_name, task_id=task_id)
        if node_role in (
            NodeRoleInTaskExecution.STANDARD,
            NodeRoleInTaskExecution.OUTSIDE,
            NodeRoleInTaskExecution.EXPAND,
            NodeRoleInTaskExecution.COLLECT,
        ):
            self.cache_keys[run_id][node_name] = cache_key
        elif node_role == NodeRoleInTaskExecution.INSIDE:
            if self.cache_keys[run_id].get(node_name, SENTINEL) is SENTINEL:
                self.cache_keys[run_id][node_name] = {}
            self.cache_keys[run_id][node_name][task_id] = cache_key  # type: ignore ; we just initialized the nested dict
        else:
            raise ValueError(
                f"Received `{node_role}`. Unhandled `NodeRoleInTaskExecution`, please report this bug."
            )

        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="adapter",
            event_type=CachingEventType.SET_CACHE_KEY,
            value=cache_key,
        )

    def _get_memory_data_version(
        self, run_id: str, node_name: str, task_id: Optional[str] = None
    ) -> Union[str, S]:
        """Get the ``data_version`` stored in-memory for a specific ``run_id``, ``node_name``, and ``task_id``.

        The behavior depends on the ``CacheBehavior`` (e.g., RECOMPUTE, IGNORE, DISABLE, DEFAULT) and
        the ``NodeRoleInTaskExecution`` of the node (e.g., STANDARD, OUTSIDE, INSIDE, EXPAND, COLLECT).

        :param run_id: Id of the Hamilton execution run.
        :param node_name: Name of the node associated with the cache key. ``node_name`` is a unique identifier
            if task-based execution is not used.
        :param task_id: Id of the task when task-based execution is used. Then, the tuple ``(node_name, task_id)``
            is a unique identifier.
        """
        node_role = self._get_node_role(run_id=run_id, node_name=node_name, task_id=task_id)
        if node_role in (
            NodeRoleInTaskExecution.STANDARD,
            NodeRoleInTaskExecution.OUTSIDE,
            NodeRoleInTaskExecution.COLLECT,
        ):
            data_version = self.data_versions[run_id].get(node_name, SENTINEL)
        elif node_role == NodeRoleInTaskExecution.EXPAND:
            data_version = SENTINEL
        elif node_role == NodeRoleInTaskExecution.INSIDE:
            tasks_data_versions = self.data_versions[run_id].get(node_name, SENTINEL)
            if isinstance(tasks_data_versions, dict):
                data_version = tasks_data_versions.get(task_id, SENTINEL)
            else:
                data_version = SENTINEL
        else:
            raise ValueError(
                f"Received `{node_role}`. Unhandled `NodeRoleInTaskExecution`, please report this bug."
            )

        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="adapter",
            event_type=CachingEventType.GET_DATA_VERSION,
            msg="hit" if data_version is not SENTINEL else "miss",
        )
        return data_version

    def _get_stored_data_version(
        self, run_id: str, node_name: str, cache_key: str, task_id: Optional[str] = None
    ) -> Union[str, S]:
        """Get the ``data_version`` stored in the metadata store associated with the ``cache_key``.

        The ``run_id``, ``node_name``, and ``task_id`` are included only for logging purposes.
        """
        data_version = self.metadata_store.get(cache_key=cache_key)
        data_version = SENTINEL if data_version is None else data_version
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="metadata_store",
            event_type=CachingEventType.GET_DATA_VERSION,
            msg="hit" if data_version is not SENTINEL else "miss",
        )

        return data_version

    def get_data_version(
        self,
        run_id: str,
        node_name: str,
        cache_key: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> Union[str, S]:
        """Get the ``data_version``  for a specific ``run_id``, ``node_name``, and ``task_id``.

        This method is public-facing and can be used directly to inspect the cache. This will check data versions
        stored both in-memory and in the metadata store.

        :param run_id: Id of the Hamilton execution run.
        :param node_name: Name of the node associated with the data version. ``node_name`` is a unique identifier
            if task-based execution is not used.
        :param task_id: Id of the task when task-based execution is used. Then, the tuple ``(node_name, task_id)``
            is a unique identifier.
        :return: The data version if it exists, otherwise return a sentinel value.

        ..code-block:: python

            from hamilton import driver
            import my_dataflow

            dr = driver.Builder().with_modules(my_dataflow).with_cache().build()
            dr.execute(...)

            dr.cache.get_data_version(run_id=dr.last_run_id, node_name="my_node", task_id=None)

        """

        data_version = self._get_memory_data_version(
            run_id=run_id, node_name=node_name, task_id=task_id
        )

        if data_version is SENTINEL and cache_key is not None:
            data_version = self._get_stored_data_version(
                run_id=run_id, node_name=node_name, task_id=task_id, cache_key=cache_key
            )

        return data_version

    def _set_memory_metadata(
        self, run_id: str, node_name: str, data_version: str, task_id: Optional[str] = None
    ) -> None:
        """Set in-memory data_version whether a task_id is specified or not"""
        assert data_version is not None
        node_role = self._get_node_role(run_id=run_id, node_name=node_name, task_id=task_id)
        if node_role in (
            NodeRoleInTaskExecution.STANDARD,
            NodeRoleInTaskExecution.OUTSIDE,
            NodeRoleInTaskExecution.COLLECT,
        ):
            self.data_versions[run_id][node_name] = data_version
        elif node_role == NodeRoleInTaskExecution.EXPAND:
            self.data_versions[run_id][node_name] = {}
        elif node_role == NodeRoleInTaskExecution.INSIDE:
            if self.data_versions[run_id].get(node_name, SENTINEL) is SENTINEL:
                self.data_versions[run_id][node_name] = {}
            self.data_versions[run_id][node_name][task_id] = data_version  # type: ignore ; we just initialized the nested dict
        else:
            raise ValueError(
                f"Received `{node_role}`. Unhandled `NodeRoleInTaskExecution`, please report this bug."
            )

        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="adapter",
            event_type=CachingEventType.SET_DATA_VERSION,
            value=data_version,
        )

    def _set_stored_metadata(
        self,
        run_id: str,
        node_name: str,
        cache_key: str,
        data_version: str,
        task_id: Optional[str] = None,
    ) -> None:
        """Set data_version in the metadata store associated with the cache_key"""
        self.metadata_store.set(
            run_id=run_id,
            node_name=node_name,
            code_version=self.code_versions[run_id][node_name],
            data_version=data_version,
            cache_key=cache_key,
        )
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="metadata_store",
            event_type=CachingEventType.SET_DATA_VERSION,
            value=data_version,
        )

    def _version_data(
        self, node_name: str, run_id: str, result: Any, task_id: Optional[str] = None
    ) -> str:
        """Create a unique data version for the result"""
        data_version = fingerprinting.hash_value(result)
        if data_version == fingerprinting.UNHASHABLE:
            self._log_event(
                run_id=run_id,
                node_name=node_name,
                task_id=task_id,
                actor="adapter",
                event_type=CachingEventType.UNHASHABLE_DATA_VERSION,
                msg=f"unhashable type {type(result)}; set CachingBehavior.IGNORE to silence warning",
                value=data_version,
            )
            logger.warning(
                f"Node `{node_name}` has unhashable result of type `{type(result)}`. "
                "Set `CachingBehavior.IGNORE` or register a versioning function to silence warning. "
                "Learn more: https://hamilton.dagworks.io/en/latest/concepts/caching/#caching-behavior\n"
            )
            # if the data version is unhashable, we need to set a random suffix to the cache_key
            # to prevent the cache from thinking this value is constant, causing a cache hit.
            data_version = "<unhashable>" + f"_{uuid.uuid4()}"

        return data_version

    def version_data(self, result: Any, run_id: str = None) -> str:
        """Create a unique data version for the result

        This is a user-facing method.
        """
        # stuff the internal function call to not log event
        return self._version_data(result=result, run_id=run_id, node_name=None)

    def version_code(self, node_name: str, run_id: Optional[str] = None) -> str:
        """Create a unique code version for the source code defining the node"""
        run_id = self.last_run_id if run_id is None else run_id
        node = self._fn_graphs[run_id].nodes[node_name]
        return graph_types.HamiltonNode.from_node(node).version  # type: ignore

    def _execute_node(
        self,
        run_id: str,
        node_name: str,
        node_callable: Callable,
        node_kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ) -> Any:
        """Simple wrapper that logs the regular execution of a node."""
        logger.debug(node_name)
        result = node_callable(**node_kwargs)
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=task_id,
            actor="adapter",
            event_type=CachingEventType.EXECUTE_NODE,
        )
        return result

    @staticmethod
    def _resolve_node_behavior(
        node: hamilton.node.Node,
        default: Optional[Collection[str]] = None,
        disable: Optional[Collection[str]] = None,
        recompute: Optional[Collection[str]] = None,
        ignore: Optional[Collection[str]] = None,
        default_behavior: CACHING_BEHAVIORS = "default",
        default_loader_behavior: CACHING_BEHAVIORS = "default",
        default_saver_behavior: CACHING_BEHAVIORS = "default",
    ) -> CachingBehavior:
        """Determine the cache behavior of a node.
        Behavior specified via the ``Builder`` has precedence over the ``@cache`` decorator.
        Otherwise, set the ``DEFAULT`` behavior.
        If the node is `Parallelizable` enforce the ``RECOMPUTE`` behavior to ensure
        yielded items are versioned individually.
        """
        if node.node_role == hamilton.node.NodeType.EXPAND:
            return CachingBehavior.RECOMPUTE

        behavior_from_tag = node.tags.get(cache_decorator.BEHAVIOR_KEY, SENTINEL)
        if behavior_from_tag is not SENTINEL:
            behavior_from_tag = CachingBehavior.from_string(behavior_from_tag)

        behavior_from_driver = SENTINEL
        for behavior, node_set in (
            (CachingBehavior.DEFAULT, default),
            (CachingBehavior.DISABLE, disable),
            (CachingBehavior.RECOMPUTE, recompute),
            (CachingBehavior.IGNORE, ignore),
        ):
            # guard against default None value
            if node_set is None:
                continue

            if node.name in node_set:
                if behavior_from_driver is not SENTINEL:
                    raise ValueError(
                        f"Multiple caching behaviors specified by Driver for node: {node.name}"
                    )
                behavior_from_driver = behavior

        if behavior_from_driver is not SENTINEL:
            return behavior_from_driver
        elif behavior_from_tag is not SENTINEL:
            return behavior_from_tag
        elif node.tags.get("hamilton.data_loader"):
            return CachingBehavior.from_string(default_loader_behavior)
        elif node.tags.get("hamilton.data_saver"):
            return CachingBehavior.from_string(default_saver_behavior)
        else:
            return CachingBehavior.from_string(default_behavior)

    def resolve_behaviors(self, run_id: str) -> Dict[str, CachingBehavior]:
        """Resolve the caching behavior for each node based on the ``@cache`` decorator
        and the ``Builder.with_cache()`` parameters for a specific ``run_id``.

        This is a user-facing method.

        Behavior specified via ``Builder.with_cache()`` have precedence. If no parameters are specified,
        the ``CachingBehavior.DEFAULT`` is used. If a node is ``Parallelizable`` (i.e., ``@expand``),
        the ``CachingBehavior`` is set to ``CachingBehavior.RECOMPUTE`` to ensure the yielded items
        are versioned individually. Internally, this uses the ``FunctionGraph`` stored for each ``run_id`` and logs
        the resolved caching behavior for each node.

        :param run_id: Id of the Hamilton execution run.
        :return: A dictionary of ``{node name: caching behavior}``.
        """
        graph = self._fn_graphs[run_id]

        _default = self._default
        _disable = self._disable
        _recompute = self._recompute
        _ignore = self._ignore

        if _default is True:
            _default = [n.name for n in graph.get_nodes()]
        elif _disable is True:
            _disable = [n.name for n in graph.get_nodes()]
        elif _recompute is True:
            _recompute = [n.name for n in graph.get_nodes()]
        elif _ignore is True:
            _ignore = [n.name for n in graph.get_nodes()]

        default_behavior = "default"
        if self.default_behavior is not None:
            default_behavior = self.default_behavior

        default_loader_behavior = default_behavior
        if self.default_loader_behavior is not None:
            default_loader_behavior = self.default_loader_behavior

        default_saver_behavior = default_behavior
        if self.default_saver_behavior is not None:
            default_saver_behavior = self.default_saver_behavior

        behaviors = {}
        for node in graph.get_nodes():
            behavior = HamiltonCacheAdapter._resolve_node_behavior(
                node=node,
                default=_default,
                disable=_disable,
                recompute=_recompute,
                ignore=_ignore,
                default_behavior=default_behavior,
                default_loader_behavior=default_loader_behavior,
                default_saver_behavior=default_saver_behavior,
            )
            behaviors[node.name] = behavior

            self._log_event(
                run_id=run_id,
                node_name=node.name,
                task_id=None,
                actor="adapter",
                event_type=CachingEventType.RESOLVE_BEHAVIOR,
                value=behavior,
            )

        # need to handle materializers via a second pass to copy the behavior
        # of their "main node"
        for node in graph.get_nodes():
            if node.tags.get("hamilton.data_loader") is True:
                main_node = node.tags["hamilton.data_loader.node"]
                if main_node == node.name:
                    continue

                # solution for `@dataloader` and `from_`
                if behaviors.get(main_node, None) is not None:
                    behaviors[node.name] = behaviors[main_node]
                # this hacky section is required to support @load_from and provide
                # a unified pattern to specify behavior from the module or the driver
                else:
                    behaviors[node.name] = HamiltonCacheAdapter._resolve_node_behavior(
                        # we create a fake node, only its name matters
                        node=hamilton.node.Node(
                            name=main_node,
                            typ=str,
                            callabl=lambda: None,
                            tags=node.tags.copy(),
                        ),
                        default=_default,
                        disable=_disable,
                        recompute=_recompute,
                        ignore=_ignore,
                        default_behavior=default_loader_behavior,
                    )

                self._data_loaders[run_id].append(main_node)

            if node.tags.get("hamilton.data_saver", None) is not None:
                self._data_savers[run_id].append(node.name)

        return behaviors

    def resolve_code_versions(
        self,
        run_id: str,
        final_vars: Optional[List[str]] = None,
        inputs: Optional[Dict[str, Any]] = None,
        overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, str]:
        """Resolve the code version for each node for a specific ``run_id``.

        This is a user-facing method.

        If ``final_vars`` is None, all nodes will be versioned. If ``final_vars`` is provided,
        the ``inputs`` and ``overrides`` are used to determine the execution path and only
        version the code for these nodes.

        :param run_id: Id of the Hamilton execution run.
        :param final_vars: Nodes requested for execution.
        :param inputs: Input node values.
        :param overrides: Override node values.
        :return: A dictionary of ``{node name: code version}``.
        """
        graph = self._fn_graphs[run_id]

        final_vars = [] if final_vars is None else final_vars
        inputs = {} if inputs is None else inputs
        overrides = {} if overrides is None else overrides

        node_selection = graph.get_nodes()
        if len(final_vars) > 0:
            all_nodes, user_defined_nodes = graph.get_upstream_nodes(final_vars, inputs, overrides)
            node_selection = set(all_nodes) - set(user_defined_nodes)

        return {
            node.name: self.version_code(run_id=run_id, node_name=node.name)
            for node in node_selection
        }

    def _process_input(self, run_id: str, node_name: str, value: Any) -> None:
        """Process input nodes to version data and code.

        To enable caching, input values must be versioned. Since inputs have no associated code,
        set a constant "code version" ``f"input__{node_name}"`` that uniquely identifies this input.
        """
        data_version = self._version_data(node_name=node_name, run_id=run_id, result=value)
        self.code_versions[run_id][node_name] = f"input__{node_name}"
        self.data_versions[run_id][node_name] = data_version
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=None,
            actor="adapter",
            event_type=CachingEventType.IS_INPUT,
            value=data_version,
        )

    def _process_override(self, run_id: str, node_name: str, value: Any) -> None:
        """Process override nodes to version data and code.

        To enable caching, override values must be versioned. As opposed to executed nodes,
        code and data versions for overrides are not stored because their value is user provided
        and isn't necessarily tied to the code.
        """
        data_version = self._version_data(node_name=node_name, run_id=run_id, result=value)
        self.data_versions[run_id][node_name] = data_version
        self._log_event(
            run_id=run_id,
            node_name=node_name,
            task_id=None,
            actor="adapter",
            event_type=CachingEventType.IS_OVERRIDE,
            value=data_version,
        )

    @staticmethod
    def _resolve_default_parameter_values(
        node_: hamilton.node.Node, node_kwargs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        If a node uses the function's default parameter values, they won't be part of the
        node_kwargs. To ensure a consistent `cache_key` we want to retrieve default parameter
        values if they're used
        """
        resolved_kwargs = node_kwargs.copy()
        for param_name, param_value in node_.default_parameter_values.items():
            # if the `param_name` not in `node_kwargs`, it means the node uses the default
            # parameter value
            if param_name not in node_kwargs.keys():
                resolved_kwargs.update(**{param_name: param_value})

        return resolved_kwargs

    def pre_graph_execute(
        self,
        *,
        run_id: str,
        graph: FunctionGraph,
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Set up the state of the adapter for a new execution.

        Most attributes need to be keyed by run_id to prevent potential conflicts because
        the same adapter instance is shared between across all ``Driver.execute()`` calls.
        """
        self.run_ids.append(run_id)
        self.metadata_store.initialize(run_id)
        self._logs[run_id] = []

        self._fn_graphs[run_id] = graph
        self.data_versions[run_id] = {}
        self.cache_keys[run_id] = {}
        self.code_versions[run_id] = self.resolve_code_versions(
            run_id=run_id, final_vars=final_vars, inputs=inputs, overrides=overrides
        )
        # the empty `._data_loaders` and `._data_savers` need to be instantiated before calling
        # `self.resolve_behaviors` because it appends to them
        self._data_loaders[run_id] = []
        self._data_savers[run_id] = []
        self.behaviors[run_id] = self.resolve_behaviors(run_id=run_id)

        # final vars are logged to be retrieved by the ``.view_run()`` method
        for final_var in final_vars:
            self._log_event(
                run_id=run_id,
                node_name=final_var,
                task_id=None,
                actor="adapter",
                event_type=CachingEventType.IS_FINAL_VAR,
            )

        if inputs:
            for node_name, value in inputs.items():
                self._process_input(run_id, node_name, value)

        if overrides:
            for node_name, value in overrides.items():
                self._process_override(run_id, node_name, value)

    def pre_node_execute(
        self,
        *,
        run_id: str,
        node_: hamilton.node.Node,
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
        **future_kwargs,
    ):
        """Before node execution or retrieval, create the cache_key and set it in memory.
        The cache_key is created based on the node's code version and its dependencies' data versions.

        Collecting ``data_version`` for upstream dependencies requires handling special cases when
        task-based execution is used:
        - If the current node is ``COLLECT`` , the dependency annotated with ``Collect[]`` needs to
        be versioned item by item instead of versioning the full container. This is because the
        collect order is inconsistent.
        - If the current node is ``INSIDE`` and the dependency is ``EXPAND``, this means the
        ``kwargs`` dictionary contains a single item. We need to version this individual item because
        it will not be available from "inside" the branch for some executors (multiprocessing, multithreading)
        because they lose access to the data_versions of ``OUTSIDE`` nodes stored in ``self.data_versions``.

        """
        node_name = node_.name
        node_kwargs = HamiltonCacheAdapter._resolve_default_parameter_values(node_, kwargs)

        if self.behaviors[run_id][node_name] == CachingBehavior.IGNORE:
            return

        # won't need the cache_key for either result retrieval or storage
        if self.behaviors[run_id][node_name] == CachingBehavior.DISABLE:
            return

        node_role = self._get_node_role(run_id=run_id, node_name=node_name, task_id=task_id)
        collected_name = (
            node_.collect_dependency if node_role == NodeRoleInTaskExecution.COLLECT else SENTINEL
        )

        dependencies_data_versions = {}
        for dep_name, dep_value in node_kwargs.items():
            # resolve caching behaviors
            if self.behaviors[run_id][dep_name] == CachingBehavior.IGNORE:
                # setting the data_version to "<ignore>" in the cache_key means that
                # the value of the dependency appears constant to this node
                dependencies_data_versions[dep_name] = "<ignore>"
                continue
            elif self.behaviors[run_id][dep_name] == CachingBehavior.DISABLE:
                # setting the data_version to "<disable>" with a random suffix in the
                # cache_key means the current node will be a cache miss and forced to recompute
                dependencies_data_versions[dep_name] = "<disable>" + f"_{uuid.uuid4()}"
                continue

            # resolve NodeRoleInTaskExecution
            if task_id is None:
                dep_role = NodeRoleInTaskExecution.STANDARD
            else:
                # want to check if dependency is an EXPAND node. We must not pass the current `task_id`
                dep_role = self._get_node_role(
                    run_id=run_id, node_name=dep_name, task_id="<placeholder>"
                )

            # if dep_role == NodeRoleInTaskExecution.STANDARD:

            if dep_name == collected_name:
                # the collected value should be hashed based on the items, not the container
                items_data_versions = [self.version_data(item, run_id=run_id) for item in dep_value]
                dep_data_version = fingerprinting.hash_value(sorted(items_data_versions))

            elif dep_role == NodeRoleInTaskExecution.EXPAND:
                # if the dependency is `EXPAND`, the kwarg received is a single item yielded by the iterator
                # rather than the full iterable. We must version it directly, similar to a top-level input
                dep_data_version = self.version_data(dep_value, run_id=run_id)

            else:
                tasks_data_versions = self._get_memory_data_version(
                    run_id=run_id, node_name=dep_name, task_id=None
                )
                if tasks_data_versions is SENTINEL:
                    dep_data_version = self.version_data(dep_value, run_id=run_id)
                elif isinstance(tasks_data_versions, dict):
                    dep_data_version = tasks_data_versions.get(task_id)
                else:
                    dep_data_version = tasks_data_versions

            if dep_data_version == fingerprinting.UNHASHABLE:
                # if the data version is unhashable, we need to set a random suffix to the cache_key
                # to prevent the cache from thinking this value is constant, causing a cache hit.
                dep_data_version = "<unhashable>" + f"_{uuid.uuid4()}"

            dependencies_data_versions[dep_name] = dep_data_version

        # create cache_key before execution; will be reused during and after execution
        cache_key = create_cache_key(
            node_name=node_name,
            code_version=self.code_versions[run_id][node_name],
            dependencies_data_versions=dependencies_data_versions,
        )
        self._set_cache_key(
            run_id=run_id, node_name=node_name, task_id=task_id, cache_key=cache_key
        )

    def do_node_execute(
        self,
        *,
        run_id: str,
        node_: hamilton.node.Node,
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
        **future_kwargs,
    ):
        """Try to retrieve stored result from previous executions or execute the node.

        Use the previously created cache_key to retrieve the data_version from memory or the metadata_store.
        If data_version is retrieved try to retrieve the result. If it fails, execute the node.
        Else, execute the node.
        """
        node_name = node_.name
        node_callable = node_.callable
        node_kwargs = HamiltonCacheAdapter._resolve_default_parameter_values(node_, kwargs)

        if self.behaviors[run_id][node_name] in (
            CachingBehavior.DISABLE,
            CachingBehavior.IGNORE,
            CachingBehavior.RECOMPUTE,
        ):
            result = self._execute_node(
                run_id=run_id,
                node_name=node_name,
                node_callable=node_callable,
                node_kwargs=node_kwargs,
                task_id=task_id,
            )
            if self.behaviors[run_id][node_name] in (
                CachingBehavior.RECOMPUTE,
                CachingBehavior.IGNORE,
            ):
                cache_key = self.get_cache_key(run_id=run_id, node_name=node_name, task_id=task_id)

                # nodes collected in `._data_loaders` return tuples of (result, metadata)
                # where metadata often includes a timestamp. To ensure we provide a consistent
                # `data_version` / hash, we only hash the result part of the materializer return
                # value and discard the metadata.
                if node_name in self._data_loaders[run_id] and isinstance(result, tuple):
                    result = result[0]

                data_version = self._version_data(node_name=node_name, run_id=run_id, result=result)

                # nodes collected in `._data_savers` return a dictionary of metadata
                # this metadata often includes a timestamp, leading to an unstable hash.
                # we do not version nor store the metadata. This node is executed for its
                # external effect of saving a file
                if node_name in self._data_savers[run_id]:
                    data_version = f"{node_name}__metadata"

                self._set_memory_metadata(
                    run_id=run_id, node_name=node_name, task_id=task_id, data_version=data_version
                )
                self._set_stored_metadata(
                    run_id=run_id,
                    node_name=node_name,
                    task_id=task_id,
                    cache_key=cache_key,
                    data_version=data_version,
                )

            return result

        # cache_key is set in `pre_node_execute`
        cache_key = self.get_cache_key(run_id=run_id, node_name=node_name, task_id=task_id)
        # retrieve data version from memory or metadata_store
        data_version = self.get_data_version(
            run_id=run_id, node_name=node_name, task_id=task_id, cache_key=cache_key
        )

        need_to_compute_node = False
        if data_version is SENTINEL:
            # must execute: data_version not found in memory or in metadata_store
            need_to_compute_node = True
        elif data_version == fingerprinting.UNHASHABLE:
            # must execute: the retrieved data_version is UNHASHABLE, therefore it isn't stored.
            need_to_compute_node = True
        elif self.result_store.exists(data_version) is False:
            # must execute: data_version retrieved, but result store can't find result
            need_to_compute_node = True
            self._log_event(
                run_id=run_id,
                node_name=node_name,
                task_id=task_id,
                actor="result_store",
                event_type=CachingEventType.MISSING_RESULT,
                value=data_version,
            )
        else:
            # try to retrieve: data_version retrieve, result store found result
            try:
                # successful retrieval: retrieve the result; potentially load using the DataLoader if e.g.,``@cache(format="json")``
                result = self.result_store.get(data_version=data_version)
                self._log_event(
                    run_id=run_id,
                    node_name=node_name,
                    task_id=task_id,
                    actor="result_store",
                    event_type=CachingEventType.GET_RESULT,
                    msg="hit",
                    value=data_version,
                )
                # set the data_version previously retrieved (could be from memory or store)
                self._set_memory_metadata(
                    run_id=run_id, node_name=node_name, task_id=task_id, data_version=data_version
                )
            except ResultRetrievalError:
                # failed retrieval: despite finding the result, probably failed loading data using DataLoader if e.g.,``@cache(format="json")``
                self.metadata_store.delete(cache_key=cache_key)
                self.result_store.delete(data_version)
                need_to_compute_node = True

        if need_to_compute_node is True:
            result = self._execute_node(
                run_id=run_id,
                node_name=node_name,
                node_callable=node_callable,
                node_kwargs=node_kwargs,
                task_id=task_id,
            )

            # nodes collected in `._data_loaders` return tuples of (result, metadata)
            # where metadata often includes a timestamp. To ensure we provide a consistent
            # `data_version` / hash, we only hash the result part of the materializer return
            # value and discard the metadata.
            if node_name in self._data_loaders[run_id] and isinstance(result, tuple):
                result = result[0]

            data_version = self._version_data(node_name=node_name, run_id=run_id, result=result)

            # nodes collected in `._data_savers` return a dictionary of metadata
            # this metadata often includes a timestamp, leading to an unstable hash.
            # we do not version nor store the metadata. This node is executed for its
            # external effect of saving a file
            if node_name in self._data_savers[run_id]:
                data_version = f"{node_name}__metadata"

            self._set_memory_metadata(
                run_id=run_id, node_name=node_name, task_id=task_id, data_version=data_version
            )
            self._set_stored_metadata(
                run_id=run_id,
                node_name=node_name,
                task_id=task_id,
                cache_key=cache_key,
                data_version=data_version,
            )

        return result

    def post_node_execute(
        self,
        *,
        run_id: str,
        node_: hamilton.node.Node,
        result: Optional[str],
        success: bool = True,
        error: Optional[Exception] = None,
        task_id: Optional[str] = None,
        **future_kwargs,
    ):
        """Get the cache_key and data_version stored in memory (respectively from
        pre_node_execute and do_node_execute) and store the result in result_store
        if it doesn't exist.
        """
        node_name = node_.name

        if success is False:
            self._log_event(
                run_id=run_id,
                node_name=node_name,
                task_id=task_id,
                actor="adapter",
                event_type=CachingEventType.FAILED_EXECUTION,
                msg=f"{error}",
            )
            return

        if self.behaviors[run_id][node_name] in (
            CachingBehavior.DEFAULT,
            CachingBehavior.RECOMPUTE,
            CachingBehavior.IGNORE,
        ):
            cache_key = self.get_cache_key(run_id=run_id, node_name=node_name, task_id=task_id)
            data_version = self.get_data_version(
                run_id=run_id, node_name=node_name, task_id=task_id, cache_key=cache_key
            )
            assert data_version is not SENTINEL

            # TODO clean up this logic
            # check if a materialized file exist before writing results
            # when using `@cache(format="json")`
            cache_format = (
                self._fn_graphs[run_id]
                .nodes[node_name]
                .tags.get(cache_decorator.FORMAT_KEY, SENTINEL)
            )
            if cache_format is not SENTINEL:
                saver_cls, loader_cls = search_data_adapter_registry(
                    name=cache_format, type_=type(result)
                )  # type: ignore
                materialized_path = self.result_store._materialized_path(data_version, saver_cls)
                materialized_path_missing = not materialized_path.exists()
            else:
                saver_cls, loader_cls = None, None
                materialized_path_missing = False

            result_missing = not self.result_store.exists(data_version)
            if result_missing or materialized_path_missing:
                self.result_store.set(
                    data_version=data_version,
                    result=result,
                    saver_cls=saver_cls,
                    loader_cls=loader_cls,
                )
                self._log_event(
                    run_id=run_id,
                    node_name=node_name,
                    task_id=task_id,
                    actor="result_store",
                    event_type=CachingEventType.SET_RESULT,
                    value=data_version,
                )
