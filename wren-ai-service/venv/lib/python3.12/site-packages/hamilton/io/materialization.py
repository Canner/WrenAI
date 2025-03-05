import dataclasses
import functools
import inspect
import typing
from typing import Any, Dict, List, Optional, Protocol, Set, Type, Union

from hamilton import base, common, graph, lifecycle, node
from hamilton.function_modifiers.adapters import LoadFromDecorator, SaveToDecorator
from hamilton.function_modifiers.dependencies import SingleDependency, value
from hamilton.graph import FunctionGraph, update_dependencies
from hamilton.io.data_adapters import DataLoader, DataSaver
from hamilton.registry import LOADER_REGISTRY, SAVER_REGISTRY


class materialization_meta__(type):
    """Metaclass for the to. materializer. This is specifically to allow class access method.
    This only exists to add more helpful error messages. We dynamically assign the attributes
    below (see `_set_materializer_attrs`), which helps with auto-complete.
    """

    def __new__(cls, name, bases, clsdict):
        """Boiler plate for a metaclass -- this just instantiates it as a type. It also sets the
        annotations to be available later.
        """
        clsobj = super().__new__(cls, name, bases, clsdict)
        clsobj.__annotations__ = {}
        return clsobj

    def __getattr__(cls, item: str) -> "_MaterializerFactoryProtocol":
        """This *just* exists to provide a more helpful error message. If you try to access
        a property that doesn't exist, we'll raise an error that tells you what properties
        are available/where to learn more."""

        try:
            return super().__getattribute__(item)
        except AttributeError as e:
            if item in SAVER_REGISTRY:
                # In this case we want to dynamically access it after registering
                # This is so that we can register post-importing
                # Note that this will register all new ones in bulk --
                # which will (in most cases) be a one-time-cost
                _set_materializer_attrs()
                return super().__getattribute__(item)
            raise AttributeError(
                f"No data materializer named: {item}. "
                f"Available materializers are: {list(SAVER_REGISTRY.keys())}. "
                "If you've gotten to this point, you either (1) Have created the custom materializer and not "
                "registered it (in which case, call registry.register_adapter...) "
                "(2) spelled the materializer name wrong, or (e) are trying to use a materialiazer that does"
                "not exist (yet). For a list of available materialiazers, see  "
                "https://hamilton.readthedocs.io/reference/io/available-data-adapters/#data"
                "-loaders "
            ) from e


class extractor_meta__(type):
    """Metaclass for the from_. extractor pattern. This is specifically to allow class access method.
    This only exists to add more helpful error messages. We dynamically assign the attributes
    below (see `_set_extractor_attrs`), which helps with auto-complete.

    TODO -- reduce shared code between this and the loader above.
    """

    def __new__(cls, name, bases, clsdict):
        """Boiler plate for a metaclass -- this just instantiates it as a type. It also sets the
        annotations to be available later.
        """
        clsobj = super().__new__(cls, name, bases, clsdict)
        clsobj.__annotations__ = {}
        return clsobj

    def __getattr__(cls, item: str) -> "_ExtractorFactoryProtocol":
        """This *just* exists to provide a more helpful error message. If you try to access
        a property that doesn't exist, we'll raise an error that tells you what properties
        are available/where to learn more."""
        try:
            return super().__getattribute__(item)
        except AttributeError as e:
            if item in LOADER_REGISTRY:
                # See note on data savers/__getattr__ above
                _set_materializer_attrs()
                return super().__getattribute__(item)
            raise AttributeError(
                f"No data loader named: {item}. "
                f"Available loaders are: {LOADER_REGISTRY.keys()}. "
                "If you've gotten to this point, you either (1) spelled the "
                "loader name wrong, (2) are trying to use a loader that does"
                "not exist (yet). For a list of available loaders, see  "
                "https://hamilton.readthedocs.io/reference/io/available-data-adapters/#data"
                "-loaders "
            ) from e


def process_kwargs(
    data_saver_kwargs: Dict[str, Union[Any, SingleDependency]],
) -> Dict[str, SingleDependency]:
    """Processes raw strings from the user, converting them into dependency specs.
    This goes according to the following rules.

    1. If it is a `SingleDependency`, we leave it alone
    2. If it is anything else, we treat it as a literal, and convert it to a value(...)

    This is so that everything is in the shape of source/value, and we can uniformally handle it later.

    :param data_saver_kwargs: Kwargs passed in from the user
    :return: Processed kwargs
    """
    processed_kwargs = {}
    for kwarg, kwarg_val in data_saver_kwargs.items():
        if not isinstance(kwarg_val, SingleDependency):
            processed_kwargs[kwarg] = value(kwarg_val)
        else:
            processed_kwargs[kwarg] = kwarg_val
    return processed_kwargs


