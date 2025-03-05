import abc
from abc import ABC
from types import ModuleType
from typing import TYPE_CHECKING, Any, Collection, Dict, List, Optional, Tuple, Type, final

from hamilton import graph_types, node

# This is only here for a type-hint
# As python types aren't real (they're determined at runtime), we can't have circular import resolved
# These are often necessary to handle typing -- as types don't have a perfect DAG of dependencies
# In this case, we're breaking the following loop:
#    -> lifecycle_api depends on graph_types and FunctionGraph
#    -> graph_types depends on hamilton.base
#    -> hamilton.base depends on lifecycle_api, as some interfaces for graph adapters live there
# To really fix this we should move everything user-facing out of base, which is a pretty sloppy name for a package anyway
# And put it where it belongs. For now we're OK with the TYPE_CHECKING hack
if TYPE_CHECKING:
    from hamilton.graph import FunctionGraph

from hamilton.graph_types import HamiltonGraph, HamiltonNode
from hamilton.lifecycle.base import (
    BaseDoBuildResult,
    BaseDoCheckEdgeTypesMatch,
    BaseDoNodeExecute,
    BaseDoValidateInput,
    BasePostGraphConstruct,
    BasePostGraphExecute,
    BasePostNodeExecute,
    BasePostTaskExecute,
    BasePreGraphExecute,
    BasePreNodeExecute,
    BasePreTaskExecute,
    BaseValidateGraph,
    BaseValidateNode,
)

try:
    from typing import override
except ImportError:
    override = lambda x: x  # noqa E731


class ResultBuilder(BaseDoBuildResult, abc.ABC):
    """Abstract class for building results. All result builders should inherit from this class and implement the build_result function.
    Note that applicable_input_type and output_type are optional, but recommended, for backwards
    compatibility. They let us type-check this. They will default to Any, which means that they'll
    connect to anything."""

    @abc.abstractmethod
    def build_result(self, **outputs: Any) -> Any:
        """Given a set of outputs, build the result.

        :param outputs: the outputs from the execution of the graph.
        :return: the result of the execution of the graph.
        """
        pass

    @override
    @final
    def do_build_result(self, outputs: Dict[str, Any]) -> Any:
        """Implements the do_build_result method from the BaseDoBuildResult class.
        This is kept from the user as the public-facing API is build_result, allowing us to change the
        API/implementation of the internal set of hooks"""
        return self.build_result(**outputs)

    def input_types(self) -> List[Type[Type]]:
        """Gives the applicable types to this result builder.
        This is optional for backwards compatibility, but is recommended.

        :return: A list of types that this can apply to.
        """
        return [Any]

    def output_type(self) -> Type:
        """Returns the output type of this result builder
        :return: the type that this creates
        """
        return Any


class LegacyResultMixin(ResultBuilder, ABC):
    """Backwards compatible legacy result builder. This utilizes a static method as we used to do that,
    although often times they got confused. If you want a result builder, use ResultBuilder above instead.
    """

    @staticmethod
    def build_result(**outputs: Any) -> Any:
        """Given a set of outputs, build the result.

        :param outputs: the outputs from the execution of the graph.
        :return: the result of the execution of the graph.
        """
        pass


