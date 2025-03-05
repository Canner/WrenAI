"""
Server Side Events (SSE) client for Python.

Provides a generator of SSE received through an existing HTTP response.
"""

from typing import Any, Generator, Optional

__all__ = ['SSEClient']

class SSEClient:
    """SSE client interface."""

    def __init__(self, event_source: Generator[bytes, None, None],
                 char_enc: str = 'utf-8'): ...
    def events(self) -> Generator[Event, None, None]: ...
    def close(self) -> None: ...

class Event:
    """Representation of an event from the event stream."""

    id: Optional[str]
    event: str
    data: str
    retry: Optional[Any]

    def __str__(self) -> str: ...
