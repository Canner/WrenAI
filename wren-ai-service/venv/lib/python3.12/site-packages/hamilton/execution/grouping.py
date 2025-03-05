import abc
import dataclasses
import enum
from collections import defaultdict
from typing import Any, Collection, Dict, List, Optional, Set, Tuple

from hamilton import node
from hamilton.execution import graph_functions
from hamilton.execution.graph_functions import get_node_levels, topologically_sort_nodes
from hamilton.lifecycle import base as lifecycle_base
from hamilton.node import Node, NodeType

"""General utilities for grouping nodes in a DAG"""


class NodeGroupPurpose(enum.Enum):
    """Node groups have a purpose. The standard type is "EXECUTE_BLOCK",
    which just executes a subdag. The other types are for creating "expanders",
    which can dictate how subsequent nodes expand into a subdag.

    """

    EXPAND_UNORDERED = "expand_unordered"  # DAG that ends in a parameter for the next subdag to
    GATHER = "gather"  # DAG that begins in the collection of a parallel block
    EXECUTE_BLOCK = "execute_block"  # DAG that is a standard block of nodes
    EXECUTE_SINGLE = "execute_single"  # DAG that is just a single node

    def is_expander(self):
        return self.value in ["expand_unordered"]

    def is_gatherer(self):
        return self.value in ["gather"]


@dataclasses.dataclass
class NodeGroup:
    """Represents a simple grouping of nodes into a single unit.
    This has some utility functions to determine inputs, outputs, etc...
    Note that this has the following properties:
    1. ID is unique across all node groups
    2. Nodes are unique across all node groups (one node to group)
    """

    base_id: str  # Unique ID for node group.
    spawning_task_base_id: Optional[str]
    nodes: List[Node]
    purpose: NodeGroupPurpose  # TODO -- derive this (or not?)
    # set of available nodes by this task for querying
    available_nodes: Set[str] = dataclasses.field(init=False)

    def __post_init__(self):
        self.available_nodes = {node_.name for node_ in self.nodes}

    def __hash__(self):
        return hash(self.base_id)

    def __eq__(self, other):
        return self.base_id == other.base_id

    def get_expander_node(self) -> Optional[Node]:
        """Returns the expander node for this node group, if it exists"""
        candidates = [n for n in self.nodes if n.node_role == NodeType.EXPAND]
        if candidates:
            return candidates[0]
        return None

    def get_collector_node(self) -> Optional[Node]:
        """Returns the collector node for this node group, if it exists"""
        candidates = [n for n in self.nodes if n.node_role == NodeType.COLLECT]
        if candidates:
            return candidates[0]
        return None

    def produces(self, node_name: str) -> bool:
        return node_name in self.available_nodes


@dataclasses.dataclass
class TaskSpec(NodeGroup):
    """Represents the spec for a task. This has no actual input/output data associated with it,
    but has information needed to know how one might execute.

    You can think of this as a "template" for a task, where the inputs are not yet known.
    Furthermore, there could be multiple instances of this task spec, each with different inputs.
    """

    outputs_to_compute: Collection[str]  # list of output names to compute
    overrides: Dict[str, Any]  # overrides for the task, fixed at the time of creation
    adapter: lifecycle_base.LifecycleAdapterSet
    base_dependencies: List[str]  # list of tasks that must be completed before this task can run

    def get_input_vars(self) -> Tuple[List[str], List[str]]:
        """Returns the node-level dependencies for this node group.
        This is all of the sources in the subdag.

        :return: A tuple consisting of (a) the list of required inputs variables and (b)
        the list of optional input variables
        """
        all_node_names = {n.name for n in self.nodes}
        required_variables = set()
        optional_variables = set()
        for node_ in self.nodes:
            if node_.name in self.overrides:
                continue
            if node_.user_defined:
                # if the node is user-defined then that
                # means we need it for the execution
                required_variables.add(node_.name)
            for dependency in node_.dependencies:
                if dependency.name not in self.overrides:
                    if dependency.user_defined or dependency.name not in all_node_names:
                        if node_.requires(dependency.name):
                            if dependency.name in optional_variables:
                                optional_variables.remove(dependency.name)
                            required_variables.add(dependency.name)
                        else:
                            optional_variables.add(dependency.name)

        return list(required_variables), list(optional_variables)


