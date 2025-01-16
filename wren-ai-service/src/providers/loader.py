import importlib
import logging
import pkgutil

logger = logging.getLogger("wren-ai-service")


PROVIDERS_PATH = "src.providers"
PROVIDERS = {}


def import_mods(package_name=PROVIDERS_PATH):
    """
    This function is designed to import all submodules within a given package,
    including those in nested packages.

    The function works by first importing the initial package using its name.
    It then iterates through the package directory and imports each submodule it encounters.
    This includes submodules in any nested packages.

    This is particularly useful in scenarios where you want to ensure that all submodules are loaded
    and ready for use, without having to manually import each one individually.

    Parameters:
        package_name (str): The name of the initial package to import submodules from.
        Defaults to the value of PROVIDERS_PATH.

    Returns:
        None: This function doesn't return anything; it simply imports the submodules.

    Raises:
        ModuleNotFoundError: If a submodule cannot be found.
    """
    package = importlib.import_module(package_name)

    # Iterate through all the submodules in the package
    for _, name, _ in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        # Import each submodule
        importlib.import_module(name)
        logger.info(f"Imported Provider: {name}")


def provider(name: str):
    """
    This decorator is designed to register a provider class and add it to the PROVIDERS dictionary.

    The decorator works by taking a name as an argument, which is used as a key in the PROVIDERS dictionary.
    The value associated with this key is the provider class that the decorator is applied to.

    This is particularly useful in scenarios where you want to maintain a registry of provider classes,
    and you want to be able to access these classes using a unique name.

    Parameters:
        name (str): The name of the provider. This is used as a key in the PROVIDERS dictionary.

    Returns:
        function: The decorator function that registers the provider class.

    Raises:
        KeyError: If a provider with the same name is already registered in the PROVIDERS dictionary.
    """

    def wrapper(cls):
        logger.info(f"Registering provider: {name}")
        PROVIDERS[name] = cls
        return cls

    return wrapper


def get_provider(name: str):
    """
    This function is designed to return a provider class by its name.

    The function works by taking a name as an argument, which is used to look up
    the corresponding provider class in a dictionary of registered providers.

    This is particularly useful in scenarios where you have a registry of provider classes
    and you want to be able to retrieve a specific provider class using its unique name.

    Parameters:
        name (str): The name of the provider. This is used as a key to look up
        the provider class in the dictionary of registered providers.

    Returns:
        type: The provider class corresponding to the given name.

    Raises:
        KeyError: If a provider with the given name is not found in the dictionary of registered providers.
    """
    logger.info(f"Getting provider: {name} from {PROVIDERS}")
    return PROVIDERS[name]
