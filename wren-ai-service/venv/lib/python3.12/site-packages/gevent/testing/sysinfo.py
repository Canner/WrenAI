# Copyright (c) 2018 gevent community
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
import errno
import os
import sys

import gevent.core
from gevent import _compat as gsysinfo

VERBOSE = sys.argv.count('-v') > 1

# Python implementations
PYPY = gsysinfo.PYPY
CPYTHON = not PYPY

# Platform/operating system
WIN = gsysinfo.WIN
LINUX = gsysinfo.LINUX
OSX = gsysinfo.OSX

PURE_PYTHON = gsysinfo.PURE_PYTHON

get_this_psutil_process = gsysinfo.get_this_psutil_process

# XXX: Formalize this better
LIBUV = 'libuv' in gevent.core.loop.__module__ # pylint:disable=no-member
CFFI_BACKEND = PYPY or LIBUV or 'cffi' in os.getenv('GEVENT_LOOP', '')

if '--debug-greentest' in sys.argv:
    sys.argv.remove('--debug-greentest')
    DEBUG = True
else:
    DEBUG = False

RUN_LEAKCHECKS = os.getenv('GEVENTTEST_LEAKCHECK')
RUN_COVERAGE = os.getenv("COVERAGE_PROCESS_START") or os.getenv("GEVENTTEST_COVERAGE")

# Generally, ignore the portions that are only implemented
# on particular platforms; they generally contain partial
# implementations completed in different modules.
PLATFORM_SPECIFIC_SUFFIXES = ('2', '279', '3')
if WIN:
    PLATFORM_SPECIFIC_SUFFIXES += ('posix',)

PY2 = False # Never again
PY3 = True
PY35 = None
PY36 = None
PY37 = None
PY38 = None
PY39 = None
PY39_EXACTLY = None
PY310 = None
PY311 = None
PY312 = None
PY313 = None

NON_APPLICABLE_SUFFIXES = ()
if sys.version_info[0] == 3:
    # Python 3
    NON_APPLICABLE_SUFFIXES += ('2', '279')
    PY2 = False
    PY3 = True
    if sys.version_info[1] >= 5:
        PY35 = True
    if sys.version_info[1] >= 6:
        PY36 = True
    if sys.version_info[1] >= 7:
        PY37 = True
    if sys.version_info[1] >= 8:
        PY38 = True
    if sys.version_info[1] >= 9:
        PY39 = True
        if sys.version_info[:2] == (3, 9):
            PY39_EXACTLY = True
    if sys.version_info[1] >= 10:
        PY310 = True
    if sys.version_info[1] >= 11:
        PY311 = True
    if sys.version_info[1] >= 12:
        PY312 = True
    if sys.version_info[1] >= 13:
        PY313 = True


else: # pragma: no cover
    # Python 4?
    raise ImportError('Unsupported major python version')

PYPY3 = PYPY and PY3

if WIN:
    NON_APPLICABLE_SUFFIXES += ("posix",)
    # This is intimately tied to FileObjectPosix
    NON_APPLICABLE_SUFFIXES += ("fileobject2",)
    SHARED_OBJECT_EXTENSION = ".pyd"
else:
    SHARED_OBJECT_EXTENSION = ".so"

# We define GitHub actions to be similar to travis
RUNNING_ON_GITHUB_ACTIONS = os.environ.get('GITHUB_ACTIONS')
RUNNING_ON_TRAVIS = os.environ.get('TRAVIS') or RUNNING_ON_GITHUB_ACTIONS
RUNNING_ON_APPVEYOR = os.environ.get('APPVEYOR')
RUNNING_ON_CI = RUNNING_ON_TRAVIS or RUNNING_ON_APPVEYOR
RUNNING_ON_MANYLINUX = os.environ.get('GEVENT_MANYLINUX')
# I'm not sure how to reliably auto-detect this, without
# importing platform, something we don't want to do.
RUNNING_ON_MUSLLINUX = 'musllinux' in os.environ.get('GEVENT_MANYLINUX_NAME', '')

if RUNNING_ON_APPVEYOR:
    # We can't exec corecext on appveyor if we haven't run setup.py in
    # 'develop' mode (i.e., we install)
    NON_APPLICABLE_SUFFIXES += ('corecext',)

