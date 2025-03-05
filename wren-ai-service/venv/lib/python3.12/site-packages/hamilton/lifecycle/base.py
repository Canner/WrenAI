"""Base lifecycle hooks/methods. This is *not* a public facing API -- see api.py for classes to extend.
This contains two sets of components:

1. Hooks/methods -- these are classes that customizes Hamilton's execution. They are called at specific
points in Hamilton's execution, and can be used to customize performance. There are specific rules about hooks
and methods
    - Methods can not (currently) be layered. This is because they replace a component of Hamilton's execution
    - Hooks can be layered. Multiple of the same hooks can be called at any given point.
2. Auxiliary tooling to register/manage hooks
    - LifecycleAdapterSet -- this is a class that manages a set of lifecycle adapters. It allows us to call
    all the lifecycle hooks/methods in a given set, and to determine if a given hook/method is implemented.
    - lifecycle -- this is a decorator container that allows us to register hooks/methods. It is used as follows:

To implement a new method/hook type:
1. Create a class that has a single method (see below for examples)
2. Decorate the class with the lifecycle decorator, passing in the name of the method/hook. This must correspond to a method on the class.
3. Add to the LifecycleAdapter type
4. Call out to the hook at different points in the lifecycle

Note that you can have one async hook/method and one sync hook/method in the same class. Some hooks/methods
are coupled to certain execution contexts. While they all live here for now, we could easily envision moving them
externally.

To build an implementation of a hook/method, all you have to do is extend any number of classes.
See api.py for implementations.
"""

import abc
import asyncio
import collections
import dataclasses
import inspect
from types import ModuleType
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union

from hamilton import htypes

# We need this because of a (required) circular reference
# Graph depends on lifecycle_base, as it uses the lifecycle hooks
# lifecycle_base has elements that use type-hinting with the FunctionGraph object
# This is OK -- in a *real* compiled language this wouldn't be an issue
# (you'd have header types in C, and java should be smart enough). Given that we're using
# python, which (our usage of) leans type-hinting trigger-happy, this will suffice.
if TYPE_CHECKING:
    from hamilton import graph, node

# All of these are internal APIs. Specifically, structure required to manage a set of
# hooks/methods/validators that we will likely expand. We store them in constants (rather than, say, a more complex single object)
# as it is a clear, simple way to manage the metadata. This allows us to track the registered hooks/methods/validators.

# A set of registered hooks -- each one refers to a string
REGISTERED_SYNC_HOOKS: Set[str] = set()
REGISTERED_ASYNC_HOOKS: Set[str] = set()

# A set of registered methods -- each one refers to a string, which is the name of the metho
REGISTERED_SYNC_METHODS: Set[str] = set()
REGISTERED_ASYNC_METHODS: Set[str] = set()

# A set of registered validators -- these have attached Exception data to them
# Note we do not curently have async validators -- see no need now
REGISTERED_SYNC_VALIDATORS: Set[str] = set()

# constants to refer to internally for hooks
SYNC_HOOK = "hooks"
ASYNC_HOOK = "async_hooks"

# constants to refer to internally for methods
SYNC_METHOD = "methods"
ASYNC_METHOD = "async_methods"

# constants to refer to internally for validators
SYNC_VALIDATOR = "validators"


@dataclasses.dataclass
class ValidationResult:
    success: bool
    error: Optional[str]
    validator: object  # validator so we can make the error message more friendly


class ValidationException(Exception):
    pass


class InvalidLifecycleAdapter(Exception):
    """Container exception to indicate that a lifecycle adapter is invalid."""

    pass


