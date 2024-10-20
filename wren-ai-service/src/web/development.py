import asyncio
import logging
import random
import time
import uuid

from fastapi import APIRouter, BackgroundTasks
from src.utils import async_timer
from src.web.v1.services.ask import (
    AskError,
    AskRequest,
    AskResponse,
    AskResultRequest,
    AskResultResponse,
)

logger = logging.getLogger("wren-ai-service")
router = APIRouter()
test_ask_results = {}


@async_timer
async def dummy_ask_task(ask_request: AskRequest):
    """
    Asynchronous task simulating a query processing request with random delays.
    This simulates different behaviors with varying sleep times.

    """
    await asyncio.sleep(random.randint(3, 7))

    # Simulating a CPU-bound task with asyncio to avoid blocking
    SYNC_SLEEP_TIME = 0.5
    await asyncio.to_thread(time.sleep, SYNC_SLEEP_TIME)

    test_ask_results[ask_request.query_id] = AskResultResponse(
        status="finished",
    )
    logger.info(f"Task completed for query_id: {ask_request.query_id}")


def get_dummy_ask_task_result(
    ask_result_request: AskResultRequest,
) -> AskResultResponse:
    result = test_ask_results.get(ask_result_request.query_id)
    
    if result is None:
        logger.warning(f"Query ID {ask_result_request.query_id} not found")
        return AskResultResponse(
            status="failed",
            error=AskError(
                code="OTHERS",
                message=f"{ask_result_request.query_id} is not found",
            ),
        )

    return result


@router.get("/dummy")
async def dummy(sleep: int = 4, is_async: bool = True, should_sleep: bool = True):
    """
    Dummy endpoint to test async behavior by sleeping for a configurable number of seconds.
    """
    if should_sleep:
        if is_async:
            await asyncio.sleep(sleep)
        else:
            await asyncio.to_thread(time.sleep, sleep)

    logger.info(f"Dummy endpoint with sleep={sleep}, is_async={is_async}")
    return {"dummy": "dummy"}


@router.post("/dummy-asks")
async def dummy_ask(
    ask_request: AskRequest,
    background_tasks: BackgroundTasks,
) -> AskResponse:
    """
    Endpoint to simulate an asynchronous ask request. The request is processed in the background.
    """
    query_id = str(uuid.uuid4())
    ask_request.query_id = query_id
    test_ask_results[query_id] = AskResultResponse(
        status="understanding",
    )

    logger.info(f"Received ask request with query_id: {query_id}")

    background_tasks.add_task(
        dummy_ask_task,
        ask_request,
    )
    return AskResponse(query_id=query_id)


@router.get("/dummy-asks/{query_id}/result")
async def get_dummy_ask_result(query_id: str) -> AskResultResponse:
    """
    Endpoint to retrieve the result of an asynchronous ask request by query ID.
    """
    logger.info(f"Fetching result for query_id: {query_id}")
    return get_dummy_ask_task_result(AskResultRequest(query_id=query_id))

