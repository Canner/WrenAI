"""
Implementation of the standard :mod:`thread` module that spawns greenlets.

.. note::

    This module is a helper for :mod:`gevent.monkey` and is not
    intended to be used directly. For spawning greenlets in your
    applications, prefer higher level constructs like
    :class:`gevent.Greenlet` class or :func:`gevent.spawn`.
"""
import sys

__implements__ = [
    'allocate_lock',
    'get_ident',
    'exit',
    'LockType',
    'stack_size',
    'start_new_thread',
    '_local',
] + ([
    'start_joinable_thread',
    'lock',
    '_ThreadHandle',
    '_make_thread_handle',
] if sys.version_info[:2] >= (3, 13) else [

])


__imports__ = ['error']

import _thread as __thread__ # pylint:disable=import-error

__target__ = '_thread'
__imports__ += [
    'TIMEOUT_MAX',
    'allocate',
    'exit_thread',
    'interrupt_main',
    'start_new'
]

# We can't actually produce a value that "may be used
# to identify this particular thread system-wide", right?
# Even if we could, I imagine people will want to pass this to
# non-Python (native) APIs, so we shouldn't mess with it.
__imports__.append('get_native_id')

# Added to 3.12
if hasattr(__thread__, 'daemon_threads_allowed'):
    __imports__.append('daemon_threads_allowed')

error = __thread__.error

from gevent._compat import PYPY
from gevent._util import copy_globals
from gevent.hub import getcurrent
from gevent.hub import GreenletExit
from gevent.hub import sleep
from gevent._hub_local import get_hub_if_exists
from gevent.greenlet import Greenlet
from gevent.lock import BoundedSemaphore
from gevent.local import local as _local
from gevent.exceptions import LoopExit


if hasattr(__thread__, 'RLock'):
    # Added in Python 3.4, backported to PyPy 2.7-7.0
    __imports__.append("RLock")



def get_ident(gr=None):
    if gr is None:
        gr = getcurrent()
    return id(gr)


def _start_new_greenlet(function, args=(), kwargs=None):
    if kwargs is not None:
        greenlet = Greenlet.spawn(function, *args, **kwargs) # pylint:disable=not-a-mapping
    else:
        greenlet = Greenlet.spawn(function, *args)
    return greenlet

def start_new_thread(function, args=(), kwargs=None):
    return get_ident(_start_new_greenlet(function, args, kwargs))

def start_joinable_thread(function, handle=None, daemon=True): # pylint:disable=unused-argument
    """
    *For internal use only*: start a new thread.

    Like start_new_thread(), this starts a new thread calling the given function.
    Unlike start_new_thread(), this returns a handle object with methods to join
    or detach the given thread.
    This function is not for third-party code, please use the
    `threading` module instead. During finalization the runtime will not wait for
    the thread to exit if daemon is True. If handle is provided it must be a
    newly created thread._ThreadHandle instance.
    """
    # The above docstring is from python 3.13.
    #
    # _thread._ThreadHandle has:
    #  - readonly property `ident`
    #  - method is_done
    #  - method join
    #  - method _set_done - threading._shutdown calls this
    #
    # I have no idea what it means  if you pass a provided handle,
    # because you can't change the ident once created, and
    # the constructor of ThreadHande takes arbitrary positional
    # and keyword arguments, and throws them away. (The ident is set
    # by C code directly accessing internal structure members).
    greenlet = _start_new_greenlet(function) # XXX: Daemon is ignored

    if handle is not None:
        assert isinstance(handle, _ThreadHandle)
        handle._set_greenlet(greenlet)

    return handle

class _ThreadHandle:
    # The constructor must accept and ignore all arguments
    # to match the stdlib.
    def __init__(self, *_args, **_kwargs):
        """Does nothing; ignores args"""

    # Must keep a weak reference to the greenlet
    # to avoid problems managing the _active list of
    # threads, which can sometimes rely on garbage collection.
    # Also, this breaks a cycle.
    _greenlet_ref = None

    def _set_greenlet(self, glet):
        from weakref import ref
        assert glet is not None
        self._greenlet_ref = ref(glet)

    def _get_greenlet(self):
        return (
            self._greenlet_ref()
            if self._greenlet_ref is not None
            else None
        )

    def join(self, timeout):
        # TODO: This is what we patch Thread.join to do on all versions,
        # so there's another implementation in gevent.monkey._patch_thread_common.
        # UNIFY THEM.
        glet = self._get_greenlet()
        if glet is not None:
            if glet is getcurrent():
                raise RuntimeError('Cannot joint current thread')
            if hasattr(glet, 'join'):
                return glet.join(timeout)
            # working with a raw greenlet. That
            # means it's probably the MainThread, because the main
            # greenlet is always raw. But it could also be a dummy
            from time import time

            end = None
            if timeout:
                end = time() + timeout

            while not self.is_done():
                if end is not None and time() > end:
                    return
                sleep(0.001)
        return None

    @property
    def ident(self):
        glet = self._get_greenlet()
        if glet is not None:
            return get_ident(glet)
        return None

    def is_done(self):
        glet = self._get_greenlet()
        if glet is None:
            return True

        return glet.dead

    def _set_done(self, enter_hub=True):
        """
        Mark the thread as complete.

        This releases our reference (if any) to our greenlet.

        By default, this will bounce back to the hub so that waiters
        in ``join`` can get notified. Set *enter_hub* to false not to
        do this.
        """
        self._greenlet_ref = None
        # Let the loop go around so that anyone waiting in
        # join() gets to know about it. This is particularly
        # important during threading/interpreter shutdown.
        if enter_hub:
            sleep(0.001)


    def __repr__(self):
        return '<%s.%s at 0x%x greenlet=%r>' % (
            self.__class__.__module__,
            self.__class__.__name__,
            id(self),
            self._get_greenlet()
        )

