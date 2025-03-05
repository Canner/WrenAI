# -*- coding: utf-8 -*-
"""
The implementation of thread patching for Python versions
prior to 3.13.

Internal use only.
"""
import sys

from ._util import _patch_module
from ._util import _queue_warning
from ._util import _notify_patch

from ._state import is_object_patched

def _patch_existing_locks(threading):
    if len(list(threading.enumerate())) != 1:
        return
    # This is used to protect internal data structures for enumerate.
    # It's acquired when threads are started and when they're stopped.
    # Stopping a thread checks a Condition, which on Python 2 wants to test
    # _is_owned of its (patched) Lock. Since our LockType doesn't have
    # _is_owned, it tries to acquire the lock non-blocking; that triggers a
    # switch. If the next thing in the callback list was a thread that needed
    # to start or end, we wouldn't be able to acquire this native lock
    # because it was being held already; we couldn't switch either, so we'd
    # block permanently.
    threading._active_limbo_lock = threading._allocate_lock()
    try:
        tid = threading.get_ident()
    except AttributeError:
        tid = threading._get_ident()
    rlock_type = type(threading.RLock())
    try:
        import importlib._bootstrap
    except ImportError:
        class _ModuleLock(object):
            pass
    else:
        _ModuleLock = importlib._bootstrap._ModuleLock # python 2 pylint: disable=no-member
    # It might be possible to walk up all the existing stack frames to find
    # locked objects...at least if they use `with`. To be sure, we look at every object
    # Since we're supposed to be done very early in the process, there shouldn't be
    # too many.

    # Note that the C implementation of locks, at least on some
    # versions of CPython, cannot be found and cannot be fixed (they simply
    # don't show up to GC; see https://github.com/gevent/gevent/issues/1354)

    # By definition there's only one thread running, so the various
    # owner attributes were the old (native) thread id. Make it our
    # current greenlet id so that when it wants to unlock and compare
    # self.__owner with _get_ident(), they match.
    gc = __import__('gc')
    for o in gc.get_objects():
        if isinstance(o, rlock_type):
            for owner_name in (
                    '_owner', # Python 3 or backported PyPy2
                    '_RLock__owner', # Python 2
            ):
                if hasattr(o, owner_name):
                    if getattr(o, owner_name) is not None:
                        setattr(o, owner_name, tid)
                    break
            else: # pragma: no cover
                raise AssertionError(
                    "Unsupported Python implementation; "
                    "Found unknown lock implementation.",
                    vars(o)
                )
        elif isinstance(o, _ModuleLock):
            if o.owner is not None:
                o.owner = tid



