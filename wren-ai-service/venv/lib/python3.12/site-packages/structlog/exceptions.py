# SPDX-License-Identifier: MIT OR Apache-2.0
# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the MIT License.  See the LICENSE file in the root of this
# repository for complete details.

"""
Exceptions factored out to avoid import loops.
"""

from __future__ import annotations


class DropEvent(BaseException):
    """
    If raised by an processor, the event gets silently dropped.

    Derives from BaseException because it's technically not an error.
    """
