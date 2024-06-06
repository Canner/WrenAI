import asyncio
import logging
import os
import random
import time
import uuid

import orjson
from fastapi import APIRouter, BackgroundTasks
from redislite import StrictRedis

from src.utils import async_timer
from src.web.v1.services.ask import (
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
)

logger = logging.getLogger("wren-ai-service")
router = APIRouter()

REDIS_DB = (
    StrictRedis(
        host=os.getenv("REDIS_HOST", "redis"),
        port=int(os.getenv("REDIS_PORT", 6379)),
    )
    if int(os.getenv("WORKERS", 1)) > 1
    else StrictRedis(
        "./redis.db",
    )
)


@async_timer
async def dummy_ask_task(ask_request: AskRequest):
    """
    settings:
    uvicorn workers 4

    {
        "user_class_name": "DummyAskUser",
        "fixed_count": 100
    }

    users = 100
    spawn-rate = 50
    run-time = 20s

    with only await asyncio.sleep, number of finished task is about 300
    with time.sleep(0.5) added, number of finished task is about 100
    with time.sleep(1) added, number of finished task is about 4
    with await asyncio.to_thread(time.sleep, 0.5) added, number of finished task is about 230
    with await asyncio.to_thread(time.sleep, 1) added, number of finished task is about 240-250
    """
    await asyncio.sleep(random.randint(3, 7))

    # SYNC_SLEEP_TIME = 0.5
    # time.sleep(SYNC_SLEEP_TIME)
    # await asyncio.to_thread(time.sleep, SYNC_SLEEP_TIME)

    REDIS_DB.hset(
        "test_ask_results",
        ask_request.query_id,
        AskResultResponse(
            status="finished",
        ).model_dump_json(),
    )


def get_dummy_ask_task_result(
    ask_result_request: AskResultRequest,
) -> AskResultResponse:
    if (
        result := REDIS_DB.hget("test_ask_results", ask_result_request.query_id)
    ) is None:
        return AskResultResponse(
            status="failed",
            error=AskResultResponse.AskError(
                code="OTHERS",
                message=f"{ask_result_request.query_id} is not found",
            ),
        )

    return AskResultResponse(**orjson.loads(result))


@router.get("/dummy")
async def dummy(sleep: int = 4, is_async: bool = True, should_sleep: bool = True):
    """
    Dummy endpoint to test async behavior by sleeping for several seconds
    """
    REDIS_DB.hset("dummy", "dummy", random.randint(1, 10))

    if should_sleep:
        if is_async:
            await asyncio.sleep(sleep)
        else:
            time.sleep(sleep)

    return {"dummy": REDIS_DB.hget("dummy", "dummy")}


@router.post("/dummy-asks")
async def dummy_ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
) -> AskResponse:
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    REDIS_DB.hset(
        "test_ask_results",
        query_id,
        AskResultResponse(
            status="understanding",
        ).model_dump_json(),
    )

    background_tasks.add_task(
        dummy_ask_task,
        ask_request,
    )
    return AskResponse(query_id=query_id)


@router.get("/dummy-asks/{query_id}/result")
async def get_dummy_ask_result(query_id: str) -> AskResultResponse:
    return get_dummy_ask_task_result(AskResultRequest(query_id=query_id))