def validate_lifecycle_adapter_function(
    fn: Callable, returns_value: bool, return_type: Optional[Type] = None
):
    """Validates that a function has arguments that are keyword-only,
    and either does or does not return a value, depending on the value of returns_value.

    :param fn: The function to validate
    :param returns_value: Whether the function should return a value or not
    """
    sig = inspect.signature(fn)
    if returns_value:
        if sig.return_annotation is inspect.Signature.empty:
            raise InvalidLifecycleAdapter(
                f"Lifecycle methods must return a value, but {fn} does not have a return annotation."
            )
        if return_type is not None and not htypes.custom_subclass_check(
            sig.return_annotation, return_type
        ):
            raise InvalidLifecycleAdapter(
                f"Lifecycle methods must return a value of type {return_type}, "
                f"but {fn} has a return annotation of "
                f"type {sig.return_annotation}."
            )
    if not returns_value and sig.return_annotation is not inspect.Signature.empty:
        raise InvalidLifecycleAdapter(
            f"Lifecycle hooks/validators must not return a value, but {fn} has a return annotation."
        )
    for param in sig.parameters.values():
        if param.kind != inspect.Parameter.KEYWORD_ONLY and param.name != "self":
            raise InvalidLifecycleAdapter(
                f"Lifecycle methods/hooks can only have keyword-only arguments. "
                f"Method/hook {fn} has argument {param} that is not keyword-only."
            )


def validate_hook_fn(fn: Callable):
    """Validates that a function forms a valid hook. This means:
    1. Function returns nothing
    2. Function must consist of only kwarg-only arguments

    :param fn: The function to validate
    :raises InvalidLifecycleAdapter: If the function is not a valid hook
    """
    validate_lifecycle_adapter_function(fn, returns_value=False)


def validate_method_fn(fn: Callable):
    """Validates that a function forms a valid method. This means:
    1. Function returns a value
    2. Functions must consist of only kwarg-only arguments

    :param fn: The function to validate
    :raises InvalidLifecycleAdapter: If the function is not a valid method
    """
    validate_lifecycle_adapter_function(fn, returns_value=True)


def validate_validator_fn(fn: Callable):
    """Ensures that a function forms a registerable "validator". These are currently the same rules as "hooks".
    While they should also raise an exception, that is not possible to express in the type annotation.

    :param fn: Function to validate
    :raises InvalidLifecycleAdapter: If the function is not a valid validator
    """
    if inspect.iscoroutinefunction(fn):
        raise InvalidLifecycleAdapter(
            f"Lifecycle validators must (so far) be synchronous, "
            f"but {fn} is an async function. "
        )
    validate_lifecycle_adapter_function(fn, returns_value=True)


class lifecycle:
    """Container class for decorators to register hooks/methods.
    This is just a container so it looks clean (`@lifecycle.base_hook(...)`), but we could easily move it out.
    What do these decorators do?
      1. We decorate a class with a method/hook/validator call
      2. This implies that there exists a function by that name
      3. We validate that that function has an appropriate signature
      4. We store this in the appropriate registry (see the constants above)
    Then, when we want to perform a hook/method/validator, we can ask the AdapterLifecycleSet to do so.
    It crawls up the MRO, looking to see which classes are in the registry, then elects which functions to run.
    See LifecycleAdapterSet for more information.
    """

    @classmethod
    def base_hook(cls, fn_name: str):
        """Hooks get called at distinct stages of Hamilton's execution.
        These can be layered together, and potentially coupled to other hooks.

        :param fn_name: Name of the function that will reside in the class we're decorating
        """

        def decorator(clazz):
            fn = getattr(clazz, fn_name, None)
            if fn is None:
                raise ValueError(
                    f"Class {clazz} does not have a method {fn_name}, but is "
                    f'decorated with @lifecycle.base_hook("{fn_name}"). The parameter '
                    f"to @lifecycle.base_hook must be the name "
                    f"of a method on the class."
                )
            validate_hook_fn(fn)
            if inspect.iscoroutinefunction(fn):
                setattr(clazz, ASYNC_HOOK, fn_name)
                REGISTERED_ASYNC_HOOKS.add(fn_name)
            else:
                setattr(clazz, SYNC_HOOK, fn_name)
                REGISTERED_SYNC_HOOKS.add(fn_name)
            return clazz

        return decorator

    @classmethod
    def base_method(cls, fn_name: str):
        """Methods replace the default behavior of Hamilton at a given stage.
        Thus they can only be called once, and not layered. TODO -- determine
        how to allow multiple/have precedence for custom behavior.

        :param fn_name: Name of the function in the class we're registering.
        """

        def decorator(clazz):
            fn = getattr(clazz, fn_name, None)
            if fn is None:
                raise ValueError(
                    f"Class {clazz} does not have a method {fn_name}, but is "
                    f'decorated with @lifecycle.base_hook("{fn_name}"). The parameter '
                    f"to @lifecycle.base_hook must be the name "
                    f"of a method on the class."
                )
            validate_method_fn(fn)
            if inspect.iscoroutinefunction(fn):
                setattr(clazz, ASYNC_METHOD, fn_name)
                REGISTERED_ASYNC_METHODS.add(fn_name)
            else:
                setattr(clazz, SYNC_METHOD, fn_name)
                REGISTERED_SYNC_METHODS.add(fn_name)
            return clazz

        return decorator

    @classmethod
    def base_validator(cls, fn_name: str):
        """Validators are hooks that return a validation result (tuple[success: bool, message: Optional[str]]).
        They provide custom validation logic that runs statically (before the DAG), rather than dynamically (during the DAG run),
        and multiple can be layered together.

        :param fn_name: Name of the function in the class we're registering.
        """

        def decorator(clazz):
            fn = getattr(clazz, fn_name, None)
            if fn is None:
                raise ValueError(
                    f"Class {clazz} does not have a method {fn_name}, but is "
                    f'decorated with @lifecycle.base_validator("{fn_name}"). The parameter '
                    f"to @lifecycle.base_hook must be the name "
                    f"of a method on the class."
                )
            validate_validator_fn(fn)
            setattr(clazz, SYNC_VALIDATOR, fn_name)
            REGISTERED_SYNC_VALIDATORS.add(fn_name)
            return clazz

        return decorator