class ExtractorFactory:
    def __init__(
        self,
        target: str,
        loaders: List[Type[DataLoader]],
        **data_loader_kwargs: Union[Any, SingleDependency],
    ):
        """Instantiates an ExtractorFactory. Note this is not a public API -- this is
        internally what gets called (through a factory method) to create it. Called using `from_`,
        E.G. `from_.csv`.

        :param target: Parameter, into which we're loading the data
        :param loaders: A list of data loaders that are viable candidates, given the key after `from_`
        :param data_loader_kwargs: Keyword arguments for the data loaders.
        """
        self.target = target
        self.loaders = loaders
        self.data_loader_kwargs = process_kwargs(data_loader_kwargs)

    def generate_nodes(self, fn_graph: graph.FunctionGraph) -> List[node.Node]:
        """Resolves the extractor, returning the set of nodes that should get
        added to the function graph. Note that this is an upsert operation --
        these nodes can replace existing nodes.

        :param fn_graph: Function graph
        :return: List of nodes to add/upsert to the graph
        """

        decorator = LoadFromDecorator(self.loaders, self.target, **self.data_loader_kwargs)
        # TODO -- add some nodes to the graph
        node_with_target = fn_graph.nodes.get(self.target)
        if node_with_target is None:
            raise ValueError(
                f"Could not find node with name: {self.target} in function "
                f"graph. Available nodes: {list(fn_graph.nodes.keys()) + [...] if len(fn_graph.nodes) > 10 else []}"
            )
        return decorator.get_loader_nodes(self.target, node_with_target.type, namespace=None)


class MaterializerFactory:
    """Basic factory for creating materializers. Note that this should only ever be instantiated
    through `to.<name>`, which conducts polymorphic lookup to find the appropriate materializer.
    """

    def __init__(
        self,
        id: str,
        savers: List[Type[DataSaver]],
        result_builder: Optional[base.ResultMixin],
        dependencies: List[Union[str, Any]],
        **data_saver_kwargs: Any,
    ):
        """Creates a materializer factory.

        :param name: Name of the node that this will represent in the DAG.
        :param savers: Potential data savers to use (these will be filtered down from the ones
        registered to <output_format> when `to.<output_format>` is called.)
        :param result_builder: ResultBuilder that joins the result of the dependencies together.
        :param dependencies: Nodes, the results of which on which this depends
        :param data_saver_kwargs: kwargs to be passed to the data_savers. Either literal values,
        or `source`/`value`.
        """

        self.id = id
        self.savers = savers
        self.result_builder = result_builder
        self.dependencies = dependencies
        self.data_saver_kwargs = process_kwargs(data_saver_kwargs)

    def sanitize_dependencies(self, module_set: Set[str]) -> "MaterializerFactory":
        """Sanitizes the dependencies to ensure they're strings.

        This replaces the internal value for self.dependencies and returns a new object.
        We return a new object to not modify the one passed in.

        :param module_set: modules that "functions" could come from if that's passed in.
        :return: new object with sanitized_dependencies.
        """
        final_vars = common.convert_output_values(self.dependencies, module_set)
        return MaterializerFactory(
            self.id,
            self.savers,
            self.result_builder,
            final_vars,
            **self.data_saver_kwargs,
        )

    def _resolve_dependencies(self, fn_graph: graph.FunctionGraph) -> List[node.Node]:
        out = []
        missing_nodes = []
        for name in self.dependencies:
            if name in fn_graph.nodes:
                out.append(fn_graph.nodes[name])
            else:
                missing_nodes.append(name)
        if missing_nodes:
            raise ValueError(
                f"Materializer {self.id} has dependencies that are not in the graph: {missing_nodes}."
            )
        return [fn_graph.nodes[name] for name in self.dependencies]

    def generate_nodes(self, fn_graph: graph.FunctionGraph) -> List[node.Node]:
        """Generates additional nodes from a materializer, returning the set of nodes that should get
        appended to the function graph. This does two things:

        1. Adds a node that handles result-building
        2. Adds a node that handles data-saving, reusing the data saver functionality.

        :param graph: Function Graph to which we are adding the materializer
        :return: List of nodes to add to the graph
        """
        node_dependencies = self._resolve_dependencies(fn_graph)

        def join_function(**kwargs):
            return self.result_builder.build_result(**kwargs)

        out = []
        if self.result_builder is None:
            if len(node_dependencies) != 1:
                raise ValueError(
                    "Must specify result builder via combine= key word argument if the materializer has more than "
                    "one dependency it is materializing. Otherwise we have no way to join them and know what to pass! "
                    f"See materializer {self.id}."
                )
            save_dep = node_dependencies[0]
        else:
            join_node = node.Node(
                name=f"{self.id}_build_result",
                typ=self.result_builder.output_type(),
                doc_string=f"Builds the result for {self.id} materializer",
                callabl=join_function,
                input_types={dep.name: dep.type for dep in node_dependencies},
                originating_functions=(
                    None if self.result_builder is None else [self.result_builder.build_result]
                ),
            )
            out.append(join_node)
            save_dep = join_node

        out.append(
            # We can reuse the functionality in the save_to decorator
            SaveToDecorator(self.savers, self.id, **self.data_saver_kwargs).create_saver_node(
                save_dep, {}, save_dep.callable
            )
        )
        return out


