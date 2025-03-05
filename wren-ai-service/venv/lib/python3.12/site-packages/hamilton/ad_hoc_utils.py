"""A suite of tools for ad-hoc use"""

import atexit
import importlib.util
import linecache
import os
import sys
import tempfile
import types
import uuid
from types import ModuleType
from typing import Callable, Optional


def _copy_func(f):
    """Returns a function with the same properties as the original one"""
    fn = types.FunctionType(f.__code__, f.__globals__, f.__name__, f.__defaults__, f.__closure__)
    # in case f was given attrs (note this dict is a shallow copy):
    fn.__dict__.update(f.__dict__)
    fn.__annotations__ = f.__annotations__  # No idea why this is not a parameter...
    return fn


def _generate_unique_temp_module_name() -> str:
    """Generates a unique module name that is a valid python variable."""
    return f"temporary_module_{str(uuid.uuid4()).replace('-', '_')}"


def create_temporary_module(*functions: Callable, module_name: str = None) -> ModuleType:
    """Creates a temporary module usable by hamilton. Note this should *not* be used in production --
    you should really be organizing your functions into modules. This is perfect in a jupyter notebook,
    however, where you have a few functions that you want to string together to build an ad-hoc driver. See notes below:

    NOTE (1): this currently *DOES NOT WORK* for scaling out onto Ray, Dask, or Pandas on Spark.

    NOTE (2): that this is slightly dangerous -- we want the module to look and feel like an actual module
    so we can fully duck-type it. We thus stick it in sys.modules (checking if it already exists).

    NOTE (3): If you pass in functions that start with "_" we will error out! That will just confuse you in the long run.

    :param functions: Functions to use
    :param module_name: Module name to use. If not provided will default to a unique one.
    :return: a "module" housing the passed in functions
    """
    module_name = module_name if module_name is not None else _generate_unique_temp_module_name()
    if module_name in sys.modules:
        raise ValueError(f"Module already exists with name: {module_name}, please make it unique.")
    module = ModuleType(module_name)
    for fn in map(_copy_func, functions):  # Copies so we don't mess with the original functions
        fn_name = fn.__name__
        if hasattr(module, fn_name):
            raise ValueError(
                f"Duplicate/reserved function name: {fn_name} cannot be used to create a temporary module."
            )
        if fn_name.startswith("_"):
            raise ValueError(
                f"In Hamilton, functions that start with '_' are reserved as helpers, and cannot be compiled into nodes in a DAG. "
                f"The function {fn_name} starts with '_' and would thus be pointless to include in a temprary module created"
                f" solely for the purpose of building a Hamilton DAG."
            )
        fn.__module__ = module.__name__
        setattr(module, fn_name, fn)
    sys.modules[module_name] = module
    return module


def module_from_source(source: str, module_name: Optional[str] = None) -> ModuleType:
    """Create a temporary module from source code."""
    module_name = module_name if module_name else _generate_unique_temp_module_name()
    module_object = ModuleType(module_name)
    code_object = compile(source, module_name, "exec")
    sys.modules[module_name] = module_object
    exec(code_object, module_object.__dict__)

    linecache.cache[module_name] = (
        len(source.splitlines()),
        None,
        source.splitlines(True),
        module_name,
    )
    return module_object


def create_module(source: str, module_name: str = None, verbosity: int = 0) -> ModuleType:
    """Create a temporary module from source code and load it as a proper Python module.

    Registers the module in sys.modules and cleans up the temporary file on interpreter shutdown.
    But if the python interpreter errors out, or the server is shutdown, the temporary file will not be cleaned up.
    """
    # Create a temporary file to hold the code
    with tempfile.NamedTemporaryFile(delete=False, suffix=".py", mode="w") as tmp_file:
        tmp_file.write(source)
        module_path = tmp_file.name
        if verbosity > 1:
            print(f"Temporary file created at {module_path}")

    # Determine a module name if not provided
    if module_name is None:
        module_name = os.path.basename(module_path).split(".")[0]

    # Load the module from the temporary file
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module_object = importlib.util.module_from_spec(spec)

    # Register the module in sys.modules
    sys.modules[module_name] = module_object
    spec.loader.exec_module(module_object)

    # Clean up the temporary file on interpreter shutdown
    def cleanup(module_path=module_path):
        os.remove(module_path)

    atexit.register(lambda: cleanup())

    return module_object