@dataclasses.dataclass
class TaskImplementation(TaskSpec):
    """Represents the "execution ready" spec for a task. This contains two essential pieces of information:

    1. The inputs/outputs
    2. The "spawning" task that spawned this

    Thus the task_id is unique (as it contains the spawning task's ID + the group ID), but the base_id is not, as
    we could have multiple versions of this task running in parallel.
    """

    # task whose result spawned these tasks
    # If this is none, it means the graph itself spawned these tasks
    group_id: Optional[str]
    realized_dependencies: Dict[str, List[str]]  # realized dependencies are the actual dependencies
    # Note that these are lists as we have "gather" operations
    spawning_task_id: Optional[str]  # task that spawned this task
    task_id: str = dataclasses.field(init=False)
    dynamic_inputs: Dict[str, Any] = dataclasses.field(default_factory=dict)
    run_id: str = dataclasses.field(default_factory=str)

    def bind(self, dynamic_inputs: Dict[str, Any]) -> "TaskImplementation":
        """Binds dynamic inputs to the task spec, returning a new task spec"""
        return dataclasses.replace(self, dynamic_inputs={**dynamic_inputs, **self.dynamic_inputs})

    @staticmethod
    def determine_task_id(base_id: str, spawning_task: Optional[str], group_id: Optional[str]):
        return ".".join(
            filter(lambda i: i is not None, [spawning_task, group_id, base_id])
        )  # This will do for now...

    def __post_init__(self):
        super(TaskImplementation, self).__post_init__()
        self.task_id = self.determine_task_id(self.base_id, self.spawning_task_id, self.group_id)


class GroupingStrategy(abc.ABC):
    """Base class for grouping nodes"""

    @abc.abstractmethod
    def group_nodes(self, nodes: List[node.Node]) -> List[NodeGroup]:
        """Groups nodes into a list of node groups"""
        pass


class GroupByRepeatableBlocks(GroupingStrategy):
    """Groups nodes by repeatable blocks. For every set of nodes betweeen
    a "parallel[]" and a "collect[]", we place them in a "block", which is its own group.
    Note that this is specifically built to allow parallel/remote execution of blocks, with local
    execution of non-parallel groups (that might generate/read from the blocks).
    """

    @staticmethod
    def nodes_after_last_expand_block(
        collect_node: node.Node,
    ) -> Tuple[node.Node, List[node.Node]]:
        """Utility function to yield all nodes between a start and an end node.
        This returns all nodes for which the following conditions are met:

        1. It contains the start node as an ancestor
        2. It contains a node that matches the terminate condition as a dependent

        :param collect_node: Collector node to trace from
        :return: The nodes in between start and end
        """

        def is_expander(node_: node.Node) -> bool:
            return node_.node_role in [NodeType.EXPAND]

        return graph_functions.nodes_between(collect_node, is_expander)

    def group_nodes(self, nodes: List[node.Node]) -> List[NodeGroup]:
        """Groups nodes into blocks. This works as follows:
        1. Fina all the Parallelizable[] nodes in the DAG
        2. For each of those, do a DFS until the next Collect[] node
        3. Create a group for each of those
        4. Add all other nodes to their own group


        :param nodes:
        :return:
        """
        collectors = [node_ for node_ in nodes if node_.node_role == NodeType.COLLECT]
        groups = []
        visited = set()
        # We have to do this as we may have overrides to handle
        node_names = {node_.name for node_ in nodes}
        for collector in collectors:
            expander, nodes_in_block = self.nodes_after_last_expand_block(collector)
            # TODO -- add error message for conflicting groups...
            # if expander in visited:
            #     raise ValueError(f"Multiple collect nodes cannot trace "
            #                      f"back to the same expander. ")
            expander_name = f"expand-{expander.name}"
            if expander.name in node_names:
                groups.append(
                    NodeGroup(
                        base_id=f"expand-{expander.name}",
                        spawning_task_base_id=None,
                        nodes=[expander],
                        purpose=NodeGroupPurpose.EXPAND_UNORDERED,
                    )
                )
                # In thie case of a strange override, we may end up with this
                # breaking, as a node in the block could be missing
                # This is an undefined case, but we'll likely end up with an error
                groups.append(
                    NodeGroup(
                        base_id=f"block-{expander.name}",
                        spawning_task_base_id=expander_name,
                        nodes=nodes_in_block,
                        purpose=NodeGroupPurpose.EXECUTE_BLOCK,
                    )
                )
                visited.update(nodes_in_block + [expander])
            groups.append(
                NodeGroup(
                    base_id=f"collect-{expander.name}",
                    spawning_task_base_id=expander_name,
                    nodes=[collector],
                    purpose=NodeGroupPurpose.GATHER,
                )
            )
            visited.update([collector])

        remaining_nodes = [node_ for node_ in nodes if node_ not in visited]
        for node_ in remaining_nodes:
            groups.append(
                NodeGroup(
                    base_id=node_.name,
                    spawning_task_base_id=None,  # Nothing spawns this task
                    nodes=[node_],
                    purpose=NodeGroupPurpose.EXECUTE_SINGLE,
                )
            )
        return groups


def convert_node_type_to_group_purpose(node_type: NodeType) -> NodeGroupPurpose:
    """Utility type to map node type to group purpose. Note its not 1:1, but its pretty close."""
    if node_type == NodeType.EXPAND:
        return NodeGroupPurpose.EXPAND_UNORDERED
    if node_type == NodeType.COLLECT:
        return NodeGroupPurpose.GATHER
    return NodeGroupPurpose.EXECUTE_BLOCK


