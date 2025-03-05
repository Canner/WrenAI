import collections
import configparser
import functools
import importlib
import logging
import os
import pathlib
from typing import Any, Dict, Literal, Optional, Tuple, Type, get_args

logger = logging.getLogger(__name__)

# Use this to ensure the registry is loaded only once.
INITIALIZED = False
ExtensionName = Literal[
    "yaml",
    "matplotlib",
    "numpy",
    "pandas",
    "plotly",
    "polars",
    "polars_lazyframe",
    "pyspark_pandas",
    "spark",
    "dask",
    "geopandas",
    "xgboost",
    "lightgbm",
    "sklearn_plot",
    "vaex",
    "ibis",
    "dlt",
    "kedro",
    "huggingface",
    "mlflow",
    "pydantic",
]
HAMILTON_EXTENSIONS: Tuple[ExtensionName, ...] = get_args(ExtensionName)
HAMILTON_AUTOLOAD_ENV = "HAMILTON_AUTOLOAD_EXTENSIONS"
# NOTE the variable DEFAULT_CONFIG_LOCAITON is redundant with `hamilton.telemetry`
# but this `registry` module must avoid circular imports
DEFAULT_CONFIG_LOCATION = pathlib.Path("~/.hamilton.conf").expanduser()

# This is a dictionary of extension name -> dict with dataframe and column types.
DF_TYPE_AND_COLUMN_TYPES: Dict[str, Dict[str, Type]] = {}

COLUMN_TYPE = "column_type"
DATAFRAME_TYPE = "dataframe_type"


def load_autoload_config() -> configparser.ConfigParser:
    """Load the Hamilton config file and set the autoloading environment variable"""
    config = configparser.ConfigParser()
    config.read(DEFAULT_CONFIG_LOCATION)

    if config.has_option("DEFAULT", HAMILTON_AUTOLOAD_ENV):
        os.environ[HAMILTON_AUTOLOAD_ENV] = config.get("DEFAULT", HAMILTON_AUTOLOAD_ENV)

    return config


load_autoload_config()


def load_extension(plugin_module: ExtensionName):
    """Given a module name, loads it for Hamilton to use.

    :param plugin_module: the module name sans .py. e.g. pandas, polars, pyspark_pandas.
    """
    mod = importlib.import_module(f"hamilton.plugins.{plugin_module}_extensions")
    # We have various plugin extensions. We default to assuming it's a dataframe extension with columns,
    # unless it explicitly says it's not.
    # We need to check the following if we are to enable `@extract_columns` for example.
    extractable = getattr(mod, "COLUMN_FRIENDLY_DF_TYPE", True)
    if extractable:
        assert hasattr(mod, "register_types"), "Error extension missing function register_types()"
        assert hasattr(
            mod, f"get_column_{plugin_module}"
        ), f"Error extension missing get_column_{plugin_module}"
        assert hasattr(
            mod, f"fill_with_scalar_{plugin_module}"
        ), f"Error extension missing fill_with_scalar_{plugin_module}"
        logger.info(f"Detected {plugin_module} and successfully loaded Hamilton extensions.")


def initialize():
    """Iterate over all extensions and try to load them"""
    logger.debug(f"{HAMILTON_AUTOLOAD_ENV}={os.environ.get(HAMILTON_AUTOLOAD_ENV)}")
    for extension_name in HAMILTON_EXTENSIONS:
        # skip modules that aren't explicitly imported by the user
        if str(os.environ.get(HAMILTON_AUTOLOAD_ENV)) == "0":
            continue

        try:
            load_extension(extension_name)
        except NotImplementedError as e:
            logger.debug(f"Did not load {extension_name} extension because {str(e)}.")
        except ModuleNotFoundError as e:
            logger.debug(f"Did not load {extension_name} extension because {e.msg}.")
        except ImportError as e:
            logger.debug(f"Did not load {extension_name} extension because {str(e)}.")

    global INITIALIZED
    INITIALIZED = True


def disable_autoload():
    """Disable extension autoloading by setting an environment variable.
    This needs to be done before hamilton.driver is imported.
    """
    os.environ[HAMILTON_AUTOLOAD_ENV] = "0"


def enable_autoload():
    """Enable extension autoloading by deleting an environment variable.
    This needs to be done before hamilton.driver is imported.
    """
    del os.environ[HAMILTON_AUTOLOAD_ENV]


