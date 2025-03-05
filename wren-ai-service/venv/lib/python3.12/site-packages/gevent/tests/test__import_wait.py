# https://github.com/gevent/gevent/issues/652 and 651
from gevent import monkey
monkey.patch_all()

try:
    import _import_wait # pylint:disable=import-error
except ModuleNotFoundError:
    from gevent.tests import _import_wait

assert _import_wait.x
