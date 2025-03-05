# -*- coding: utf-8 -*-
"""
Utilities used in patching.

Internal use only.

"""
import sys


def _notify_patch(event, _warnings=None):
    # Raises DoNotPatch if we're not supposed to patch
    from gevent.events import notify_and_call_entry_points

    event._warnings = _warnings
    notify_and_call_entry_points(event)

def _ignores_DoNotPatch(func):

    from functools import wraps

    @wraps(func)
    def ignores(*args, **kwargs):
        from gevent.events import DoNotPatch
        try:
            return func(*args, **kwargs)
        except DoNotPatch:
            return False

    return ignores

def _check_availability(name):
    """
    Test that the source and target modules for *name* are
    available and return them.

    :raise ImportError: If the source or target cannot be imported.
    :return: The tuple ``(gevent_module, target_module, target_module_name)``
    """
    # Always import the gevent module first. This helps us be sure we can
    # use regular imports in gevent files (when we can't use gevent.monkey.get_original())
    gevent_module = getattr(__import__('gevent.' + name), name)
    target_module_name = getattr(gevent_module, '__target__', name)
    target_module = __import__(target_module_name)

    return gevent_module, target_module, target_module_name


def _patch_module(name,
                  items=None,
                  _warnings=None,
                  _patch_kwargs=None,
                  _notify_will_subscribers=True,
                  _notify_did_subscribers=True,
                  _call_hooks=True):

    from .api import patch_module

    gevent_module, target_module, target_module_name = _check_availability(name)

    patch_module(target_module, gevent_module, items=items,
                 _warnings=_warnings, _patch_kwargs=_patch_kwargs,
                 _notify_will_subscribers=_notify_will_subscribers,
                 _notify_did_subscribers=_notify_did_subscribers,
                 _call_hooks=_call_hooks)

    # On Python 2, the `futures` package will install
    # a bunch of modules with the same name as those from Python 3,
    # such as `_thread`; primarily these just do `from thread import *`,
    # meaning we have alternate references. If that's already been imported,
    # we need to attempt to patch that too.

    # Be sure to keep the original states matching also.

    alternate_names = getattr(gevent_module, '__alternate_targets__', ())
    from ._state import saved # TODO: Add apis for these use cases.
    for alternate_name in alternate_names:
        alternate_module = sys.modules.get(alternate_name)
        if alternate_module is not None and alternate_module is not target_module:
            saved.pop(alternate_name, None)
            patch_module(alternate_module, gevent_module, items=items,
                         _warnings=_warnings,
                         _notify_will_subscribers=False,
                         _notify_did_subscribers=False,
                         _call_hooks=False)
            saved[alternate_name] = saved[target_module_name]

    return gevent_module, target_module


def _queue_warning(message, _warnings):
    # Queues a warning to show after the monkey-patching process is all done.
    # Done this way to avoid extra imports during the process itself, just
    # in case. If we're calling a function one-off (unusual) go ahead and do it
    if _warnings is None:
        _process_warnings([message])
    else:
        _warnings.append(message)


def _process_warnings(_warnings):
    import warnings
    from ._errors import MonkeyPatchWarning
    for warning in _warnings:
        warnings.warn(warning, MonkeyPatchWarning, stacklevel=3)
