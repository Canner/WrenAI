# On Python 2, a deadlock is possible if we import a module that runs gevent's getaddrinfo
# with a unicode hostname, which starts Python's getaddrinfo on a thread, which
# attempts to import encodings.idna but blocks on the import lock. Verify
# that gevent avoids this deadlock.

try:
    import getaddrinfo_module # pylint:disable=import-error
except ModuleNotFoundError:
    from gevent.tests import getaddrinfo_module

del getaddrinfo_module  # fix pyflakes
