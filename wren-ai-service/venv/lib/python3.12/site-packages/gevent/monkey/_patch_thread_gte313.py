# -*- coding: utf-8 -*-
"""
The implementation of thread patching for Python versions
after 3.13.

Internal use only.
"""
import sys


from ._patch_thread_common import BasePatcher

class Patcher(BasePatcher):


    def patch_active_threads(self):
        from gevent.threading import main_native_thread

        for thread in self.threading_mod._active.values():
            if thread == main_native_thread():
                from greenlet import getcurrent
                from gevent.thread import _ThreadHandle
                thread._after_fork = lambda new_ident=None: new_ident
                thread._handle = _ThreadHandle()
                thread._handle._set_greenlet(getcurrent())
                thread._ident = thread._handle.ident
                assert thread.ident == thread._handle.ident
                continue
            thread.join = self._make_existing_non_main_thread_join_func(thread,
                                                                        None,
                                                                        self.threading_mod)

    def patch_threading_shutdown_on_main_thread_not_already_patched(self):
        import greenlet
        from .api import patch_item

        main_thread = self.main_thread
        threading_mod = self.threading_mod
        orig_shutdown = self.orig_shutdown
        _greenlet = main_thread._greenlet = greenlet.getcurrent()

        def _shutdown():
            # Release anyone trying to join() me,
            # and let us switch to them.
            main_thread._handle._set_done()
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
            class FakeHandle:
                def is_done(self):
                    return False
                def _set_done(self):
                    return
                def join(self):
                    return
            main_thread._handle = FakeHandle()
            assert main_thread.is_alive()
            # main_thread._is_stopped = False
            # main_thread._tstate_lock = main_thread.__real_tstate_lock
            # main_thread.__real_tstate_lock = None
            # The only truly blocking native shutdown lock to
            # acquire should be our own (hopefully), and the call to
            # _stop that orig_shutdown makes will discard it.

            # XXX: What if more get spawned?
            for t in list(threading_mod.enumerate()):
                if t.daemon or t is main_thread:
                    continue
                while t.is_alive():
                    try:
                        t._handle.join(0.001)
                    except RuntimeError:
                        # Joining ourself.
                        t._handle._set_done()
                        break

            orig_shutdown()
            patch_item(threading_mod, '_shutdown', self.orig_shutdown)

        patch_item(self.threading_mod, '_shutdown', _shutdown)
