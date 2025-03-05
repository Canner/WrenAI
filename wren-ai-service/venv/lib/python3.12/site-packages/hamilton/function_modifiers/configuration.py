from typing import Any, Callable, Collection, Dict, List, Optional

from . import base

"""Decorators that handle the configuration of a function. These can be viewed as
replacing if/else/switch statements in standard dataflow definition libraries"""


class ConfigResolver:
    """Base class for resolving configuration so we can share the tooling between different functions."""

    def __init__(self, resolves: Callable[[Dict[str, Any]], bool], config_used: List[str]):
        self.resolves = resolves
        self._config_used = config_used

    @property
    def optional_config(self) -> Dict[str, Any]:
        """Gives the optional configuration for this resolver -- to be used by the @config decorator."""
        return {key: None for key in self._config_used}

    def __call__(self, config: Dict[str, Any]) -> bool:
        return self.resolves(config)

    @staticmethod
    def when(**key_value_pairs) -> "ConfigResolver":
        """Gives a resolver that resolves iff all keys in the config are equal to the corresponding value.


        :param key_value_pairs: Keys and corresponding values to look up in the config
        :return: a configuration decorator
        """

        def resolves(configuration: Dict[str, Any]) -> bool:
            return all(value == configuration.get(key) for key, value in key_value_pairs.items())

        return ConfigResolver(resolves, config_used=list(key_value_pairs.keys()))

    @staticmethod
    def when_not(**key_value_pairs: Any) -> "ConfigResolver":
        """Gives a resolver that resolves iff the keys in the config are all not equal to the corresponding value

        :param key_value_pairs: Keys and corresponding values to look up in the config
        :return: a configuration decorator
        """

        def resolves(configuration: Dict[str, Any]) -> bool:
            return all(value != configuration.get(key) for key, value in key_value_pairs.items())

        return ConfigResolver(resolves, config_used=list(key_value_pairs.keys()))

    @staticmethod
    def when_in(**key_value_group_pairs: Collection[Any]) -> "ConfigResolver":
        """Gives a resolver that the function if all the
        values corresponding to the config keys are equal to one of items in the list of values.

        :param key_value_group_pairs: pairs of key-value mappings where the value is a list of possible values
        :return: a configuration decorator
        """

        def resolves(configuration: Dict[str, Any]) -> bool:
            return all(
                configuration.get(key) in value for key, value in key_value_group_pairs.items()
            )

        return ConfigResolver(resolves, config_used=list(key_value_group_pairs.keys()))

    @staticmethod
    def when_not_in(**key_value_group_pairs: Collection[Any]) -> "ConfigResolver":
        """Gives a decorator that resolves the function only if none of the keys are in the list of values.

        :param key_value_group_pairs: pairs of key-value mappings where the value is a list of possible values
        :return: a configuration decorator
        """

        def resolves(configuration: Dict[str, Any]) -> bool:
            return all(
                configuration.get(key) not in value for key, value in key_value_group_pairs.items()
            )

        return ConfigResolver(resolves, config_used=list(key_value_group_pairs.keys()))