def config_enable_autoload():
    """Modify the Hamilton config file to enable extension autoloading.
    Autoloading can be disabled manually via `hamilton.registry.disable_autoload()`
    before importing `hamilton.driver`.

    NOTE the function name is tied to an entrypoint in `pyproject.toml`
    """
    config = load_autoload_config()
    if "DEFAULT" not in config:
        config.add_section("DEFAULT")

    config.remove_option("DEFAULT", HAMILTON_AUTOLOAD_ENV)
    with DEFAULT_CONFIG_LOCATION.open("w") as f:
        config.write(f)


def config_disable_autoload():
    """Modify the Hamilton config file to disable extension autoloading.
    Autoloading can be enabled manually via `hamilton.registry.enable_autoload()`
    before importing `hamilton.driver`.

    NOTE the function name is tied to an entrypoint in `pyproject.toml`
    """
    config = load_autoload_config()
    if "DEFAULT" not in config:
        config.add_section("DEFAULT")

    config.set("DEFAULT", HAMILTON_AUTOLOAD_ENV, "0")
    with DEFAULT_CONFIG_LOCATION.open("w") as f:
        config.write(f)


def register_types(extension_name: str, dataframe_type: Type, column_type: Optional[Type]):
    """Registers the dataframe and column types for the extension. Note that column types are optional
    as some extensions may not have a column type (E.G. spark). In this case, this is not included

    :param extension_name: name of the extension doing the registering.
    :param dataframe_type: the dataframe type to register.
    :param column_type: the column type to register
    """
    global DF_TYPE_AND_COLUMN_TYPES
    output = {}
    output[DATAFRAME_TYPE] = dataframe_type
    if column_type is not None:
        output[COLUMN_TYPE] = column_type
    DF_TYPE_AND_COLUMN_TYPES[extension_name] = output


@functools.singledispatch
def get_column(df: Any, column_name: str):
    """Gets a column from a dataframe.

    Each extension should register a function for this.

    :param df: the dataframe.
    :param column_name: the column name.
    :return: the correct "representation" of a column for this "dataframe".
    """
    raise NotImplementedError()


@functools.singledispatch
def fill_with_scalar(df: Any, column_name: str, scalar_value: Any) -> Any:
    """Fills a column with a scalar value.

    :param df: the dataframe.
    :param column_name: the column to fill.
    :param scalar_value: the scalar value to fill with.
    :return: the modified dataframe.
    """
    raise NotImplementedError()


def get_column_type_from_df_type(dataframe_type: Type) -> Type:
    """Function to cycle through the registered extensions and return the column type for the dataframe type.

    :param dataframe_type: the dataframe type to find the column type for.
    :return: the column type.
    :raises: NotImplementedError if we don't know what the column type is.
    """
    for _extension, type_map in DF_TYPE_AND_COLUMN_TYPES.items():
        if dataframe_type == type_map[DATAFRAME_TYPE]:
            return type_map[COLUMN_TYPE]
    raise NotImplementedError(
        f"Cannot get column type for [{dataframe_type}]. "
        f"Registered types are {DF_TYPE_AND_COLUMN_TYPES}"
    )


LOADER_REGISTRY = collections.defaultdict(list)
SAVER_REGISTRY = collections.defaultdict(list)


def register_adapter(adapter: Any):
    """Registers a adapter. Note that the type is any,
    because we can't import it here due to circular imports.

    :param adapter: the adapter to register.
    """
    if adapter.can_load():
        LOADER_REGISTRY[adapter.name()].append(adapter)
    if adapter.can_save():
        SAVER_REGISTRY[adapter.name()].append(adapter)


def get_registered_dataframe_types() -> Dict[str, Type]:
    """Returns a dictionary of extension name -> dataframe type.

    :return: the dictionary.
    """
    return {
        extension: type_map[DATAFRAME_TYPE]
        for extension, type_map in DF_TYPE_AND_COLUMN_TYPES.items()
    }


def get_registered_column_types() -> Dict[str, Type]:
    """Returns a dictionary of extension name -> column type.

    :return: the dictionary.
    """
    return {
        extension: type_map[COLUMN_TYPE] for extension, type_map in DF_TYPE_AND_COLUMN_TYPES.items()
    }
