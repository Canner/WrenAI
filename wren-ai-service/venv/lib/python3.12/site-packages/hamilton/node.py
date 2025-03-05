import inspect
import sys
import typing
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple, Type, Union

import typing_inspect

from hamilton.htypes import Collect, Parallelizable

"""
Module that contains the primitive components of the graph.

These get their own file because we don't like circular dependencies.
"""


class NodeType(Enum):
    """
    Specifies where this node's value originates.
    This can be used by different adapters to flexibly execute a function graph.
    """

    STANDARD = 1  # standard dependencies
    EXTERNAL = 2  # This node's value should be taken from cache
    PRIOR_RUN = 3  # This node's value should be taken from a prior run.
    EXPAND = 4
    COLLECT = 5
    # This is not used in a standard function graph, but it comes in handy for
    # repeatedly running the same one.


class DependencyType(Enum):
    REQUIRED = 1
    OPTIONAL = 2

    @staticmethod
    def from_parameter(param: inspect.Parameter):
        if param.default is inspect.Parameter.empty:
            return DependencyType.REQUIRED
        return DependencyType.OPTIONAL


class Node(object):
    """Object representing a node of computation."""

    def __init__(
        self,
        name: str,
        typ: Type,
        doc_string: str = "",
        callabl: Callable = None,
        node_source: NodeType = NodeType.STANDARD,
        input_types: Dict[str, Union[Type, Tuple[Type, DependencyType]]] = None,
        tags: Dict[str, Any] = None,
        namespace: Tuple[str, ...] = (),
        originating_functions: Optional[Tuple[Callable, ...]] = None,
        optional_values: Optional[Dict[str, Any]] = None,
    ):
        """Constructor for our Node object.

        :param name: the name of the function.
        :param typ: the output type of the function.
        :param doc_string: the doc string for the function. Optional.
        :param callabl: the actual function callable.
        :param node_source: whether this is something someone has to pass in.
        :param input_types: the input parameters and their types.
        :param tags: the set of tags that this node contains.
        """
        if tags is None:
            tags = dict()
        self._tags = tags
        self._name = name
        self._type = typ
        if typ is None or typ == inspect._empty:
            raise ValueError(f"Missing type for hint for function {name}. Please add one to fix.")
        self._callable = callabl
        self._doc = doc_string
        self._node_source = node_source
        self._dependencies = []
        self._depended_on_by = []
        self._namespace = namespace
        self._input_types = {}
        self._originating_functions = originating_functions
        self._default_parameter_values = {}

        if self._node_source in (
            NodeType.STANDARD,
            NodeType.COLLECT,
            NodeType.EXPAND,
        ):
            if input_types is not None:
                for key, value in input_types.items():
                    if isinstance(value, tuple):
                        self._input_types[key] = value
                    else:
                        self._input_types = {
                            key: (value, DependencyType.REQUIRED)
                            for key, value in input_types.items()
                        }
                # assume optional values passed
                self._default_parameter_values = optional_values if optional_values else {}
            else:
                # TODO -- remove this when we no longer support 3.8 -- 10/14/2024
                type_hint_kwargs = {} if sys.version_info < (3, 9) else {"include_extras": True}
                input_types = typing.get_type_hints(callabl, **type_hint_kwargs)
                signature = inspect.signature(callabl)
                for key, value in signature.parameters.items():
                    if key not in input_types:
                        raise ValueError(
                            f"Missing type hint for {key} in function {name}. Please add one to fix."
                        )
                    dep_type = DependencyType.from_parameter(value)
                    self._input_types[key] = (
                        input_types[key],
                        dep_type,
                    )
                    if dep_type == DependencyType.OPTIONAL:
                        # capture optional value
                        self._default_parameter_values[key] = value.default
        elif self.user_defined:
            if len(self._input_types) > 0:
                raise ValueError(
                    f"Input types cannot be provided for user-defined node {self.name}"
                )

    @property
    def collect_dependency(self) -> str:
        """Returns the name of the dependency that this node collects."""
        if self._node_source != NodeType.COLLECT:
            raise ValueError(f"Node {self.name} is not a collect node.")
        # gets the dependency that gets collected
        # This should be folded into the dependency type...
        for key, (type_, _) in self._input_types.items():
            if typing_inspect.get_origin(type_) == Collect:
                return key

    @property
    def namespace(self) -> Tuple[str, ...]:
        return self._namespace

    @property
    def documentation(self) -> str:
        return self._doc

    @property
    def input_types(self) -> Dict[Any, Tuple[Any, DependencyType]]:
        return self._input_types

    @property
    def default_parameter_values(self) -> Dict[str, Any]:
        """Only returns parameters for which we have optional values."""
        return self._default_parameter_values

    def requires(self, dependency: str) -> bool:
        """Returns whether or not this node requires the given dependency.

        :param dependency: Dependency we may require
        :return: True if it is an input *and* it is required
        """
        return (
            dependency in self._input_types
            and self._input_types[dependency][1] == DependencyType.REQUIRED
        )

    @property
    def name(self) -> str:
        return ".".join(self.namespace + (self._name,))

    @property
    def type(self) -> Any:
        return self._type

    def set_type(self, typ: Any):
        """Sets the type of the node"""
        assert self.user_defined is True, "Cannot reset type of non-user-defined node"
        self._type = typ

    @property
    def callable(self):
        return self._callable

    # TODO - deprecate in favor of the node sources above
    @property
    def user_defined(self):
        return self._node_source == NodeType.EXTERNAL

    @property
    def node_role(self):
        return self._node_source

    @property
    def dependencies(self) -> List["Node"]:
        return self._dependencies

    @property
    def depended_on_by(self) -> List["Node"]:
        return self._depended_on_by

    @property
    def tags(self) -> Dict[str, str]:
        return self._tags

    @property
    def originating_functions(self) -> Optional[Tuple[Callable, ...]]:
        """Gives all functions from which this node was created. None if the data
        is not available (it is user-defined, or we have not added it yet). Note that this can be
        multiple in the case of subdags (the subdag function + the other function). In that case,
        it will be in order of creation (subdag function last).

        Note that this is filled in in function_modifiers.base -- see note in from_fn

        :return: A Tuple consisting of functions from which this node was created.
        """
        return self._originating_functions

    def add_originating_function(self, fn: Callable):
        """Adds a function to the list of originating functions.

        This is used in the case to attach originating functions to user-defined (i.e. external/input nodes).
        :param fn: Function to add
        """
        assert self.user_defined is True, "Cannot add originating function to non-user-defined node"
        if self._originating_functions is None:
            self._originating_functions = (fn,)
        else:
            self._originating_functions += (fn,)

    def add_tag(self, tag_name: str, tag_value: str):
        self._tags[tag_name] = tag_value

    def __hash__(self):
        return hash(self._name)

    def __repr__(self):
        return f"<{self.name} {self._tags}>"

    def __eq__(self, other: "Node"):
        """Want to deeply compare nodes in a custom way.

        Current user is just unit tests. But you never know :)

        Note: we only compare names of dependencies because we don't want infinite recursion.
        """
        return (
            isinstance(other, Node)
            and self._name == other.name
            and self._type == other.type
            and self._doc == other.documentation
            and self._tags == other.tags
            and self.user_defined == other.user_defined
            and [n.name for n in self.dependencies] == [o.name for o in other.dependencies]
            and [n.name for n in self.depended_on_by] == [o.name for o in other.depended_on_by]
            and self.node_role == other.node_role
        )

    def __ne__(self, other: "Node"):
        return not self.__eq__(other)

    def __call__(self, *args, **kwargs):
        """Call just delegates to the callable, purely for clean syntactic sugar"""
        return self.callable(*args, **kwargs)

    @staticmethod
    def from_fn(fn: Callable, name: str = None) -> "Node":
        """Generates a node from a function. Optionally overrides the name.

        Note that currently, the `originating_function` is externally passed in -- this
        happens in resolve_nodes in function_modifiers.base. TBD whether we'll want it to stay there.

        :param fn: Function to generate the name from
        :param name: Name to use for the node
        :return: The node we generated
        """
        if name is None:
            name = fn.__name__
        # TODO -- remove this when we no longer support 3.8 -- 10/14/2024
        type_hint_kwargs = {} if sys.version_info < (3, 9) else {"include_extras": True}
        return_type = typing.get_type_hints(fn, **type_hint_kwargs).get("return")
        if return_type is None:
            raise ValueError(f"Missing type hint for return value in function {fn.__qualname__}.")
        module = inspect.getmodule(fn).__name__
        tags = {"module": module}

        node_source = NodeType.STANDARD
        # TODO - extract this into a function + clean up!
        if typing_inspect.is_generic_type(return_type):
            if typing_inspect.get_origin(return_type) == Parallelizable:
                node_source = NodeType.EXPAND
        for hint in typing.get_type_hints(fn, **type_hint_kwargs).values():
            if typing_inspect.is_generic_type(hint):
                if typing_inspect.get_origin(hint) == Collect:
                    node_source = NodeType.COLLECT
                    break

        if hasattr(fn, "__config_decorated__"):
            tags["hamilton.config"] = ",".join(fn.__config_decorated__)
        return Node(
            name,
            return_type,
            fn.__doc__ if fn.__doc__ else "",
            callabl=fn,
            tags=tags,
            node_source=node_source,
        )

    def copy_with(self, include_refs: bool = True, **overrides) -> "Node":
        """Copies a node with the specified overrides for the constructor arguments.
        Utility function for creating a node -- useful for modifying it.

        :param kwargs: kwargs to use in place of the node. Passed to the constructor.
        :param include_refs: Whether or not to include dependencies and depended_on_by
        :return: A node copied from self with the specified keyword arguments replaced.
        """
        constructor_args = dict(
            name=self.name,
            typ=self.type,
            doc_string=self.documentation,
            callabl=self.callable,
            node_source=self.node_role,
            input_types=self.input_types.copy(),
            tags=self.tags.copy(),
            originating_functions=self.originating_functions,
            optional_values=self.default_parameter_values.copy()
            if self.default_parameter_values
            else {},
        )
        constructor_args.update(**overrides)
        out = Node(**constructor_args)
        if include_refs:
            out._dependencies = self._dependencies
            out._depended_on_by = self._depended_on_by
        return out

    def copy(self, include_refs: bool = True) -> "Node":
        """Copies a node, not modifying anything (except for the references
        /dependencies if specified).

        :param include_refs: Whether or not to include dependencies and depended_on_by
        :return: A copy of the node.
        """
        """Gives a copy of the node, so we can modify it without modifying the original.
        :return: A copy of the node.
        """
        return self.copy_with(include_refs)

    def reassign_inputs(
        self, input_names: Dict[str, Any] = None, input_values: Dict[str, Any] = None
    ) -> "Node":
        """Reassigns the input names of a node. Useful for applying
        a node to a separate input if needed. Note that things can get a
        little strange if you have multiple inputs with the same name, so
        be careful about how you use this.

        :param input_names: Input name map to reassign
        :return: A node with the input names reassigned
        """
        if input_names is None:
            input_names = {}
        if input_values is None:
            input_values = {}

        is_async = inspect.iscoroutinefunction(self.callable)  # determine if its async

        def new_callable(**kwargs) -> Any:
            reverse_input_names = {v: k for k, v in input_names.items()}
            kwargs = {**kwargs, **input_values}
            return self.callable(**{reverse_input_names.get(k, k): v for k, v in kwargs.items()})

        async def async_function(**kwargs):
            return await new_callable(**kwargs)

        fn_to_use = async_function if is_async else new_callable

        new_input_types = {
            input_names.get(k, k): v for k, v in self.input_types.items() if k not in input_values
        }
        # out = self.copy_with(callabl=new_callable, input_types=new_input_types)
        out = self.copy_with(callabl=fn_to_use, input_types=new_input_types)
        return out

    def transform_output(
        self, __transform: Callable[[Dict[str, Any], Any], Any], __output_type: Type[Any]
    ) -> "Node":
        """Applies a transformation on the output of the node, returning a new node.
        Also modifies the type.

        :param __transform: Transformation to apply. This is a function with two arguments:
        (a) the kwargs passed to the node, and (b) the output of the node.
        :param __output_type: Return type of the transformation
        :return: A new node, with the right type/transformation
        """

        def new_callable(**kwargs) -> Any:
            return __transform(self.callable(**kwargs), kwargs)

        return self.copy_with(callabl=new_callable, typ=__output_type)


def matches_query(
    tags: Dict[str, Union[str, List[str]]], query_dict: Dict[str, Optional[Union[str, List[str]]]]
) -> bool:
    """Check whether a set of node tags matches the query based on tags.

    An empty dict of a query matches all tags.

    :param tags: the tags of the node.
    :param query_dict: of tag to value. If value is None, we just check that the tag exists.
    :return: True if we have tags that match all tag queries, False otherwise.
    """
    # it's an AND clause between each tag and value in the query dict.
    for tag, value in query_dict.items():
        # if tag not in node we can return False immediately.
        if tag not in tags:
            return False
        # if value is None -- we don't care about the value, just that the tag exists.
        if value is None:
            continue
        node_tag_value = tags[tag]
        if not isinstance(node_tag_value, list):
            node_tag_value = [node_tag_value]
        if not isinstance(value, list):
            value = [value]
        if set(value).intersection(set(node_tag_value)):
            # if there is some overlap, we're good.
            continue
        else:
            # else, return False.
            return False
    return True
