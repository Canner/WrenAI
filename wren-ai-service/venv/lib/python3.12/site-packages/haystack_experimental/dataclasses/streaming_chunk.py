# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

from typing import Awaitable, Callable, Optional, Union

from haystack.dataclasses import StreamingChunk

from haystack_experimental.util import is_callable_async_compatible

StreamingCallbackT = Callable[[StreamingChunk], None]
AsyncStreamingCallbackT = Callable[[StreamingChunk], Awaitable[None]]


def select_streaming_callback(
    init_callback: Optional[Union[StreamingCallbackT, AsyncStreamingCallbackT]],
    runtime_callback: Optional[Union[StreamingCallbackT, AsyncStreamingCallbackT]],
    requires_async: bool,
) -> Optional[Union[StreamingCallbackT, AsyncStreamingCallbackT]]:
    """
    Picks the correct streaming callback given an optional initial and runtime callback.

    The runtime callback takes precedence over the initial callback.

    :param init_callback:
        The initial callback.
    :param runtime_callback:
        The runtime callback.
    :param requires_async:
        Whether the selected callback must be async compatible.
    :returns:
        The selected callback.
    """
    if init_callback is not None:
        if requires_async and not is_callable_async_compatible(init_callback):
            raise ValueError("The init callback must be async compatible.")
        if not requires_async and is_callable_async_compatible(init_callback):
            raise ValueError("The init callback cannot be a coroutine.")

    if runtime_callback is not None:
        if requires_async and not is_callable_async_compatible(runtime_callback):
            raise ValueError("The runtime callback must be async compatible.")
        if not requires_async and is_callable_async_compatible(runtime_callback):
            raise ValueError("The runtime callback cannot be a coroutine.")

    return runtime_callback or init_callback