class BasePatcher:
    # Description of the hang:
    # There is an incompatibility with patching 'thread' and the 'multiprocessing' module:
    # The problem is that multiprocessing.queues.Queue uses a half-duplex multiprocessing.Pipe,
    # which is implemented with os.pipe() and _multiprocessing.Connection. os.pipe isn't patched
    # by gevent, as it returns just a fileno. _multiprocessing.Connection is an internal implementation
    # class implemented in C, which exposes a 'poll(timeout)' method; under the covers, this issues a
    # (blocking) select() call: hence the need for a real thread. Except for that method, we could
    # almost replace Connection with gevent.fileobject.SocketAdapter, plus a trivial
    # patch to os.pipe (below). Sigh, so close. (With a little work, we could replicate that method)

    # import os
    # import fcntl
    # os_pipe = os.pipe
    # def _pipe():
    #   r, w = os_pipe()
    #   fcntl.fcntl(r, fcntl.F_SETFL, os.O_NONBLOCK)
    #   fcntl.fcntl(w, fcntl.F_SETFL, os.O_NONBLOCK)
    #   return r, w
    # os.pipe = _pipe

    gevent_threading_mod = None
    gevent_thread_mod = None

    thread_mod = None
    threading_mod = None
    orig_current_thread = None
    main_thread = None
    orig_shutdown = None

    def __init__(self, threading=True, _threading_local=True, Event=True, logging=True,
                 existing_locks=True,
                 _warnings=None):
        self.threading = threading
        self.threading_local = _threading_local
        self.Event = Event
        self.logging = logging
        self.existing_locks = existing_locks
        self.warnings = _warnings



    def __call__(self):
        # The 'threading' module copies some attributes from the
        # thread module the first time it is imported. If we patch 'thread'
        # before that happens, then we store the wrong values in 'saved',
        # So if we're going to patch threading, we either need to import it
        # before we patch thread, or manually clean up the attributes that
        # are in trouble. The latter is tricky because of the different names
        # on different versions.


        self.threading_mod = __import__('threading')
        # Capture the *real* current thread object before
        # we start returning DummyThread objects, for comparison
        # to the main thread.
        self.orig_current_thread = self.threading_mod.current_thread()
        self.main_thread = self.threading_mod.main_thread()
        self.orig_shutdown = self.threading_mod._shutdown

        gevent_thread_mod, thread_mod = _patch_module('thread',
                                                      _warnings=self.warnings,
                                                      _notify_did_subscribers=False)


        if self.threading:
            self.patch_threading_event_logging_existing_locks()

        if self.threading_local:
            self.patch__threading_local()

        if self.threading:
            self.patch_active_threads()


        # Issue 18808 changes the nature of Thread.join() to use
        # locks. This means that a greenlet spawned in the main thread
        # (which is already running) cannot wait for the main thread---it
        # hangs forever. We patch around this if possible. See also
        # gevent.threading.
        already_patched = is_object_patched('threading', '_shutdown')

        if self.orig_current_thread == self.threading_mod.main_thread() and not already_patched:
            self.patch_threading_shutdown_on_main_thread_not_already_patched()
            self.patch_main_thread_cleanup()

        elif not already_patched:
            self.patch_shutdown_not_on_main_thread()

        from gevent import events
        _notify_patch(events.GeventDidPatchModuleEvent('thread',
                                                       gevent_thread_mod,
                                                       thread_mod))
        if self.gevent_threading_mod is not None:
            _notify_patch(events.GeventDidPatchModuleEvent('threading',
                                                           self.gevent_threading_mod,
                                                           self.threading_mod))

    def patch_threading_event_logging_existing_locks(self):

        self.gevent_threading_mod, patched_mod = _patch_module(
            'threading',
            _warnings=self.warnings,
            _notify_did_subscribers=False)

        assert patched_mod is self.threading_mod

        if self.Event:
            self.patch_event()

        if self.existing_locks:
            _patch_existing_locks(self.threading_mod)

        if self.logging and 'logging' in sys.modules:
            self.patch_logging()

    def patch_event(self):
        from .api import patch_item
        from gevent.event import Event
        patch_item(self.threading_mod, 'Event', Event)
        # Python 2 had `Event` as a function returning
        # the private class `_Event`. Some code may be relying
        # on that.
        if hasattr(self.threading_mod, '_Event'):
            patch_item(self.threading_mod, '_Event', Event)

    def patch_logging(self):
        from .api import patch_item
        logging = __import__('logging')
        patch_item(logging, '_lock', self.threading_mod.RLock())
        for wr in logging._handlerList:
            # In py26, these are actual handlers, not weakrefs
            handler = wr() if callable(wr) else wr
            if handler is None:
                continue
            if not hasattr(handler, 'lock'):
                raise TypeError("Unknown/unsupported handler %r" % handler)
            handler.lock = self.threading_mod.RLock()

    def patch__threading_local(self):
        _threading_local = __import__('_threading_local')
        from .api import patch_item
        from gevent.local import local
        patch_item(_threading_local, 'local', local)

    def patch_active_threads(self):
        raise NotImplementedError

    def patch_threading_shutdown_on_main_thread_not_already_patched(self):
        raise NotImplementedError

    def patch_main_thread_cleanup(self):
        # We create a bit of a reference cycle here,
        # so main_thread doesn't get to be collected in a timely way.
        # Not good. Take it out of dangling so we don't get
        # warned about it.
        main_thread = self.main_thread
        self.threading_mod._dangling.remove(main_thread)

        # Patch up the ident of the main thread to match. This
        # matters if threading was imported before monkey-patching
        # thread
        oldid = main_thread.ident
        main_thread._ident = self.threading_mod.get_ident()
        if oldid in self.threading_mod._active:
            self.threading_mod._active[main_thread.ident] = self.threading_mod._active[oldid]
        if oldid != main_thread.ident:
            del self.threading_mod._active[oldid]

    def patch_shutdown_not_on_main_thread(self):
        _queue_warning("Monkey-patching not on the main thread; "
                       "threading.main_thread().join() will hang from a greenlet",
                       self.warnings)

        from .api import patch_item

        main_thread = self.main_thread
        threading_mod = self.threading_mod
        get_ident = self.threading_mod.get_ident
        orig_shutdown = self.orig_shutdown
        def _shutdown():
            # We've patched get_ident but *did not* patch the
            # main_thread.ident value. Beginning in Python 3.9.8
            # and then later releases (3.10.1, probably), the
            # _main_thread object is only _stop() if the ident of
            # the current thread (the *real* main thread) matches
            # the ident of the _main_thread object. But without doing that,
            # the main thread's shutdown lock (threading._shutdown_locks) is never
            # removed *or released*, thus hanging the interpreter.
            # XXX: There's probably a better way to do this. Probably need to take a
            # step back and look at the whole picture.
            main_thread._ident = get_ident()
            orig_shutdown()
            patch_item(threading_mod, '_shutdown', orig_shutdown)
        patch_item(threading_mod, '_shutdown', _shutdown)

    @staticmethod # Static to be sure we don't accidentally capture `self` and keep it alive
    def _make_existing_non_main_thread_join_func(thread, thread_greenlet, threading_mod):
        from gevent.hub import sleep
        from time import time
        # TODO: This is almost the algorithm that the 3.13 _ThreadHandle class
        # employs. UNIFY them.
        def join(timeout=None):
            end = None
            if threading_mod.current_thread() is thread:
                raise RuntimeError("Cannot join current thread")
            if thread_greenlet is not None and thread_greenlet.dead:
                return
            # You may ask: Why not call thread_greenlet.join()?
            # Well, in the one case we actually have a greenlet, it's the
            # low-level greenlet.greenlet object for the main thread, which
            # doesn't have a join method.
            #
            # You may ask: Why not become the main greenlet's *parent*
            # so you can get notified when it finishes? Because you can't
            # create a greenlet cycle (the current greenlet is a descendent
            # of the parent), and nor can you set a greenlet's parent to None,
            # so there can only ever be one greenlet with a parent of None: the main
            # greenlet, the one we need to watch.
            #
            # You may ask: why not swizzle out the problematic lock on the main thread
            # into a gevent friendly lock? Well, the interpreter actually depends on that
            # for the main thread in threading._shutdown; see below.

            if not thread.is_alive():
                return

            if timeout:
                end = time() + timeout

            while thread.is_alive():
                if end is not None and time() > end:
                    return
                sleep(0.01)
        return join