class GraphAdapter(
    BaseDoNodeExecute,
    LegacyResultMixin,
    BaseDoValidateInput,
    BaseDoCheckEdgeTypesMatch,
    abc.ABC,
):
    """This is an implementation of HamiltonGraphAdapter, which has now been
    implemented with lifecycle methods/hooks."""

    @staticmethod
    @abc.abstractmethod
    def check_input_type(node_type: Type, input_value: Any) -> bool:
        """Used to check whether the user inputs match what the execution strategy & functions can handle.

        Static purely for legacy reasons.

        :param node_type: The type of the node.
        :param input_value: An actual value that we want to inspect matches our expectation.
        :return: True if the input is valid, False otherwise.
        """
        pass

    @staticmethod
    @abc.abstractmethod
    def check_node_type_equivalence(node_type: Type, input_type: Type) -> bool:
        """Used to check whether two types are equivalent.

        Static, purely for legacy reasons.

        This is used when the function graph is being created and we're statically type checking the annotations
        for compatibility.

        :param node_type: The type of the node.
        :param input_type: The type of the input that would flow into the node.
        :return: True if the types are equivalent, False otherwise.
        """
        pass

    @override
    @final
    def do_node_execute(
        self, run_id: str, node_: node.Node, kwargs: Dict[str, Any], task_id: Optional[str] = None
    ) -> Any:
        return self.execute_node(node_, kwargs)

    @override
    @final
    def do_validate_input(self, node_type: type, input_value: Any) -> bool:
        return self.check_input_type(node_type, input_value)

    @override
    @final
    def do_check_edge_types_match(self, type_from: type, type_to: type) -> bool:
        return self.check_node_type_equivalence(type_to, type_from)

    @abc.abstractmethod
    def execute_node(self, node: node.Node, kwargs: Dict[str, Any]) -> Any:
        """Given a node that represents a hamilton function, execute it.
        Note, in some adapters this might just return some type of "future".

        :param node: the Hamilton Node
        :param kwargs: the kwargs required to exercise the node function.
        :return: the result of exercising the node.
        """
        pass


class NodeExecutionHook(BasePreNodeExecute, BasePostNodeExecute, abc.ABC):
    """Implement this to hook into the node execution lifecycle. You can call anything before and after the driver"""

    @abc.abstractmethod
    def run_before_node_execution(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_kwargs: Dict[str, Any],
        node_return_type: type,
        task_id: Optional[str],
        run_id: str,
        node_input_types: Dict[str, Any],
        **future_kwargs: Any,
    ):
        """Hook that is executed prior to node execution.

        :param node_name: Name of the node.
        :param node_tags: Tags of the node
        :param node_kwargs: Keyword arguments to pass to the node
        :param node_return_type: Return type of the node
        :param task_id: The ID of the task, none if not in a task-based environment
        :param run_id: Run ID (unique in process scope) of the current run. Use this to track state.
        :param node_input_types: the input types to the node and what it is expecting
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        """
        pass

    @override
    @final
    def pre_node_execute(
        self,
        *,
        run_id: str,
        node_: node.Node,
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ):
        """Wraps the before_execution method, providing a bridge to an external-facing API. Do not override this!"""
        self.run_before_node_execution(
            node_name=node_.name,
            node_tags=node_.tags,
            node_kwargs=kwargs,
            node_return_type=node_.type,
            task_id=task_id,
            run_id=run_id,
            node_input_types={k: v[0] for k, v in node_.input_types.items()},
        )

    @abc.abstractmethod
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
        run_id: str,
        **future_kwargs: Any,
    ):
        """Hook that is executed post node execution.

        :param node_name: Name of the node in question
        :param node_tags: Tags of the node
        :param node_kwargs: Keyword arguments passed to the node
        :param node_return_type: Return type of the node
        :param result: Output of the node, None if an error occurred
        :param error: Error that occurred, None if no error occurred
        :param success: Whether the node executed successfully
        :param task_id: The ID of the task, none if not in a task-based environment
        :param run_id: Run ID (unique in process scope) of the current run. Use this to track state.
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        """
        pass

    @override
    @final
    def post_node_execute(
        self,
        *,
        run_id: str,
        node_: node.Node,
        kwargs: Dict[str, Any],
        success: bool,
        error: Optional[Exception],
        result: Optional[Any],
        task_id: Optional[str] = None,
    ):
        """Wraps the after_execution method, providing a bridge to an external-facing API. Do not override this!"""
        self.run_after_node_execution(
            node_name=node_.name,
            node_tags=node_.tags,
            node_kwargs=kwargs,
            node_return_type=node_.type,
            result=result,
            error=error,
            task_id=task_id,
            success=success,
            run_id=run_id,
        )


