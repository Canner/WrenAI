'''
Locking constants

Lock types:

- `EXCLUSIVE` exclusive lock
- `SHARED` shared lock

Lock flags:

- `NON_BLOCKING` non-blocking

Manually unlock, only needed internally

- `UNBLOCK` unlock
'''

import enum
import os

# The actual tests will execute the code anyhow so the following code can
# safely be ignored from the coverage tests
if os.name == 'nt':  # pragma: no cover
    import msvcrt

    #: exclusive lock
    LOCK_EX = 0x1
    #: shared lock
    LOCK_SH = 0x2
    #: non-blocking
    LOCK_NB = 0x4
    #: unlock
    LOCK_UN = msvcrt.LK_UNLCK  # type: ignore

elif os.name == 'posix':  # pragma: no cover
    import fcntl

    #: exclusive lock
    LOCK_EX = fcntl.LOCK_EX
    #: shared lock
    LOCK_SH = fcntl.LOCK_SH
    #: non-blocking
    LOCK_NB = fcntl.LOCK_NB
    #: unlock
    LOCK_UN = fcntl.LOCK_UN

else:  # pragma: no cover
    raise RuntimeError('PortaLocker only defined for nt and posix platforms')


class LockFlags(enum.IntFlag):
    #: exclusive lock
    EXCLUSIVE = LOCK_EX
    #: shared lock
    SHARED = LOCK_SH
    #: non-blocking
    NON_BLOCKING = LOCK_NB
    #: unlock
    UNBLOCK = LOCK_UN
