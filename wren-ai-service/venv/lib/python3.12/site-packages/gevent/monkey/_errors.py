# -*- coding: utf-8 -*-
"""
Exception classes and errors that this package may raise.

"""
import logging

logger = logging.getLogger(__name__)

class _BadImplements(AttributeError):
    """
    Raised when ``__implements__`` is incorrect.
    """

    def __init__(self, module):
        AttributeError.__init__(
            self,
            "Module %r has a bad or missing value for __implements__" % (module,)
        )

class MonkeyPatchWarning(RuntimeWarning):
    """
    The type of warnings we issue.

    .. versionadded:: 1.3a2
    """
