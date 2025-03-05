"""Module for external-facing graph constructs. These help the user navigate/manage the graph as needed."""

import ast
import functools
import hashlib
import inspect
import logging
import typing
from dataclasses import dataclass

from hamilton import htypes, node
from hamilton.htypes import get_type_as_string

# This is a little ugly -- its just required for graph build, and works
# This indicates a larger smell though -- we need to have the right level of
# hierarchy to ensure we don't have to deal with this.
# The larger problem is that we have a few interfaces that are referred to by
# The core system (in defaults), and we have not managed to disentangle it yet.
if typing.TYPE_CHECKING:
    from hamilton import graph

logger = logging.getLogger(__name__)


def _remove_docs_and_comments(source: str) -> str:
    """Remove the docs and comments from a source code string.

    The use of `ast.unparse()` requires Python 3.9

    1. Parsing then unparsing the AST of the source code will
    create a code object and convert it back to a string. In the
    process, comments are stripped.

    2. walk the AST to check if first element after `def` is a
    docstring. If so, edit AST to skip the docstring

    NOTE. The ast parsing will fail if `source` has syntax errors. For the
    majority of cases this is caught upstream (e.g., by calling `import`).
    The foreseeable edge case is if `source` is the result of `inspect.getsource`
    on a nested function, method, or callable where `def` isn't at column 0.
    Standard usage of Hamilton requires users to define functions/nodes at the top
    level of a module, and therefore no issues should arise.
    """
    parsed = ast.parse(source)
    for n in ast.walk(parsed):
        if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue

        if not len(n.body):
            continue

        # check if 1st node is a docstring
        if not isinstance(n.body[0], ast.Expr):
            continue

        if not hasattr(n.body[0], "value") or not isinstance(n.body[0].value, ast.Str):
            continue

        # skip docstring
        n.body = n.body[1:]

    return ast.unparse(parsed)


def hash_source_code(source: typing.Union[str, typing.Callable], strip: bool = False) -> str:
    """Hashes the source code of a function (str).

    The `strip` parameter requires Python 3.9

    If strip, try to remove docs and comments from source code string. Since
    they don't impact function behavior, they shouldn't influence the hash.
    """
    if isinstance(source, typing.Callable):
        source = inspect.getsource(source)

    source = source.strip()

    if strip:
        try:
            # could fail if source is indented code.
            # see `remove_docs_and_comments` docstring for details.
            source = _remove_docs_and_comments(source)
        except Exception:
            pass

    return hashlib.sha256(source.encode()).hexdigest()


