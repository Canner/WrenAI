from __future__ import annotations

import inspect
import logging
import typing
from collections import Counter, defaultdict
from typing import Any, Callable, Collection, Dict, List, Optional, Tuple, Type, Union

import pandas as pd

from hamilton import models, node
from hamilton.dev_utils.deprecation import deprecated
from hamilton.function_modifiers import base
from hamilton.function_modifiers.configuration import ConfigResolver, hamilton_exclude
from hamilton.function_modifiers.delayed import resolve as delayed_resolve
from hamilton.function_modifiers.dependencies import (
    LiteralDependency,
    SingleDependency,
    UpstreamDependency,
    source,
)

logger = logging.getLogger(__name__)

"""Decorators that replace a function's execution with specified behavior"""

# Python 3.10 + has this built in, otherwise we have to define it
try:
    from types import EllipsisType
except ImportError:
    EllipsisType = type(...)


# the following are empty functions that we can compare against to ensure that @does uses an empty function
def _empty_function():
    pass


def _empty_function_with_docstring():
    """Docstring for an empty function"""
    pass


def ensure_function_empty(fn: Callable):
    """
    Ensures that a function is empty. This is strict definition -- the function must have only one line (and
    possibly a docstring), and that line must say "pass".
    """
    if fn.__code__.co_code not in {
        _empty_function.__code__.co_code,
        _empty_function_with_docstring.__code__.co_code,
    }:
        raise base.InvalidDecoratorException(
            f"Function: {fn.__name__} is not empty. Must have only one line that "
            'consists of "pass"'
        )


class does(base.NodeCreator):
    """``@does`` is a decorator that essentially allows you to run a function over all the input parameters. \
    So you can't pass any old function to ``@does``, instead the function passed has to take any amount of inputs and \
    process them all in the same way.

    .. code-block:: python

        import pandas as pd
        from hamilton.function_modifiers import does
        import internal_package_with_logic

        def sum_series(**series: pd.Series) -> pd.Series:
            '''This function takes any number of inputs and sums them all together.'''
            ...

        @does(sum_series)
        def D_XMAS_GC_WEIGHTED_BY_DAY(D_XMAS_GC_WEIGHTED_BY_DAY_1: pd.Series,
                                      D_XMAS_GC_WEIGHTED_BY_DAY_2: pd.Series) -> pd.Series:
            '''Adds D_XMAS_GC_WEIGHTED_BY_DAY_1 and D_XMAS_GC_WEIGHTED_BY_DAY_2'''
            pass

        @does(internal_package_with_logic.identity_function)
        def copy_of_x(x: pd.Series) -> pd.Series:
            '''Just returns x'''
            pass

    The example here is a function, that all that it does, is sum all the parameters together. So we can annotate it \
    with the ``@does`` decorator and pass it the ``sum_series`` function. The ``@does`` decorator is currently limited \
    to just allow functions that consist only of one argument, a generic \\*\\*kwargs.
    """

    def __init__(self, replacing_function: Callable, **argument_mapping: Union[str, List[str]]):
        """Constructor for a modifier that replaces the annotated functions functionality with something else.
        Right now this has a very strict validation requirements to make compliance with the framework easy.

        :param replacing_function: The function to replace the original function with.
        :param argument_mapping: A mapping of argument name in the replacing function to argument name in the \
        decorating function.
        """
        self.replacing_function = replacing_function
        self.argument_mapping = argument_mapping

    @staticmethod
    def map_kwargs(kwargs: Dict[str, Any], argument_mapping: Dict[str, str]) -> Dict[str, Any]:
        """Maps kwargs using the argument mapping.
        This does 2 things:
        1. Replaces all kwargs in passed_in_kwargs with their mapping
        2. Injects all defaults from the origin function signature

        :param kwargs: Keyword arguments that will be passed into a hamilton function.
        :param argument_mapping: Mapping of those arguments to a replacing function's arguments.
        :return: The new kwargs for the replacing function's arguments.
        """
        output = {**kwargs}
        for arg_mapped_to, original_arg in argument_mapping.items():
            if original_arg in kwargs and arg_mapped_to not in argument_mapping.values():
                del output[original_arg]
            # Note that if it is not there it could be a **kwarg
            output[arg_mapped_to] = kwargs[original_arg]
        return output

    @staticmethod
    def test_function_signatures_compatible(
        fn_signature: inspect.Signature,
        replace_with_signature: inspect.Signature,
        argument_mapping: Dict[str, str],
    ) -> bool:
        """Tests whether a function signature and the signature of the replacing function are compatible.

        :param fn_signature:
        :param replace_with_signature:
        :param argument_mapping:
        :return: True if they're compatible, False otherwise
        """
        # The easy (and robust) way to do this is to use the bind with a set of dummy arguments and test if it breaks.
        # This way we're not reinventing the wheel.
        SENTINEL_ARG_VALUE = ...  # does not matter as we never use it
        # We initialize as the default values, as they'll always be injected in
        dummy_param_values = {
            key: SENTINEL_ARG_VALUE
            for key, param_spec in fn_signature.parameters.items()
            if param_spec.default is not inspect.Parameter.empty
        }
        # Then we update with the dummy values. Again, replacing doesn't matter (we'll be mimicking it later)
        dummy_param_values.update({key: SENTINEL_ARG_VALUE for key in fn_signature.parameters})
        dummy_param_values = does.map_kwargs(dummy_param_values, argument_mapping)
        try:
            # Python signatures have a bind() capability which does exactly what we want to do
            # Throws a type error if it is not valid
            replace_with_signature.bind(**dummy_param_values)
        except TypeError:
            return False
        return True

    @staticmethod
    def ensure_function_signature_compatible(
        og_function: Callable,
        replacing_function: Callable,
        argument_mapping: Dict[str, str],
    ):
        """Ensures that a function signature is compatible with the replacing function, given the argument mapping

        :param og_function: Function that's getting replaced (decorated with `@does`)
        :param replacing_function: A function that gets called in its place (passed in by `@does`)
        :param argument_mapping: The mapping of arguments from fn to replace_with
        :return:
        """
        fn_parameters = inspect.signature(og_function).parameters
        invalid_fn_parameters = []
        for param_name, param_spec in fn_parameters.items():
            if param_spec.kind not in {
                inspect.Parameter.KEYWORD_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            }:
                invalid_fn_parameters.append(param_name)

        if invalid_fn_parameters:
            raise base.InvalidDecoratorException(
                f"Decorated function for @does (and really, all of hamilton), "
                f"can only consist of keyword-friendly arguments. "
                f"The following parameters for {og_function.__name__} are not keyword-friendly: {invalid_fn_parameters}"
            )
        if not does.test_function_signatures_compatible(
            inspect.signature(og_function),
            inspect.signature(replacing_function),
            argument_mapping,
        ):
            raise base.InvalidDecoratorException(
                f"The following function signatures are not compatible for use with @does: "
                f"{og_function.__name__} with signature {inspect.signature(og_function)} "
                f"and replacing function {replacing_function.__name__} with signature {inspect.signature(replacing_function)}. "
                f"Mapping for arguments provided was: {argument_mapping}. You can fix this by either adjusting "
                f"the signature for the replacing function *or* adjusting the mapping."
            )

    def validate(self, fn: Callable):
        """Validates that the function:
        - Is empty (we don't want to be overwriting actual code)
        - Has a compatible return type
        - Matches the function signature with the appropriate mapping
        :param fn: Function to validate
        :raises: InvalidDecoratorException
        """
        ensure_function_empty(fn)
        does.ensure_function_signature_compatible(
            fn, self.replacing_function, self.argument_mapping
        )

    def generate_nodes(self, fn: Callable, config) -> List[node.Node]:
        """Returns one node which has the replaced functionality
        :param fn: Function to decorate
        :param config: Configuration (not used in this)
        :return: A node with the function in `@does` injected,
        and the same parameters/types as the original function.
        """

        def wrapper_function(**kwargs):
            final_kwarg_values = {
                key: param_spec.default
                for key, param_spec in inspect.signature(fn).parameters.items()
                if param_spec.default is not inspect.Parameter.empty
            }
            final_kwarg_values.update(kwargs)
            final_kwarg_values = does.map_kwargs(final_kwarg_values, self.argument_mapping)
            return self.replacing_function(**final_kwarg_values)

        return [node.Node.from_fn(fn).copy_with(callabl=wrapper_function)]


