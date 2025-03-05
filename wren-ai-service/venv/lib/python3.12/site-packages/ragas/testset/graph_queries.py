import typing as t

from ragas.testset.graph import KnowledgeGraph, Node


def get_child_nodes(node: Node, graph: KnowledgeGraph, level: int = 1) -> t.List[Node]:
    """
    Get the child nodes of a given node up to a specified level.

    Parameters
    ----------
    node : Node
        The node to get the children of.
    graph : KnowledgeGraph
        The knowledge graph containing the node.
    level : int
        The maximum level to which child nodes are searched.

    Returns
    -------
    List[Node]
        The list of child nodes up to the specified level.
    """
    children = []

    # Helper function to perform depth-limited search for child nodes
    def dfs(current_node: Node, current_level: int):
        if current_level > level:
            return
        for rel in graph.relationships:
            if rel.source == current_node and rel.type == "child":
                children.append(rel.target)
                dfs(rel.target, current_level + 1)

    # Start DFS from the initial node at level 0
    dfs(node, 1)

    return children


def get_parent_nodes(node: Node, graph: KnowledgeGraph, level: int = 1) -> t.List[Node]:
    """
    Get the parent nodes of a given node up to a specified level.

    Parameters
    ----------
    node : Node
        The node to get the parents of.
    graph : KnowledgeGraph
        The knowledge graph containing the node.
    level : int
        The maximum level to which parent nodes are searched.

    Returns
    -------
    List[Node]
        The list of parent nodes up to the specified level.
    """
    parents = []

    # Helper function to perform depth-limited search for parent nodes
    def dfs(current_node: Node, current_level: int):
        if current_level > level:
            return
        for rel in graph.relationships:
            if rel.target == current_node and rel.type == "child":
                parents.append(rel.source)
                dfs(rel.source, current_level + 1)

    # Start DFS from the initial node at level 0
    dfs(node, 1)

    return parents
