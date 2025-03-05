import enum
import inspect
from typing import Any, Callable, Dict, List, Optional, Tuple

from hamilton import settings
from hamilton.function_modifiers.base import (
    DynamicResolver,
    InvalidDecoratorException,
    NodeTransformLifecycle,
)


class ResolveAt(enum.Enum):
    CONFIG_AVAILABLE = "config_available"


VALID_PARAM_KINDS = [inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY]


def extract_and_validate_params(fn: Callable) -> Tuple[List[str], Dict[str, Any]]:
    """Gets the parameters from a function, while validating that
    the function has *only* named arguments.

    :param fn: Function to extract parameters from
    :return: List of parameter names
    :raises InvalidDecoratorException: If the function has any non kwargs-friendly arguments
    """
    invalid_params = []
    required_params = []
    optional_params = {}
    sig = inspect.signature(fn)
    for key, value in inspect.signature(fn).parameters.items():
        if value.kind not in VALID_PARAM_KINDS:
            invalid_params.append(key)
        else:
            if value.default is not value.empty:
                optional_params[key] = value.default
            else:
                required_params.append(key)
    if invalid_params:
        raise InvalidDecoratorException(
            f"Configuration-parsing functions can only except keyword-friendly arguments. "
            f"Instead got signature: {sig}"
        )
    return required_params, optional_params


class resolve(DynamicResolver):
    """Decorator class to delay evaluation of decorators until after the configuration is available.
    Note: this is a power-user feature, and you have to enable power-user mode! To do so, you have
    to add the configuration hamilton.enable_power_user_mode=True to the config you pass into the
    driver.

    If not, this will break when it tries to instantiate a DAG.

    This is particularly useful when you don't know how you want your functions to resolve until
    configuration time. Say, for example, we want to add two series, and we need to pass the set of
    series to add as a configuration parameter, as we'll be changing it regularly. Without this,
    you would have to have them as part of the same dataframe. E.G.

    .. code-block:: python

        @parameterize_values(
            series_sum_1={"s1": "series_1", "s2": "series_2"},
            series_sum_2={"s1": "series_3", "s2": "series_4"},
        )
        def summation(df: pd.DataFrame, s1: str, s2: str) -> pd.Series:
            return df[s1] + df[s2]

    Note that there are a lot of benefits to this code, but it is a workaround for the fact that
    we cannot configure the dependencies. With the `@resolve` decorator, we can actually dynamically
    set the shape of the DAG based on config:

    .. code-block:: python

        from hamilton.function_modifiers import resolve, ResolveAt


        @resolve(
            when=ResolveAt.CONFIG_AVAILABLE,
            decorate_with=lambda first_series_sum, second_series_sum: parameterize_sources(
                series_sum_1={"s1": first_series_sum[0], "s2": second_series_sum[1]},
                series_sum_2={"s1": second_series_sum[1], "s2": second_series_sum[2]},
            ),
        )
        def summation(s1: pd.Series, s2: pd.Series) -> pd.Series:
            return s1 + s2

    Note how this works:
    1. The `decorate_with` argument is a function that gives you the decorator you want to apply.
    Currently its "hamilton-esque" -- while we do not require it to be typed, you can use a separate
    configuration-reoslver function (and include type information). This lambda function must return
    a decorator.
    2. The `when` argument is the point at which you want to resolve the decorator. Currently, we
    only support `ResolveAt.CONFIG_AVAILABLE`, which means that the decorator will be resolved at compile
    time, E.G. when the driver is instantiated.
    3. This is then run and dynamically resolved.

    This is powerful, but the code is uglier. It's meant to be used in some very specific cases,
    E.G. When you want time-series data on a per-column basis (E.G. once per month), and don't want
    that hardcoded. While it is possible to store this up in a JSON file and run parameterization on
    the loaded result as a global variable, it is much cleaner to pass it through the DAG, which
    is why we support it. However, since the code goes against one of Hamilton's primary tenets (
    that all code is highly readable), we require that you enable power_user_mode.

    We *highly* recommend that you put all functions decorated with this in their own module,
    keeping it separate from the rest of your functions. This way, you can import/build DAGs from
    the rest of your functions without turning on power-user mode.
    """

    def __init__(self, *, when: ResolveAt, decorate_with: Callable[..., NodeTransformLifecycle]):
        """Initializes a delayed decorator that gets called at some specific resolution time.

        :param decorate_with: Function that takes required and optional parameters/returns a decorator.
        :param until: When to resolve the decorator. Currently only supports `ResolveAt.CONFIG_AVAILABLE`.
        """
        if when != ResolveAt.CONFIG_AVAILABLE:
            raise ValueError("Dynamic functions must be configured at config time!")
        self.until = when
        self.decorate_with = decorate_with
        self._required_config, self._optional_config = extract_and_validate_params(decorate_with)

    def required_config(self) -> Optional[List[str]]:
        return self._required_config

    def optional_config(self) -> Optional[Dict[str, Any]]:
        return self._optional_config

    def resolve(self, config: Dict[str, Any], fn: Callable) -> NodeTransformLifecycle:
        if not config[settings.ENABLE_POWER_USER_MODE]:
            raise InvalidDecoratorException(
                "Dynamic functions are only allowed in power user mode!"
                "Why? This is occasionally needed to enable highly flexible "
                "dataflows, but it can compromise readability if you're not "
                "careful! To enable power user mode, pass in the configuration "
                f"parameter {settings.ENABLE_POWER_USER_MODE}=True to your driver."
            )
        missing_configs = []
        for item in self.required_config():
            if item not in config:
                missing_configs.append(item)
        if missing_configs:
            raise InvalidDecoratorException(
                f"Config items: {missing_configs} declared "
                f"but not provided for decorator: {self} on fn: {fn}"
            )
        kwargs = {key: config[key] for key in self._required_config}
        for key in self._optional_config:
            if key in config:
                kwargs[key] = config[key]
        return self.decorate_with(**kwargs)


class resolve_from_config(resolve):
    """Decorator class to delay evaluation of decorators until after the configuration is available.
    Note: this is a power-user feature, and you have to enable power-user mode! To do so, you have
    to add the configuration hamilton.enable_power_user_mode=True to the config you pass into the
    driver.

    This is a convenience decorator that is a subclass of `resolve` and passes
    `ResolveAt.CONFIG_AVAILABLE` to the `when` argument such that the decorator is resoled at
    compile time, E.G. when the driver is instantiated.

    .. code-block:: python

        from hamilton.function_modifiers import resolve, ResolveAt


        @resolve_from_config(
            decorate_with=lambda first_series_sum, second_series_sum: parameterize_sources(
                series_sum_1={"s1": first_series_sum[0], "s2": second_series_sum[1]},
                series_sum_2={"s1": second_series_sum[1], "s2": second_series_sum[2]},
            )
        )
        def summation(s1: pd.Series, s2: pd.Series) -> pd.Series:
            return s1 + s2

    """

    def __init__(self, *, decorate_with: Callable[..., NodeTransformLifecycle]):
        super().__init__(when=ResolveAt.CONFIG_AVAILABLE, decorate_with=decorate_with)
