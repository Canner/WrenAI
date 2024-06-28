import asyncio
import os

import aiohttp
import backoff
from dotenv import load_dotenv

load_dotenv(override=True)
if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
    load_dotenv(".env.dev", override=True)


@backoff.on_exception(backoff.expo, aiohttp.ClientError, max_time=60, max_tries=3)
async def force_deploy():
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{os.getenv("WREN_UI_ENDPOINT", "http://wren-ui:3000")}/api/graphql",
            json={
                "query": "mutation Deploy($force: Boolean) { deploy(force: $force) }",
                "variables": {"force": True},
            },
            timeout=aiohttp.ClientTimeout(total=60),  # 60 seconds
        ) as response:
            res = await response.json()
            print(f"Forcing deployment: {res}")


if os.getenv("ENGINE", "wren-ui") == "wren-ui":
    asyncio.run(force_deploy())
