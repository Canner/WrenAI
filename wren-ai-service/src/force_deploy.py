# This file is only used for OSS, it will force deploy the mdl for the OSS users
# Since we allow users to customize llm and embedding models, which means qdrant collections may need to be recreated
# So, this file automates the process of force deploying the mdl

import asyncio
import os
from pathlib import Path

import aiohttp
import backoff
from dotenv import load_dotenv

if Path(".env.dev").exists():
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


if os.getenv("ENGINE", "wren_ui") == "wren_ui":
    asyncio.run(force_deploy())