class GraphExecutionHook(BasePreGraphExecute, BasePostGraphExecute):
    """Implement this to execute code before and after graph execution. This is useful for logging, etc..."""

    @override
    @final
    def post_graph_execute(
        self,
        *,
        run_id: str,
        graph: "FunctionGraph",
        success: bool,
        error: Optional[Exception],
        results: Optional[Dict[str, Any]],
    ):
        """Just delegates to the interface method, passing in the right data."""
        return self.run_after_graph_execution(
            graph=HamiltonGraph.from_graph(graph),
            success=success,
            error=error,
            results=results,
            run_id=run_id,
        )

    @override
    @final
    def pre_graph_execute(
        self,
        *,
        run_id: str,
        graph: "FunctionGraph",
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        """Implementation of the pre_graph_execute hook. This just converts the inputs to
        the format the user-facing hook is expecting -- performing a walk of the DAG to pass in
        the set of nodes to execute. Delegates to the interface method."""
        all_nodes, user_defined_nodes = graph.get_upstream_nodes(final_vars, inputs, overrides)
        nodes_to_execute = set(all_nodes) - set(user_defined_nodes)
        return self.run_before_graph_execution(
            graph=HamiltonGraph.from_graph(graph),
            final_vars=final_vars,
            inputs=inputs,
            overrides=overrides,
            execution_path=[item.name for item in nodes_to_execute],
            run_id=run_id,
        )

    @abc.abstractmethod
    def run_before_graph_execution(
        self,
        *,
        graph: graph_types.HamiltonGraph,
        final_vars: List[str],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        execution_path: Collection[str],
        run_id: str,
        **future_kwargs: Any,
    ):
        """This is run prior to graph execution. This allows you to do anything you want before the graph executes,
        knowing the basic information that was passed in.

        :param graph: Graph that is being executed
        :param final_vars: Output variables of the graph
        :param inputs: Input variables passed to the graph
        :param overrides: Overrides passed to the graph
        :param execution_path: Collection of nodes that will be executed --
            these are just the nodes (not input nodes) that will be run during the course of execution.
        :param run_id: Run ID (unique in process scope) of the current run. Use this to track state.
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        """
        pass

    @abc.abstractmethod
    def run_after_graph_execution(
        self,
        *,
        graph: graph_types.HamiltonGraph,
        success: bool,
        error: Optional[Exception],
        results: Optional[Dict[str, Any]],
        run_id: str,
        **future_kwargs: Any,
    ):
        """This is run after graph execution. This allows you to do anything you want after the graph executes,
        knowing the results of the execution/any errors.

        :param graph: Graph that is being executed
        :param results: Results of the graph execution
        :param error: Error that occurred, None if no error occurred
        :param success: Whether the graph executed successfully
        :param run_id: Run ID (unique in process scope) of the current run. Use this to track state.
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        """
        pass


class TaskExecutionHook(BasePreTaskExecute, BasePostTaskExecute, abc.ABC):
    """Implement this to run something after task execution. Tasks are tols used to group nodes.
    Note that this is currently run *inside* the task, although we do not guarantee where it will be run
    (it could easily move to outside the task)."""

    def pre_task_execute(
        self,
        *,
        run_id: str,
        task_id: str,
        nodes: List["node.Node"],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
    ):
        self.run_before_task_execution(
            run_id=run_id,
            task_id=task_id,
            nodes=[HamiltonNode.from_node(n) for n in nodes],
            inputs=inputs,
            overrides=overrides,
        )

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
        self.run_after_task_execution(
            run_id=run_id,
            task_id=task_id,
            nodes=[HamiltonNode.from_node(n) for n in nodes],
            results=results,
            success=success,
            error=error,
        )

    @abc.abstractmethod
    def run_before_task_execution(
        self,
        *,
        task_id: str,
        run_id: str,
        nodes: List[HamiltonNode],
        inputs: Dict[str, Any],
        overrides: Dict[str, Any],
        **future_kwargs,
    ):
        """Implement this to run something after task execution. Tasks are tols used to group nodes.
        Note that this is currently run *inside* the task, although we do not guarantee where it will be run
        (it could easily move to outside the task).

        :param task_id: ID of the task we're launching.
        :param run_id: ID of the run this is under.
        :param nodes: Nodes that are part of this task
        :param inputs: Inputs to the task
        :param overrides: Overrides passed to the task
        :param future_kwargs: Reserved for backwards compatibility.
        """
        pass

    @abc.abstractmethod
    def run_after_task_execution(
        self,
        *,
        task_id: str,
        run_id: str,
        nodes: List[HamiltonNode],
        results: Optional[Dict[str, Any]],
        success: bool,
        error: Exception,
        **future_kwargs,
    ):
        """Implement this to run something after task execution. See note in run_before_task_execution.

        :param task_id: ID of the task that was just executed
        :param run_id: ID of the run this was under.
        :param nodes: Nodes that were part of this task
        :param results: Results of the task, per-node
        :param success: Whether the task was successful
        :param error: The error the task threw, if any
        :param future_kwargs: Reserved for backwards compatibility.
        """
        pass


class EdgeConnectionHook(BaseDoCheckEdgeTypesMatch, BaseDoValidateInput, abc.ABC):
    """Implement this to customize edges that are allowed in the graph. You can do customizations around typing here."""

    @override
    @final
    def do_check_edge_types_match(self, *, type_from: type, type_to: type) -> bool:
        """Wraps the check_edge_types_match method, providing a bridge to an external-facing API. Do not override this!"""
        return self.check_edge_types_match(type_from, type_to)

    @abc.abstractmethod
    def check_edge_types_match(self, type_from: type, type_to: type, **kwargs: Any) -> bool:
        """This is run to check if edge types match. Note that this is an OR functionality
        -- this is run after we do some default checks, so this can only be permissive.
        Reach out if you want to be more restrictive than the default checks.

        :param type_from: The type of the node that is the source of the edge.
        :param type_to: The type of the node that is the destination of the edge.
        :param kwargs: This is kept for future backwards compatibility.
        :return: Whether or not the two node types form a valid edge.
        """
        pass

    @override
    @final
    def do_validate_input(self, *, node_type: type, input_value: Any) -> bool:
        """Wraps the validate_input method, providing a bridge to an external-facing API. Do not override this!"""
        return self.validate_input(node_type=node_type, input_value=input_value)

    @abc.abstractmethod
    def validate_input(self, node_type: type, input_value: Any, **kwargs: Any) -> bool:
        """This is run to check if the input is valid for the node type. Note that this is an OR functionality
        -- this is run after we do some default checks, so this can only be permissive.
        Reach out if you want to be more restrictive than the default checks.

        :param node_type: Type of the node that is accepting the input.
        :param input_value: Value of the input
        :param kwargs: Keyword arguments -- this is kept for future backwards compatibility.
        :return: Whether the input is valid for the node type.
        """
        pass


class NodeExecutionMethod(BaseDoNodeExecute):
    """API for executing a node. This takes in tags, callable, node name, and kwargs, and is
    responsible for executing the node and returning the result. Note this is not (currently)
    able to be layered together, although we may add that soon.
    """

    @override
    @final
    def do_node_execute(
        self,
        *,
        run_id: str,
        node_: node.Node,
        kwargs: Dict[str, Any],
        task_id: Optional[str] = None,
    ) -> Any:
        return self.run_to_execute_node(
            node_name=node_.name,
            node_tags=node_.tags,
            node_callable=node_.callable,
            node_kwargs=kwargs,
            task_id=task_id,
            is_expand=node_.node_role == node.NodeType.EXPAND,
            is_collect=node_.node_role == node.NodeType.COLLECT,
        )

    @abc.abstractmethod
    def run_to_execute_node(
        self,
        *,
        node_name: str,
        node_tags: Dict[str, Any],
        node_callable: Any,
        node_kwargs: Dict[str, Any],
        task_id: Optional[str],
        is_expand: bool,
        is_collect: bool,
        **future_kwargs: Any,
    ) -> Any:
        """This method is responsible for executing the node and returning the result.

        :param node_name: Name of the node.
        :param node_tags: Tags of the node.
        :param node_callable: Callable of the node.
        :param node_kwargs: Keyword arguments to pass to the node.
        :param task_id: The ID of the task, none if not in a task-based environment
        :param is_expand: Whether the node is parallelizable.
        :param is_collect: Whether the node is a collect node.
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        :return: The result of the node execution -- up to you to return this.
        """
        pass


class StaticValidator(BaseValidateGraph, BaseValidateNode):
    """Performs static validation of the DAG. Note that this has the option to perform default validation for each method --
    this means that if you don't implement one of these it is OK.

    .. code-block:: python

        class MyTagValidator(api.StaticValidator):
            '''Validates tags on a node'''

            def run_to_validate_node(
                    self, *, node: HamiltonNode, **future_kwargs
            ) -> tuple[bool, Optional[str]]:
                if node.tags.get("node_type", "") == "output":
                    table_name = node.tags.get("table_name")
                    if not table_name:  # None or empty
                        error_msg = (f"Node {node.tags['module']}.{node.name} "
                                    "is an output node, but does not have a table_name tag.")
                        return False, error_msg
                return True, None

    """

    def run_to_validate_node(
        self, *, node: HamiltonNode, **future_kwargs
    ) -> Tuple[bool, Optional[str]]:
        """Override this to build custom node validations! Defaults to just returning that a node is valid so you don't have to implement it if you want to just implement a single method.
        Runs post node construction to validate a node. You have access to a bunch of metadata about the node, stored in the hamilton_node argument

        :param node: Node to validate
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        :return: A tuple of whether the node is valid and an error
            message in the case of failure. Return [True, None] for a valid node.Otherwise, return a detailed error message -- this should have all context/debugging information, but does not need to
            mention the node name (it will be aggregated with others).
        """
        return True, None

    def run_to_validate_graph(
        self, graph: HamiltonGraph, **future_kwargs
    ) -> Tuple[bool, Optional[str]]:
        """Override this to build custom DAG validations! Default to just returning that the graph is valid, so you don't have to implement it if you want to just implement a single method.
        Runs post graph construction to validate a graph. You have access to a bunch of metadata about the graph, stored in the graph argument.

        :param graph: Graph to validate.
        :param future_kwargs: Additional keyword arguments -- this is kept for backwards compatibility
        :return: A tuple of whether the graph is valid and an error message in the case of failure. Return [True, None] for a valid graph.
            Otherwise, return a detailed error message -- this should have all context/debugging information.
        """
        return True, None

    @override
    @final
    def validate_node(self, *, created_node: node.Node) -> Tuple[bool, Optional[Exception]]:
        return self.run_to_validate_node(node=HamiltonNode.from_node(created_node))

    @override
    @final
    def validate_graph(
        self, *, graph: "FunctionGraph", modules: List[ModuleType], config: Dict[str, Any]
    ) -> Tuple[bool, Optional[Exception]]:
        return self.run_to_validate_graph(graph=HamiltonGraph.from_graph(graph))


class GraphConstructionHook(BasePostGraphConstruct, abc.ABC):
    """Hook that is run after graph construction. This allows you to register/capture info on the graph.
    Note that, in the case of materialization, this may be called multiple times (once when we create the graph,
    once when we materialize). Currently information into that is not exposed to the user, but we will be adding that in future
    iterations.
    """

    def post_graph_construct(
        self, *, graph: "FunctionGraph", modules: List[ModuleType], config: Dict[str, Any]
    ):
        self.run_after_graph_construction(graph=HamiltonGraph.from_graph(graph), config=config)

    @abc.abstractmethod
    def run_after_graph_construction(
        self, *, graph: HamiltonGraph, config: Dict[str, Any], **future_kwargs: Any
    ):
        """Hook that is run post graph construction. This allows you to register/capture info on the graph.
        A common pattern is to store something in your object's state here so that you can use it later
        (E.G. compute a hash on the graph)

        :param graph: Graph that was constructed
        :param config: Configuration used to construct the graph
        :param future_kwargs: Reserved for backwards compatibility.
        """
        pass