@lifecycle.base_hook("pre_do_anything")
class BasePreDoAnythingHook(abc.ABC):
    @abc.abstractmethod
    def pre_do_anything(self):
        """Synchronous hook that gets called before doing anything, in the constructor of the driver."""
        pass


@lifecycle.base_method("do_check_edge_types_match")
class BaseDoCheckEdgeTypesMatch(abc.ABC):
    @abc.abstractmethod
    def do_check_edge_types_match(self, *, type_from: type, type_to: type) -> bool:
        """Method that checks whether two types are equivalent. This is used when the function graph is being created.

        :param type_from: The type of the node that is the source of the edge.
        :param type_to: The type of the node that is the destination of the edge.
        :return bool: Whether or not they are equivalent
        """
        pass


@lifecycle.base_method("do_validate_input")
class BaseDoValidateInput(abc.ABC):
    @abc.abstractmethod
    def do_validate_input(self, *, node_type: type, input_value: Any) -> bool:
        """Method that an input value maches an expected type.

        :param node_type:  The type of the node.
        :param input_value:  The value that we want to validate.
        :return: Whether or not the input value matches the expected type.
        """
        pass


@lifecycle.base_validator("validate_node")
class BaseValidateNode(abc.ABC):
    @abc.abstractmethod
    def validate_node(self, *, created_node: "node.Node") -> Tuple[bool, Optional[Exception]]:
        """Validates a node. This will raise an InvalidNodeException
        if the node is invalid.

        :param created_node: Node that was created.
        :raises InvalidNodeException: If the node is invalid.
        """
        pass


@lifecycle.base_validator("validate_graph")
class BaseValidateGraph(abc.ABC):
    @abc.abstractmethod
    def validate_graph(
        self,
        *,
        graph: "graph.FunctionGraph",
        modules: List[ModuleType],
        config: Dict[str, Any],
    ) -> Tuple[bool, Optional[str]]:
        """Validates the graph. This will raise an InvalidNodeException

        :param graph: Graph that has been constructed.
        :param modules: Modules passed into the graph
        :param config: Config passed into the graph
        :return: A (is_valid, error_message) tuple
        """


@lifecycle.base_hook("post_graph_construct")
class BasePostGraphConstruct(abc.ABC):
    @abc.abstractmethod
    def post_graph_construct(
        self,
        *,
        graph: "graph.FunctionGraph",
        modules: List[ModuleType],
        config: Dict[str, Any],
    ):
        """Hooks that is called after the graph is constructed.

        :param graph: Graph that has been constructed.
        :param modules: Modules passed into the graph
        :param config: Config passed into the graph
        """
        pass