def get_default_tags(fn: Callable) -> Dict[str, str]:
    """Function that encapsulates default tags on a function.

    :param fn: the function we want to create default tags for.
    :return: a dictionary with str -> str values representing the default tags.
    """
    module_name = inspect.getmodule(fn).__name__
    return {"module": module_name}


@deprecated(
    warn_starting=(1, 20, 0),
    fail_starting=(2, 0, 0),
    use_this=delayed_resolve,
    explanation="dynamic_transform has been replaced with @resolve -- a cleaner way"
    "to utilize config for resolving decorators. Note this allows you to use any"
    "existing decorators.",
    current_version=(1, 19, 0),
    migration_guide="https://hamilton.dagworks.io/en/latest/reference/decorators/",
)
class dynamic_transform(base.NodeCreator):
    def __init__(
        self,
        transform_cls: Type[models.BaseModel],
        config_param: str,
        **extra_transform_params,
    ):
        """Constructs a model. Takes in a model_cls, which has to have a parameter."""
        self.transform_cls = transform_cls
        self.config_param = config_param
        self.extra_transform_params = extra_transform_params

    def validate(self, fn: Callable):
        """Validates that the model works with the function -- ensures:
        1. function has no code
        2. function has no parameters
        3. function has series as a return type
        :param fn: Function to validate
        :raises InvalidDecoratorException if the model is not valid.
        """

        ensure_function_empty(fn)  # it has to look exactly
        signature = inspect.signature(fn)
        if not issubclass(typing.get_type_hints(fn).get("return"), pd.Series):
            raise base.InvalidDecoratorException(
                "Models must declare their return type as a pandas Series"
            )
        if len(signature.parameters) > 0:
            raise base.InvalidDecoratorException(
                "Models must have no parameters -- all are passed in through the config"
            )

    def generate_nodes(self, fn: Callable, config: Dict[str, Any] = None) -> List[node.Node]:
        if self.config_param not in config:
            raise base.InvalidDecoratorException(
                f"Configuration has no parameter: {self.config_param}. Did you define it? If so did you spell it right?"
            )
        fn_name = fn.__name__
        transform = self.transform_cls(
            config[self.config_param], fn_name, **self.extra_transform_params
        )
        return [
            node.Node(
                name=fn_name,
                typ=typing.get_type_hints(fn).get("return"),
                doc_string=fn.__doc__,
                callabl=transform.compute,
                input_types={dep: pd.Series for dep in transform.get_dependents()},
                tags=get_default_tags(fn),
            )
        ]

    def require_config(self) -> List[str]:
        """Returns the configuration parameters that this model requires

        :return: Just the one config param used by this model
        """
        return [self.config_param]


class model(dynamic_transform):
    """Model, same as a dynamic transform"""

    def __init__(self, model_cls, config_param: str, **extra_model_params):
        super(model, self).__init__(
            transform_cls=model_cls, config_param=config_param, **extra_model_params
        )


NamespaceType = Union[str, EllipsisType, None]


