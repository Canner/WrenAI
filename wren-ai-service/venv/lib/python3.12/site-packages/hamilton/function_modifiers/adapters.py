import inspect
import logging
import typing
from typing import Any, Callable, Collection, Dict, List, Optional, Tuple, Type

import typing_inspect

from hamilton import node
from hamilton.function_modifiers.base import (
    InvalidDecoratorException,
    NodeCreator,
    NodeInjector,
    SingleNodeNodeTransformer,
)
from hamilton.function_modifiers.dependencies import (
    LiteralDependency,
    ParametrizedDependency,
    UpstreamDependency,
)
from hamilton.htypes import custom_subclass_check
from hamilton.io.data_adapters import AdapterCommon, DataLoader, DataSaver
from hamilton.node import DependencyType
from hamilton.registry import LOADER_REGISTRY, SAVER_REGISTRY

logger = logging.getLogger(__name__)


class AdapterFactory:
    """Factory for data loaders. This handles the fact that we pass in source(...) and value(...)
    parameters to the data loaders."""

    def __init__(self, adapter_cls: Type[AdapterCommon], **kwargs: ParametrizedDependency):
        """Initializes an adapter factory. This takes in parameterized dependencies
        and stores them for later resolution.

        Note that this is not strictly necessary -- we could easily put this in the
        decorator, but I wanted to separate out/consolidate the logic between data savers and data
        loaders.

        :param adapter_cls: Class of the loader to create.
        :param kwargs: Keyword arguments to pass to the loader, as parameterized dependencies.
        """
        self.adapter_cls = adapter_cls
        self.kwargs = kwargs
        self.validate()

    def validate(self):
        """Validates that the loader class has the required arguments, and that
        the arguments passed in are valid.

        :raises InvalidDecoratorException: If the arguments are invalid.
        """
        required_args = self.adapter_cls.get_required_arguments()
        optional_args = self.adapter_cls.get_optional_arguments()
        missing_params = set(required_args.keys()) - set(self.kwargs.keys())
        extra_params = (
            set(self.kwargs.keys()) - set(required_args.keys()) - set(optional_args.keys())
        )
        if len(missing_params) > 0:
            raise InvalidDecoratorException(
                f"Missing required parameters for adapter : {self.adapter_cls}: {missing_params}. "
                f"Required parameters/types are: {required_args}. Optional parameters/types are: "
                f"{optional_args}. "
            )
        if len(extra_params) > 0:
            available_args = {**required_args, **optional_args}.keys()
            raise InvalidDecoratorException(
                f"Extra parameters for loader: {self.adapter_cls} {extra_params}. Choices for parameters are: "
                f"{available_args}."
            )

    def create_loader(self, **resolved_kwargs: Any) -> DataLoader:
        if not self.adapter_cls.can_load():
            raise InvalidDecoratorException(f"Adapter {self.adapter_cls} cannot load data.")
        return self.adapter_cls(**resolved_kwargs)

    def create_saver(self, **resolved_kwargs: Any) -> DataSaver:
        if not self.adapter_cls.can_save():
            raise InvalidDecoratorException(f"Adapter {self.adapter_cls} cannot save data.")
        return self.adapter_cls(**resolved_kwargs)


def resolve_kwargs(kwargs: Dict[str, Any]) -> Tuple[Dict[str, str], Dict[str, Any]]:
    """Resolves kwargs to a list of dependencies, and a dictionary of name
    to resolved literal values.

    :return: A tuple of the dependencies, and the resolved literal kwargs.
    """
    dependencies = {}
    resolved_kwargs = {}
    for name, dependency in kwargs.items():
        if isinstance(dependency, UpstreamDependency):
            dependencies[name] = dependency.source
        elif isinstance(dependency, LiteralDependency):
            resolved_kwargs[name] = dependency.value
        else:
            resolved_kwargs[name] = dependency
    return dependencies, resolved_kwargs


