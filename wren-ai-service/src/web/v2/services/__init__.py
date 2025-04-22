import asyncio
from collections import defaultdict
from datetime import datetime
from typing import Iterable, Iterator, Literal, Optional

import orjson
import pytz
from pydantic import BaseModel


class Configuration(BaseModel):
    def show_current_time(self):
        # Get the current time in the specified timezone
        tz = pytz.timezone(
            self.timezone
        )  # Assuming timezone.name contains the timezone string
        current_time = datetime.now(tz)

        return f"{current_time.strftime('%Y-%m-%d %A %H:%M:%S')}"  # YYYY-MM-DD weekday_name HH:MM:SS, ex: 2024-10-23 Wednesday 12:00:00

    language: Optional[str] = "English"
    timezone: Optional[str] = "UTC"


class Error(BaseModel):
    code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
    message: str


class QueryEventManager:
    def __init__(self):
        # one queue per query_id
        self.queues: dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)

    def get_queue(self, query_id: str) -> asyncio.Queue:
        return self.queues[query_id]

    async def publish(self, query_id: str, event: str, data: dict):
        q = self.get_queue(query_id)
        await q.put((event, data))

    def cleanup(self, query_id: str):
        # remove the queue so it can be GC’d
        self.queues.pop(query_id, None)


async def emit_message_start(
    query_manager: QueryEventManager,
    query_id: str,
    trace_id: str,
):
    await query_manager.publish(
        query_id,
        "message_start",
        {
            "type": "message_start",
            "message": {
                "query_id": query_id,
                "trace_id": trace_id,
            },
        },
    )


async def emit_message_stop(
    query_manager: QueryEventManager,
    query_id: str,
    trace_id: str,
):
    await query_manager.publish(
        query_id,
        "message_stop",
        {
            "type": "message_stop",
            "message": {
                "query_id": query_id,
                "trace_id": trace_id,
            },
        },
    )


async def emit_error(
    query_manager: QueryEventManager,
    query_id: str,
    trace_id: str,
    error: Error,
):
    await query_manager.publish(
        query_id,
        "error",
        {
            "type": "error",
            "message": {
                "query_id": query_id,
                "trace_id": trace_id,
                "code": error.code,
                "message": error.message,
            },
        },
    )


async def emit_content_block(
    query_manager: QueryEventManager,
    query_id: str,
    trace_id: str,
    index: int,
    pieces: Iterable[str],
    *,
    block_type: Literal["tool_use", "text"] = "tool_use",
):
    """Emit a complete content block (start → delta → stop)."""
    # 1) start
    await query_manager.publish(
        query_id,
        "content_block_start",
        {
            "type": "content_block_start",
            "index": index,
            "message": {
                "type": block_type,
                "trace_id": trace_id,
            },
        },
    )
    # 2) the actual payload
    for chunk in pieces:
        await query_manager.publish(
            query_id,
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": index,
                "message": {
                    "type": ("json" if block_type == "tool_use" else "text") + "_delta",
                    "content": orjson.dumps(chunk) if block_type == "json" else chunk,
                    "trace_id": trace_id,
                },
            },
        )
    # 3) stop
    await query_manager.publish(
        query_id,
        "content_block_stop",
        {
            "type": "content_block_stop",
            "index": index,
            "message": {
                "trace_id": trace_id,
            },
        },
    )


def chunk_text(s: str, size: int = 10) -> Iterator[str]:
    for i in range(0, len(s), size):
        yield s[i : i + size]


from .conversation import ConversationService  # noqa: E402

__all__ = ["ConversationService"]