@typing.runtime_checkable
class _MaterializerFactoryProtocol(Protocol):
    """Typing for the create_materializer_factory function"""

    def __call__(
        self,
        id: str,
        dependencies: List[str],
        combine: lifecycle.ResultBuilder = None,
        **kwargs: Union[str, SingleDependency],
    ) -> MaterializerFactory:
        pass


@typing.runtime_checkable
class _ExtractorFactoryProtocol(Protocol):
    def __call__(self, target: str, **kwargs: Union[str, SingleDependency]) -> ExtractorFactory:
        pass


def partial_materializer(data_savers: List[Type[DataSaver]]) -> _MaterializerFactoryProtocol:
    """Creates a partial materializer, with the specified data savers."""

    def create_materializer_factory(
        id: str,
        dependencies: List[str],
        combine: base.ResultMixin = None,
        **kwargs: typing.Any,
    ) -> MaterializerFactory:
        return MaterializerFactory(
            id=id,
            savers=data_savers,
            result_builder=combine,
            dependencies=dependencies,
            **kwargs,
        )

    return create_materializer_factory


def partial_extractor(
    data_loaders: List[Type[DataLoader]],
) -> _ExtractorFactoryProtocol:
    """Creates a partial materializer, with the specified data savers."""

    def create_extractor_factory(
        target: str,
        **kwargs: typing.Any,
    ) -> ExtractorFactory:
        return ExtractorFactory(
            target=target,
            loaders=data_loaders,
            **kwargs,
        )

    return create_extractor_factory


class Materialize(metaclass=materialization_meta__):
    """Materialize class to facilitate easy reference. Note that you should never need to refer
    to this directly. Rather, this should be referred as `to` in hamilton.io."""


class to(Materialize):
    """This is the entry point for Materialization. Note that this is coupled
    with the driver's materialize function -- properties are dynamically assigned
    based on data savers that have been registered, allowing you to call `to.csv`/`to.json`.
    For full documentation, see the documentation for the `materialize` function in the hamilton
    driver."""

    pass


class Extract(metaclass=extractor_meta__):
    """Extract class to facilitate easy reference. Note that you should never need to refer
    to this directly. Rather, this should be referred as `from_` in hamilton.io."""


class from_(Extract):
    """This is the entry point for Extraction. Note that this is coupled
    with the driver's materialize function -- properties are dynamically assigned
    based on data loaders that have been registered, allowing you to call `from_.csv`/`from_.json`.
    For full documentation, see the documentation for the `materialize` function in the hamilton
    driver.
    """


