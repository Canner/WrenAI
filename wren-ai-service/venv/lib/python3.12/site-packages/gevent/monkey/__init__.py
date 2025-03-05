# Copyright (c) 2009-2012 Denis Bilenko. See LICENSE for details.
# pylint: disable=redefined-outer-name,too-many-lines
"""
Make the standard library cooperative.

The primary purpose of this module is to carefully patch, in place,
portions of the standard library with gevent-friendly functions that
behave in the same way as the original (at least as closely as possible).

The primary interface to this is the :func:`patch_all` function, which
performs all the available patches. It accepts arguments to limit the
patching to certain modules, but most programs **should** use the
default values as they receive the most wide-spread testing, and some monkey
patches have dependencies on others.

Patching **should be done as early as possible** in the lifecycle of the
program. For example, the main module (the one that tests against
``__main__`` or is otherwise the first imported) should begin with
this code, ideally before any other imports::

    from gevent import monkey
    monkey.patch_all()

A corollary of the above is that patching **should be done on the main
thread** and **should be done while the program is single-threaded**.

.. tip::

    Some frameworks, such as gunicorn, handle monkey-patching for you.
    Check their documentation to be sure.

.. warning::

    Patching too late can lead to unreliable behaviour (for example, some
    modules may still use blocking sockets) or even errors.

.. tip::

    Be sure to read the documentation for each patch function to check for
    known incompatibilities.

Querying
========

Sometimes it is helpful to know if objects have been monkey-patched, and in
advanced cases even to have access to the original standard library functions. This
module provides functions for that purpose.

- :func:`is_module_patched`
- :func:`is_object_patched`
- :func:`get_original`

.. _plugins:

Plugins and Events
==================

Beginning in gevent 1.3, events are emitted during the monkey patching process.
These events are delivered first to :mod:`gevent.events` subscribers, and then
to `setuptools entry points`_.

The following events are defined. They are listed in (roughly) the order
that a call to :func:`patch_all` will emit them.

- :class:`gevent.events.GeventWillPatchAllEvent`
- :class:`gevent.events.GeventWillPatchModuleEvent`
- :class:`gevent.events.GeventDidPatchModuleEvent`
- :class:`gevent.events.GeventDidPatchBuiltinModulesEvent`
- :class:`gevent.events.GeventDidPatchAllEvent`

Each event class documents the corresponding setuptools entry point name. The
entry points will be called with a single argument, the same instance of
the class that was sent to the subscribers.

You can subscribe to the events to monitor the monkey-patching process and
to manipulate it, for example by raising :exc:`gevent.events.DoNotPatch`.

You can also subscribe to the events to provide additional patching beyond what
gevent distributes, either for additional standard library modules, or
for third-party packages. The suggested time to do this patching is in
the subscriber for :class:`gevent.events.GeventDidPatchBuiltinModulesEvent`.
For example, to automatically patch `psycopg2`_ using `psycogreen`_
when the call to :func:`patch_all` is made, you could write code like this::

    # mypackage.py
    def patch_psycopg(event):
        from psycogreen.gevent import patch_psycopg
        patch_psycopg()

In your ``setup.py`` you would register it like this::

    from setuptools import setup
    setup(
        ...
        entry_points={
            'gevent.plugins.monkey.did_patch_builtins': [
                'psycopg2 = mypackage:patch_psycopg',
            ],
        },
        ...
    )

For more complex patching, gevent provides a helper method
that you can call to replace attributes of modules with attributes of your
own modules. This function also takes care of emitting the appropriate events.

- :func:`patch_module`

.. _setuptools entry points: http://setuptools.readthedocs.io/en/latest/setuptools.html#dynamic-discovery-of-services-and-plugins
.. _psycopg2: https://pypi.python.org/pypi/psycopg2
.. _psycogreen: https://pypi.python.org/pypi/psycogreen

Use as a module
===============

Sometimes it is useful to run existing python scripts or modules that
were not built to be gevent aware under gevent. To do so, this module
can be run as the main module, passing the script and its arguments.
For details, see the :func:`main` function.

.. versionchanged:: 1.3b1
   Added support for plugins and began emitting will/did patch events.
"""

import sys

####
# gevent developers: IMPORTANT: Keep imports
# as limited and localized as possible to avoid
# interfering with the monkey-patch process.
# This is why many imports are nested inside functions.
#
# This applies for this entire package.
###