@lifecycle.base_hook("post_graph_construct")
class BasePostGraphConstructAsync(abc.ABC):
    @abc.abstractmethod
    async def post_graph_construct(
        self,
        *,
        graph: "graph.FunctionGraph",
        modules: List[ModuleType],
        config: Dict[str, Any],
    ):
        """Asynchronous hook that is called after the graph is constructed.

        :param graph: Graph that has been constructed.
        :param modules: Modules passed into the graph
        :param config: Config passed into the graph
        """
        pass


@lifecycle.base_hook("pre_graph_execute")
class BasePreGraphExecute(abc.ABC):
    @abc.abstractmethod
    def pre_graph_execute(
        self,
        *,
        run_id: str,
        graph: "graph.FunctionGraph",
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Hook that is called immediately prior to graph execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param graph:  Graph that is being executed
        :param final_vars: Variables we are extracting from the graph
        :param inputs: Inputs to the graph
        :param overrides: Overrides to graph execution
        """
        pass


@lifecycle.base_hook("pre_graph_execute")
class BasePreGraphExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def pre_graph_execute(
        self,
        *,
        run_id: str,
        graph: "graph.FunctionGraph",
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Asynchronous Hook that is called immediately prior to graph execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param graph:  Graph that is being executed
        :param final_vars: Variables we are extracting from the graph
        :param inputs: Inputs to the graph
        :param overrides: Overrides to graph execution
        """
        pass


@lifecycle.base_hook("pre_task_execute")
class BasePreTaskExecute(abc.ABC):
    @abc.abstractmethod
    def pre_task_execute(
        self,
        *,
        run_id: str,
        task_id: str,
        nodes: List["node.Node"],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Hook that is called immediately prior to task execution. Note that this is only useful in dynamic
        execution, although we reserve the right to add this back into the standard hamilton execution pattern.

        :param run_id: ID of the run, unique in scope of the driver.
        :param task_id: ID of the task, unique in scope of the driver.
        :param nodes: Nodes that are being executed
        :param inputs: Inputs to the task
        :param overrides: Overrides to task execution
        """
        pass


@lifecycle.base_hook("pre_task_execute")
class BasePreTaskExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def pre_task_execute(
        self,
        *,
        run_id: str,
        task_id: str,
        nodes: List["node.Node"],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Hook that is called immediately prior to task execution. Note that this is only useful in dynamic
        execution, although we reserve the right to add this back into the standard hamilton execution pattern.

        :param run_id: ID of the run, unique in scope of the driver.
        :param task_id: ID of the task, unique in scope of the driver.
        :param nodes: Nodes that are being executed
        :param inputs: Inputs to the task
        :param overrides: Overrides to task execution
        """
        pass


@lifecycle.base_hook("pre_node_execute")
class BasePreNodeExecute(abc.ABC):
    @abc.abstractmethod
    def pre_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ):
        """Hook that is called immediately prior to node execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param task_id: ID of the task, defaults to None if not in a task setting
        """
        pass


@lifecycle.base_hook("pre_node_execute")
class BasePreNodeExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def pre_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ):
        """Asynchronous hook that is called immediately prior to node execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param task_id: ID of the task, defaults to None if not in a task setting
        """
        pass


@lifecycle.base_method("do_node_execute")
class BaseDoNodeExecute(abc.ABC):
    @abc.abstractmethod
    def do_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ) -> Any:
        """Method that is called to implement node execution. This can replace the execution of a node
        with something all together, augment it, or delegate it.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param task_id: ID of the task, defaults to None if not in a task setting
        """
        pass


@lifecycle.base_method("do_remote_execute")
class BaseDoRemoteExecute(abc.ABC):
    @abc.abstractmethod
    def do_remote_execute(
        self,
        *,
        node: "node.Node",
        kwargs: Dict[str, Any],
        execute_lifecycle_for_node: Callable,
    ) -> Any:
        """Method that is called to implement correct remote execution of hooks. This makes sure that all the pre-node and post-node hooks get executed in the remote environment which is necessary for some adapters. Node execution is called the same as before through "do_node_execute".


        :param node: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param execute_lifecycle_for_node: Function executing lifecycle_hooks and lifecycle_methods
        """
        pass