def _set_materializer_attrs():
    """Sets materialization attributes for easy reference. This sets it to the available keys.
    This is so one can get auto-complete"""

    def with_modified_signature(
        fn: Type[_MaterializerFactoryProtocol],
        dataclasses_union: List[Type[dataclasses.dataclass]],
        key: str,
    ):
        """Modifies the signature to include the parameters from *all* dataclasses.
        Note this just replaces **kwargs with the union of the parameters. Its not
        strictly correct, as (a) its a superset of the available ones and (b) it doesn't
        include the source/value parameters. However, this can help the development experience
        on jupyter notebooks, and is a good enough approximation for now.


        :param fn: Function to modify -- will change the signature.
        :param dataclasses_union: All dataclasses to union.
        :param key: Key to use for the materializer.
        :return: The function without **kwargs and with the union of the parameters.
        """
        original_signature = inspect.signature(fn)
        original_parameters = list(original_signature.parameters.values())

        new_parameters = []
        seen = set()
        for dataclass in dataclasses_union:
            for field in dataclasses.fields(dataclass):
                if field.name not in seen:
                    new_parameters.append(
                        inspect.Parameter(
                            field.name,
                            inspect.Parameter.KEYWORD_ONLY,
                            annotation=field.type,
                            default=None,
                        )
                    )
                seen.add(field.name)

        # Combining old and new parameters
        # Checking for position of **kwargs and insert new params before
        for idx, param in enumerate(original_parameters):  # noqa
            if param.kind == inspect.Parameter.VAR_KEYWORD:
                break
        else:
            idx = len(original_parameters)

        # Insert new parameters while respecting the order
        combined_parameters = original_parameters[:idx] + new_parameters + original_parameters[idx:]
        combined_parameters = [param for param in combined_parameters if param.name != "kwargs"]

        # Creating a new signature with combined parameters
        new_signature = original_signature.replace(parameters=combined_parameters)

        # Creating a new function with the new signature
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            bound_arguments = new_signature.bind(*args, **kwargs)
            return fn(*bound_arguments.args, **bound_arguments.kwargs)

        # Assign the new signature to the wrapper function
        wrapper.__signature__ = new_signature
        wrapper.__doc__ = f"""
        Materializes data to {key} format. Note that the parameters are a superset of possible parameters -- this might depend on
        the actual type of the data passed in. For more information, see: https://hamilton.dagworks.io/en/latest/reference/io/available-data-adapters/#data-loaders.
        You can also pass `source` and `value` in as kwargs.
        """
        return wrapper

    # Go through savers and loaders and add them to the class
    # This way we can access with from_.xyz/to.xyz
    for registry, cls_target, adapter_type, partial_factory in [
        (SAVER_REGISTRY, Materialize, DataSaver, partial_materializer),
        (LOADER_REGISTRY, Extract, DataLoader, partial_extractor),
    ]:
        for key, potential_loaders in registry.items():
            loaders = [loader for loader in potential_loaders if issubclass(loader, adapter_type)]
            if len(loaders) > 0:
                partial = partial_factory(potential_loaders)
                partial_with_signature = with_modified_signature(partial, potential_loaders, key)
                setattr(cls_target, key, partial_with_signature)
                cls_target.__annotations__[key] = type(partial_with_signature)


_set_materializer_attrs()


def modify_graph(
    fn_graph: FunctionGraph,
    materializer_factories: List[MaterializerFactory],
    extractor_factories: List[ExtractorFactory],
) -> FunctionGraph:
    """Modifies the function graph, adding in the specified materialization/loader nodes.

    Note that this is not simple -- adding materializers is different from adding loaders:
    1. Materializers can simply be appended to the beginning of the graph
    2. loaders (currently) function as "injected nodes", meaning they behave as overrides.
    We don't actually *feed* them in as overrides (as that would have to be a 2-pass process).
    Rather, we add them to the graph, then prune the paths that are upstream of *just them*,
    that can't possibly be executed

    :param graph: Graph to modify.
    :param materializer_factories: Materializer factories (created by to.xyz) to add to the graph
    :param extractor_factories: Loader factories (created by from_.xyz) to add to the graph
    :return: A new graph with the materializers.
    """
    materializer_nodes = []
    for materializer in materializer_factories:
        materializer_nodes.extend(materializer.generate_nodes(fn_graph))
    fn_graph = fn_graph.with_nodes({node_.name: node_ for node_ in materializer_nodes})
    loader_nodes = []
    # We want to treat this as an override
    # For now what we'll do is:
    # 1. Replace the nodes we're replacing
    # 2. Update dependencies
    # This will leave some dangling nodes, but we can deal with those later...
    for loader in extractor_factories:
        loader_nodes.extend(loader.generate_nodes(fn_graph))
    graph_nodes = fn_graph.nodes.copy()
    for loader_node in loader_nodes:
        graph_nodes[loader_node.name] = loader_node
    # Simpler to just create a new one
    # This leaks some details slightly -- E.G. how the dependencies work
    # We should probably add this as part of the functiong raph constructor?
    # For now this will be OK
    fn_graph = graph.FunctionGraph(
        nodes=update_dependencies(graph_nodes, fn_graph.adapter),
        config=fn_graph.config,
        adapter=fn_graph.adapter,
    )
    # TODO -- prune the nodes that are upstream *only* of the old loader nodes, and not
    return fn_graph
