import asyncio
import time

from fastapi import APIRouter

router = APIRouter()


@router.get("/dummy")
async def dummy(sleep: int = 4, is_async: bool = True, should_sleep: bool = True):
    """
    Dummy endpoint to test async behavior by sleeping for several seconds
    """
    if should_sleep:
        if is_async:
            await asyncio.sleep(sleep)
        else:
            time.sleep(sleep)

    return {"status": "dummy"}
