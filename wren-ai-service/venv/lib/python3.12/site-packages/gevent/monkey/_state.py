# -*- coding: utf-8 -*-
"""
State management and query functions for tracking and discovering what
has been patched.
"""
import logging

logger = logging.getLogger(__name__)


# maps module name -> {attribute name: original item}
# e.g. "time" -> {"sleep": built-in function sleep}
# NOT A PUBLIC API. However, third-party monkey-patchers may be using
# it? TODO: Provide better API for them.
saved:dict = {}


def is_module_patched(mod_name):
    """
    Check if a module has been replaced with a cooperative version.

    :param str mod_name: The name of the standard library module,
        e.g., ``'socket'``.

    """
    return mod_name in saved


def is_object_patched(mod_name, item_name):
    """
    Check if an object in a module has been replaced with a
    cooperative version.

    :param str mod_name: The name of the standard library module,
        e.g., ``'socket'``.
    :param str item_name: The name of the attribute in the module,
        e.g., ``'create_connection'``.

    """
    return is_module_patched(mod_name) and item_name in saved[mod_name]


def is_anything_patched():
    """
    Check if this module has done any patching in the current process.
    This is currently only used in gevent tests.

    Not currently a documented, public API, because I'm not convinced
    it is 100% reliable in the event of third-party patch functions that
    don't use ``saved``.

    .. versionadded:: 21.1.0
    """
    return bool(saved)

def _get_original(name, items):
    d = saved.get(name, {})
    values = []
    module = None
    for item in items:
        if item in d:
            values.append(d[item])
        else:
            if module is None:
                module = __import__(name)
            values.append(getattr(module, item))
    return values

def _save(module, attr_name, item):
    saved.setdefault(module.__name__, {}).setdefault(attr_name, item)