EXPECT_POOR_TIMER_RESOLUTION = (
    PYPY3
    # Really, this is probably only in VMs. But that's all I test
    # Windows with.
    or WIN
    or (LIBUV and PYPY)
    or RUN_COVERAGE
    or (OSX and RUNNING_ON_CI)
)


CONN_ABORTED_ERRORS = []
def _make_socket_errnos(*names):
    result = []
    for name in names:
        try:
            x = getattr(errno, name)
        except AttributeError:
            pass
        else:
            result.append(x)
    return frozenset(result)

CONN_ABORTED_ERRORS = _make_socket_errnos('WSAECONNABORTED', 'ECONNRESET')
CONN_REFUSED_ERRORS = _make_socket_errnos('WSAECONNREFUSED', 'ECONNREFUSED')

RESOLVER_ARES = os.getenv('GEVENT_RESOLVER') == 'ares'
RESOLVER_DNSPYTHON = os.getenv('GEVENT_RESOLVER') == 'dnspython'

RESOLVER_NOT_SYSTEM = RESOLVER_ARES or RESOLVER_DNSPYTHON

def get_python_version():
    """
    Return a string of the simple python version,
    such as '3.8.0b4'. Handles alpha, beta, release candidate, and final releases.
    """
    version = '%s.%s.%s' % sys.version_info[:3]
    if sys.version_info[3] == 'alpha':
        version += 'a%s' % sys.version_info[4]
    elif sys.version_info[3] == 'beta':
        version += 'b%s' % sys.version_info[4]
    elif sys.version_info[3] == 'candidate':
        version += 'rc%s' % sys.version_info[4]

    return version

def _parse_version(ver_str):
    try:
        from packaging.version import Version
        # InvalidVersion is a type of ValueError
    except ImportError:
        import warnings
        warnings.warn('packaging.version not available; assuming no advanced Linux backends')
        raise ValueError

    try:
        return Version(ver_str)
    except ValueError:
        import warnings
        warnings.warn('Unable to parse version %s' % (ver_str,))
        raise

def _check_linux_version_at_least(major, minor, error_kind):
    # pylint:disable=too-many-return-statements
    # ^ Yeah, but this is the most linear and simple way to
    # write this.
    from platform import system
    if system() != 'Linux':
        return  False

    from platform import release as _release
    release = _release()
    try:
        # Linux versions like '6.8.0-1014-azure' cannot be parsed
        # by packaging.version.Version, and distutils.LooseVersion, which
        # did handle that, is deprecated. Neither module is guaranteed to be available
        # anyway, so do the best we can manually.
        ver_strings = (release or '0').split('.', 2)

        if not ver_strings or int(ver_strings[0]) < major: # no way.
            return False

        if int(ver_strings[0]) > major: # Way newer!
            return True

        assert major == int(ver_strings[0]) # Exactly the major

        if len(ver_strings) < 2: # no minor version, assume no
            return False

        if int(ver_strings[1]) < minor:
            return False

        assert int(ver_strings[1]) >= minor, (ver_strings[1], minor)
        return True
    except AssertionError:
        raise
    except Exception: # pylint:disable=broad-exception-caught
        import warnings
        warnings.warn('Unable to parse version %r; assuming no %s support' % (
            release, error_kind
        ))
        return False

def libev_supports_linux_aio():
    # libev requires kernel 4.19 or above to be able to support
    # linux AIO. It can still be compiled in, but will fail to create
    # the loop at runtime.
    return _check_linux_version_at_least(4, 19, 'aio')


def libev_supports_linux_iouring():
    # libev requires kernel XXX to be able to support linux io_uring.
    # It fails with the kernel in fedora rawhide (4.19.76) but
    # works (doesn't fail catastrophically when asked to create one)
    # with kernel 5.3.0 (Ubuntu Bionic)
    return _check_linux_version_at_least(5, 3, 'iouring')


def resolver_dnspython_available():
    # Try hard not to leave around junk we don't have to.
    from importlib import metadata
    try:
        metadata.distribution('dnspython')
    except metadata.PackageNotFoundError:
        return False
    return True
