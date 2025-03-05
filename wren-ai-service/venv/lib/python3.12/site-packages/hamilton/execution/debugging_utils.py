from typing import List

from hamilton.execution.grouping import NodeGroup, NodeGroupPurpose, TaskSpec

"""A set of utilities for debugging/printing out data"""
group_purpose_icons = {
    NodeGroupPurpose.EXPAND_UNORDERED: "⫳",
    NodeGroupPurpose.GATHER: "⋃",
    NodeGroupPurpose.EXECUTE_BLOCK: "᠅",
    NodeGroupPurpose.EXECUTE_SINGLE: "•",
}


def print_node_groups(node_groups: List[NodeGroup]):
    """Prints out the node groups in a clean, tree-like format.

    :param node_groups:
    :return:
    """
    for group in node_groups:
        node_icon = group_purpose_icons[group.purpose]
        print(f"{node_icon} {group.base_id}")
        for node_ in group.nodes:
            print(f"   • {node_.name} [ƒ({','.join(map(lambda n: n.name, node_.dependencies))})]")


def print_tasks(tasks: List[TaskSpec]):
    """Prints out the node groups in a clean, tree-like format.

    :param tasks:
    :return:
    """
    print()
    for task in tasks:
        node_icon = group_purpose_icons[task.purpose]
        print(f"{node_icon} {task.base_id} [ƒ({', '.join(task.base_dependencies)})]")
        for node_ in task.nodes:
            print(
                f"   • {node_.name}"
            )  # ƒ({', '.join(map(lambda n: n.name, node_.dependencies))})")