def resolve_adapter_class(
    type_: Type[Type], loader_classes: List[Type[AdapterCommon]]
) -> Optional[Type[AdapterCommon]]:
    """Resolves the loader class for a function. This will return the most recently
    registered loader class that applies to the injection type, hence the reversed order.

    :param fn: Function to inject the loaded data into.
    :return: The loader class to use.
    """
    applicable_adapters: List[Type[AdapterCommon]] = []
    loaders_with_any = []
    for loader_cls in reversed(loader_classes):
        # We do this here, rather than in applies_to, as its a bit of a special case
        # Any should always get last priority, as its very non-specific and should be able to
        # This is partially for backwards compatibility as we haven't always supported these -- including it now
        # would potentially use the wrong loader for production cases
        if Any in loader_cls.applicable_types():
            loaders_with_any.append(loader_cls)
        if loader_cls.applies_to(type_):
            applicable_adapters.append(loader_cls)
    if len(applicable_adapters) > 0:
        if len(applicable_adapters) > 1:
            logger.warning(
                f"More than one applicable adapter detected for {type_}. "
                f"Using the last one registered {applicable_adapters[0]}."
            )
        return applicable_adapters[0]
    if loaders_with_any:
        return loaders_with_any[0]
    return None


class LoadFromDecorator(NodeInjector):
    def __init__(
        self,
        loader_classes: typing.Sequence[Type[DataLoader]],
        inject_=None,
        **kwargs: ParametrizedDependency,
    ):
        """Instantiates a load_from decorator. This decorator will load from a data source,
        and

        :param inject: The name of the parameter to inject the data into.
        :param loader_cls: The data loader class to use.
        :param kwargs: The arguments to pass to the data loader.
        """
        self.loader_classes = loader_classes
        self.kwargs = kwargs
        self.inject = inject_

    def _select_param_to_inject(self, params: List[str], fn: Callable) -> str:
        """Chooses a parameter to inject, given the parameters available. If self.inject is None
        (meaning we inject the only parameter), then that's the one. If it is not None, then
        we need to ensure it is one of the available parameters, in which case we choose it.
        """
        if self.inject is None:
            if len(params) == 1:
                return params[0]
            raise InvalidDecoratorException(
                f"If the nodes produced by {fn.__qualname__} require multiple inputs, "
                f"you must pass `inject_` to the load_from decorator for "
                f"function: {fn.__qualname__}"
            )
        if self.inject not in params:
            raise InvalidDecoratorException(
                f"Parameter {self.inject} not required by nodes produced by {fn.__qualname__}"
            )
        return self.inject

    def get_loader_nodes(
        self, inject_parameter: str, load_type: Type[Type], namespace: str = None
    ) -> List[node.Node]:
        loader_cls = resolve_adapter_class(
            load_type,
            self.loader_classes,
        )
        if loader_cls is None:
            raise InvalidDecoratorException(
                f"Could not resolve loader for type: {load_type} given possibilities: {self.loader_classes} "
            )
        loader_factory = AdapterFactory(loader_cls, **self.kwargs)
        # dependencies is a map from param name -> source name
        # we use this to pass the right arguments to the loader.
        dependencies, resolved_kwargs = resolve_kwargs(self.kwargs)
        # we need to invert the dependencies so that we can pass
        # the right argument to the loader
        dependencies_inverted = {v: k for k, v in dependencies.items()}

        def load_data(
            __loader_factory: AdapterFactory = loader_factory,
            __load_type: Type[Type] = load_type,
            __resolved_kwargs=resolved_kwargs,
            __dependencies=dependencies_inverted,
            __optional_params=loader_cls.get_optional_arguments(),  # noqa: B008
            **input_kwargs: Any,
        ) -> Tuple[load_type, Dict[str, Any]]:
            input_args_with_fixed_dependencies = {
                __dependencies.get(key, key): value for key, value in input_kwargs.items()
            }
            kwargs = {**__resolved_kwargs, **input_args_with_fixed_dependencies}
            data_loader = __loader_factory.create_loader(**kwargs)
            return data_loader.load_data(load_type)

        def get_input_type_key(key: str) -> str:
            return key if key not in dependencies else dependencies[key]

        input_types = {
            get_input_type_key(key): (type_, DependencyType.REQUIRED)
            for key, type_ in loader_cls.get_required_arguments().items()
        }
        input_types.update(
            {
                dependencies[key]: (type_, DependencyType.OPTIONAL)
                for key, type_ in loader_cls.get_optional_arguments().items()
                if key in dependencies
            }
        )
        # Take out all the resolved kwargs, as they are not dependencies, and will be filled out
        # later
        input_types = {
            key: value for key, value in input_types.items() if key not in resolved_kwargs
        }

        # the loader node is the node that loads the data from the data source.
        loader_node = node.Node(
            name=f"{inject_parameter}",
            callabl=load_data,
            typ=Tuple[Dict[str, Any], load_type],
            input_types=input_types,
            tags={
                "hamilton.data_loader": True,
                "hamilton.data_loader.has_metadata": True,
                "hamilton.data_loader.source": f"{loader_cls.name()}",
                "hamilton.data_loader.classname": f"{loader_cls.__qualname__}",
                "hamilton.data_loader.node": inject_parameter,
            },
            namespace=(
                (namespace, "load_data") if namespace else ("load_data",)
            ),  # We want no namespace in this case
        )

        # the filter node is the node that takes the data from the data source, filters out
        # metadata, and feeds it in as a parameter. Note that this must have the same name as the
        # inject parameter

        def filter_function(_inject_parameter=inject_parameter, **kwargs):
            return kwargs[loader_node.name][0]  # filter it out

        filter_node = node.Node(
            name=f"{inject_parameter}",
            callabl=filter_function,
            typ=load_type,
            input_types={loader_node.name: loader_node.type},
            tags={
                "hamilton.data_loader": True,
                "hamilton.data_loader.has_metadata": False,
                "hamilton.data_loader.source": f"{loader_cls.name()}",
                "hamilton.data_loader.classname": f"{loader_cls.__qualname__}",
                "hamilton.data_loader.node": inject_parameter,
            },
            # This is a little sloppy -- we need to figure out the best way to handle namespacing
            # In reality we will likely be changing the API -- using the logging construct so we don't have
            # to have this weird DAG shape. For now, this solves the problem, and this is an internal component of the API
            # so we're good to go
            namespace=((namespace, "select_data") if namespace else ()),  # We want no namespace
        )
        return [loader_node, filter_node]

    def inject_nodes(
        self, params: Dict[str, Type[Type]], config: Dict[str, Any], fn: Callable
    ) -> Tuple[Collection[node.Node], Dict[str, str]]:
        """Generates two nodes:
        1. A node that loads the data from the data source, and returns that + metadata
        2. A node that takes the data from the data source, injects it into, and runs, the function.

        :param fn: The function to decorate.
        :param config: The configuration to use.
        :return: The resolved nodes
        """
        inject_parameter = self._select_param_to_inject(list(params.keys()), fn)
        load_type = params[inject_parameter]
        try:
            loader_node, filter_node = self.get_loader_nodes(
                inject_parameter, load_type, fn.__name__
            )
        except InvalidDecoratorException as e:
            raise InvalidDecoratorException(f"Cannot find : {fn.__qualname__}: {e}") from e

        return [loader_node, filter_node], {inject_parameter: filter_node.name}

    def _get_inject_parameter_from_function(self, fn: Callable) -> Tuple[str, Type[Type]]:
        """Gets the name of the parameter to inject the data into.

        :param fn: The function to decorate.
        :return: The name of the parameter to inject the data into.
        """
        sig = inspect.signature(fn)
        if self.inject is None:
            if len(sig.parameters) == 0:
                raise InvalidDecoratorException(
                    f"The function: {fn.__qualname__} has no parameters. "
                    f"The data loader functionality injects the loaded data "
                    f"into the function, so you must have at least one parameter."
                )
            if len(sig.parameters) != 1:
                raise InvalidDecoratorException(
                    f"If you have multiple parameters in the signature, "
                    f"you must pass `inject_` to the load_from decorator for "
                    f"function: {fn.__qualname__}"
                )
            inject = list(sig.parameters.keys())[0]

        else:
            if self.inject not in sig.parameters:
                raise InvalidDecoratorException(
                    f"Invalid inject parameter: {self.inject} for fn: {fn.__qualname__}"
                )
            inject = self.inject
        return inject, typing.get_type_hints(fn)[inject]

    def validate(self, fn: Callable):
        """Note that we actually do something a little clever here. While the decorator operates
        on the nodes in the subdag, we actually validate it against the function. This ensures that
        we're not doing a lot of weird dynamic things that inject parameters that aren't in the
        function.

        :param fn: Function that produces the data loader.
        """

        inject_parameter, type_ = self._get_inject_parameter_from_function(fn)
        cls = resolve_adapter_class(type_, self.loader_classes)
        if cls is None:
            raise InvalidDecoratorException(
                f"No loader class found for type: {type_} specified by "
                f"parameter: {inject_parameter} in function: {fn.__qualname__}"
            )
        loader_factory = AdapterFactory(cls, **self.kwargs)
        loader_factory.validate()


