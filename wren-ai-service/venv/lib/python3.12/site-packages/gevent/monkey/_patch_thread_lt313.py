# -*- coding: utf-8 -*-
"""
The implementation of thread patching for Python versions
prior to 3.13.

Internal use only.
"""
import sys


from ._patch_thread_common import BasePatcher


class Patcher(BasePatcher):

    def patch_active_threads(self):
        from gevent.threading import main_native_thread
        threading_mod = self.threading_mod
        for thread in threading_mod._active.values():
            if thread == main_native_thread():
                continue
            thread.join = self._make_existing_non_main_thread_join_func(thread, None, threading_mod)


    def patch_threading_shutdown_on_main_thread_not_already_patched(self):
        import greenlet
        from .api import patch_item
        threading_mod = self.threading_mod
        main_thread = self.main_thread
        orig_shutdown = self.orig_shutdown

        _greenlet = main_thread._greenlet = greenlet.getcurrent()
        main_thread._gevent_real_tstate_lock = main_thread._tstate_lock
        assert main_thread._gevent_real_tstate_lock is not None
        # The interpreter will call threading._shutdown
        # when the main thread exits and is about to
        # go away. It is called *in* the main thread. This
        # is a perfect place to notify other greenlets that
        # the main thread is done. We do this by overriding the
        # lock of the main thread during operation, and only restoring
        # it to the native blocking version at shutdown time
        # (the interpreter also has a reference to this lock in a
        # C data structure).
        main_thread._tstate_lock = threading_mod.Lock()
        main_thread._tstate_lock.acquire()

        def _shutdown():
            # Release anyone trying to join() me,
            # and let us switch to them.
            if not main_thread._tstate_lock:
                return

            main_thread._tstate_lock.release()
            from gevent import sleep
            try:
                sleep()
            except: # pylint:disable=bare-except
                # A greenlet could have .kill() us
                # or .throw() to us. I'm the main greenlet,
                # there's no where else for this to go.
                from gevent  import get_hub
                get_hub().print_exception(_greenlet, *sys.exc_info())

            # Now, this may have resulted in us getting stopped
            # if some other greenlet actually just ran there.
            # That's not good, we're not supposed to be stopped
            # when we enter _shutdown.
            main_thread._is_stopped = False
            main_thread._tstate_lock = main_thread._gevent_real_tstate_lock
            main_thread._gevent_real_tstate_lock = None
            # The only truly blocking native shutdown lock to
            # acquire should be our own (hopefully), and the call to
            # _stop that orig_shutdown makes will discard it.

            orig_shutdown()
            patch_item(threading_mod, '_shutdown', orig_shutdown)

        patch_item(threading_mod, '_shutdown', _shutdown)