__all__ = [
    'patch_all',
    'patch_builtins',
    'patch_dns',
    'patch_os',
    'patch_queue',
    'patch_select',
    'patch_signal',
    'patch_socket',
    'patch_ssl',
    'patch_subprocess',
    'patch_sys',
    'patch_thread',
    'patch_time',
    # query functions
    'get_original',
    'is_module_patched',
    'is_object_patched',

    # 'is_anything_patched', <- see docstring

    # plugin API
    'patch_module',
    # module functions
    'main',
    # Errors and warnings
    'MonkeyPatchWarning',
]

WIN = sys.platform.startswith("win")

# Unused imports may be removed in a major release after 2024-10.
# Used private imports may be renamed or removed or changed
# in an incompatible way at that time.



from ._errors import MonkeyPatchWarning

from ._util import _notify_patch
from ._util import _ignores_DoNotPatch

from ._state import saved
from ._state import is_module_patched
from ._state import is_object_patched

# Never documented as a public API, but
# potentially in use by third parties
# given the naming convention.
from ._state import is_anything_patched # pylint:disable=unused-import
from ._errors import _BadImplements # pylint:disable=unused-import



from .api import get_original
from .api import patch_module



# These are not part of the documented public API,
# but they could be used by plugins. TODO: Do we
# want to make them public with __all__?
from .api import patch_item
from .api import remove_item








from ._util import _check_availability
from ._util import _patch_module
from ._util import _queue_warning
from ._util import _process_warnings



def _patch_sys_std(name):
    from gevent.fileobject import FileObjectThread
    orig = getattr(sys, name)
    if not isinstance(orig, FileObjectThread):
        patch_item(sys, name, FileObjectThread(orig))

@_ignores_DoNotPatch
def patch_sys(stdin=True, stdout=True, stderr=True): # pylint:disable=unused-argument
    """
    Patch sys.std[in,out,err] to use a cooperative IO via a
    threadpool.

    This is relatively dangerous and can have unintended consequences
    such as hanging the process or `misinterpreting control keys`_
    when :func:`input` and :func:`raw_input` are used. :func:`patch_all`
    does *not* call this function by default.

    This method does nothing on Python 3. The Python 3 interpreter
    wants to flush the TextIOWrapper objects that make up
    stderr/stdout at shutdown time, but using a threadpool at that
    time leads to a hang.

    .. _`misinterpreting control keys`: https://github.com/gevent/gevent/issues/274

    .. deprecated:: 23.7.0
       Does nothing on any supported version.
    """
    return

@_ignores_DoNotPatch
def patch_os():
    """
    Replace :func:`os.fork` with :func:`gevent.fork`, and, on POSIX,
    :func:`os.waitpid` with :func:`gevent.os.waitpid` (if the
    environment variable ``GEVENT_NOWAITPID`` is not defined). Does
    nothing if fork is not available.

    .. caution:: This method must be used with :func:`patch_signal` to have proper `SIGCHLD`
         handling and thus correct results from ``waitpid``.
         :func:`patch_all` calls both by default.

    .. caution:: For `SIGCHLD` handling to work correctly, the event loop must run.
         The easiest way to help ensure this is to use :func:`patch_all`.
    """
    _patch_module('os')


@_ignores_DoNotPatch
def patch_queue():
    """
    Patch objects in :mod:`queue`.


    Currently, this just replaces :class:`queue.SimpleQueue` (implemented
    in C) with its Python counterpart, but the details may change at any time.

    .. versionadded:: 1.3.5
    """
    _patch_module('queue', items=[
        'SimpleQueue',
    ])


@_ignores_DoNotPatch
def patch_time():
    """
    Replace :func:`time.sleep` with :func:`gevent.sleep`.
    """
    _patch_module('time')

@_ignores_DoNotPatch
def patch_contextvars():
    """
    Replaces the implementations of :mod:`contextvars` with
    :mod:`gevent.contextvars`.

    On Python 3.7 and above, this is a standard library module. On
    earlier versions, a backport that uses the same distribution name
    and import name is available on PyPI (though this is not
    recommended). If that is installed, it will be patched.

    .. versionchanged:: 20.04.0
       Clarify that the backport is also patched.

    .. versionchanged:: 20.9.0
       This now does nothing on Python 3.7 and above.
       gevent now depends on greenlet 0.4.17, which
       natively handles switching context vars when greenlets are switched.
       Older versions of Python that have the backport installed will
       still be patched.

    .. deprecated:: 23.7.0
       Does nothing on any supported version.
    """
    return



