import logging
import pprint
from functools import partial
from typing import Any, Collection, Dict, List, Optional, Set, Tuple

from hamilton import node
from hamilton.lifecycle.base import LifecycleAdapterSet

logger = logging.getLogger(__name__)

"""A set of utility functions for managing/traversing DAGs. Note these all operate on nodes.
We will likely want to genericize them so we're dealing with anything, not just node.Nodes.
"""


def topologically_sort_nodes(nodes: List[node.Node]) -> List[node.Node]:
    """Topologically sorts a list of nodes based on their dependencies.
    Note that we bypass utilizing the preset dependencies/depended_on_by attributes of the node,
    as we may want to use this before these nodes get put in a function graph.

    Thus we compute our own dependency map...
    Note that this assumes that the nodes are continuous -- if there is a hidden dependency that
    connects them, this has no way of knowing about it.

    TODO -- use python graphlib when we no longer have to support 3.8.

    https://docs.python.org/3/library/graphlib.html

    :param nodes: Nodes to sort
    :return: Nodes in sorted order
    """
    node_name_map = {node_.name: node_ for node_ in nodes}
    depended_on_by_map = {}
    dependency_map = {}
    for node_ in nodes:
        dependency_map[node_.name] = []
        for dep in node_.input_types:
            # if the dependency is not here, we don't want to count it
            # that means it depends on something outside the set of nodes we're sorting
            if dep not in node_name_map:
                continue
            dependency_map[node_.name].append(dep)
            if dep not in depended_on_by_map:
                depended_on_by_map[dep] = []
            depended_on_by_map[dep].append(node_)

    in_degrees = {node_.name: len(dependency_map.get(node_.name, [])) for node_ in nodes}
    # TODO -- determine what happens if nodes have dependencies that aren't present
    sources = [node_ for node_ in nodes if in_degrees[node_.name] == 0]
    queue = []
    for source in sources:
        queue.append(source)
    sorted_nodes = []
    while len(queue) > 0:
        node_ = queue.pop(0)
        sorted_nodes.append(node_)
        for next_node in depended_on_by_map.get(node_.name, []):
            if next_node.name in in_degrees:
                in_degrees[next_node.name] -= 1
                if in_degrees[next_node.name] == 0:
                    queue.append(next_node)
    return sorted_nodes


def get_node_levels(topologically_sorted_nodes: List[node.Node]) -> Dict[str, int]:
    """Gets the levels for a group of topologically sorted nodes.
    This only works if its topologically sorted, of course...


    :param topologically_sorted_nodes:
    :return: A dictionary of node name -> level
    """
    node_levels = {}
    node_set = {node_.name for node_ in topologically_sorted_nodes}
    for node_ in topologically_sorted_nodes:
        dependencies_in_set = {n.name for n in node_.dependencies}.intersection(node_set)
        if len(dependencies_in_set) == 0:
            node_levels[node_.name] = 0
        else:
            node_levels[node_.name] = max([node_levels[n] for n in dependencies_in_set]) + 1
    return node_levels