class load_from__meta__(type):
    """Metaclass for the load_from decorator. This is specifically to allow class access method.
    Note that there *is* another way to do this -- we couold add attributes dynamically on the
    class in registry, or make it a function that just proxies to the decorator. We can always
    change this up, but this felt like a pretty clean way of doing it, where we can decouple the
    registry from the decorator class.
    """

    def __getattr__(cls, item: str):
        if item in LOADER_REGISTRY:
            return load_from.decorator_factory(LOADER_REGISTRY[item])
        try:
            return super().__getattribute__(item)
        except AttributeError as e:
            raise AttributeError(
                f"No loader named: {item} available for {cls.__name__}. "
                f"Available loaders are: {LOADER_REGISTRY.keys()}. "
                f"If you've gotten to this point, you either (1) spelled the "
                f"loader name wrong, (2) are trying to use a loader that does"
                f"not exist (yet). For a list of available loaders, see: "
                f"https://hamilton.readthedocs.io/reference/io/available-data-adapters/#data"
                f"-loaders "
            ) from e


class load_from(metaclass=load_from__meta__):
    """Decorator to inject externally loaded data into a function. Ideally, anything that is not
    a pure transform should either call this, or accept inputs from an external location.

    This decorator functions by "injecting" a parameter into the function. For example,
    the following code will load the json file, and inject it into the function as the parameter
    `input_data`. Note that the path for the JSON file comes from another node called
    raw_data_path (which could also be passed in as an external input).

    .. code-block:: python

        @load_from.json(path=source("raw_data_path"))
        def raw_data(input_data: dict) -> dict:
            return input_data

    The decorator can also be used with `value` to inject a constant value into the loader.
    In the following case, we use the literal value "some/path.json" as the path to the JSON file.

    .. code-block:: python

        @load_from.json(path=value("some/path.json"))
        def raw_data(input_data: dict) -> dict:
            return input_data

    Note that, if neither `source` nor `value` is specified, the value will be passed in as a
    literal value.

    .. code-block:: python

        @load_from.json(path="some/path.json")
        def raw_data(input_data: dict) -> dict:
            return input_data

    You can also utilize the `inject_` parameter in the loader if you want to inject the data
    into a specific param. For example, the following code will load the json file, and inject it
    into the function as the parameter `data`.

    .. code-block:: python

        @load_from.json(path=source("raw_data_path"), inject_="data")
        def raw_data(data: dict, valid_keys: List[str]) -> dict:
            return [item for item in data if item in valid_keys]

    You can also utilize multiple data loaders with separate `inject_` parameters to
    load from multiple files.
    data loaders to a single function:

    .. code-block:: python

        @load_from.json(path=source("raw_data_path"), inject_="data")
        @load_from.json(path=source("raw_data_path2"), inject_="data2")
        def raw_data(data: dict, data2: dict) -> dict:
            return [item for item in data if item in data2]


    This is a highly pluggable functionality -- here's the basics of how it works:

    1. Every "key" (json above, but others include csv, literal, file, pickle, etc...) corresponds
    to a set of loader classes. For example, the json key corresponds to the JSONLoader class in
    default_data_loaders. They implement the classmethod `name`. Once they are registered with the
    central registry they pick

    2. Every data loader class (which are all dataclasses) implements the `load_targets` method,
    which returns a list of types it can load to. For example, the JSONLoader class can load data
    of type `dict`. Note that the set of potential loading candidate classes are evaluated in
    reverse order, so the most recently registered loader class is the one that is used. That
    way, you can register custom ones.

    3. The loader class is instantiated with the kwargs passed to the decorator. For example, the
    JSONLoader class takes a `path` kwarg, which is the path to the JSON file.

    4. The decorator then creates a node that loads the data, and modifies the node that runs the
    function to accept that. It also returns metadata (customizable at the loader-class-level) to
    enable debugging after the fact. This is unstructured, but can be used down the line to describe
    any metadata to help debug.

    The "core" hamilton library contains a few basic data loaders that can be implemented within
    the confines of python's standard library. pandas_extensions contains a few more that require
    pandas to be installed.

    Note that these can have `default` arguments, specified by defaults in the dataclass fields.
    For the full set of "keys" and "types" (e.g. load_from.json, etc...), look for all classes
    that inherit from `DataLoader` in the hamilton library. We plan to improve documentation shortly
    to make this discoverable.
    """

    def __call__(self, *args, **kwargs):
        return LoadFromDecorator(*args, **kwargs)

    @classmethod
    def decorator_factory(
        cls, loaders: typing.Sequence[Type[DataLoader]]
    ) -> Callable[..., LoadFromDecorator]:
        """Effectively a partial function for the load_from decorator. Broken into its own (
        rather than using functools.partial) as it is a little clearer to parse.

        :param loaders: Options of data loader classes to use
        :return: The data loader decorator.
        """

        def create_decorator(
            __loaders=tuple(loaders), inject_=None, **kwargs: ParametrizedDependency
        ):
            return LoadFromDecorator(__loaders, inject_=inject_, **kwargs)

        return create_decorator