@_ignores_DoNotPatch
def patch_thread(threading=True, _threading_local=True, Event=True, logging=True,
                 existing_locks=True,
                 _warnings=None):
    """
    patch_thread(threading=True, _threading_local=True, Event=True, logging=True, existing_locks=True) -> None

    Replace the standard :mod:`thread` module to make it greenlet-based.

    :keyword bool threading: When True (the default),
        also patch :mod:`threading`.
    :keyword bool _threading_local: When True (the default),
        also patch :class:`_threading_local.local`.
    :keyword bool logging: When True (the default), also patch locks
        taken if the logging module has been configured.

    :keyword bool existing_locks: When True (the default), and the
        process is still single threaded, make sure that any
        :class:`threading.RLock` (and, under Python 3, :class:`importlib._bootstrap._ModuleLock`)
        instances that are currently locked can be properly unlocked. **Important**: This is a
        best-effort attempt and, on certain implementations, may not detect all
        locks. It is important to monkey-patch extremely early in the startup process.
        Setting this to False is not recommended, especially on Python 2.

    .. caution::
        Monkey-patching :mod:`thread` and using
        :class:`multiprocessing.Queue` or
        :class:`concurrent.futures.ProcessPoolExecutor` (which uses a
        ``Queue``) will hang the process.

        Monkey-patching with this function and using
        sub-interpreters (and advanced C-level API) and threads may be
        unstable on certain platforms.

    .. versionchanged:: 1.1b1
        Add *logging* and *existing_locks* params.
    .. versionchanged:: 1.3a2
        ``Event`` defaults to True.
    """
    if sys.version_info[:2] < (3, 13):
        from ._patch_thread_lt313 import Patcher
    else:
        from ._patch_thread_gte313 import Patcher
    patch = Patcher(threading=threading, _threading_local=_threading_local, Event=Event,
                    logging=logging, existing_locks=existing_locks, _warnings=_warnings)
    patch()


@_ignores_DoNotPatch
def patch_socket(dns=True, aggressive=True):
    """
    Replace the standard socket object with gevent's cooperative
    sockets.

    :keyword bool dns: When true (the default), also patch address
        resolution functions in :mod:`socket`. See :doc:`/dns` for details.
    """
    from gevent import socket
    # Note: although it seems like it's not strictly necessary to monkey patch 'create_connection',
    # it's better to do it. If 'create_connection' was not monkey patched, but the rest of socket module
    # was, create_connection would still use "green" getaddrinfo and "green" socket.
    # However, because gevent.socket.socket.connect is a Python function, the exception raised by it causes
    # _socket object to be referenced by the frame, thus causing the next invocation of bind(source_address) to fail.
    if dns:
        items = socket.__implements__ # pylint:disable=no-member
    else:
        items = set(socket.__implements__) - set(socket.__dns__) # pylint:disable=no-member
    _patch_module('socket', items=items)
    if aggressive:
        if 'ssl' not in socket.__implements__: # pylint:disable=no-member
            remove_item(socket, 'ssl')

@_ignores_DoNotPatch
def patch_dns():
    """
    Replace :doc:`DNS functions </dns>` in :mod:`socket` with
    cooperative versions.

    This is only useful if :func:`patch_socket` has been called and is
    done automatically by that method if requested.
    """
    from gevent import socket
    _patch_module('socket', items=socket.__dns__) # pylint:disable=no-member


def _find_module_refs(to, excluding_names=()):
    # Looks specifically for module-level references,
    # i.e., 'from foo import Bar'. We define a module reference
    # as a dict (subclass) that also has a __name__ attribute.
    # This does not handle subclasses, but it does find them.
    # Returns two sets. The first is modules (name, file) that were
    # found. The second is subclasses that were found.
    gc = __import__('gc')
    direct_ref_modules = set()
    subclass_modules = set()

    def report(mod):
        return mod['__name__'], mod.get('__file__', '<unknown>')

    for r in gc.get_referrers(to):
        if isinstance(r, dict) and '__name__' in r:
            if r['__name__'] in excluding_names:
                continue

            for v in r.values():
                if v is to:
                    direct_ref_modules.add(report(r))
        elif isinstance(r, type) and to in r.__bases__ and 'gevent.' not in r.__module__:
            subclass_modules.add(r)

    return direct_ref_modules, subclass_modules