class config(base.NodeResolver):
    """Decorator class that determines whether a function should be in the DAG based on some configuration variable.

    Notes:

    1. Currently, functions that exist in all configurations have to be disjoint.

    2. There is currently no ``@config.otherwise(...)`` decorator, so make sure to have ``config.when`` specify set of \
    configuration possibilities. Any missing cases will not have that output (and subsequent downstream functions \
    may error out if they ask for it).

    3. To make this easier, we have a few more ``@config`` decorators:
        * ``@config.when_not(param=value)`` Will be included if the parameter is _not_ equal to the value specified.
        * ``@config.when_in(param=[value1, value2, ...])`` Will be included if the parameter is equal to one of the \
        specified values.
        * ``@config.when_not_in(param=[value1, value2, ...])`` Will be included if the parameter is not equal to any \
        of the specified values.
        * ``@config`` If you're feeling adventurous, you can pass in a lambda function that takes in the entire \
        configuration and resolves to ``True`` or ``False``. You probably don't want to do this.

    Example:

    .. code-block:: python

       @config.when_in(business_line=["mens","kids"], region=["uk"])
       def LEAD_LOG_BASS_MODEL_TIMES_TREND(
            TREND_BSTS_WOMENS_ACQUISITIONS: pd.Series,
            LEAD_LOG_BASS_MODEL_SIGNUPS_NON_REFERRAL: pd.Series) -> pd.Series:
            # logic
            ...

    Example - use of `__suffix` to differentiate between functions with the same name. This is required if you want to
    use the same function name in multiple configurations. Hamilton will automatically drop the suffix for you. The
    following will ensure only one function is registered with the name `my_transform`:

    .. code-block:: python

       @config.when(region="us")
       def my_transform__us(some_input: pd.Series, some_input_b: pd.Series) -> pd.Series:
            # logic
            ...

       @config.when(region="uk")
       def my_transform__uk(some_input: pd.Series, some_input_c: pd.Series) -> pd.Series:
            # logic
            ...


    ``@config`` If you're feeling adventurous, you can pass in a lambda function that takes in the entire configuration\
    and resolves to ``True`` or ``False``. You probably don't want to do this.
    """

    def __init__(
        self,
        resolves: Callable[[Dict[str, Any]], bool],
        target_name: str = None,
        config_used: List[str] = None,
    ):
        """Decorator that resolves a function based on the configuration...

        :param resolves: the python function to use to resolve whether the wrapped function should exist in the graph \
        or not.
        :param target_name: Optional. The name of the "function"/"node" that we want to attach @config to.
        :param config_used: Optional. The list of config names that this function uses.
        """
        self.does_resolve = resolves
        self.target_name = target_name
        self._config_used = config_used

    def required_config(self) -> Optional[List[str]]:
        """This returns the required configuration elements. Note that "none"
        is a sentinel value that means that we actaully don't know what
        it uses. If either required or optional configs are None, we
        pass the entire configuration.

        Note that this can still return None due to the @config(resolver) decorator.
        We will likely be deprecating this in 2.0, in favor of a (to be added) config.custom.
        Still thinking this over...

        :return: The list of required config elements, or None if we don't have any idea.
        """
        return None if self._config_used is None else []

    def optional_config(self) -> Optional[Dict[str, Any]]:
        """Everything is optional with None as the required value"""
        return {key: None for key in self._config_used} if self._config_used is not None else None

    def _get_function_name(self, fn: Callable) -> str:
        if self.target_name is not None:
            return self.target_name
        return base.sanitize_function_name(fn.__name__)

    def resolve(self, fn, config: Dict[str, Any]) -> Callable:
        if not self.does_resolve(config):
            return None
        # attaches config keys used to resolve function
        fn.__config_decorated__ = (
            self._config_used if self._config_used is not None else ["__UNKNOWN__"]
        )
        fn.__original_name__ = fn.__name__
        fn.__name__ = self._get_function_name(fn)  # TODO -- copy function to not mutate it
        return fn

    def validate(self, fn):
        if fn.__name__.endswith("__"):
            raise base.InvalidDecoratorException(
                "Config will always use the portion of the function name before the last __. For example, signups__v2 will map to signups, whereas"
            )

    @staticmethod
    def when(name=None, **key_value_pairs) -> "config":
        """Yields a decorator that resolves the function if all keys in the config are equal to the corresponding value.


        :param key_value_pairs: Keys and corresponding values to look up in the config
        :return: a configuration decorator
        """
        resolver = ConfigResolver.when(**key_value_pairs)
        return config(resolver, target_name=name, config_used=list(resolver.optional_config))

    @staticmethod
    def when_not(name=None, **key_value_pairs: Any) -> "config":
        """Yields a decorator that resolves the function if none keys in the config are equal to the corresponding value

        ``@config.when_not(param=value)`` will be included if the parameter is _not_ equal to the value specified.

        :param key_value_pairs: Keys and corresponding values to look up in the config
        :return: a configuration decorator
        """

        resolver = ConfigResolver.when_not(**key_value_pairs)
        return config(resolver, target_name=name, config_used=list(resolver.optional_config))

    @staticmethod
    def when_in(name=None, **key_value_group_pairs: Collection[Any]) -> "config":
        """Yields a decorator that resolves the function if all of the
        values corresponding to the config keys are equal to one of items in the list of values.

        ``@config.when_in(param=[value1, value2, ...])`` Will be included if the parameter is equal to one of the \
        specified values.

        :param key_value_group_pairs: pairs of key-value mappings where the value is a list of possible values
        :return: a configuration decorator
        """

        resolver = ConfigResolver.when_in(**key_value_group_pairs)
        return config(resolver, target_name=name, config_used=list(resolver.optional_config))

    @staticmethod
    def when_not_in(**key_value_group_pairs: Collection[Any]) -> "config":
        """Yields a decorator that resolves the function only if none of the keys are in the list of values.

        ``@config.when_not_in(param=[value1, value2, ...])`` Will be included if the parameter is not equal to any of \
        the specified values.

        :param key_value_group_pairs: pairs of key-value mappings where the value is a list of possible values
        :return: a configuration decorator

        .. code-block:: python

           @config.when_not_in(business_line=["mens","kids"], region=["uk"])
           def LEAD_LOG_BASS_MODEL_TIMES_TREND(
               TREND_BSTS_WOMENS_ACQUISITIONS: pd.Series,
               LEAD_LOG_BASS_MODEL_SIGNUPS_NON_REFERRAL: pd.Series) -> pd.Series:

        above will resolve for config has `{"business_line": "womens", "region": "us"}`,
        but not for configs that have `{"business_line": "mens", "region": "us"}`,
        `{"business_line": "kids", "region": "us"}`, or `{"region": "uk"}`.

        .. seealso::
            :ref:config.when_not
        """

        resolver = ConfigResolver.when_not_in(**key_value_group_pairs)
        return config(resolver, config_used=list(resolver.optional_config))


class hamilton_exclude(base.NodeResolver):
    """Decorator class that excludes a function from the DAG.

    The preferred way to hide functions from the Hamilton DAG is to prefix them with "_". However,
    for the exceptional case, it can be useful for decorating helper functions without the need to prefix
    them with "_" and use them either inside other nodes or in conjunction with ``step`` or ``apply_to``.

    .. code-block:: python

        @hamilton_exclude
        def helper(...) -> ...:
            '''This will not be part of the DAG'''
            ...

    You may also want to use this decorator for excluding functions in legacy code that would raise
    and error in Hamilton (for example missing type hints).
    """

    def __init__(self):
        pass

    def resolve(self, *args, **kwargs) -> Optional[Callable]:
        """Returning None defaults to not be included in the DAG.

        :param fn: Function to resolve
        :param config: DAG config
        :return: None to not be included in the DAG
        """
        return None

    def validate(self, fn):
        """Any function should work."""
        pass