class save_to__meta__(type):
    """See note on load_from__meta__ for details on how this works."""

    def __getattr__(cls, item: str):
        if item in SAVER_REGISTRY:
            return save_to.decorator_factory(SAVER_REGISTRY[item])
        try:
            return super().__getattribute__(item)
        except AttributeError as e:
            raise AttributeError(
                f"No saver named: {item} available for {cls.__name__}. "
                f"Available data savers are: {list(SAVER_REGISTRY.keys())}. "
                "If you've gotten to this point, you either (1) spelled the "
                "loader name wrong, (2) are trying to use a saver that does"
                "not exist (yet). For a list of available savers, see "
                "https://hamilton.dagworks.io/en/latest/reference/io/available-data-adapters/"
            ) from e


class SaveToDecorator(SingleNodeNodeTransformer):
    def __init__(
        self,
        saver_classes_: typing.Sequence[Type[DataSaver]],
        output_name_: str = None,
        target_: str = None,
        **kwargs: ParametrizedDependency,
    ):
        super(SaveToDecorator, self).__init__()
        self.artifact_name = output_name_
        self.saver_classes = saver_classes_
        self.kwargs = kwargs
        self.target = target_

    def create_saver_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> node.Node:
        artifact_name = self.artifact_name
        artifact_namespace = ()
        node_to_save = node_.name if self.target is None else self.target

        if artifact_name is None:
            artifact_name = node_to_save
            artifact_namespace = ("save",)

        type_ = node_.type
        saver_cls = resolve_adapter_class(
            type_,
            self.saver_classes,
        )
        if saver_cls is None:
            raise InvalidDecoratorException(
                f"No saver class found for type: {type_} specified by "
                f"output type: {type_} in node: {node_to_save} generated by "
                f"function: {fn.__qualname__}."
            )

        adapter_factory = AdapterFactory(saver_cls, **self.kwargs)
        dependencies, resolved_kwargs = resolve_kwargs(self.kwargs)
        dependencies_inverted = {v: k for k, v in dependencies.items()}

        def save_data(
            __adapter_factory=adapter_factory,
            __dependencies=dependencies_inverted,
            __resolved_kwargs=resolved_kwargs,
            __data_node_name=node_to_save,
            **input_kwargs,
        ) -> Dict[str, Any]:
            input_args_with_fixed_dependencies = {
                __dependencies.get(key, key): value for key, value in input_kwargs.items()
            }
            kwargs = {**__resolved_kwargs, **input_args_with_fixed_dependencies}
            data_to_save = kwargs[__data_node_name]
            kwargs = {k: v for k, v in kwargs.items() if k != __data_node_name}
            data_saver = __adapter_factory.create_saver(**kwargs)
            return data_saver.save_data(data_to_save)

        def get_input_type_key(key: str) -> str:
            return key if key not in dependencies else dependencies[key]

        input_types = {
            get_input_type_key(key): (type_, DependencyType.REQUIRED)
            for key, type_ in saver_cls.get_required_arguments().items()
        }
        input_types.update(
            {
                dependencies[key]: (type_, DependencyType.OPTIONAL)
                for key, type_ in saver_cls.get_optional_arguments().items()
                if key in dependencies
            }
        )
        # Take out all the resolved kwargs, as they are not dependencies, and will be filled out
        # later
        input_types = {
            key: value for key, value in input_types.items() if key not in resolved_kwargs
        }
        input_types[node_to_save] = (node_.type, DependencyType.REQUIRED)
        save_node = node.Node(
            name=artifact_name,
            callabl=save_data,
            typ=Dict[str, Any],
            input_types=input_types,
            namespace=artifact_namespace,
            tags={
                "hamilton.data_saver": True,
                "hamilton.data_saver.sink": f"{saver_cls.name()}",
                "hamilton.data_saver.classname": f"{saver_cls.__qualname__}",
            },
        )
        return save_node

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Transforms the node to a data saver.

        :param node_: Node to transform
        :param config: Config to use
        :param fn: Original function that generated the node
        :return: The transformed node
        """

        return [
            self.create_saver_node(node_, config, fn),
            node_,
        ]

    def validate(self, fn: Callable):
        pass


class save_to(metaclass=save_to__meta__):
    """Decorator that outputs data to some external source. You can think
    about this as the inverse of load_from.

    This decorates a function, takes the final node produced by that function
    and then appends an additional node that saves the output of that function.

    As the load_from decorator does, this decorator can be referred to in a
    dynamic way. For instance, @save_to.json will save the output of the function
    to a json file. Note that this means that the output of the function must
    be a dictionary (or subclass thereof), otherwise the decorator will fail.

    Looking at the json example:

    .. code-block:: python

        @save_to.json(path=source("raw_data_path"), output_name_="data_save_output")
        def final_output(data: dict, valid_keys: List[str]) -> dict:
            return [item for item in data if item in valid_keys]

    This adds a final node to the DAG with the name "data_save_output" that
    accepts the output of the function "final_output" and saves it to a json.
    In this case, the JSONSaver accepts a `path` parameter, which is provided
    by the upstream node (or input) named "raw_data_path". The `output_name_`
    parameter then says how to refer to the output of this node in the DAG.

    If you called this with the driver:

    .. code-block:: python

        dr = driver.Driver(my_module)
        output = dr.execute(["final_output"], {"raw_data_path": "/path/my_data.json"})

    You would *just* get the final result, and nothing would be saved.

    If you called this with the driver:

    .. code-block:: python

        dr = driver.Driver(my_module)
        output = dr.execute(["data_save_output"], {"raw_data_path": "/path/my_data.json"})

    You would get a dictionary of metadata (about the saving output), and the final result would
    be saved to a path.

    Note that you can also hardcode the path, rather than using a dependency:

    .. code-block:: python

        @save_to.json(path=value("/path/my_data.json"), output_name_="data_save_output")
        def final_output(data: dict, valid_keys: List[str]) -> dict:
            return [item for item in data if item in valid_keys]

    Note that, like the loader function, you can use literal values as kwargs and they'll get interpreted as values.
    If you needs savers, you should also look into `.materialize` on the driver -- it's a clean way to do this in a more
    ad-hoc/decoupled manner.

    If you want to layer savers, you'll have to use the target\\_ parameter, which tells the saver which node to use.

    .. code-block:: python

        @save_to.json(path=source("raw_data_path"), output_name_="data_save_output", target_="data")
        @save_to.json(path=source("raw_data_path2"), output_name_="data_save_output2", target_="data")
        def final_output(data: dict, valid_keys: List[str]) -> dict:
            return [item for item in data if item in valid_keys]

    """

    def __call__(self, *args, **kwargs):
        return SaveToDecorator(*args, **kwargs)

    @classmethod
    def decorator_factory(
        cls, savers: typing.Sequence[Type[DataSaver]]
    ) -> Callable[..., SaveToDecorator]:
        """Effectively a partial function for the load_from decorator. Broken into its own (
        rather than using functools.partial) as it is a little clearer to parse.

        :param savers: Candidate data savers
        :param loaders: Options of data loader classes to use
        :return: The data loader decorator.
        """

        def create_decorator(__savers=tuple(savers), **kwargs: ParametrizedDependency):
            return SaveToDecorator(__savers, **kwargs)

        return create_decorator


class dataloader(NodeCreator):
    """
    Decorator for specifying a data loading function within the Hamilton framework. This decorator
    is used to annotate functions that load data, allowing them to be treated specially in the Hamilton
    DAG (Directed Acyclic Graph). The decorated function should return a tuple
    containing the loaded data and a dictionary of metadata about the loading process.

    The `dataloader` decorator captures loading data metadata and ensures the function's return
    type is correctly annotated to be a tuple, where the first element is the loaded data and the
    second element is a dictionary containing metadata about the data loading process.

    **Downstream functions need only to depend on the type of data loaded.**

    Example Usage:
    --------------
    Assuming you have a function that loads data from a JSON file and you want to expose the metadata in
    your Hamilton DAG to be captured in the Hamilton UI / adapters:

    .. code-block:: python

        import pandas as pd
        from hamilton.function_modifiers import dataloader


        @dataloader()  # you need ()
        def load_json_data(json_path: str = "data/my_data.json") -> tuple[pd.DataFrame, dict]:
            '''Loads a dataframe from a JSON file.

            :return: A tuple containing two dictionaries:
                - The first dictionary contains the loaded JSON data as a dataframe
                - The second dictionary contains metadata about the loading process.
            '''
            # Load the data
            data = pd.read_json(json_path)

            # Metadata about the loading process
            metadata = {"source": json_path, "format": "json"}

            return data, metadata

    """

    def validate(self, fn: Callable):
        """Validates that the output type is correctly annotated."""
        return_annotation = typing.get_type_hints(fn).get("return")
        if return_annotation is inspect.Signature.empty:
            raise InvalidDecoratorException(
                f"Function: {fn.__qualname__} must have a return annotation."
            )
        # check that the type is a tuple[TYPE, dict]:
        if not typing_inspect.is_tuple_type(return_annotation):
            raise InvalidDecoratorException(f"Function: {fn.__qualname__} must return a tuple.")
        # check that there are two
        if len(typing_inspect.get_args(return_annotation)) != 2:
            raise InvalidDecoratorException(
                f"Function: {fn.__qualname__} must return a tuple of length 2."
            )
        # check that the second is a dict
        second_arg = typing_inspect.get_args(return_annotation)[1]
        if not (custom_subclass_check(second_arg, dict)):
            raise InvalidDecoratorException(
                f"Function: {fn.__qualname__} must return a tuple of type (SOME_TYPE, dict)."
            )
        second_arg_params = typing_inspect.get_args(second_arg)
        if (
            len(second_arg_params) > 0 and not second_arg_params[0] == str
        ):  # metadata must have string keys
            raise InvalidDecoratorException(
                f"Function: {fn.__qualname__} must return a tuple of type (SOME_TYPE, dict[str, ...]). Instead got (SOME_TYPE, dict[{second_arg_params[0]}, ...]"
            )

    def generate_nodes(self, fn: Callable, config) -> List[node.Node]:
        """Generates two nodes. We have to add tags appropriately.

        The first one is just the fn - with a slightly different name.
        The second one uses the proper function name, but only returns
        the first part of the tuple that the first returns.

        :param fn:
        :param config:
        :return:
        """
        _name = "loader"
        og_node = node.Node.from_fn(fn, name=_name)
        new_tags = og_node.tags.copy()
        new_tags.update(
            # we need this to be common with the loader tags above.
            {
                "hamilton.data_loader": True,
                "hamilton.data_loader.has_metadata": True,
                "hamilton.data_loader.node": f"{fn.__name__}",
                "hamilton.data_loader.classname": f"{fn.__name__}()",
                "hamilton.data_loader.source": _name,
            }
        )

        def filter_function(**kwargs):
            return kwargs[f"{fn.__name__}.{_name}"][0]

        filter_node = node.Node(
            name=fn.__name__,  # use original function name
            callabl=filter_function,
            typ=typing_inspect.get_args(og_node.type)[0],
            input_types={f"{fn.__name__}.{_name}": og_node.type},
            # we need this to be common with the loader tags above.
            tags={
                "hamilton.data_loader": True,
                "hamilton.data_loader.has_metadata": False,
                "hamilton.data_loader.node": f"{fn.__name__}",
                "hamilton.data_loader.classname": f"{fn.__name__}()",
                "hamilton.data_loader.source": fn.__name__,
            },
        )

        return [og_node.copy_with(tags=new_tags, namespace=(fn.__name__,)), filter_node]


class datasaver(NodeCreator):
    """
    Decorator for specifying a data saving function within the Hamilton framework. This decorator
    is used to annotate functions that save data, allowing them to be treated specially in the Hamilton
    DAG (Directed Acyclic Graph). The decorated function should return a dictionary containing metadata
    about the saving process.

    The `datasaver` decorator captures saving data metadata and ensures the function's return
    type is correctly annotated to be a dictionary, where the dictionary contains metadata about
    the data saving process, that then is exposed / captures for the Hamilton UI / adapters.

    Example Usage:
    --------------
    Assuming you have a function that saves data to a JSON file and you want to expose the metadata in
    your Hamilton DAG to be captured in the Hamilton UI / adapters:

    .. code-block:: python

        import pandas as pd
        from hamilton.function_modifiers import datasaver


        @datasaver()  # you need ()
        def save_json_data(data: pd.DataFrame, json_path: str = "data/my_saved_data.json") -> dict:
            '''Saves data to a JSON file and returns metadata about the saving process.

            :param data: The data to save.
            :param json_path: The path to save the data to.
            :return: metadata about what was saved.
            '''
            # Save the data
            with open(json_path, "w") as file:
                data.to_json(json_path)

            # Metadata about the saving process
            metadata = {"destination": json_path, "format": "json"}

            return metadata

    This function can now be used within the Hamilton framework as a node that saves data to
    a JSON file. The metadata returned alongside the data can be used for logging, debugging, or
    any other purpose that requires information about the data saving process as it can be pulled
    out by the Hamilton Tracker for the Hamilton UI or other adapters.
    """

    def validate(self, fn: Callable):
        """Validates that the function output is a dict type."""
        return_annotation = inspect.signature(fn).return_annotation
        if return_annotation is inspect.Signature.empty:
            raise InvalidDecoratorException(
                f"Function: {fn.__qualname__} must have a return annotation."
            )
        # check that the return type is a dict
        if return_annotation not in (dict, Dict):
            raise InvalidDecoratorException(f"Function: {fn.__qualname__} must return a dict.")

    def generate_nodes(self, fn: Callable, config) -> List[node.Node]:
        """Generates same node but all this does is add tags to it.
        :param fn:
        :param config:
        :return:
        """
        og_node = node.Node.from_fn(fn)
        new_tags = og_node.tags.copy()
        new_tags.update(
            # we need this to be common with the saver tags above.
            {
                "hamilton.data_saver": True,
                "hamilton.data_saver.sink": f"{og_node.name}",
                "hamilton.data_saver.classname": f"{fn.__name__}()",
            }
        )
        return [og_node.copy_with(tags=new_tags)]