@_ignores_DoNotPatch
def patch_ssl(_warnings=None, _first_time=True):
    """
    patch_ssl() -> None

    Replace :class:`ssl.SSLSocket` object and socket wrapping functions in
    :mod:`ssl` with cooperative versions.

    This is only useful if :func:`patch_socket` has been called.
    """
    may_need_warning = (
        _first_time
        and 'ssl' in sys.modules
        and hasattr(sys.modules['ssl'], 'SSLContext'))
    # Previously, we didn't warn on Python 2 if pkg_resources has been imported
    # because that imports ssl and it's commonly used for namespace packages,
    # which typically means we're still in some early part of the import cycle.
    # However, with our new more discriminating check, that no longer seems to be a problem.
    # Prior to 3.6, we don't have the RecursionError problem, and prior to 3.7 we don't have the
    # SSLContext.sslsocket_class/SSLContext.sslobject_class problem.

    gevent_mod, _ = _patch_module('ssl', _warnings=_warnings)
    if may_need_warning:
        direct_ref_modules, subclass_modules = _find_module_refs(
            gevent_mod.orig_SSLContext,
            excluding_names=('ssl', 'gevent.ssl', 'gevent._ssl3', 'gevent._sslgte279'))
        if direct_ref_modules or subclass_modules:
            # Normally you don't want to have dynamic warning strings, because
            # the cache in the warning module is based on the string. But we
            # specifically only do this the first time we patch ourself, so it's
            # ok.
            direct_ref_mod_str = subclass_str = ''
            if direct_ref_modules:
                direct_ref_mod_str = 'Modules that had direct imports (NOT patched): %s. ' % ([
                    "%s (%s)" % (name, fname)
                    for name, fname in direct_ref_modules
                ])
            if subclass_modules:
                subclass_str = 'Subclasses (NOT patched): %s. ' % ([
                    str(t) for t in subclass_modules
                ])
            _queue_warning(
                'Monkey-patching ssl after ssl has already been imported '
                'may lead to errors, including RecursionError on Python 3.6. '
                'It may also silently lead to incorrect behaviour on Python 3.7. '
                'Please monkey-patch earlier. '
                'See https://github.com/gevent/gevent/issues/1016. '
                + direct_ref_mod_str + subclass_str,
                _warnings)


@_ignores_DoNotPatch
def patch_select(aggressive=True):
    """
    Replace :func:`select.select` with :func:`gevent.select.select`
    and :func:`select.poll` with :class:`gevent.select.poll` (where available).

    If ``aggressive`` is true (the default), also remove other
    blocking functions from :mod:`select` .

    - :func:`select.epoll`
    - :func:`select.kqueue`
    - :func:`select.kevent`
    - :func:`select.devpoll` (Python 3.5+)
    """
    _patch_module('select',
                  _patch_kwargs={'aggressive': aggressive})

@_ignores_DoNotPatch
def patch_selectors(aggressive=True):
    """
    Replace :class:`selectors.DefaultSelector` with
    :class:`gevent.selectors.GeventSelector`.

    If ``aggressive`` is true (the default), also remove other
    blocking classes :mod:`selectors`:

    - :class:`selectors.EpollSelector`
    - :class:`selectors.KqueueSelector`
    - :class:`selectors.DevpollSelector` (Python 3.5+)

    On Python 2, the :mod:`selectors2` module is used instead
    of :mod:`selectors` if it is available. If this module cannot
    be imported, no patching is done and :mod:`gevent.selectors` is
    not available.

    In :func:`patch_all`, the *select* argument controls both this function
    and :func:`patch_select`.

    .. versionadded:: 20.6.0
    """
    try:
        _check_availability('selectors')
    except ImportError: # pragma: no cover
        return

    _patch_module('selectors',
                  _patch_kwargs={'aggressive': aggressive})


@_ignores_DoNotPatch
def patch_subprocess():
    """
    Replace :func:`subprocess.call`, :func:`subprocess.check_call`,
    :func:`subprocess.check_output` and :class:`subprocess.Popen` with
    :mod:`cooperative versions <gevent.subprocess>`.

    .. note::
       On Windows under Python 3, the API support may not completely match
       the standard library.

    """
    _patch_module('subprocess')

@_ignores_DoNotPatch
def patch_builtins():
    """
    Make the builtin :func:`__import__` function `greenlet safe`_ under Python 2.

    .. note::
       This does nothing under Python 3 as it is not necessary. Python 3 features
       improved import locks that are per-module, not global.

    .. _greenlet safe: https://github.com/gevent/gevent/issues/108

    .. deprecated:: 23.7.0
       Does nothing on any supported platform.
    """


@_ignores_DoNotPatch
def patch_signal():
    """
    Make the :func:`signal.signal` function work with a :func:`monkey-patched os <patch_os>`.

    .. caution:: This method must be used with :func:`patch_os` to have proper ``SIGCHLD``
         handling. :func:`patch_all` calls both by default.

    .. caution:: For proper ``SIGCHLD`` handling, you must yield to the event loop.
         Using :func:`patch_all` is the easiest way to ensure this.

    .. seealso:: :mod:`gevent.signal`
    """
    _patch_module("signal")


