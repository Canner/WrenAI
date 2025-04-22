import asyncio
import logging
from typing import Dict, List, Optional

import orjson
from fastapi import Request
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v2.services import (
    Configuration,
    Error,
    QueryEventManager,
)

logger = logging.getLogger("wren-ai-service")


class ConversationHistory(BaseModel):
    question: str
    sql: str


# POST /v2/conversations
class ConversationRequest(BaseModel):
    _query_id: str | None = None
    query: str
    project_id: Optional[str] = None
    mdl_hash: Optional[str] = None
    histories: Optional[List[ConversationHistory]] = Field(default_factory=list)
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class ConversationResponse(BaseModel):
    query_id: str


class ConversationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        max_histories: int = 5,
    ):
        self._pipelines = pipelines
        self._query_event_manager = QueryEventManager()
        self._max_histories = max_histories

    @observe(name="Start Conversation")
    @trace_metadata
    async def start_conversation(
        self,
        conversation_request: ConversationRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "conversation_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
            },
        }

        query_id = conversation_request.query_id
        # histories = conversation_request.histories[: self._max_histories][
        #     ::-1
        # ]  # reverse the order of histories

        try:
            await self._query_event_manager.emit_message_start(
                query_id,
                trace_id,
            )

            await self._query_event_manager.emit_message_stop(
                query_id,
                trace_id,
            )
        except Exception as e:
            logger.exception(f"conversation pipeline - OTHERS: {e}")

            await self._query_event_manager.emit_error(
                query_id,
                trace_id,
                Error(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)

        return results

    async def get_conversation_streaming_result(self, query_id: str, request: Request):
        queue = self._query_event_manager.get_queue(query_id)

        async def event_generator():
            while True:
                # if client disconnects, break
                if await request.is_disconnected():
                    break

                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    break

                payload = orjson.dumps(data).decode()
                yield f"event: {event}\n"
                yield f"data: {payload}\n\n"

                if event in ("message_stop", "error"):
                    break

            self._query_event_manager.cleanup(query_id)

        return event_generator()
