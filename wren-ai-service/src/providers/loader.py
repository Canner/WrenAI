import importlib
import logging
import pkgutil

logger = logging.getLogger("wren-ai-service")


PROVIDERS_PATH = "src.providers"
PROVIDERS = {}


def import_mods(package_name=PROVIDERS_PATH):
    """Import all submodules in a package. including nested packages."""
    package = importlib.import_module(package_name)

    # Iterate through all the submodules in the package
    for _, name, _ in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        # Import each submodule
        importlib.import_module(name)
        logger.debug(f"Imported Provider: {name}")


def provider(name: str):
    """
    This is a decorator to register a provider class. and add it to the PROVIDERS dict.

    param name: The name of the provider. used as a key in the PROVIDERS dict.

    """

    def wrapper(cls):
        logger.info(f"Registering provider: {name}")
        PROVIDERS[name] = cls
        return cls

    return wrapper


def get_provider(name: str):
    """
    Return the provider class by name.

    param name: The name of the provider.

    return: The provider class.

    raise KeyError: If the provider is not found.
    """
    logger.debug(f"Getting provider: {name} from {PROVIDERS}")

    return PROVIDERS[name]


if __name__ == "__main__":
    from src.providers.loader import PROVIDERS

    logging.basicConfig(level=logging.INFO)

    import_mods()
    get_provider("openai")