def combine_config_and_inputs(config: Dict[str, Any], inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Validates and combines config and inputs, ensuring that they're mutually disjoint.
    :param config: Config to construct, run the DAG with.
    :param inputs: Inputs to run the DAG on at runtime
    :return: The combined set of inputs to the DAG.
    :raises ValueError: if they are not disjoint
    """
    duplicated_inputs = [key for key in inputs if key in config]
    if len(duplicated_inputs) > 0:
        raise ValueError(
            f"The following inputs are present in both config and inputs. They must be "
            f"mutually disjoint. {duplicated_inputs} "
        )
    return {**config, **inputs}


def create_input_string(kwargs: dict) -> str:
    """This is a utility function to create a string representation of the inputs to a function.

    This is useful for debugging, as it can be printed out to see what the inputs were.

    :param kwargs: The inputs to the function that errored.
    :return: The string representation of the inputs, truncated appropriately.
    """
    pp = pprint.PrettyPrinter(width=80)
    inputs = {}
    for k, v in kwargs.items():
        item_repr = repr(v)
        if len(item_repr) > 50:
            item_repr = item_repr[:50] + "..."
        else:
            item_repr = v
        inputs[k] = item_repr
    input_string = pp.pformat(inputs)
    if len(input_string) > 1000:
        input_string = input_string[:1000] + "..."
    return input_string


def create_error_message(kwargs: dict, node_: node.Node, step: str) -> str:
    """Creates an error message for a node that errored."""
    # This code is coupled to how @config resolution works. Ideally it shouldn't be,
    # so when @config resolvers are changed to return Nodes, then fn.__name__ should
    # just work.
    original_func_name = "unknown"
    if node_.originating_functions:
        if hasattr(node_.originating_functions[0], "__original_name__"):
            original_func_name = node_.originating_functions[0].__original_name__
        else:
            original_func_name = node_.originating_functions[0].__name__
    module = (
        node_.originating_functions[0].__module__
        if node_.originating_functions and hasattr(node_.originating_functions[0], "__module__")
        else "unknown_module"
    )
    message = f">{step} {node_.name} [{module}.{original_func_name}()] encountered an error"
    padding = " " * (80 - min(len(message), 79) - 1)
    message += padding + "<"
    input_string = create_input_string(kwargs)
    message += "\n> Node inputs:\n" + input_string
    border = "*" * 80
    message = "\n" + border + "\n" + message + "\n" + border
    return message


def execute_subdag(
    nodes: Collection[node.Node],
    inputs: Dict[str, Any],
    adapter: LifecycleAdapterSet = None,
    computed: Dict[str, Any] = None,
    overrides: Dict[str, Any] = None,
    run_id: str = None,
    task_id: str = None,
) -> Dict[str, Any]:
    """Base function to execute a subdag. This conducts a depth first traversal of the graph.

    :param nodes: Nodes to compute
    :param inputs: Inputs, external
    :param adapter:  Adapter to use to compute
    :param computed:  Already computed nodes
    :param overrides: Overrides to use, will short-circuit computation
    :param run_id: Run ID to use
    :param task_id: Task ID to use -- this is optional for the purpose of the task-based execution...
    :return: The results
    """
    if overrides is None:
        overrides = {}
    if computed is None:
        computed = {}
    nodes_to_compute = {node_.name for node_ in nodes}

    if adapter is None:
        adapter = LifecycleAdapterSet()

    def dfs_traverse(
        node_: node.Node, dependency_type: node.DependencyType = node.DependencyType.REQUIRED
    ):
        if node_.name in computed:
            return
        if node_.name in overrides:
            computed[node_.name] = overrides[node_.name]
            return
        for n in node_.dependencies:
            if n.name not in computed:
                _, node_dependency_type = node_.input_types[n.name]
                dfs_traverse(n, node_dependency_type)

        logger.debug(f"Computing {node_.name}.")
        if node_.user_defined:
            if node_.name not in inputs:
                if dependency_type != node.DependencyType.OPTIONAL:
                    raise NotImplementedError(
                        f"{node_.name} was expected to be passed in but was not."
                    )
                return
            result = inputs[node_.name]
        else:
            kwargs = {}  # construct signature
            for dependency in node_.dependencies:
                if dependency.name in computed:
                    kwargs[dependency.name] = computed[dependency.name]

            execute_lifecycle_for_node_partial = partial(
                execute_lifecycle_for_node,
                __node_=node_,
                __adapter=adapter,
                __run_id=run_id,
                __task_id=task_id,
            )

            if adapter.does_method("do_remote_execute", is_async=False):
                result = adapter.call_lifecycle_method_sync(
                    "do_remote_execute",
                    node=node_,
                    execute_lifecycle_for_node=execute_lifecycle_for_node_partial,
                    **kwargs,
                )
            else:
                result = execute_lifecycle_for_node_partial(**kwargs)

        computed[node_.name] = result
        # > pruning the graph
        # This doesn't narrow it down to the entire space of the graph
        # E.G. if something is not needed by this current execution due to
        # the selection of nodes to run it might not prune everything.
        # to do this we'd need to first determine all nodes on the path, then prune
        # We may also want to use a reference counter for slightly cleaner/more efficient memory management

        for dep in node_.dependencies:
            if dep.name in computed and dep.name not in nodes_to_compute:
                for downstream_node in dep.depended_on_by:
                    # if it isn't computed, and it isn't required, we can't prune
                    if (
                        downstream_node.name not in computed
                        or downstream_node.name in nodes_to_compute
                    ):
                        break
                # If the result of this node is no longer needed, we can prune it/save the memory
                else:
                    del computed[dep.name]

    for final_var_node in nodes:
        dep_type = node.DependencyType.REQUIRED
        if final_var_node.user_defined:
            # from the top level, we don't know if this UserInput is required. So mark as optional.
            dep_type = node.DependencyType.OPTIONAL
        dfs_traverse(final_var_node, dep_type)
    return computed


# TODO: better function name
def execute_lifecycle_for_node(
    __node_: node.Node,
    __adapter: LifecycleAdapterSet,
    __run_id: str,
    __task_id: str,
    **__kwargs: Dict[str, Any],
):
    """Helper function to properly execute node lifecycle.

    Firstly, we execute the pre-node-execute hooks if supplied adapters have any, then we execute the node function, and lastly, we execute the post-node-execute hooks if present in the adapters.

    For local runtime gets execute directy. Otherwise, serves as a sandwich function that guarantees the pre_node and post_node lifecycle hooks are executed in the remote environment.

    :param __node_:  Node that is being executed
    :param __adapter:  Adapter to use to compute
    :param __run_id: ID of the run, unique in scope of the driver.
    :param __task_id: ID of the task, defaults to None if not in a task setting
    :param ___kwargs: Keyword arguments that are being passed into the node
    """

    error = None
    result = None
    success = True
    pre_node_execute_errored = False

    try:
        if __adapter.does_hook("pre_node_execute", is_async=False):
            try:
                __adapter.call_all_lifecycle_hooks_sync(
                    "pre_node_execute",
                    run_id=__run_id,
                    node_=__node_,
                    kwargs=__kwargs,
                    task_id=__task_id,
                )
            except Exception as e:
                pre_node_execute_errored = True
                raise e
        if __adapter.does_method("do_node_execute", is_async=False):
            result = __adapter.call_lifecycle_method_sync(
                "do_node_execute",
                run_id=__run_id,
                node_=__node_,
                kwargs=__kwargs,
                task_id=__task_id,
            )
        else:
            result = __node_(**__kwargs)

        return result

    except Exception as e:
        success = False
        error = e
        step = "[pre-node-execute]" if pre_node_execute_errored else ""
        message = create_error_message(__kwargs, __node_, step)
        logger.exception(message)
        raise
    finally:
        if not pre_node_execute_errored and __adapter.does_hook(
            "post_node_execute", is_async=False
        ):
            try:
                __adapter.call_all_lifecycle_hooks_sync(
                    "post_node_execute",
                    run_id=__run_id,
                    node_=__node_,
                    kwargs=__kwargs,
                    success=success,
                    error=error,
                    result=result,
                    task_id=__task_id,
                )
            except Exception:
                message = create_error_message(__kwargs, __node_, "[post-node-execute]")
                logger.exception(message)
                raise


def nodes_between(
    end_node: node.Node,
    search_condition: lambda node_: bool,
) -> Tuple[Optional[node.Node], List[node.Node]]:
    """Utility function to search backwards from an end node to a start node.
    This returns all nodes for which both of the following conditions are met:

    1. It contains a node that matches the start_condition as an ancestor
    2. It contains a node that matches the end node as a dependent

    Note that currently it is assumed that only one node will
    match search_condition.

    This just grabs the search node when it finds it -- the nonlocal is a bit hacky but more fun
    than passing a ton of data back and forth (who the parent is, etc...).

    :param end_node: Node to trace back from
    :param search_condition: Condition to stop the search for ancestors
    :return: A tuple of [start_node, between], where start_node is None
    if there is no path (and between will be empty).
    """

    out = set()
    visited = set()
    search_node = None

    def dfs_traverse(node_: node.Node):
        if search_condition(node_):
            # if we hit the end, we want to include all others in it
            nonlocal search_node
            search_node = node_
            return True
        if node_ in visited:
            # if we've already seen it, we want to include it
            return node_ in out
        # now we mark that we've seen it
        visited.add(node_)

        any_deps_included = False
        for n in node_.dependencies:
            any_deps_included |= dfs_traverse(n)
        if any_deps_included:
            out.add(node_)
        return any_deps_included

    for dep in end_node.dependencies:
        dfs_traverse(dep)

    return search_node, list(out)


def node_is_required_by_anything(node_: node.Node, node_set: Set[node.Node]) -> bool:
    """Checks dependencies on this node and determines if at least one requires it.

    Nodes can be optionally depended upon, i.e. the function parameter has a default value. We want to check that
    of the nodes the depend on this one, at least one of them requires it, i.e. the parameter is not optional.

    :param node_: node in question
    :param node_set: checks that we traverse only nodes in the provided set.
    :return: True if it is required by any downstream node, false otherwise
    """
    required = False
    for downstream_node in node_.depended_on_by:
        if downstream_node not in node_set:
            continue
        _, dep_type = downstream_node.input_types[node_.name]
        if dep_type == node.DependencyType.REQUIRED:
            return True
    return required
