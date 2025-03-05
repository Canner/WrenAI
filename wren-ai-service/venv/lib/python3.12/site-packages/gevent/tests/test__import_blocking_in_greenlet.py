#!/usr/bin/python
# See https://github.com/gevent/gevent/issues/108
import gevent
from gevent import monkey

import_errors = []


def some_func():
    try:
        from _blocks_at_top_level import x
        assert x == 'done'
    except ImportError as e:
        import_errors.append(e)
        raise

if __name__ == '__main__':
    import sys
    if sys.version_info[:2] == (3, 13):
        import unittest
        class Test(unittest.TestCase):
            def test_it(self):
                self.skipTest(
                    'On Python 3.13, no matter how I arrange the PYTHONPATH/sys.path '
                    'we get "cannot import name x from partially initialized module '
                    '_blocks_at_top_level". It is unclear why. Limiting the scope of '
                    'the exclusion for now.'
                )
        unittest.main()
    else:

        monkey.patch_all()
        import sys
        import os
        p = os.path.dirname(__file__)
        sys.path.insert(0, p)


        gs = [gevent.spawn(some_func) for i in range(2)]
        gevent.joinall(gs)

        assert not import_errors, import_errors