@lifecycle.base_method("do_node_execute")
class BaseDoNodeExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def do_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ) -> Any:
        """Asynchronous method that is called to implement node execution. This can replace the execution of a node
        with something all together, augment it, or delegate it.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param task_id: ID of the task, defaults to None if not in a task setting
        """
        pass


@lifecycle.base_hook("post_node_execute")
class BasePostNodeExecute(abc.ABC):
    @abc.abstractmethod
    def post_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        success: bool,
        error: Optional[Exception],
        result: Optional[Any],
        task_id: Optional[str] = None,
    ):
        """Hook that is called immediately after node execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param success: Whether or not the node executed successfully
        :param error: The error that was raised, if any
        :param result: The result of the node execution, if no error was raised
        :param task_id: ID of the task, defaults to None if not in a task-based execution
        """
        pass


@lifecycle.base_hook("post_node_execute")
class BasePostNodeExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def post_node_execute(
        self,
        *,
        run_id: str,
        node_: "node.Node",
        kwargs: Dict[str, Any],
        success: bool,
        error: Optional[Exception],
        result: Any,
        task_id: Optional[str] = None,
    ):
        """Hook that is called immediately after node execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param node_: Node that is being executed
        :param kwargs: Keyword arguments that are being passed into the node
        :param success: Whether or not the node executed successfully
        :param error: The error that was raised, if any
        :param result: The result of the node execution, if no error was raised
        :param task_id: ID of the task, defaults to None if not in a task-based execution
        """
        pass


@lifecycle.base_hook("post_task_execute")
class BasePostTaskExecute(abc.ABC):
    @abc.abstractmethod
    def post_task_execute(
        self,
        *,
        run_id: str,
        task_id: str,
        nodes: List["node.Node"],
        results: Optional[Dict[str, Any]],
        success: bool,
        error: Exception,
    ):
        """Hook called immediately after task execution. Note that this is only useful in dynamic
        execution, although we reserve the right to add this back into the standard hamilton execution pattern.

        :param run_id: ID of the run, unique in scope of the driver.
        :param task_id: ID of the task
        :param nodes: Nodes that were executed
        :param results: Results of the task
        :param success: Whether or not the task executed successfully
        :param error: The error that was raised, if any
        """
        pass


@lifecycle.base_hook("post_task_execute")
class BasePostTaskExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def post_task_execute(
        self,
        *,
        run_id: str,
        task_id: str,
        nodes: List["node.Node"],
        results: Optional[Dict[str, Any]],
        success: bool,
        error: Exception,
    ):
        """Asynchronous Hook called immediately after task execution. Note that this is only useful in dynamic
        execution, although we reserve the right to add this back into the standard hamilton execution pattern.

        :param run_id: ID of the run, unique in scope of the driver.
        :param task_id: ID of the task
        :param nodes: Nodes that were executed
        :param results: Results of the task
        :param success: Whether or not the task executed successfully
        :param error: The error that was raised, if any
        """
        pass


@lifecycle.base_hook("post_graph_execute")
class BasePostGraphExecute(abc.ABC):
    @abc.abstractmethod
    def post_graph_execute(
        self,
        *,
        run_id: str,
        graph: "graph.FunctionGraph",
        success: bool,
        error: Optional[Exception],
        results: Optional[Dict[str, Any]],
    ):
        """Hook called immediately after graph execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param graph: Graph that was executed
        :param success: Whether or not the graph executed successfully
        :param error: Error that was raised, if any
        :param results: Results of the graph execution
        """
        pass


@lifecycle.base_hook("post_graph_execute")
class BasePostGraphExecuteAsync(abc.ABC):
    @abc.abstractmethod
    async def post_graph_execute(
        self,
        *,
        run_id: str,
        graph: "graph.FunctionGraph",
        success: bool,
        error: Optional[Exception],
        results: Optional[Dict[str, Any]],
    ):
        """Asynchronous Hook called immediately after graph execution.

        :param run_id: ID of the run, unique in scope of the driver.
        :param graph: Graph that was executed
        :param success: Whether or not the graph executed successfully
        :param error: Error that was raised, if any
        :param results: Results of the graph execution
        """
        pass