class Applicable:
    """Applicable is a largely internal construct that represents a function that can be applied as a node.
    A few of these function are external-facing, however (named, when, when_not, ...)"""

    def __init__(
        self,
        fn: Union[Callable, str, None],
        args: Tuple[Union[Any, SingleDependency], ...],
        kwargs: Dict[str, Union[Any, SingleDependency]],
        target_fn: Union[Callable, str, None] = None,
        _resolvers: List[ConfigResolver] = None,
        _name: Optional[str] = None,
        _namespace: Union[str, None, EllipsisType] = ...,
        _target: base.TargetType = None,
    ):
        """Instantiates an Applicable.

        We allow fn=None for the use-cases where we want to store the Applicable config (i.e. .when* family, namespace, target, etc.)
        but do not yet the access to the actual function we are turning into the Applicable. In addition, in case the target nodes come
        from a function (using extract_columns/extract_fields) we can pass target_fn to have access to its pointer that we can decorate
        programmatically. See `apply_to` and `mutate` for an example.

        :param args: Args (*args) to pass to the function
        :param fn: Function it takes in. Can be None to create an Applicable placeholder with delayed choice of function.
        :param target_fn: Function the applicable will be applied to
        :param _resolvers: Resolvers to use for the function
        :param _name: Name of the node to be created
        :param _namespace: Namespace of the node to be created -- currently only single-level namespaces are supported
        :param _target: Selects which target nodes it will be appended onto. Default None gets resolved on decorator level.
            Specifically, pipe_input would use the first parameter and pipe_output / mutate would apply it to all sink nodes.
        :param kwargs: Kwargs (**kwargs) to pass to the function
        """

        if isinstance(fn, str) or isinstance(target_fn, str):
            raise TypeError("Strings are not supported currently. Please provide function pointer.")

        self.fn = fn
        self.target_fn = target_fn

        if "_name" in kwargs:
            raise ValueError("Cannot pass in _name as a kwarg")

        self.kwargs = {key: value for key, value in kwargs.items() if key != "__name"}  # TODO --
        self.args = args
        # figure out why this was showing up in two places...
        self.resolvers = _resolvers if _resolvers is not None else []
        self.name = _name
        self.namespace = _namespace
        self.target = _target

    def _with_resolvers(self, *additional_resolvers: ConfigResolver) -> "Applicable":
        """Helper function for the .when* group"""
        return Applicable(
            fn=self.fn,
            _resolvers=self.resolvers + list(additional_resolvers),
            _name=self.name,
            _namespace=self.namespace,
            _target=self.target,
            args=self.args,
            kwargs=self.kwargs,
            target_fn=self.target_fn,
        )

    def when(self, **key_value_pairs) -> "Applicable":
        """Choose to apply this function when all of the keys in the function
        are present in the config, and the values match the values in the config.

        :param key_value_pairs: key/value pairs to match
        :return: The Applicable with this condition applied
        """
        return self._with_resolvers(ConfigResolver.when(**key_value_pairs))

    def when_not(self, **key_value_pairs) -> "Applicable":
        """Choose to apply this function when all of the keys specified
        do not match the values specified in the config.

        :param key_value_pairs: key/value pairs to match
        :return: The Applicable with this condition applied
        """
        return self._with_resolvers(ConfigResolver.when_not(**key_value_pairs))

    def when_in(self, **key_value_group_pairs: list) -> "Applicable":
        """Choose to apply this function when all the keys provided have values contained within the list of values
        specified

        :param key_value_group_pairs: key/value pairs to match
        :return:  The Applicable with this condition applied
        """
        return self._with_resolvers(ConfigResolver.when_in(**key_value_group_pairs))

    def when_not_in(self, **key_value_group_pairs: list) -> "Applicable":
        """Choose to apply this function when all the keys provided have values not contained within the list of values
        specified.

        :param key_value_group_pairs: key/value pairs to match
        :return:  The Applicable with this condition applied
        """

        return self._with_resolvers(ConfigResolver.when_not_in(**key_value_group_pairs))

    def namespaced(self, namespace: NamespaceType) -> "Applicable":
        """Add a namespace to this node. You probably don't need this -- you should look at "named" instead.

        :param namespace: Namespace to apply, can be ..., None, or a string.
        :return: The Applicable with this namespace
        """
        return Applicable(
            fn=self.fn,
            _resolvers=self.resolvers,
            _name=self.name,
            _namespace=namespace,
            _target=self.target,
            args=self.args,
            kwargs=self.kwargs,
            target_fn=self.target_fn,
        )

    def resolves(self, config: Dict[str, Any]) -> bool:
        """Returns whether the Applicable resolves with the given config

        :param config: Configuration to check
        :return: Whether the Applicable resolves with the given config
        """
        for resolver in self.resolvers:
            if not resolver(config):
                return False
        return True

    def named(self, name: str, namespace: NamespaceType = ...) -> "Applicable":
        """Names the function application. This has the following rules:
        1. The name will be the name passed in, this is required
        2. If the namespace is `None`, then there will be no namespace
        3. If the namespace is `...`, then the namespace will be the namespace that already exists, usually the name of the
        function that this is decorating. This is an odd case -- but it helps if you have
        multiple of the same type of operations that you want to apply across different nodes,
        or in the case of a parameterization (which is not yet supported).

        :param name: Name of the node to be created
        :param namespace: Namespace of the node to be created -- currently only single-level namespaces are supported
        :return: The applicable with the new name
        """
        return Applicable(
            fn=self.fn,
            _resolvers=self.resolvers,
            _name=name if name is not None else self.name,
            _namespace=(
                None
                if namespace is None
                else (namespace if namespace is not ... else self.namespace)
            ),
            _target=self.target,
            args=self.args,
            kwargs=self.kwargs,
            target_fn=self.target_fn,
        )

    # on_input / on_output are the same but here for naming convention
    # I know there is a way to dynamically resolve this to revert to a common function
    # just can't remember it now or find it online...
    # TODO: adding the option to select target parameter for each transform
    # def on_input(self, target: base.TargetType) -> "Applicable":
    #     """Add Target on a single function level.

    #     This determines to which node(s) it will applies. Should match the same naming convention
    #     as the NodeTransorfmLifecycle child class (for example NodeTransformer).

    #     :param target: Which node(s) to apply on top of
    #     :return: The Applicable with specified target
    #     """
    #     return Applicable(
    #         fn=self.fn,
    #         _resolvers=self.resolvers,
    #         _name=self.name,
    #         _namespace=self.namespace,
    #         _target=target if target is not None else self.target,
    #         args=self.args,
    #         kwargs=self.kwargs,
    #         target_fn=self.target_fn,
    #     )

    def on_output(self, target: base.TargetType) -> "Applicable":
        """Add Target on a single function level.

        This determines to which node(s) it will applies. Should match the same naming convention
        as the NodeTransorfmLifecycle child class (for example NodeTransformer).

        :param target: Which node(s) to apply on top of
        :return: The Applicable with specified target
        """
        return Applicable(
            fn=self.fn,
            _resolvers=self.resolvers,
            _name=self.name,
            _namespace=self.namespace,
            _target=target if target is not None else self.target,
            args=self.args,
            kwargs=self.kwargs,
            target_fn=self.target_fn,
        )

    def get_config_elements(self) -> List[str]:
        """Returns the config elements that this Applicable uses"""
        out = []
        for resolver in self.resolvers:
            out.extend(resolver.optional_config)
        return out

    def validate(self, chain_first_param: bool, allow_custom_namespace: bool):
        """Validates that the Applicable function can be applied given the
        set of args/kwargs passed in. This says that:

        1. The signature binds appropriately
        2. If we chain the first parameter, it is not present in the function

        Note that this is currently restrictive. We only support hamilton-friendly functions. Furthermore,
        this logic is slightly duplicated from `@does` above. We will be suporting more function shapes (in
        both this and `@does`) over time, and also combining the logic between the two for
        validating/binding signatures.

        :param chain_first_param: Whether we chain the first parameter
        :raises InvalidDecoratorException if the function cannot be applied
        :return:
        """
        args = ((...,) if chain_first_param else ()) + tuple(self.args)  # dummy argument at first
        sig = inspect.signature(self.fn)
        if len(sig.parameters) == 0:
            raise base.InvalidDecoratorException(
                f"Function: {self.fn.__name__} has no parameters. "
                f"You cannot apply a function with no parameters."
            )
        invalid_args = [
            item
            for item in inspect.signature(self.fn).parameters.values()
            if item.kind
            not in {
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                inspect.Parameter.KEYWORD_ONLY,
            }
        ]
        if len(invalid_args) > 0:
            raise base.InvalidDecoratorException(
                f"Function: {self.fn.__name__} has invalid parameters. "
                "You cannot apply a function with parameters that are not keyword-friendly. "
                f"The following parameters are not keyword-friendly: {invalid_args}"
            )
        try:
            sig.bind(*args, **self.kwargs)
        except TypeError as e:
            raise base.InvalidDecoratorException(
                f"Function: {self.fn.__name__} cannot be applied with the following args: {self.args} "
                f"and the following kwargs: {self.kwargs}"
            ) from e
        if len(sig.parameters) == 0:
            raise base.InvalidDecoratorException(
                f"Function: {self.fn.__name__} has no parameters. "
                "You cannot apply a function with no parameters."
            )
        if self.namespace is not ... and not allow_custom_namespace:
            raise base.InvalidDecoratorException(
                "Currently, setting namespace globally inside "
                "pipe(...)/flow(...) is not compatible with setting namespace "
                "for a step(...) call."
            )
        try:
            node.Node.from_fn(self.fn)
        except ValueError as e:
            raise base.InvalidDecoratorException(
                f"Function: {self.fn.__name__} cannot be applied with the following args: {self.args} "
                f"and the following kwargs: {self.kwargs}. See documentation on pipe(), the function "
                "shapes are currently restrictive to anything with named kwargs (either kwarg-only or positional/kwarg arguments), "
                "and must be typed. If you need functions that don't have these requirements, please reach out to the Hamilton team."
                "Current workarounds are to define a wrapper function that assigns types with the proper keyword-friendly arguments."
            ) from e

    def resolve_namespace(self, default_namespace: str) -> Tuple[str, ...]:
        """Resolves the namespace -- see rules in `named` for more details.

        :param default_namespace: namespace to use as a default if we do not wish to override it
        :return: The namespace to use, as a tuple (hierarchical)
        """
        return (
            (default_namespace,)
            if self.namespace is ...
            else (self.namespace,)
            if self.namespace is not None
            else ()
        )

    def bind_function_args(
        self, current_param: Optional[str]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Binds function arguments, given current, chained parameter

        :param current_param: Current, chained parameter. None, if we're not chaining.
        :return: A tuple of (upstream_inputs, literal_inputs)
        """
        args_to_bind = self.args
        if current_param is not None:
            args_to_bind = (source(current_param),) + args_to_bind
        kwargs_to_bind = self.kwargs
        fn_signature = inspect.signature(self.fn)
        bound_signature = fn_signature.bind(*args_to_bind, **kwargs_to_bind)
        all_kwargs = {**bound_signature.arguments, **bound_signature.kwargs}
        upstream_inputs = {}
        literal_inputs = {}
        # TODO -- restrict to ensure that this covers *all* dependencies
        # TODO -- bind to parameters using args
        for dep, value in all_kwargs.items():
            if isinstance(value, UpstreamDependency):
                upstream_inputs[dep] = value.source
            elif isinstance(value, LiteralDependency):
                literal_inputs[dep] = value.value
            else:
                literal_inputs[dep] = value

        return upstream_inputs, literal_inputs


def step(
    fn, *args: Union[SingleDependency, Any], **kwargs: Union[SingleDependency, Any]
) -> Applicable:
    """Applies a function to for a node (or a subcomponent of a node).
    See documentation for `pipe` to see how this is used.

    :param fn: Function to use. Must be validly called as f(**kwargs), and have a 1:1 mapping of kwargs to parameters.
    :param args: Args to pass to the function -- although these cannot be variable/position-only arguments, they can be
    positional arguments. If these are not source/value, they will be converted to a value (a literal)
    :param kwargs: Kwargs to pass to the function. These can be source/value, or they can be literals. If they are literals,
    they will be converted to a value (a literal)
    :return: an applicable with the function applied
    """
    return Applicable(fn=fn, _resolvers=[], args=args, kwargs=kwargs)


# TODO: In case of multiple parameter targets we want to safeguard that it is a clear target distribution
# class MissingTargetError(Exception):
#     """When setting target make sure it is clear which transform targets which node.

#     This is a safeguard, because the default behavior may not apply if targets are partially set
#     and we do not want to make assumptions what the user meant.
#     """

#     pass


class pipe_input(base.NodeInjector):
    """Running a series of transformations on the input of the function.

    To demonstrate the rules for chaining nodes, we'll be using the following example. This is
    using primitives to demonstrate, but as hamilton is just functions of any python objects, this works perfectly with
    dataframes, series, etc...


    .. code-block:: python
        :name: Simple @pipe_input example

        from hamilton.function_modifiers import step, pipe_input, value, source


        def _add_one(x: int) -> int:
            return x + 1


        def _sum(x: int, y: int) -> int:
            return x + y


        def _multiply(x: int, y: int, z: int = 10) -> int:
            return x * y * z


        @pipe_input(
            step(_add_one),
            step(_multiply, y=2),
            step(_sum, y=value(3)),
            step(_multiply, y=source("upstream_node_to_multiply")),
        )
        def final_result(upstream_int: int) -> int:
            return upstream_int

    .. code-block:: python
        :name: Equivalent example with no @pipe_input, nested

        upstream_int = ...  # result from upstream
        upstream_node_to_multiply = ...  # result from upstream

        output = final_result(
            _multiply(
                _sum(
                    _multiply(
                        _add_one(upstream_int),
                        y=2
                    ),
                    y=3
                ),
                y=upstream_node_to_multiply
            )
        )

    .. code-block:: python
        :name: Equivalent example with no @pipe_input, procedural

        upstream_int = ...  # result from upstream
        upstream_node_to_multiply = ...  # result from upstream

        one_added = _add_one(upstream_int)
        multiplied = _multiply(one_added, y=2)
        summed = _sum(multiplied, y=3)
        multiplied_again = _multiply(summed, y=upstream_node_to_multiply)
        output = final_result(multiplied_again)


    Note that functions must have no position-only arguments (this is rare in python, but hamilton does not handle these).
    This basically means that the functions must be defined similarly to ``def fn(x, y, z=10)`` and not ``def fn(x, y, /, z=10)``.
    In fact, all arguments must be named and "kwarg-friendly", meaning that the function can happily be called with ``**kwargs``,
    where kwargs are some set of resolved upstream values. So, no ``*args`` are allowed, and ``**kwargs`` (variable keyword-only) are not
    permitted. Note that this is not a design limitation, rather an implementation detail -- if you feel like you need this, please
    reach out.

    Furthermore, the function should be typed, as a Hamilton function would be.

    One has three ways to tune the shape/implementation of the subsequent nodes:

    1. ``when``/``when_not``/``when_in``/``when_not_in`` -- these are used to filter the application of the function.
        This is valuable to reflect if/else conditions in the structure of the DAG, pulling it out of functions, rather
        than buried within the logic itself. It is functionally equivalent to ``@config.when``.

        For instance, if you want to include a function in the chain only when a config parameter is set to a certain value, you can do:

        .. code-block:: python

            @pipe_input(
                step(_add_one).when(foo="bar"),
                step(_add_two, y=source("other_node_to_add").when(foo="baz"),
            )
            def final_result(upstream_int: int) -> int:
                return upstream_int

        This will only apply the first function when the config parameter ``foo`` is set to ``bar``, and the second when it is set to ``baz``.

    2. ``named`` -- this is used to name the node. This is useful if you want to refer to intermediate results.
        If this is left out, hamilton will automatically name the functions in a globally unique manner. The names of
        these functions will not necessarily be stable/guaranteed by the API, so if you want to refer to them, you should use ``named``.
        The default namespace will always be the name of the decorated function (which will be the last node in the chain).

        ``named`` takes in two parameters -- required is the ``name`` -- this will assign the nodes with a single name and *no* global namespace.
        For instance:

        .. code-block:: python

            @pipe_input(
                step(_add_one).named("a"),
                step(_add_two, y=source("upstream_node")).named("b"),
            )
            def final_result(upstream_int: int) -> int:
                return upstream_int

        The above will create two nodes, ``a`` and ``b``. ``a`` will be the result of ``_add_one``, and ``b`` will be the result of ``_add_two``.
        ``final_result`` will then be called with the output of ``b``. Note that, if these are part of a namespaced operation (a subdag, in particular),
        they *will* get the same namespace as the subdag.

        The second parameter is ``namespace``. This is used to specify a namespace for the node. This is useful if you want
        to either (a) ensure that the nodes are namespaced but share a common one to avoid name clashes (usual case), or (b)
        if you want a custom namespace (unusual case). To indicate a custom namespace, one need simply pass in a string.

        To indicate that a node should share a namespace with the rest of the step(...) operations in a pipe, one can pass in ``...`` (the ellipsis).

        .. code-block:: python
          :name: Namespaced step


            @pipe_input(
                step(_add_one).named("a", namespace="foo"),  # foo.a
                step(_add_two, y=source("upstream_node")).named("b", namespace=...),  # final_result.b
            )
            def final_result(upstream_int: int) -> int:
                return upstream_int

        Note that if you pass a namespace argument to the ``pipe_input`` function, it will set the namespace on each step operation.
        This is useful if you want to ensure that all the nodes in a pipe have a common namespace, but you want to rename them.

        .. code-block:: python
            :name: pipe_input with globally applied namespace

            @pipe_input(
                step(_add_one).named("a"), # a
                step(_add_two, y=source("upstream_node")).named("b"), # foo.b
                namespace=..., # default -- final_result.a and final_result.b, OR
                namespace=None, # no namespace -- a and b are exposed as that, OR
                namespace="foo", # foo.a and foo.b
            )
            def final_result(upstream_int: int) -> int:
                return upstream_int

        In all likelihood, you should not be using this, and this is only here in case you want to expose a node for
        consumption/output later. Setting the namespace in individual nodes as well as in ``pipe_input`` is not yet supported.

    3. ``on_input`` -- this selects which input we will run the pipeline on.
        In case ``on_input`` is set to None (default), we apply ``pipe_input`` on the first parameter. Let us know if you wish to expand to other use-cases.
        You can track the progress on this topic via: https://github.com/DAGWorks-Inc/hamilton/issues/1177

        The following would apply function *_add_one* and *_add_two* to ``p2``:

        .. code-block:: python

            @pipe_input(
                step(_add_one)
                step(_add_two, y=source("upstream_node")),
                on_input = "p2"
            )
            def final_result(p1: int, p2: int, p3: int) -> int:
                return upstream_int

        .. |
            THIS IS COMMENTED OUT, I.E. SPHINX WILL NOT AUTODOC IT, HERE IN CASE WE ENABLE MULTIPLE PARAMETER TARGETS
            For extra control in case of multiple function arguments (parameters), we can also specify the target parameter that we wish to transform.
            In case ``on_input`` is set to None (default), we apply ``pipe_input`` on the first parameter only. If ``on_input`` is set for a specific transform
            make sure the other ones are also set either through a global setting or individually, otherwise it is unclear which transforms target which parameters.

            The following applies *_add_one* to ``p1``, ``p3`` and *_add_two* to ``p2``

            .. code-block:: python

                @pipe_input(
                    step(_add_one).on_input(["p1","p3"])
                    step(_add_two, y=source("upstream_node")).on_input("p2")
                )
                def final_result(p1: int, p2: int, p3: int) -> int:
                    return p1 + p2 + p3

            We can also do this on the global level to set for all transforms a target parameter.

            Lastly, a mixture of global and local is possible, where the global selects the target parameters for
            all transforms and we can select individual transforms to also target more parameters.
            The following would apply function *_add_one* to all ``p1``, ``p2``, ``p3`` and *_add_two* also on ``p2``

            .. code-block:: python

                @pipe_input(
                    step(_add_one).on_input(["p1","p3"])
                    step(_add_two, y=source("upstream_node")),
                    on_input = "p2"
                )
                def final_result(p1: int, p2: int, p3: int) -> int:
                    return upstream_int
            | replace:: \
    """

    def __init__(
        self,
        *transforms: Applicable,
        namespace: NamespaceType = ...,
        on_input: base.TargetType = None,
        collapse=False,
        _chain=False,
    ):
        """Instantiates a ``@pipe_input`` decorator.

        :param transforms: step transformations to be applied, in order
        :param namespace: namespace to apply to all nodes in the pipe. This can be "..." (the default), which resolves to the name of the decorated function, None (which means no namespace), or a string (which means that all nodes will be namespaced with that string). Note that you can either use this *or* namespaces inside ``pipe_input()``...
        :param on_input: setting the target parameter for all steps in the pipe. Leave empty to select only the first argument.
        :param collapse: Whether to collapse this into a single node. This is not currently supported.
        :param _chain: Whether to chain the first parameter. This is the only mode that is supported. Furthermore, this is not externally exposed. ``@flow`` will make use of this.
        """
        if on_input is not None:
            if not isinstance(on_input, str):
                raise NotImplementedError(
                    "on_input currently only supports a single target parameter specified by a string. "
                    "Please reach out if you want a more flexible option in the feature."
                )
        base.NodeTransformer._early_validate_target(target=on_input, allow_multiple=True)

        self.transforms = transforms
        self.collapse = collapse
        self.chain = _chain
        self.namespace = namespace
        self.target = [on_input]

        # TODO: for multiple target parameter case
        # if isinstance(on_input, str):  # have to do extra since strings are collections in python
        #     self.target = [on_input]
        # elif isinstance(on_input, Collection):
        #     self.target = on_input
        # else:
        #     self.target = [on_input]

        if self.collapse:
            raise NotImplementedError(
                "Collapsing step() functions as one node is not yet implemented for pipe_input(). Please reach out if you want this feature."
            )

        if self.chain:
            raise NotImplementedError("@flow() is not yet supported -- this is ")

    def _distribute_transforms_to_parameters(
        self, params: Dict[str, Type[Type]]
    ) -> Dict[str, List[Applicable]]:
        """Resolves target option on the transform level.
        Adds option that we can decide for each applicable which input parameter it will target on
        top of the global target (if it is set).

        We create a hash for each target parameter with a list of transforms that will be applied
        to this parameter.

        :params: Available input parameters of the function
        :return: A dictionary mapping between selected parameters and list of transforms
        """

        selected_transforms = defaultdict(list)
        for param in params:
            if param in self.target:
                selected_transforms[param].extend(self.transforms)
            # TODO: in case of multiple parameters we can set individual targets and resolve them here
            # for transform in self.transforms:
            #     target = transform.target
            #     # In case there is no target set on applicable we assign global target
            #     if target is None:
            #         target = self.target
            #     elif isinstance(target, str):  # user selects single target via string
            #         target = [target]
            #         target.extend(self.target)
            #     elif isinstance(target, Collection):  # user inputs a list of targets
            #         target.extend(self.target)

            # if param in target:
            #     selected_transforms[param].append(transform)

        return selected_transforms

    def _create_valid_parameters_transforms_mapping(
        self, mapping: Dict[str, List[Applicable]], fn: Callable, params: Dict[str, Type[Type]]
    ) -> Dict[str, List[Applicable]]:
        """Checks for a valid distribution of transforms to parameters."""
        sig = inspect.signature(fn)
        param_names = []
        for param in list(sig.parameters.values()):
            param_names.append(param.name)
            # use the name of the parameter to determine the first node
            # Then wire them all through in order
            # if it resolves, great
            # if not, skip that, pointing to the previous
            # Create a node along the way

        if not mapping:
            # This reverts back to legacy chaining through first parameter and checks first parameter
            first_parameter = param_names[0]
            if first_parameter not in params:
                raise base.InvalidDecoratorException(
                    f"Function: {fn.__name__} has a first parameter that is not a dependency. "
                    f"@pipe requires the parameter names to match the function parameters. "
                    f"Thus it might not be compatible with some other decorators"
                )
            mapping[first_parameter] = self.transforms
        # TODO: validate that all transforms have a target in case multiple parameters targeted
        # else:
        #     # in case we set target this checks that each transform has at least one target parameter
        #     transform_set = []
        #     for param in mapping:
        #         transform_set.extend(mapping[param])
        #     transform_set = set(transform_set)
        #     if len(transform_set) != len(self.transforms):
        #         raise MissingTargetError(
        #             "The on_input settings are unclear. Please make sure all transforms "
        #             "either have specified individually or globally a target or there is "
        #             "no on_input usage."
        #         )

        # similar to above we check that the target parameter is among the actual function parameters
        if next(iter(mapping)) not in param_names:
            raise base.InvalidDecoratorException(
                f"Function: {fn.__name__} with parameters {param_names} does not a have "
                f"dependency {next(iter(mapping))}. @pipe_input requires the parameter "
                f"names to match the function parameters. Thus it might not be compatible "
                f"with some other decorators."
            )

        return mapping

    def _resolve_namespace(
        self,
        param: str,
    ) -> str:
        """Add parameter name to namespace.
        In case we pipe_input on multiple parameters we have to duplicate nodes to be able to chain
        them together for each argument and they have to have different names.
        """
        if self.namespace is ... or self.namespace is None:
            return param
        else:
            return f"{self.namespace}_{param}"

    def inject_nodes(
        self, params: Dict[str, Type[Type]], config: Dict[str, Any], fn: Callable
    ) -> Tuple[List[node.Node], Dict[str, str]]:
        """Injects nodes into the graph. This creates a node for each pipe() step,
        then reassigns the inputs to pass it in."""

        parameters_transforms_mapping = self._distribute_transforms_to_parameters(params=params)
        parameters_transforms_mapping = self._create_valid_parameters_transforms_mapping(
            mapping=parameters_transforms_mapping, fn=fn, params=params
        )

        total_nodes = []
        total_rename_maps = {}

        for param in parameters_transforms_mapping:
            # If only single parameter we revert to previous namespace convention since no duplication issues
            # This also ensures backwards compatibility
            if len(parameters_transforms_mapping) == 1:
                namespace = self.namespace
            else:
                namespace = self._resolve_namespace(param=param)

            # Chaining gets done by linking the specified argument of each node
            nodes, current_param = chain_transforms(
                target_arg=param,
                transforms=parameters_transforms_mapping[param],
                namespace=namespace,
                config=config,
                fn=fn,
            )
            total_nodes.extend(nodes)
            total_rename_maps.update({param: current_param})

        return total_nodes, total_rename_maps  # rename to ensure it all works

    def validate(self, fn: Callable):
        """Validates the the individual steps work together."""
        for applicable in self.transforms:
            applicable.validate(
                chain_first_param=True, allow_custom_namespace=self.namespace is ...
            )
        # TODO -- validate that the types match on the chain (this is de-facto done later)

    def optional_config(self) -> Dict[str, Any]:
        """Declares the optional configuration keys for this decorator.
        These are configuration keys that can be used by the decorator, but are not required.
        Along with these we have *defaults*, which we will use to pass to the config.

        :return: The optional configuration keys with defaults. Note that this will return None
        if we have no idea what they are, which bypasses the configuration filtering we use entirely.
        This is mainly for the legacy API.
        """
        out = {}
        for applicable in self.transforms:
            for resolver in applicable.resolvers:
                out.update(resolver.optional_config)
        return out


@deprecated(
    warn_starting=(1, 20, 0),
    fail_starting=(2, 0, 0),
    use_this=pipe_input,
    explanation="pipe has been replaced with pipe_input -- a clearer name since "
    "we also added pipe_output with complimentary functionality.",
    current_version=(1, 77, 0),
    migration_guide="https://hamilton.dagworks.io/en/latest/reference/decorators/",
)
class pipe(pipe_input):
    def __init__(
        self,
        *transforms: Applicable,
        namespace: NamespaceType = ...,
        on_input: base.TargetType = None,
        collapse=False,
        _chain=False,
    ):
        super(pipe, self).__init__(
            *transforms,
            namespace=namespace,
            on_input=on_input,
            collapse=False,
            _chain=False,
        )


# # TODO -- implement flow!
# class flow(pipe):
#     """flow() is a more flexible, power-user version of `pipe`. The rules are largely similar, with a few key differences:
#
#     1. The first parameter is not passed through -- the user is responsible for passing all parameters into a function
#     2. The final function can depend on any of the prior functions -- it will declare those as inputs using the input parameters. These will
#     be seen as inputs, regardless of namespace.
#
#     This means that `flow` can be used to construct *any* DAG -- this is why its a power-user capability. Before we dig into some examples,
#     a quick note on when to use it:
#
#     flow is meant to procedurally specify a subcomponent of the DAG. While Hamilton encourage declarative (not procedural) DAGs, there are
#     certain cases where you may find yourself wanting to more dynamically construct a DAG, for certain subcomponents. This is where
#     `flow` comes in. As we will show later in this doc, this can be very powerful when combined with `resolve` to build configuration-driven
#     DAGs. Again, however, this is meant to be a subset of a declarative DAG -- procedurally defined subdags can help with flexibility, but
#     should not be overused.
#
#     Now, let's get to some examples:
#
#     TODO -- basic example
#
#     TODO -- example with resolve
#
#     TODO -- examples with namespacing
#     """
#
#     def __init__(self, *transforms: Applicable, collapse=False):
#         super(flow, self).__init__(*transforms, collapse=collapse, _chain=False)


class SingleTargetError(Exception):
    """We prohibit the target to be raise both globally and locally.

    Decorators that transform the output of a node can be set to transform only
    a certain output node (useful with extract_columns / extract_fields). Some decorators
    can group multiple transforms and we can set that certain output node either for all of them
    or for each individually.

    This is a safeguard, because when you set the global target it creates a subset of those nodes and
    if the local target is outside of that subset it gets ignore (opposed to the logical assumption that
    it can override the global one). So we disable that case.
    """

    pass


class pipe_output(base.NodeTransformer):
    """Running a series of transformation on the output of the function.

    The decorated function declares the dependency, the body of the function gets executed, and then
    we run a series of transformations on the result of the function specified by ``pipe_output``.

    If we have nodes **A --> B --> C** in the DAG and decorate **B** with ``pipe_output`` like

    .. code-block:: python
        :name: Simple @pipe_output example

        @pipe_output(
            step(B1),
            step(B2)
        )
        def B(...):
            return ...

    we obtain the new DAG **A --> B.raw --> B1 --> B2 --> B --> C**, where we can think of the **B.raw --> B1 --> B2 --> B** as a "pipe" that takes the raw output of **B**, applies to it
    **B1**, takes the output of **B1** applies to it **B2** and then gets renamed to **B** to re-connect to the rest of the DAG.

    The rules for chaining nodes are the same as for ``pipe_input``.

    For extra control in case of multiple output nodes, for example after ``extract_field``/ ``extract_columns`` we can also specify the output node that we wish to mutate.
    The following apply *A* to all fields while *B* only to ``field_1``

    .. code-block:: python
        :name: Simple @pipe_output example targeting specific nodes

        @extract_columns("col_1", "col_2")
        def A(...):
            return ...

        def B(...):
            return ...


         @pipe_output(
            step(A),
            step(B).on_output("field_1"),
        )
        @extract_fields(
                {"field_1":int, "field_2":int, "field_3":int}
        )
        def foo(a:int)->Dict[str,int]:
            return {"field_1":1, "field_2":2, "field_3":3}

    We can also do this on the global level (but cannot do on both levels at the same time). The following would apply function *A* and function *B* to only ``field_1`` and ``field_2``

    .. code-block:: python
        :name: Simple @pipe_output targeting specific nodes local

        @pipe_output(
            step(A),
            step(B),
            on_output = ["field_1","field_2]
        )
        @extract_fields(
                {"field_1":int, "field_2":int, "field_3":int}
        )
        def foo(a:int)->Dict[str,int]:
            return {"field_1":1, "field_2":2, "field_3":3}
    """

    @classmethod
    def _validate_single_target_level(cls, target: base.TargetType, transforms: Tuple[Applicable]):
        """We want to make sure that target gets applied on a single level.
        Either choose for each step individually what it targets or set it on the global level where
        all steps will target the same node(s).
        """
        if target is not None:
            for transform in transforms:
                if transform.target is not None:
                    raise SingleTargetError("Cannot have target set on pipe_output and step level.")

    def __init__(
        self,
        *transforms: Applicable,
        namespace: NamespaceType = ...,
        on_output: base.TargetType = None,
        collapse=False,
        _chain=False,
    ):
        """Instantiates a ``@pipe_output`` decorator.

        Warning: if there is a global pipe_output target, the individual ``step(...).target`` would only choose
        from the subset pre-selected from the global pipe_output target. We have disabled this for now to avoid
        confusion. Leave global pipe_output target empty if you want to choose between all the nodes on the individual step level.

        :param transforms: step transformations to be applied, in order
        :param namespace: namespace to apply to all nodes in the pipe. This can be "..." (the default), which resolves to the name of the decorated function, None (which means no namespace), or a string (which means that all nodes will be namespaced with that string). Note that you can either use this *or* namespaces inside ``pipe_output()``...
        :param on_output: setting the target node for all steps in the pipe. Leave empty to select all the output nodes.
        :param collapse: Whether to collapse this into a single node. This is not currently supported.
        :param _chain: Whether to chain the first parameter. This is the only mode that is supported. Furthermore, this is not externally exposed. ``@flow`` will make use of this.
        """
        pipe_output._validate_single_target_level(target=on_output, transforms=transforms)

        if on_output == ...:
            raise ValueError(
                "Cannot apply Elipsis(...) to on_output. Use None, single string or list of strings."
            )

        super(pipe_output, self).__init__(target=on_output)
        self.transforms = transforms
        self.collapse = collapse
        self.chain = _chain
        self.namespace = namespace

        if self.collapse:
            raise NotImplementedError(
                "Collapsing step() functions as one node is not yet implemented for pipe(). Please reach out if you want this feature."
            )

        if self.chain:
            raise NotImplementedError("@flow() is not yet supported -- this is ")

    def _filter_individual_target(self, node_):
        """Resolves target option on the transform level.
        Adds option that we can decide for each applicable which output node it will target.

        :param node_: The current output node.
        :return: The set of transforms that target this node
        """
        selected_transforms = []
        for transform in self.transforms:
            target = transform.target
            if isinstance(target, str):  # user selects single target via string
                if node_.name == target:
                    selected_transforms.append(transform)
            elif isinstance(target, Collection):  # user inputs a list of targets
                if node_.name in target:
                    selected_transforms.append(transform)
            else:  # for target=None (default) we include all sink nodes
                selected_transforms.append(transform)

        return tuple(selected_transforms)

    def transform_node(
        self, node_: node.Node, config: Dict[str, Any], fn: Callable
    ) -> Collection[node.Node]:
        """Injects nodes into the graph.

        We create a copy of the original function and rename it to `function_name.raw` to be the
        initial node. Then we create a node for each step in `post-pipe` and chain them together.
        The last node is an identity to the previous one with the original name `function_name` to
        represent an exit point of `pipe_output`.
        """
        transforms = self._filter_individual_target(node_)
        if len(transforms) < 1:
            # in case no functions in pipeline we short-circuit and return the original node
            return [node_]

        if self.namespace is None:
            _namespace = None
        elif self.namespace is ...:
            _namespace = node_.name
        else:
            _namespace = self.namespace

        # We pick a reserved prefix that ovoids clashes with user defined functions / nodes
        original_node = node_.copy_with(name=f"{node_.name}.raw")

        is_async = inspect.iscoroutinefunction(fn)  # determine if its async

        def __identity(foo: Any) -> Any:
            return foo

        async def async_function(**kwargs):
            return await __identity(**kwargs)

        fn_to_use = async_function if is_async else __identity

        transforms = transforms + (step(fn_to_use).named(fn.__name__),)
        nodes, _ = chain_transforms(
            target_arg=original_node.name,
            transforms=transforms,
            namespace=_namespace,  # self.namespace,
            config=config,
            fn=fn,
        )

        # In case config resolves to no pipe functions applied we return the original node and skip pipe
        if len(nodes) == 1:
            return [node_]

        last_node = nodes[-1].copy_with(name=f"{node_.name}", typ=nodes[-2].type)

        out = [original_node]
        out.extend(nodes[:-1])
        out.append(last_node)
        return out

    def validate(self, fn: Callable):
        """Validates the the individual steps work together."""
        for applicable in self.transforms:
            applicable.validate(
                chain_first_param=True, allow_custom_namespace=self.namespace is ...
            )
        # TODO -- validate that the types match on the chain (this is de-facto done later)

    def optional_config(self) -> Dict[str, Any]:
        """Declares the optional configuration keys for this decorator.
        These are configuration keys that can be used by the decorator, but are not required.
        Along with these we have *defaults*, which we will use to pass to the config.

        :return: The optional configuration keys with defaults. Note that this will return None
        if we have no idea what they are, which bypasses the configuration filtering we use entirely.
        This is mainly for the legacy API.
        """
        out = {}
        for applicable in self.transforms:
            for resolver in applicable.resolvers:
                out.update(resolver.optional_config)
        return out


def chain_transforms(
    target_arg: str,
    transforms: List[Applicable],
    namespace: str,
    config: Dict[str, Any],
    fn: Callable,
):
    """Chaining nodes together sequentially through the a specified argument.

    :param target_arg: assigning the name of the specified argument of the first node in chain
    :param transforms: step transformations to be applied, in order
    :param namespace: namespace to apply to all nodes. This can be "..." (the default), which resolves to the name of the decorated function, None (which means no namespace), or a string (which means that all nodes will be namespaced with that string)
    :param config: Configuration to use -- this can be specified in the decorator
    :param fn: initial function that was decorated

    :return: A list of nodes that have been chained together through the specified argument.
    """

    fn_count = Counter()
    nodes = []
    for applicable in transforms:
        if namespace is not ...:
            applicable = applicable.namespaced(
                namespace=namespace
            )  # we reassign the global namespace
        if applicable.resolves(config):
            fn_name = applicable.fn.__name__
            postfix = "" if fn_count[fn_name] == 0 else f"_{fn_count[fn_name]}"
            node_name = (
                applicable.name
                if applicable.name is not None
                else f"with{('_' if not fn_name.startswith('_') else '') + fn_name}{postfix}"
            )
            raw_node = node.Node.from_fn(
                applicable.fn,
                f"with{('_' if not fn_name.startswith('_') else '') + fn_name}{postfix}",
            )
            node_namespace = applicable.resolve_namespace(fn.__name__)
            raw_node = raw_node.copy_with(namespace=node_namespace, name=node_name)
            # TODO -- validate that the first parameter is the right type/all the same
            fn_count[fn_name] += 1
            upstream_inputs, literal_inputs = applicable.bind_function_args(target_arg)
            nodes.append(
                raw_node.reassign_inputs(
                    input_names=upstream_inputs,
                    input_values=literal_inputs,
                )
            )
            target_arg = raw_node.name
    return nodes, target_arg


def apply_to(fn_: Union[Callable, str], **mutating_fn_kwargs: Union[SingleDependency, Any]):
    """Creates an applicable placeholder with potential kwargs that will be applied to a node (or a subcomponent of a node).
    See documentation for ``mutate`` to see how this is used. It de facto allows a postponed ``step``.

    We pass fn=None here as this will be the function we are decorating and need to delay passing it in. The target
    function is the one we wish to mutate and we store it for later access.

    :param fn: Function the applicable will be applied to
    :param mutating_fn_kwargs: Kwargs (**kwargs) to pass to the mutator function. Must be validly called as f(**kwargs), and have a 1:1 mapping of kwargs to parameters.
    :return: an applicable placeholder with the target function
    """
    return Applicable(fn=None, args=(), kwargs=mutating_fn_kwargs, target_fn=fn_, _resolvers=[])


class NotSameModuleError(Exception):
    """Limit the use of a decorator on functions from the same module.

    Some decorators have the ability to transform also other functions than the one they are decorating (for example mutate).
    This ensures that all the functions are located within the same module.
    """

    def __init__(self, fn: Callable, target_fn: Callable):
        super().__init__(
            f"The functions have to be in the same module... "
            f"The target function {target_fn.__name__} is in module {target_fn.__module__} and "
            f"the mutator function {fn.__name__} is in module {fn.__module__}./n"
            "Use power user setting to disable this restriction."
        )


class mutate:
    """Running a transformation on the outputs of a series of functions.

    This is closely related to ``pipe_output`` as it effectively allows you to run transformations on the output of a node without touching that node.
    We choose which target functions we wish to mutate by the transformation we are decorating. For now, the target functions, that will be mutated,
    have to be in the same module (come speak to us if you need this capability over multiple modules).

    We suggest you define them with an prefixed underscore to only have them displayed in the `transform pipeline` of the target node.

    If we wish to apply ``_transform1`` to the output of **A** and **B** and ``_transform2`` only to the output
    of node **B**, we can do this like

    .. code-block:: python
        :name: Simple @mutate example

        def A(...):
            return ...

        def B(...):
            return ...

        @mutate(A, B)
        def _transform1(...):
            return ...

        @mutate(B)
        def _transform2(...):
            return ...

    we obtain the new pipe-like subDAGs **A.raw --> _transform1 --> A** and **B.raw --> _transform1 --> _transform2 --> B**,
    where the behavior is the same as ``pipe_output``.

    While it is generally reasonable to use ``pipe_output``, you should consider ``mutate`` in the following scenarios:

    1. Loading data and applying pre-cleaning step.
    2. Feature engineering via joining, filtering, sorting, etc.
    3. Experimenting with different transformations across nodes by selectively turning transformations on / off.

    We assume the first argument of the decorated function to be the output of the function we are targeting.
    For transformations with multiple arguments you can use key word arguments coupled with ``step`` or ``value``
    the same as with other ``pipe``-family decorators

    .. code-block:: python
        :name: Simple @mutate example with multiple arguments

        @mutate(A, B, arg2=step('upstream_node'), arg3=value(some_literal), ...)
        def _transform1(output_from_target:correct_type, arg2:arg2_type, arg3:arg3_type,...):
            return ...

    You can also select individual args that will be applied to each target node by adding ``apply_to(...)``

    .. code-block:: python
        :name: Simple @mutate example with multiple arguments allowing individual actions

        @mutate(
                apply_to(A, arg2=step('upstream_node_1'), arg3=value(some_literal_1)),
                apply_to(B, arg2=step('upstream_node_2'), arg3=value(some_literal_2)),
                )
        def _transform1(output_from_target:correct_type, arg2:arg2_type, arg3:arg3_type, ...):
            return ...

    In case of multiple output nodes, for example after ``extract_field`` / ``extract_columns`` we can also specify the output node that we wish to mutate.
    The following would mutate all columns of *A* individually while in the case of function *B* only ``field_1``

    .. code-block:: python
        :name: @mutate example targeting specific nodes local

        @extract_columns("col_1", "col_2")
        def A(...):
            return ...

        @extract_fields(
                {"field_1":int, "field_2":int, "field_3":int}
        )
        def B(...):
            return ...

        @mutate(
            apply_to(A),
            apply_to(B).on_output("field_1"),
            )

        def foo(a:int)->Dict[str,int]:
            return {"field_1":1, "field_2":2, "field_3":3}
    """

    def __init__(
        self,
        *target_functions: Union[Applicable, Callable],
        collapse: bool = False,
        _chain: bool = False,
        **mutating_function_kwargs: Union[SingleDependency, Any],
    ):
        """Instantiates a ``mutate`` decorator.

        We assume the first argument of the decorated function to be the output of the function we are targeting.

        :param target_functions: functions we wish to mutate the output of
        :param collapse: Whether to collapse this into a single node. This is not currently supported.
        :param _chain: Whether to chain the first parameter. This is the only mode that is supported. Furthermore, this is not externally exposed. ``@flow`` will make use of this.
        :param `**mutating_function_kwargs`: other kwargs that the decorated function has. Must be validly called as ``f(**kwargs)``, and have a 1-to-1 mapping of kwargs to parameters. This will be applied for all ``target_functions``, unless ``apply_to`` already has the mutator function kwargs, in which case it takes those.
        """
        self.collapse = collapse
        self.chain = _chain
        # keeping it here once it gets implemented maybe nice to have options
        if self.collapse:
            raise NotImplementedError(
                "Collapsing functions as one node is not yet implemented for mutate(). Please reach out if you want this feature."
            )
        if self.chain:
            raise NotImplementedError("@flow() is not yet supported -- this is ")

        self.remote_applicables = tuple(
            [apply_to(fn) if isinstance(fn, Callable) else fn for fn in target_functions]
        )
        self.mutating_function_kwargs = mutating_function_kwargs

        # Cross module will require some thought so we are restricting mutate to single module for now
        self.restrict_to_single_module = True

    def validate_same_module(self, mutating_fn: Callable):
        """Validates target functions are in the same module as the mutator function.

        :param mutating_fn: Function to validate against
        :return: Nothing, raises exception if not valid.
        """
        local_module = mutating_fn.__module__
        for remote_applicable in self.remote_applicables:
            if remote_applicable.target_fn.__module__ != local_module:
                raise NotSameModuleError(fn=mutating_fn, target_fn=remote_applicable.target_fn)

    def _create_step(self, mutating_fn: Callable, remote_applicable_builder: Applicable):
        """Adds the correct function for the applicable and resolves kwargs"""

        if not remote_applicable_builder.kwargs:
            remote_applicable_builder.kwargs = self.mutating_function_kwargs

        remote_applicable_builder.fn = mutating_fn

        return remote_applicable_builder

    def __call__(self, mutating_fn: Callable):
        """Adds to an existing pipe_output or creates a new pipe_output.

        This is a new type of decorator that builds ``pipe_output`` for multiple nodes in the DAG. It does
        not fit in the current decorator framework since it does not decorate the node function in the DAG
        but allows us to "remotely decorate" multiple nodes at once, which needs to happen before the
        NodeTransformLifecycle gets applied / resolved.

        :param mutating_fn: function that will be used in pipe_output to transform target function
        :return: mutating_fn, to guarantee function works even when Hamilton driver is not used
        """

        # This function will be excluded from the DAG as a node since we are inserting it manually
        mutating_fn = hamilton_exclude()(mutating_fn)

        if self.restrict_to_single_module:
            self.validate_same_module(mutating_fn=mutating_fn)

        # TODO:  If @mutate runs once it's good
        #       If you run that again, it might double-up
        # In the juptyer notebook/cross-module case we'll want to guard against it.
        for remote_applicable in self.remote_applicables:
            new_pipe_step = self._create_step(
                mutating_fn=mutating_fn, remote_applicable_builder=remote_applicable
            )
            found_pipe_output = False
            if hasattr(remote_applicable.target_fn, base.NodeTransformer.get_lifecycle_name()):
                for decorator in remote_applicable.target_fn.transform:
                    if isinstance(decorator, pipe_output):
                        decorator.transforms = decorator.transforms + (new_pipe_step,)
                        found_pipe_output = True

            if not found_pipe_output:
                remote_applicable.target_fn = pipe_output(
                    new_pipe_step, collapse=self.collapse, _chain=self.chain
                )(remote_applicable.target_fn)

        return mutating_fn
