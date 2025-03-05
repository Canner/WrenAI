import abc
import collections
import functools
import itertools
import logging
from abc import ABC

try:
    from types import EllipsisType
except ImportError:
    # python3.10 and above
    EllipsisType = type(...)
from typing import Any, Callable, Collection, Dict, List, Optional, Tuple, Type, Union

from hamilton import node, registry, settings

logger = logging.getLogger(__name__)

if not registry.INITIALIZED:
    # Trigger load of extensions here because decorators are the only thing that use the registry
    # right now. Side note: ray serializes things weirdly, so we need to do this here rather than in
    # in the other choice of hamilton/base.py.
    registry.initialize()


def sanitize_function_name(name: str) -> str:
    """Sanitizes the function name to use.
    Note that this is a slightly leaky abstraction, but this is really just a single case in which we want to strip out
    dunderscores. This will likely change over time, but for now we need a way for a decorator to know about the true
    function name without having to rely on the decorator order. So, if you want the function name of the function you're
    decorating, call this first.

    :param name: Function name
    :return: Sanitized version.
    """
    last_dunder_index = name.rfind("__")
    return name[:last_dunder_index] if last_dunder_index != -1 else name


DECORATOR_COUNTER = collections.defaultdict(int)


def track_decorator_usage(call_fn: Callable) -> Callable:
    """Decorator to wrap the __call__ to count decorator usage.

    :param call_fn: the `__call__` function.
    :return: the wrapped call function.
    """

    @functools.wraps(call_fn)
    def replace__call__(self, fn):
        global DECORATOR_COUNTER
        if self.__module__.startswith("hamilton.function_modifiers"):
            # only capture counts for hamilton decorators
            DECORATOR_COUNTER[self.__class__.__name__] = (
                DECORATOR_COUNTER[self.__class__.__name__] + 1
            )
        else:
            DECORATOR_COUNTER["custom_decorator"] = DECORATOR_COUNTER["custom_decorator"] + 1
        return call_fn(self, fn)

    return replace__call__


class NodeTransformLifecycle(abc.ABC):
    """Base class to represent the decorator lifecycle. Common among all node decorators."""

    @classmethod
    @abc.abstractmethod
    def get_lifecycle_name(cls) -> str:
        """Gives the lifecycle name of the node decorator. Unique to the class, will likely not be overwritten by subclasses.
        Note that this is coupled with the resolve_node() function below.
        """
        pass

    @classmethod
    @abc.abstractmethod
    def allows_multiple(cls) -> bool:
        """Whether or not multiple of these decorators are allowed.

        :return: True if multiple decorators are allowed else False
        """
        pass

    @abc.abstractmethod
    def validate(self, fn: Callable):
        """Validates the decorator against the function

        :param fn: Function to validate against
        :return: Nothing, raises exception if not valid.
        """
        pass

    @track_decorator_usage
    def __call__(self, fn: Callable):
        """Calls the decorator by adding attributes using the get_lifecycle_name string.
        These attributes are the pointer to the decorator object itself, and used later in resolve_nodes below.

        :param fn: Function to decorate
        :return: The function again, with the desired properties.
        """
        self.validate(fn)
        lifecycle_name = self.__class__.get_lifecycle_name()
        if hasattr(fn, self.get_lifecycle_name()):
            if not self.allows_multiple():
                raise ValueError(
                    f"Got multiple decorators for decorator @{self.__class__}. Only one allowed."
                )
            curr_value = getattr(fn, lifecycle_name)
            setattr(fn, lifecycle_name, curr_value + [self])
        else:
            setattr(fn, lifecycle_name, [self])
        return fn

    def required_config(self) -> Optional[List[str]]:
        """Declares the required configuration keys for this decorator.
        Note that these configuration keys will be filtered and passed to the `configuration`
        parameter of the functions that this decorator uses.

        Note that this currently allows for a "escape hatch".
        That is, returning None from this function.

        :return: A list of the required configuration keys.
        """
        return []

    def optional_config(self) -> Optional[Dict[str, Any]]:
        """Declares the optional configuration keys for this decorator.
        These are configuration keys that can be used by the decorator, but are not required.
        Along with these we have *defaults*, which we will use to pass to the config.

        :return: The optional configuration keys with defaults. Note that this will return None
        if we have no idea what they are, which bypasses the configuration filtering we use entirely.
        This is mainly for the legacy API.
        """
        return {}

    @property
    def name(self) -> str:
        """Name of the decorator.

        :return: The name of the decorator
        """
        return self.__class__.__name__