class GroupNodesIndividually(GroupingStrategy):
    """Groups nodes into individual blocks."""

    def group_nodes(self, nodes: List[node.Node]):
        return [
            NodeGroup(
                base_id=node_.name,
                nodes=[node_],
                purpose=convert_node_type_to_group_purpose(node_.node_role),
                spawning_task_base_id=None,
            )
            for node_ in nodes
        ]


class GroupNodesAllAsOne(GroupingStrategy):
    """Groups nodes all into one block. TODO -- add validation."""

    def group_nodes(self, nodes: List[node.Node]):
        return [
            NodeGroup(
                base_id="root",
                spawning_task_base_id=None,
                nodes=nodes,
                purpose=convert_node_type_to_group_purpose(nodes[0].node_role),
            )
        ]


class GroupNodesByLevel(GroupingStrategy):
    def group_nodes(self, nodes: List[node.Node]) -> List[NodeGroup]:
        in_order = topologically_sort_nodes(nodes)
        node_levels = get_node_levels(in_order)
        nodes_by_level = defaultdict(list)
        nodes_by_name = {node_.name: node_ for node_ in nodes}
        for node_name, level in node_levels.items():
            nodes_by_level[level].append(nodes_by_name[node_name])
        out = []
        for i in range(len(nodes_by_level)):
            nodes = nodes_by_level[i]
            out.append(
                NodeGroup(
                    base_id=f"level_{i}",
                    spawning_task_base_id=None,
                    nodes=nodes,
                    purpose=NodeGroupPurpose.EXECUTE_BLOCK,
                )
            )
        return out


def create_task_plan(
    node_groups: List[NodeGroup],
    outputs: List[str],
    overrides: Dict[str, Any],
    adapter: lifecycle_base.LifecycleAdapterSet,
) -> List[TaskSpec]:
    """Creates tasks from node groups. This occurs after we group and after execute() is called in
    the driver. Knowing what the user wants, we can finally create the tasks.

    This does the following:

    1. Determines any tasks that are not in the critical path, deletes them
    2. For every task in the critical path
        - Sets the outputs required from that task (all user-specified outputs that reside in that task)
        - Instantiates and returns the task

    :param node_groups: Groups of nodes to form tasks
    :param outputs: output nodes the user wants
    :param overrides: Overrides that short-circuit the execution
    :param adapter: LifecycleAdapterSet to use for execution
    :return: A list of task specs that we will execute later
    """

    outputs_set = set(outputs)
    out = []
    node_to_task_map = {}
    for node_group in node_groups:
        outputs = []
        nodes_in_group = set([node_.name for node_ in node_group.nodes])
        for node_ in node_group.nodes:
            # If this is overridden we can skip it
            # Note there may be a strange bug with grouping/overrides (E.G. downstream of overrides)
            if node_.name in overrides:
                continue
            node_to_task_map[node_.name] = node_group
            is_output = False
            if node_.name in outputs_set:
                is_output = True
            for depended_on_by in node_.depended_on_by:
                if (
                    depended_on_by.name not in overrides
                    and depended_on_by.name not in nodes_in_group
                ):
                    is_output = True
                    break
            if is_output:
                outputs.append(node_.name)

        task_spec = TaskSpec(
            base_id=node_group.base_id,
            spawning_task_base_id=node_group.spawning_task_base_id,
            nodes=node_group.nodes,
            purpose=node_group.purpose,
            outputs_to_compute=outputs,
            adapter=adapter,
            overrides={
                node_.name: overrides[node_.name]
                for node_ in node_group.nodes
                if node_.name in overrides
            },
            base_dependencies=[],
        )
        out.append(task_spec)
    # Now we need to go through and add dependencies to each task
    # We should be able to do this in the single pass if we guarenteed topological order,
    # but for now we're doing this in the second pass
    for task_spec in out:
        task_dependencies = set()
        nodes_in_group = set([node_.name for node_ in task_spec.nodes])
        for node_ in task_spec.nodes:
            if node_.name in overrides:
                continue
            for dependency in node_.dependencies:
                if dependency.name not in overrides and dependency.name not in nodes_in_group:
                    task_containing_dependency = node_to_task_map.get(dependency.name)
                    # If its optional, we don't need to add it as a dependency
                    if task_containing_dependency is None and not node_.requires(dependency.name):
                        continue
                    if task_containing_dependency is None:
                        raise ValueError(
                            f"Dependency is None and requires {dependency.name}."
                            f"We're somehow in a bad state. Please reach out on slack."
                        )
                    task_dependencies.add(task_containing_dependency.base_id)
        task_spec.base_dependencies = list(task_dependencies)
    return out
