import asyncio
import os
import random
import time

from fastapi import APIRouter
from redislite import StrictRedis

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