class NodeResolver(NodeTransformLifecycle):
    """Decorator to resolve a nodes function. Can modify anything about the function and is run at DAG creation time."""

    @abc.abstractmethod
    def resolve(self, fn: Callable, config: Dict[str, Any]) -> Optional[Callable]:
        """Determines what a function resolves to. Returns None if it should not be included in the DAG.

        :param fn: Function to resolve
        :param config: DAG config
        :return: A name if it should resolve to something. Otherwise None.
        """
        pass

    @abc.abstractmethod
    def validate(self, fn):
        """Validates that the function can work with the function resolver.

        :param fn: Function to validate
        :return: nothing
        :raises InvalidDecoratorException: if the function is not valid for this decorator
        """
        pass

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "resolve"

    @classmethod
    def allows_multiple(cls) -> bool:
        return True


class NodeCreator(NodeTransformLifecycle, abc.ABC):
    """Abstract class for nodes that "expand" functions into other nodes."""

    @abc.abstractmethod
    def generate_nodes(self, fn: Callable, config: Dict[str, Any]) -> List[node.Node]:
        """Given a function, converts it to a series of nodes that it produces.

        :param config:
        :param fn: A function to convert.
        :return: A collection of nodes.
        """
        pass

    @abc.abstractmethod
    def validate(self, fn: Callable):
        """Validates that a function will work with this expander

        :param fn: Function to validate.
        :raises InvalidDecoratorException if this is not a valid function for the annotator
        """
        pass

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "generate"

    @classmethod
    def allows_multiple(cls) -> bool:
        return False