def _make_thread_handle(*_args):
    """
    Called on 3.13 after forking in the child.
    Takes ``(module, ident)``, returns a handle object
    with that ident.
    """
    # The argument _should_ be a thread identifier int
    handle = _ThreadHandle()
    handle._set_greenlet(getcurrent())
    return handle

class LockType(BoundedSemaphore):
    """
    The basic lock type.

    .. versionchanged:: 24.10.1
       Subclassing this object is no longer allowed. This matches the
       Python 3 API.
    """
    # Change the ValueError into the appropriate thread error
    # and any other API changes we need to make to match behaviour
    _OVER_RELEASE_ERROR = __thread__.error

    if PYPY:
        _OVER_RELEASE_ERROR = RuntimeError


    _TIMEOUT_MAX = __thread__.TIMEOUT_MAX # pylint:disable=no-member

    def __init__(self):
        """
        .. versionchanged:: 24.10.1
           No longer accepts arguments to pass to the super class. If you
           want a semaphore with a different count, use a semaphore class directly.
           This matches the Lock API of Python 3
        """
        super().__init__()

    @classmethod
    def __init_subclass__(cls):
        raise TypeError

    def acquire(self, blocking=True, timeout=-1):
        # This is the Python 3 signature.
        # On Python 2, Lock.acquire has the signature `Lock.acquire([wait])`
        # where `wait` is a boolean that cannot be passed by name, only position.
        # so we're fine to use the Python 3 signature.

        # Transform the default -1 argument into the None that our
        # semaphore implementation expects, and raise the same error
        # the stdlib implementation does.
        if timeout == -1:
            timeout = None
        if not blocking and timeout is not None:
            raise ValueError("can't specify a timeout for a non-blocking call")
        if timeout is not None:
            if timeout < 0:
                # in C: if(timeout < 0 && timeout != -1)
                raise ValueError("timeout value must be strictly positive")
            if timeout > self._TIMEOUT_MAX:
                raise OverflowError('timeout value is too large')


        try:
            acquired = BoundedSemaphore.acquire(self, blocking, timeout)
        except LoopExit:
            # Raised when the semaphore was not trivially ours, and we needed
            # to block. Some other thread presumably owns the semaphore, and there are no greenlets
            # running in this thread to switch to. So the best we can do is
            # release the GIL and try again later.
            if blocking: # pragma: no cover
                raise
            acquired = False

        if not acquired and not blocking and getcurrent() is not get_hub_if_exists():
            # Run other callbacks. This makes spin locks works.
            # We can't do this if we're in the hub, which we could easily be:
            # printing the repr of a thread checks its tstate_lock, and sometimes we
            # print reprs in the hub.
            # See https://github.com/gevent/gevent/issues/1464

            # By using sleep() instead of self.wait(0), we don't force a trip
            # around the event loop *unless* we've been running callbacks for
            # longer than our switch interval.
            sleep()
        return acquired

    # Should we implement _is_owned, at least for Python 2? See notes in
    # monkey.py's patch_existing_locks.

allocate_lock = lock = LockType


def exit():
    raise GreenletExit


if hasattr(__thread__, 'stack_size'):
    _original_stack_size = __thread__.stack_size

    def stack_size(size=None):
        if size is None:
            return _original_stack_size()
        if size > _original_stack_size():
            return _original_stack_size(size)
        # not going to decrease stack_size, because otherwise other
        # greenlets in this thread will suffer
else:
    __implements__.remove('stack_size')

__imports__ = copy_globals(__thread__, globals(),
                           only_names=__imports__,
                           ignore_missing_names=True)

__all__ = __implements__ + __imports__
__all__.remove('_local')


# XXX interrupt_main
# XXX _count()
