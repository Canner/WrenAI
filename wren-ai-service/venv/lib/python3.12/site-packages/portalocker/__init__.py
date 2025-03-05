from . import __about__, constants, exceptions, portalocker
from .utils import (
    BoundedSemaphore,
    Lock,
    RLock,
    TemporaryFileLock,
    open_atomic,
)

try:  # pragma: no cover
    from .redis import RedisLock
except ImportError:  # pragma: no cover
    RedisLock = None  # type: ignore


#: The package name on Pypi
__package_name__ = __about__.__package_name__
#: Current author and maintainer, view the git history for the previous ones
__author__ = __about__.__author__
#: Current author's email address
__email__ = __about__.__email__
#: Version number
__version__ = '2.10.1'
#: Package description for Pypi
__description__ = __about__.__description__
#: Package homepage
__url__ = __about__.__url__


#: Exception thrown when the file is already locked by someone else
AlreadyLocked = exceptions.AlreadyLocked
#: Exception thrown if an error occurred during locking
LockException = exceptions.LockException


#: Lock a file. Note that this is an advisory lock on Linux/Unix systems
lock = portalocker.lock
#: Unlock a file
unlock = portalocker.unlock

#: Place an exclusive lock.
#: Only one process may hold an exclusive lock for a given file at a given
#: time.
LOCK_EX: constants.LockFlags = constants.LockFlags.EXCLUSIVE

#: Place a shared lock.
#: More than one process may hold a shared lock for a given file at a given
#: time.
LOCK_SH: constants.LockFlags = constants.LockFlags.SHARED

#: Acquire the lock in a non-blocking fashion.
LOCK_NB: constants.LockFlags = constants.LockFlags.NON_BLOCKING

#: Remove an existing lock held by this process.
LOCK_UN: constants.LockFlags = constants.LockFlags.UNBLOCK

#: Locking flags enum
LockFlags = constants.LockFlags

#: Locking utility class to automatically handle opening with timeouts and
#: context wrappers

__all__ = [
    'lock',
    'unlock',
    'LOCK_EX',
    'LOCK_SH',
    'LOCK_NB',
    'LOCK_UN',
    'LockFlags',
    'LockException',
    'Lock',
    'RLock',
    'AlreadyLocked',
    'BoundedSemaphore',
    'TemporaryFileLock',
    'open_atomic',
    'RedisLock',
]