@dataclass
class HamiltonNode:
    """External facing API for hamilton Nodes. Having this as a dataclass allows us
    to hide the internals of the system but expose what the user might need.
    Furthermore, we can always add attributes and maintain backwards compatibility."""

    name: str
    type: typing.Type
    tags: typing.Dict[str, typing.Union[str, typing.List[str]]]
    is_external_input: bool
    originating_functions: typing.Optional[typing.Tuple[typing.Callable, ...]]
    documentation: typing.Optional[str]
    required_dependencies: typing.Set[str]
    optional_dependencies: typing.Set[str]
    optional_dependencies_default_values: typing.Dict[str, typing.Any]

    def as_dict(self, include_optional_dependencies_default_values: bool = False) -> dict:
        """Create a dictionary representation of the Node that is JSON serializable.

        :param include_optional_dependencies_default_values: Include optional dependencies default values in the output.
            Note: optional values could be anything and might not be JSON serializable.
        """
        dict_representation = {
            "name": self.name,
            "tags": self.tags,
            "output_type": (get_type_as_string(self.type) if get_type_as_string(self.type) else ""),
            "required_dependencies": sorted(self.required_dependencies),
            "optional_dependencies": sorted(self.optional_dependencies),
            "source": (
                inspect.getsource(self.originating_functions[0])
                if self.originating_functions
                else None
            ),
            "documentation": self.documentation,
            "version": self.version,
        }
        if include_optional_dependencies_default_values:
            dict_representation["optional_dependencies_default_values"] = (
                self.optional_dependencies_default_values
            )
        return dict_representation

    @staticmethod
    def from_node(n: node.Node) -> "HamiltonNode":
        """Creates a HamiltonNode from a Node (Hamilton's internal representation).

        :param n: Node to create the Variable from.
        :return: HamiltonNode created from the Node.
        """
        return HamiltonNode(
            name=n.name,
            type=n.type,
            tags=n.tags,
            is_external_input=n.user_defined,
            originating_functions=n.originating_functions,
            documentation=n.documentation,
            required_dependencies={
                dep
                for dep, (type_, dep_type) in n.input_types.items()
                if dep_type == node.DependencyType.REQUIRED
            },
            optional_dependencies={
                dep
                for dep, (type_, dep_type) in n.input_types.items()
                if dep_type == node.DependencyType.OPTIONAL
            },
            optional_dependencies_default_values={
                name: value for name, value in n.default_parameter_values.items()
            },
        )

    @functools.cached_property
    def version(self) -> typing.Optional[str]:
        """Generate a hash of the node originating function source code.

        Note that this will be `None` if the node is an external input/has no
        originating functions.

        The option `strip=True` means docstring and comments are ignored
        when hashing the function.
        """
        if self.originating_functions is None or len(self.originating_functions) == 0:
            if self.is_external_input:
                # return the name of the config node. (we could add type but skipping for now)
                return self.name
            return None  # this shouldn't happen often.
        try:
            # return hash of first function. It could be that others are Hamilton framework code.
            return hash_source_code(self.originating_functions[0], strip=True)
        except OSError:  # TODO -- ensure we can get the node hash in a databricks environment when using jupyter magic
            logger.warning(
                f"Failed to hash source code for node {self.name}. Certain environments (such as databricks) do not allow it."
                " In this case, version will be None."
            )
            return None

    def __repr__(self):
        return f'Node("{self.name}": {htypes.get_type_as_string(self.type)})'


@dataclass
class HamiltonGraph:
    """External facing API for Hamilton Graphs. Currently a list of nodes that
    allow you to trace forward/backwards in the graph. Will likely be adding some more capabilities:
        1. More metadata -- config + modules
        2. More utility functions -- make it easy to walk/do an action at each node
    For now, you have to implement walking on your own if you care about order.

    Note that you do not construct this class directly -- instead, you will get this at various points in the API.
    """

    nodes: typing.List[HamiltonNode]
    # store the original graph for internal use

    @staticmethod
    def from_graph(fn_graph: "graph.FunctionGraph") -> "HamiltonGraph":
        """Creates a HamiltonGraph from a FunctionGraph (Hamilton's internal representation).

        :param fn_graph: FunctionGraph to convert
        :return: HamiltonGraph created from the FunctionGraph
        """
        return HamiltonGraph(
            nodes=[HamiltonNode.from_node(n) for n in fn_graph.nodes.values()],
        )

    @functools.cached_property
    def version(self) -> str:
        """Generate a hash of the dataflow based on the collection of node hashes.

        Node hashes are in a sorted list, then concatenated as a string before hashing.
        To find differences between dataflows, you need to inspect the node level.
        """
        sorted_node_versions = sorted([n.version for n in self.nodes if n.version is not None])
        return hashlib.sha256(str(sorted_node_versions).encode()).hexdigest()

    @functools.cached_property
    def __nodes_lookup(self) -> typing.Dict[str, HamiltonNode]:
        """Cache the mapping {node_name: node} for faster `__getitem__`"""
        return {n.name: n for n in self.nodes}

    def __getitem__(self, key: str) -> HamiltonNode:
        """Get an HamiltonNode by name

        :param key: Hamilton node name
        :return: Hamilton node
        """
        return self.__nodes_lookup[key]

    def filter_nodes(
        self, filter: typing.Callable[[HamiltonNode], bool]
    ) -> typing.List[HamiltonNode]:
        """Return Hamilton nodes matching the filter criteria"""
        return [n for n in self.nodes if filter(n) is True]