class SubDAGModifier(NodeTransformLifecycle, abc.ABC):
    @abc.abstractmethod
    def transform_dag(
        self, nodes: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Modifies a DAG consisting of a set of nodes. Note that this is to support the following two base classes.

        :param nodes: Collection of nodes (not necessarily connected) to modify
        :param config: Configuration in case any is needed
        :return: the new DAG of nodes
        """
        pass


class NodeInjector(SubDAGModifier, abc.ABC):
    """Injects a value as a source node in the DAG. This is a special case of the SubDAGModifier,
    which gets all the upstream (required) nodes from the subdag and gives the decorator a chance
    to inject values into them.

    This is used when you want to feed in, say, some parameter to a function. For instance:

        def processed_data(data: pd.DataFrame) -> pd.DataFrame:
            ...

    on its own would produce the "user-defined" node data, which the user is expected to pass in.
    The NodeInjector know sthat this is a parameter of the DAG and has the chance to provide a value
    for "data".
    """

    @staticmethod
    def find_injectable_params(nodes: Collection[node.Node]) -> Dict[str, Type[Type]]:
        """Identifies required nodes of this subDAG (nodes produced by this function)
        that aren't satisfied by the nodes inside it. These are "injectable",
        meaning that we can add more nodes that feed into them.

        Note that these would be "user-defined" if nothing satisfied them --
        in this case we're finding them to give this class a chance to feed them values.

        :param nodes: Subdag to consider
        :return: All dependencies that are not satisfied by the subdag.
        """
        output_deps = {}
        node_names = {node_.name for node_ in nodes}
        for node_ in nodes:
            for param_name, (type_, _) in node_.input_types.items():
                if param_name not in node_names:
                    output_deps[param_name] = type_
        return output_deps

    def transform_dag(
        self, nodes: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Transforms the subDAG by getting the injectable parameters (anything not
        produced by nodes inside it), then calling the inject_nodes function on it.

        :param nodes:
        :param config:
        :param fn:
        :return:
        """
        injectable_params = NodeInjector.find_injectable_params(nodes)
        nodes_to_inject, rename_map = self.inject_nodes(injectable_params, config, fn)
        out = []
        for node_ in nodes:
            # if there's an intersection then we want to rename the input
            if set(node_.input_types.keys()) & set(rename_map.keys()):
                out.append(node_.reassign_inputs(input_names=rename_map))
            else:
                out.append(node_)
        out.extend(nodes_to_inject)
        return out

    @abc.abstractmethod
    def inject_nodes(
        self, params: Dict[str, Type[Type]], config: Dict[str, Any], fn: Callable
    ) -> Tuple[List[node.Node], Dict[str, str]]:
        """Adds a set of nodes to inject into the DAG. These get injected into the specified param name,
        meaning that exactly one of the output nodes will have that name. Note that this also allows
        input renaming, meaning that the injector can rename the input to something else (to avoid
        name-clashes).

        :param params: Dictionary of all the type names one wants to inject
        :param config: Configuration with which the DAG was constructed.
        :param fn: original function we're decorating. This is useful largely for debugging.
        :return: A list of nodes to add. Empty if you wish to inject nothing, as well as a dictionary,
        allowing the injector to rename the inputs (e.g. if you want the name to be
        namespaced to avoid clashes)
        """

        pass

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "inject"

    @classmethod
    def allows_multiple(cls) -> bool:
        return True

    @abc.abstractmethod
    def validate(self, fn: Callable):
        pass


class NodeExpander(SubDAGModifier):
    """Expands a node into multiple nodes. This is a special case of the SubDAGModifier,
    which allows modification of some portion of the DAG. This just modifies a single node.
    """

    EXPAND_NODES = "expand_nodes"

    def transform_dag(
        self, nodes: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        if len(nodes) != 1:
            raise ValueError(
                f"Cannot call NodeExpander: {self.__class__} on more than one node. This must be "
                f"called first in the DAG. Called with {nodes} "
            )
        (node_,) = nodes
        return self.expand_node(node_, config, fn)

    @abc.abstractmethod
    def expand_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Given a single node, expands into multiple nodes. Note that this node list includes:
        1. Each "output" node (think sink in a DAG)
        2. All intermediate steps
        So in essence, this forms a miniature DAG

        :param node: The node to expand
        :return: A collection of nodes to add to the DAG
        """
        pass

    @abc.abstractmethod
    def validate(self, fn: Callable):
        pass

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "expand"

    @classmethod
    def allows_multiple(cls) -> bool:
        return False


TargetType = Union[str, Collection[str], None, EllipsisType]


class NodeTransformer(SubDAGModifier):
    NON_FINAL_TAG = "hamilton.non_final_node"

    @classmethod
    def _early_validate_target(cls, target: TargetType, allow_multiple: bool):
        """Determines whether the target is valid, given that we may or may not
        want to allow multiple nodes to be transformed.

        If the target type is a single string then we're good.
        If the target type is a collection of strings, then it has to be a collection of size one.
        If the target type is None, then we delay checking until later (as there might be just
        one node transformed in the DAG).
        If the target type is ellipsis, then we delay checking until later (as there might be
        just one node transformed in the DAG)

        :param target: How to appply this node. See docs below.
        :param allow_multiple:  Whether or not this can operate on multiple nodes.
        :raises InvalidDecoratorException: if the target is invalid given the value of allow_multiple.
        """
        if isinstance(target, str):
            # We're good -- regardless of the value of allow_multiple we'll pass
            return
        elif isinstance(target, Collection) and all(isinstance(x, str) for x in target):
            if len(target) > 1 and not allow_multiple:
                raise InvalidDecoratorException(f"Cannot have multiple targets for . Got {target}")
            return
        elif target is None or target is Ellipsis:
            return
        else:
            raise InvalidDecoratorException(f"Invalid target type for NodeTransformer: {target}")

    def __init__(self, target: TargetType):
        """Target determines to which node(s) this applies. This represents selection from a subDAG.
        For the options, consider at the following graph:
        A -> B -> C
             \\_> D -> E

        1. If it is `None`, it defaults to the "old" behavior. That is, is applies to all "final" DAG
        nodes. In the subdag. That is, all nodes with out-degree zero/sinks. In the case
        above, *just* C and E will be transformed.

        2. If it is a string, it will be interpreted as a node name. In the above case, if it is A, it
        will transform A, B will transform B, etc...

        3. If it is a collection of strings, it will be interpreted as a collection of node names.
        That is, it will apply to all nodes that are referenced in that collection. In the above case,
        if it is ["A", "B"], it will transform to A and B.

        4. If it is Ellipsis, it will apply to all nodes in the subDAG. In the above case, it will
        transform A, B, C, D, and E.

        :param target: Which node(s)/node spec to run transforms on top of. These nodes will get
        replaced by a list of nodes.
        """
        self.target = target

    @staticmethod
    def _extract_final_nodes(
        nodes: Collection[node.Node],
    ) -> Collection[node.Node]:
        """Separates out final nodes (sinks) from the nodes.

        :param nodes: Nodes to separate out
        :return: A tuple consisting of [internal, final] node sets
        """
        non_final_nodes = set()
        for node_ in nodes:
            for dep in node_.input_types:
                non_final_nodes.add(dep)
        return [
            node_
            for node_ in nodes
            if node_.name not in non_final_nodes
            and not node_.tags.get(NodeTransformer.NON_FINAL_TAG)
        ]

    @staticmethod
    def select_nodes(target: TargetType, nodes: Collection[node.Node]) -> Collection[node.Node]:
        """Resolves all nodes to match the target. This does a resolution on the rules
        specified in the constructor above, giving a set of nodes that match a target.
        We then can split them from the remainder of nodes, and just transform them.

        :param target: The target to use to resolve nodes
        :param nodes: SubDAG to resolve.
        :return: The set of nodes matching this target
        """
        if target is None:
            return NodeTransformer._extract_final_nodes(nodes)
        elif target is Ellipsis:
            return nodes
        elif isinstance(target, str):
            out = [node_ for node_ in nodes if node_.name == target]
            if len(out) == 0:
                raise InvalidDecoratorException(f"Could not find node {target} in {nodes}")
            return out
        elif isinstance(target, Collection):
            out = [node_ for node_ in nodes if node_.name in target]
            if len(out) != len(target):
                raise InvalidDecoratorException(
                    f"Could not find all nodes {target} in {nodes}. "
                    f"Missing ({set(target) - set([node_.name for node_ in out])})"
                )
            return out
        else:
            raise ValueError(f"Invalid target: {target}")

    @staticmethod
    def compliment(
        all_nodes: Collection[node.Node], nodes_to_transform: Collection[node.Node]
    ) -> Collection[node.Node]:
        """Given a set of nodes, and a set of nodes to transform, returns the set of nodes that
        are not in the set of nodes to transform.

        :param all_nodes: All nodes in the subdag
        :param nodes_to_transform: All nodes to transform
        :return: A collection of nodes that are not in the set of nodes to transform but are in the
        subdag
        """
        return [node_ for node_ in all_nodes if node_ not in nodes_to_transform]

    def transform_targets(
        self, targets: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Transforms a set of target nodes. Note that this is just a loop,
        but abstracting t away gives subclasses control over how this is done,
        allowing them to validate beforehand. While we *could* just have this
        as a `validate`, or `transforms_multiple` function, this is a pretty clean/
        readable way to do it.

        :param targets: Node Targets to transform
        :param config: Configuration to use to
        :param fn: Function being decorated
        :return: Results of transformations
        """
        out = []
        for node_to_transform in targets:
            out += list(self.transform_node(node_to_transform, config, fn))
        return out

    def transform_dag(
        self, nodes: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Finds the sources and sinks and runs the transformer on each sink.
        Then returns the result of the entire set of sinks. Note that each sink has to have a unique name.

        :param config: The original function we're messing with
        :param nodes: Subdag to modify
        :param fn: Original function that we're utilizing/modifying
        :return: The DAG of nodes in this node
        """
        nodes_to_transform = self.select_nodes(self.target, nodes)
        nodes_to_keep = self.compliment(nodes, nodes_to_transform)
        out = list(nodes_to_keep)
        out += self.transform_targets(nodes_to_transform, config, fn)
        return out

    @abc.abstractmethod
    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        pass

    @abc.abstractmethod
    def validate(self, fn: Callable):
        pass

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "transform"

    @classmethod
    def allows_multiple(cls) -> bool:
        return True


class SingleNodeNodeTransformer(NodeTransformer, ABC):
    """A node transformer that only allows a single node to be transformed.
    Specifically, this must be applied to a decorator operation that returns
    a single node (E.G. @subdag). Note that if you have multiple node transformations,
    the order *does* matter.

    This should end up killing NodeExpander, as it has the same impact, and the same API.
    """

    def __init__(self):
        """Initializes the node transformer to only allow a single node to be transformed.
        Note this passes target=None to the superclass, which means that it will only
        apply to the 'sink' nodes produced."""
        super().__init__(target=None)

    def transform_targets(
        self, targets: Collection[node.Node], config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Transforms the target set of nodes. Exists to validate the target set.

        :param targets: Targets to transform -- this has to be an array of 1.
        :param config: Configuration passed into the DAG.
        :param fn: Function that was decorated.
        :return: The resulting nodes.
        """
        if len(targets) != 1:
            raise InvalidDecoratorException(
                f"Expected a single node to transform, but got {len(targets)}. {self.__class__} "
                f" can only operate on a single node, but multiple nodes were created by {fn.__qualname__}"
            )
        return super().transform_targets(targets, config, fn)


class NodeDecorator(NodeTransformer, abc.ABC):
    DECORATE_NODES = "decorate_nodes"

    def __init__(self, target: TargetType):
        """Initializes a NodeDecorator with a target, to determine *which* nodes to decorate.
        See documentation in NodeTransformer for more details on what to decorate.

        :param target: Target parameter to resolve set of nodes to transform.
        """
        super().__init__(target=target)

    def validate_node(self, node_: node.Node):
        """Validates that a node is valid for this decorator. This is
        not the same as validation on the function, as this is done
        during node-resolution.

        :param node_: Node to validate
        :raises InvalidDecoratorException: if the node is not valid for this decorator
        """
        pass

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Transforms the node. Delegates to decorate_node

        :param node_: Node to transform
        :param config: Config in case its needed
        :param fn: Function we're decorating
        :return: The nodes produced by the transformation
        """
        self.validate_node(node_)
        return [self.decorate_node(node_)]

    @classmethod
    def get_lifecycle_name(cls) -> str:
        return NodeDecorator.DECORATE_NODES

    @classmethod
    def allows_multiple(cls) -> bool:
        return True

    def validate(self, fn: Callable):
        pass

    @abc.abstractmethod
    def decorate_node(self, node_: node.Node) -> node.Node:
        """Decorates the node -- copies and embellishes in some way.

        :param node_: Node to decorate.
        :return: A copy of the node.
        """
        pass


class DefaultNodeCreator(NodeCreator):
    def generate_nodes(self, fn: Callable, config: Dict[str, Any]) -> List[node.Node]:
        return [node.Node.from_fn(fn)]

    def validate(self, fn: Callable):
        pass


class DefaultNodeResolver(NodeResolver):
    def resolve(self, fn: Callable, config: Dict[str, Any]) -> Callable:
        return fn

    def validate(self, fn):
        pass


class DefaultNodeDecorator(NodeDecorator):
    def __init__(self):
        super().__init__(target=...)

    def decorate_node(self, node_: node.Node) -> node.Node:
        return node_


def resolve_config(
    name_for_error: str,
    config: Dict[str, Any],
    config_required: Optional[List[str]],
    config_optional_with_defaults: Dict[str, Any],
) -> Dict[str, Any]:
    """Resolves the configuration that a decorator utilizes

    :param name_for_error:
    :param config:
    :param config_required:
    :param config_optional_with_defaults:
    :return:
    """
    if config_required is None:
        # This is an out to allow for backwards compatibility for the config.resolve decorator
        # Note this is an internal API, but we made the config with the `resolve` parameter public
        return config
    # Validate that all required parameters are present, so we fake the optional parameters for now
    config_optional_with_global_defaults_applied = (
        config_optional_with_defaults.copy() if config_optional_with_defaults is not None else {}
    )
    config_optional_with_global_defaults_applied[settings.ENABLE_POWER_USER_MODE] = (
        config_optional_with_global_defaults_applied.get(settings.ENABLE_POWER_USER_MODE, False)
    )
    missing_keys = (
        set(config_required)
        - set(config.keys())
        - set(config_optional_with_global_defaults_applied.keys())
    )
    if len(missing_keys) > 0:
        raise MissingConfigParametersException(
            f"The following configurations are required by {name_for_error}: {missing_keys}"
        )
    config_out = {key: config[key] for key in config_required}
    for key in config_optional_with_global_defaults_applied:
        config_out[key] = config.get(key, config_optional_with_global_defaults_applied[key])
    return config_out


class DynamicResolver(NodeTransformLifecycle):
    @classmethod
    def get_lifecycle_name(cls) -> str:
        return "dynamic"

    @classmethod
    def allows_multiple(cls) -> bool:
        return True

    def validate(self, fn: Callable):
        pass


def filter_config(config: Dict[str, Any], decorator: NodeTransformLifecycle) -> Dict[str, Any]:
    """Filters the config to only include the keys in config_required
    :param config: The config to filter
    :param config_required: The keys to include
    :param decorator: The decorator that is utilizing the configuration
    :return: The filtered config
    """
    config_required = decorator.required_config()
    config_optional_with_defaults = decorator.optional_config()
    return resolve_config(decorator.name, config, config_required, config_optional_with_defaults)


def get_node_decorators(
    fn: Callable, config: Dict[str, Any]
) -> Dict[str, List[NodeTransformLifecycle]]:
    """Gets the decorators for a function. Contract is this will have one entry
    for every step of the decorator lifecycle that can always be run (currently everything except NodeExpander)

    :param fn:
    :return:
    """
    defaults = {
        NodeResolver.get_lifecycle_name(): [DefaultNodeResolver()],
        NodeCreator.get_lifecycle_name(): [DefaultNodeCreator()],
        NodeExpander.get_lifecycle_name(): [],
        NodeTransformer.get_lifecycle_name(): [],
        NodeInjector.get_lifecycle_name(): [],
        NodeDecorator.get_lifecycle_name(): [DefaultNodeDecorator()],
    }
    dynamic_decorators = []
    for dynamic_resolver in getattr(fn, DynamicResolver.get_lifecycle_name(), []):
        dynamic_decorators.append(dynamic_resolver.resolve(config, fn))
    all_decorators = list(
        itertools.chain(
            *[getattr(fn, lifecycle_step, []) for lifecycle_step in defaults],
            dynamic_decorators,
        )
    )
    grouped_by_lifecycle_step = collections.defaultdict(list)
    for decorator in all_decorators:
        grouped_by_lifecycle_step[decorator.get_lifecycle_name()].append(decorator)
    defaults.update(grouped_by_lifecycle_step)
    return defaults


def _add_original_function_to_nodes(fn: Callable, nodes: List[node.Node]) -> List[node.Node]:
    """Adds the original function to the nodes. We do this so that we can have appropriate metadata
    on the function -- this is valuable to see if/how the function changes over time to manage node
    versions, etc...

    Note that this will add it so the "external" function is always last. They *should* correspond
    to namespaces, but this is not

    This is not mutating them, rather
    copying them with the original function. If it gets slow we *can* mutate them, but
    this is just another O(n) operation so I'm not concerned.


    :param fn: The function to add
    :param nodes: The nodes to add it to
    :return: The nodes with the function added
    """
    out = []
    for node_ in nodes:
        current_originating_functions = node_.originating_functions
        new_originating_functions = (
            current_originating_functions if current_originating_functions is not None else ()
        ) + (fn,)
        out.append(node_.copy_with(originating_functions=new_originating_functions))
    return out


def _resolve_nodes_error(fn: Callable) -> str:
    return f"Exception occurred while compiling function: {fn.__name__} " f"to nodes"


def resolve_nodes(fn: Callable, config: Dict[str, Any]) -> Collection[node.Node]:
    """Gets a list of nodes from a function. This is meant to be an abstraction between the node
    and the function that it implements. This will end up coordinating with the decorators we build
    to modify nodes.

    Algorithm is as follows:
    1. If there is a list of function resolvers, apply them one
    after the other. Otherwise, apply the default function resolver
    which will always return just the function. This determines whether to
    proceed -- if any function resolver is none, short circuit and return
    an empty list of nodes.

    2. If there is a list of node creators, that list must be of length 1
    -- this is determined in the node creator class. Apply that to get
    the initial node.

    3. If there is a list of node expanders, apply them. Otherwise apply the default
    node expander This must be a list of length one. This gives out a list of nodes.

    4. If there is a node transformer, apply that. Note that the node transformer
    gets applied individually to just the sink nodes in the subdag. It subclasses
    "DagTransformer" to do so.

    5. Return the final list of nodes.

    :param fn: Function to input.
    :param config: Configuration to use -- this can be used by decorators to specify
    which configuration they need.
    :return: A list of nodes into which this function transforms.
    """
    try:
        function_decorators = get_node_decorators(fn, config)
        node_resolvers = function_decorators[NodeResolver.get_lifecycle_name()]
        for resolver in node_resolvers:
            fn = resolver.resolve(fn, config=filter_config(config, resolver))
            if fn is None:
                return []
        (node_creator,) = function_decorators[NodeCreator.get_lifecycle_name()]
        nodes = node_creator.generate_nodes(fn, filter_config(config, node_creator))
        node_injectors = function_decorators[NodeInjector.get_lifecycle_name()]
        for node_injector in node_injectors:
            nodes = node_injector.transform_dag(nodes, filter_config(config, node_injector), fn)
        node_expanders = function_decorators[NodeExpander.get_lifecycle_name()]
        if len(node_expanders) > 0:
            (node_expander,) = node_expanders
            nodes = node_expander.transform_dag(nodes, filter_config(config, node_expander), fn)
        node_transformers = function_decorators[NodeTransformer.get_lifecycle_name()]
        for dag_modifier in node_transformers:
            nodes = dag_modifier.transform_dag(nodes, filter_config(config, dag_modifier), fn)
        function_decorators = function_decorators[NodeDecorator.get_lifecycle_name()]
        for node_decorator in function_decorators:
            nodes = node_decorator.transform_dag(nodes, filter_config(config, node_decorator), fn)
        return _add_original_function_to_nodes(fn, nodes)
    except Exception as e:
        logger.exception(_resolve_nodes_error(fn))
        raise e


class InvalidDecoratorException(Exception):
    pass


class MissingConfigParametersException(Exception):
    pass