def _check_repatching(**module_settings):
    _warnings = []
    key = '_gevent_saved_patch_all_module_settings'

    del module_settings['kwargs']
    currently_patched = saved.setdefault(key, {})
    first_time = not currently_patched
    if not first_time and currently_patched != module_settings:
        _queue_warning("Patching more than once will result in the union of all True"
                       " parameters being patched",
                       _warnings)

    to_patch = {}
    for k, v in module_settings.items():
        # If we haven't seen the setting at all, record it and echo it.
        # If we have seen the setting, but it became true, record it and echo it.
        if k not in currently_patched:
            to_patch[k] = currently_patched[k] = v
        elif v and not currently_patched[k]:
            to_patch[k] = currently_patched[k] = True

    return _warnings, first_time, to_patch


def _subscribe_signal_os(will_patch_all):
    if will_patch_all.will_patch_module('signal') and not will_patch_all.will_patch_module('os'):
        warnings = will_patch_all._warnings # Internal
        _queue_warning('Patching signal but not os will result in SIGCHLD handlers'
                       ' installed after this not being called and os.waitpid may not'
                       ' function correctly if gevent.subprocess is used. This may raise an'
                       ' error in the future.',
                       warnings)

def patch_all(socket=True, dns=True, time=True, select=True, thread=True, os=True, ssl=True,
              subprocess=True, sys=False, aggressive=True, Event=True,
              builtins=True, signal=True,
              queue=True, contextvars=True,
              **kwargs):
    """
    Do all of the default monkey patching (calls every other applicable
    function in this module).

    :return: A true value if patching all modules wasn't cancelled, a false
      value if it was.

    .. versionchanged:: 1.1
       Issue a :mod:`warning <warnings>` if this function is called multiple times
       with different arguments. The second and subsequent calls will only add more
       patches, they can never remove existing patches by setting an argument to ``False``.
    .. versionchanged:: 1.1
       Issue a :mod:`warning <warnings>` if this function is called with ``os=False``
       and ``signal=True``. This will cause SIGCHLD handlers to not be called. This may
       be an error in the future.
    .. versionchanged:: 1.3a2
       ``Event`` defaults to True.
    .. versionchanged:: 1.3b1
       Defined the return values.
    .. versionchanged:: 1.3b1
       Add ``**kwargs`` for the benefit of event subscribers. CAUTION: gevent may add
       and interpret additional arguments in the future, so it is suggested to use prefixes
       for kwarg values to be interpreted by plugins, for example, `patch_all(mylib_futures=True)`.
    .. versionchanged:: 1.3.5
       Add *queue*, defaulting to True, for Python 3.7.
    .. versionchanged:: 1.5
       Remove the ``httplib`` argument. Previously, setting it raised a ``ValueError``.
    .. versionchanged:: 1.5a3
       Add the ``contextvars`` argument.
    .. versionchanged:: 1.5
       Better handling of patching more than once.
    """
    # pylint:disable=too-many-locals,too-many-branches

    # Check to see if they're changing the patched list
    _warnings, first_time, modules_to_patch = _check_repatching(**locals())

    if not modules_to_patch:
        # Nothing to do. Either the arguments were identical to what
        # we previously did, or they specified false values
        # for things we had previously patched.
        _process_warnings(_warnings)
        return

    for k, v in modules_to_patch.items():
        locals()[k] = v

    from gevent import events
    try:
        _notify_patch(events.GeventWillPatchAllEvent(modules_to_patch, kwargs), _warnings)
    except events.DoNotPatch:
        return False

    # order is important
    if os:
        patch_os()
    if thread:
        patch_thread(Event=Event, _warnings=_warnings)
    if time:
        # time must be patched after thread, some modules used by thread
        # need access to the real time.sleep function.
        patch_time()

    # sys must be patched after thread. in other cases threading._shutdown will be
    # initiated to _MainThread with real thread ident
    if sys:
        patch_sys()
    if socket:
        patch_socket(dns=dns, aggressive=aggressive)
    if select:
        patch_select(aggressive=aggressive)
        patch_selectors(aggressive=aggressive)
    if ssl:
        patch_ssl(_warnings=_warnings, _first_time=first_time)
    if subprocess:
        patch_subprocess()
    if builtins:
        patch_builtins()
    if signal:
        patch_signal()
    if queue:
        patch_queue()
    if contextvars:
        patch_contextvars()

    _notify_patch(events.GeventDidPatchBuiltinModulesEvent(modules_to_patch, kwargs), _warnings)
    _notify_patch(events.GeventDidPatchAllEvent(modules_to_patch, kwargs), _warnings)

    _process_warnings(_warnings)
    return True

def __getattr__(name):
    if name == 'main':
        from ._main import main
        return main
    raise AttributeError(name)
