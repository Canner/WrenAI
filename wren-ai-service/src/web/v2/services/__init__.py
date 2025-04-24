import asyncio
from datetime import datetime
from typing import Callable, Literal, Optional

import orjson
import pytz
from pydantic import BaseModel


async def ensure_async(iterable):
    # if it's already async, just yield from it;
    # otherwise wrap the sync iterable.
    if hasattr(iterable, "__aiter__"):
        async for item in iterable:
            yield item
    else:
        for item in iterable:
            yield item


class Configurations(BaseModel):
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


class QueueNotFoundError(Exception):
    """Raised when someone tries to access or stop a non-existent queue."""

    def __init__(self, query_id: str):
        super().__init__(f"No result found for query_id: {query_id}")
        self.query_id = query_id


class QueryEventManager:
    def __init__(self):
        # one queue per query_id
        self._queues: dict[str, asyncio.Queue] = {}

    def get_queue(self, query_id: str) -> asyncio.Queue:
        if query_id not in self._queues:
            raise QueueNotFoundError(query_id)
        return self._queues[query_id]

    def start_queue(self, query_id: str):
        self._queues[query_id] = asyncio.Queue()

    def stop_queue(self, query_id: str):
        q = self.get_queue(query_id)
        _event = "message_stop"
        _data = {
            "type": "message_stop",
            "message": {
                "query_id": query_id,
            },
        }
        q.put_nowait((_event, _data))
        self.cleanup(query_id)

    async def _publish(self, query_id: str, event: str, data: dict):
        q = self.get_queue(query_id)
        await q.put((event, data))

    def cleanup(self, query_id: str):
        # remove the queue so it can be GC’d
        self._queues.pop(query_id, None)

    async def emit_message_start(
        self,
        query_id: str,
        trace_id: str,
    ):
        self.start_queue(query_id)
        await self._publish(
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
        self,
        query_id: str,
        trace_id: str,
    ):
        await self._publish(
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
        self,
        query_id: str,
        trace_id: str,
        error: Error,
    ):
        await self._publish(
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
        self,
        query_id: str,
        trace_id: str,
        index: int,
        emit_content_func: Callable,
        emit_content_func_kwargs: dict,
        *,
        content_block_label: Optional[str] = None,
        block_type: Literal["tool_use", "text"] = "tool_use",
        stream: bool = False,
    ):
        """Emit a complete content block (start → delta → stop)."""
        # 1) start
        await self._publish(
            query_id,
            "content_block_start",
            {
                "type": "content_block_start",
                "index": index,
                "message": {
                    "type": block_type,
                    "content_block_label": content_block_label or "",
                    "trace_id": trace_id,
                },
            },
        )

        result = emit_content_func(**emit_content_func_kwargs)
        if not stream:
            result, result_for_pipeline = await result
            final_result = result_for_pipeline
        else:
            final_result = ""

        async for chunk in ensure_async(result):
            if stream and block_type == "text":
                final_result += chunk
            await self._publish(
                query_id,
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": index,
                    "message": {
                        "type": ("json" if block_type == "tool_use" else "text")
                        + "_delta",
                        "content_block_label": content_block_label or "",
                        "content": orjson.dumps(chunk)
                        if block_type == "json"
                        else chunk,
                        "trace_id": trace_id,
                    },
                },
            )

        # 3) stop
        await self._publish(
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

        return final_result


from .conversation import ConversationService  # noqa: E402

__all__ = ["ConversationService"]
