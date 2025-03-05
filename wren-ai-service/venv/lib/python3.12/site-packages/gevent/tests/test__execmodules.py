import unittest
import warnings

from gevent.testing import modules
from gevent.testing import main
from gevent.testing.sysinfo import NON_APPLICABLE_SUFFIXES
from gevent.testing import six

import pathlib

def make_exec_test(path, module):
    path = pathlib.Path(path)

    def test(_):

        with open(path, 'rb') as f:
            src = f.read()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', DeprecationWarning)
            globs = {'__file__': path, '__name__': module}
            if path.name == '__init__.py':
                globs['__path__'] = [path]
                globs['__package__'] = module
            elif '.' in module:
                globs['__package__'] = module.rsplit('.', 1)[0]
            try:
                six.exec_(src, globs)
            except ImportError:
                if module in modules.OPTIONAL_MODULES:
                    raise unittest.SkipTest("Unable to import optional module %s" % module)
                raise

    name = "test_" + module.replace(".", "_")
    test.__name__ = name
    return test

def make_all_tests(cls):
    for path, module in modules.walk_modules(recursive=True, check_optional=False):
        if module.endswith(NON_APPLICABLE_SUFFIXES):
            continue
        test = make_exec_test(path, module)
        setattr(cls, test.__name__, test)
    return cls


@make_all_tests
class Test(unittest.TestCase):
    pass


if __name__ == '__main__':
    # This should not be combined with other tests in the same process
    # because it messes with global shared state.
    # pragma: testrunner-no-combine
    main()
