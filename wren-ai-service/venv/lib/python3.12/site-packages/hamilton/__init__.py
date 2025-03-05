try:
    from .version import VERSION as __version__  # noqa: F401
except ImportError:
    from version import VERSION as __version__  # noqa: F401

# this supposedly is required for namespace packages to work.
__path__ = __import__("pkgutil").extend_path(__path__, __name__)