@lifecycle.base_method("do_build_result")
class BaseDoBuildResult(abc.ABC):
    @abc.abstractmethod
    def do_build_result(self, *, outputs: Any) -> Any:
        """Method that is called to build the result of the graph execution.

        :param outputs: Output of the node execution
        :return: The final result
        """
        pass


# This is the type of a lifecycle adapter -- these types utilize

LifecycleAdapter = Union[
    BasePreDoAnythingHook,
    BaseDoCheckEdgeTypesMatch,
    BaseDoValidateInput,
    BaseValidateNode,
    BaseValidateGraph,
    BasePostGraphConstruct,
    BasePostGraphConstructAsync,
    BasePreGraphExecute,
    BasePreGraphExecuteAsync,
    BasePreTaskExecute,
    BasePreTaskExecuteAsync,
    BasePreNodeExecute,
    BasePreNodeExecuteAsync,
    BaseDoNodeExecute,
    BaseDoNodeExecuteAsync,
    BasePostNodeExecute,
    BasePostNodeExecuteAsync,
    BasePostTaskExecute,
    BasePostTaskExecuteAsync,
    BasePostGraphExecute,
    BasePostGraphExecuteAsync,
    BaseDoBuildResult,
]


class LifecycleAdapterSet:
    """An internal class that groups together all the lifecycle adapters.
    This allows us to call methods through a delegation pattern, enabling us to add
    whatever callbacks, logging, error-handling, etc... we need globally. While this
    does increase the stack trace in an error, it should be pretty easy to figure out what'g going on.
    """

    def __init__(self, *adapters: LifecycleAdapter):
        """Initializes the adapter set.

        :param adapters: Adapters to group together
        """
        self._adapters = self._uniqify_adapters(adapters)
        self.sync_hooks, self.async_hooks = self._get_lifecycle_hooks()
        self.sync_methods, self.async_methods = self._get_lifecycle_methods()
        self.sync_validators = self._get_lifecycle_validators()

    def _uniqify_adapters(self, adapters: List[LifecycleAdapter]) -> List[LifecycleAdapter]:
        """Removes duplicate adapters from the list of adapters -- this often happens on how they're passed in
        and we don't want to have the same adapter twice. Specifically, this came up due to parsing/splitting out adapters
        with async lifecycle hooks -- there were cases in which we were passed duplicates. This was compounded as we would pass
        adapters to other adapter sets and end up further duplicating.

        TODO -- remove this and ensure that no case passes in duplicates.
        """

        seen = set()
        return [
            adapter for adapter in adapters if not (id(adapter) in seen or seen.add(id(adapter)))
        ]

    def _get_lifecycle_validators(
        self,
    ) -> Dict[str, List[LifecycleAdapter]]:
        sync_validators = collections.defaultdict(set)
        for adapter in self.adapters:
            for cls in inspect.getmro(adapter.__class__):
                sync_validator = getattr(cls, SYNC_VALIDATOR, None)
                if sync_validator is not None:
                    sync_validators[sync_validator].add(adapter)
        return {validator: list(adapters) for validator, adapters in sync_validators.items()}

    def _get_lifecycle_hooks(
        self,
    ) -> Tuple[Dict[str, List[LifecycleAdapter]], Dict[str, List[LifecycleAdapter]]]:
        sync_hooks = collections.defaultdict(list)
        async_hooks = collections.defaultdict(list)
        for adapter in self.adapters:
            for cls in inspect.getmro(adapter.__class__):
                sync_hook = getattr(cls, SYNC_HOOK, None)
                if sync_hook is not None:
                    if adapter not in sync_hooks[sync_hook]:
                        sync_hooks[sync_hook].append(adapter)
                async_hook = getattr(cls, ASYNC_HOOK, None)
                if async_hook is not None:
                    if adapter not in async_hooks[async_hook]:
                        async_hooks[async_hook].append(adapter)
        return (
            {hook: adapters for hook, adapters in sync_hooks.items()},
            {hook: adapters for hook, adapters in async_hooks.items()},
        )

    def _get_lifecycle_methods(
        self,
    ) -> Tuple[Dict[str, List[LifecycleAdapter]], Dict[str, List[LifecycleAdapter]]]:
        sync_methods = collections.defaultdict(set)
        async_methods = collections.defaultdict(set)
        for adapter in self.adapters:
            for cls in inspect.getmro(adapter.__class__):
                sync_method = getattr(cls, SYNC_METHOD, None)
                if sync_method is not None:
                    sync_methods[sync_method].add(adapter)
                async_method = getattr(cls, ASYNC_METHOD, None)
                if async_method is not None:
                    async_methods[async_method].add(adapter)
        multiple_implementations_sync = [
            method for method, adapters in sync_methods.items() if len(adapters) > 1
        ]
        multiple_implementations_async = [
            method for method, adapters in async_methods.items() if len(adapters) > 1
        ]
        if len(multiple_implementations_sync) > 0 or len(multiple_implementations_async) > 0:
            raise ValueError(
                f"Multiple adapters cannot (currently) implement the same lifecycle method. "
                f"Sync methods: {multiple_implementations_sync}. "
                f"Async methods: {multiple_implementations_async}"
            )
        return (
            {method: list(adapters) for method, adapters in sync_methods.items()},
            {method: list(adapters) for method, adapters in async_methods.items()},
        )

    def does_hook(self, hook_name: str, is_async: Optional[bool] = None) -> bool:
        """Whether or not a hook is implemented by any of the adapters in this group.
        If this hook is not registered, this will raise a ValueError.

        :param hook_name: Name of the hook
        :param is_async: Whether you want the async version or not
        :return: True if this adapter set does this hook, False otherwise
        """
        either = is_async is None
        if (is_async or either) and hook_name not in REGISTERED_ASYNC_HOOKS:
            raise ValueError(
                f"Hook {hook_name} is not registered as an asynchronous lifecycle hook. "
                f"Registered hooks are {REGISTERED_ASYNC_HOOKS}"
            )
        if ((not is_async) or either) and hook_name not in REGISTERED_SYNC_HOOKS:
            raise ValueError(
                f"Hook {hook_name} is not registered as a synchronous lifecycle hook. "
                f"Registered hooks are {REGISTERED_SYNC_HOOKS}"
            )
        has_async = hook_name in self.async_hooks
        has_sync = hook_name in self.sync_hooks
        return (has_async or has_sync) if either else has_async if is_async else has_sync

    def does_method(self, method_name: str, is_async: Optional[bool] = None) -> bool:
        """Whether a method is implemented by any of the adapters in this group.
        If this method is not registered, this will raise a ValueError.

        :param method_name: Name of the method
        :param is_async: Whether you want the async version or not
        :return: True if this adapter set does this method, False otherwise
        """
        either = is_async is None
        if (is_async or either) and method_name not in REGISTERED_ASYNC_METHODS:
            raise ValueError(
                f"Method {method_name} is not registered as an asynchronous lifecycle method. "
                f"Registered methods are {REGISTERED_ASYNC_METHODS}"
            )
        if ((not is_async) or either) and method_name not in REGISTERED_SYNC_METHODS:
            raise ValueError(
                f"Method {method_name} is not registered as a synchronous lifecycle method. "
                f"Registered methods are {REGISTERED_SYNC_METHODS}"
            )
        has_async = method_name in self.async_methods
        has_sync = method_name in self.sync_methods
        return (has_async or has_sync) if either else has_async if is_async else has_sync

    def does_validation(self, validator_name: str) -> bool:
        """Whether a validator is implemented by any of the adapters in this group.

        :param validator_name: Name of the validator
        :param is_async: Whether you want the async version or not
        :return: True if this adapter set does this validator, False otherwise
        """
        if validator_name not in REGISTERED_SYNC_VALIDATORS:
            raise ValueError(
                f"Validator {validator_name} is not registered as a lifecycle validator. "
                f"Registered validators are {REGISTERED_SYNC_VALIDATORS}"
            )
        return validator_name in self.sync_validators

    def call_all_lifecycle_hooks_sync(self, hook_name: str, **kwargs):
        """Calls all the lifecycle hooks in this group, by hook name (stage)

        :param hook_name: Name of the hooks to call
        :param kwargs: Keyword arguments to pass into the hook
        """
        for adapter in self.sync_hooks.get(hook_name, []):
            getattr(adapter, hook_name)(**kwargs)

    async def call_all_lifecycle_hooks_async(self, hook_name: str, **kwargs):
        """Calls all the lifecycle hooks in this group, by hook name (stage).

        :param hook_name: Name of the hook
        :param kwargs: Keyword arguments to pass into the hook
        """
        futures = []
        for adapter in self.async_hooks.get(hook_name, []):
            futures.append(getattr(adapter, hook_name)(**kwargs))
        await asyncio.gather(*futures)

    async def call_all_lifecycle_hooks_sync_and_async(self, hook_name: str, **kwargs):
        """Calls all the lifecycle hooks whether they are sync or async

        :param hook_name: name of the hook
        :param kwargs: keyword arguments for the hook
        """
        self.call_all_lifecycle_hooks_sync(hook_name, **kwargs)
        await self.call_all_lifecycle_hooks_async(hook_name, **kwargs)

    def call_lifecycle_method_sync(self, method_name: str, **kwargs) -> Any:
        """Calls a lifecycle method in this group, by method name.

        :param method_name: Name of the method
        :param kwargs: Keyword arguments to pass into the method
        :return: The result of the method
        """
        if method_name not in REGISTERED_SYNC_METHODS:
            raise ValueError(
                f"Method {method_name} is not registered as a synchronous lifecycle method. "
                f"Registered methods are {REGISTERED_SYNC_METHODS}"
            )
        if method_name not in self.sync_methods:
            raise ValueError(
                f"Method {method_name} is not implemented by any of the adapters in this group. "  # TODO _- improve the error message
                f"Registered methods are {self.sync_methods}"
            )
        (adapter,) = self.sync_methods[method_name]
        return getattr(adapter, method_name)(**kwargs)

    async def call_lifecycle_method_async(self, method_name: str, **kwargs):
        """Call a lifecycle method in this group, by method name, async

        :param method_name: Name of the method
        :param kwargs: Keyword arguments to pass into the method
        :return: The result of the method
        """
        if method_name not in REGISTERED_ASYNC_METHODS:
            raise ValueError(
                f"Method {method_name} is not registered as an asynchronous lifecycle method. "
                f"Registered methods are {REGISTERED_ASYNC_METHODS}"
            )
        (adapter,) = self.async_methods[method_name]
        return await getattr(adapter, method_name)(**kwargs)

    def call_all_validators_sync(
        self, validator_name: str, output_only_failures: bool = True, **kwargs
    ) -> List[ValidationResult]:
        """Calls all the lifecycle validators in this group, by validator name (stage)

        :param validator_name: Name of the validators to call
        :param kwargs: Keyword arguments to pass into the validator
        :param output_only_failures: Whether to output only failures
        """
        results = []
        for adapter in self.sync_validators[validator_name]:
            is_valid, message = getattr(adapter, validator_name)(**kwargs)
            if not is_valid or not output_only_failures:
                results.append(ValidationResult(success=is_valid, error=message, validator=adapter))
        return results

    @property
    def adapters(self) -> List[LifecycleAdapter]:
        """Gives the adapters in this group

        :return: A list of adapters
        """
        return self._adapters

    async def ainit(self):
        """Asynchronously initializes the adapters in this group. This is so we can avoid having an async constructor
        -- it is an implicit internal-facing contract -- the async adapters are allowed one ainit()
        method that will be called by the driver.

        Note this is not public-facing -- E.G. you cannot expect to define this on your own adapters. We may consider adding
        a ``pre_do_anything`` async hook and removing this, but for now this should suffice.
        """
        for adapter in self.adapters:
            if hasattr(adapter, "ainit"):
                await adapter.ainit()
