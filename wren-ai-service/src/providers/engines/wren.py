import logging
import os
from typing import Any, Dict, Optional, Tuple

import aiohttp

from src.core.engine import Engine, add_quotes, remove_limit_statement
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")


@provider("wren-ui")
class WrenUI(Engine):
    def __init__(self, endpoint: str = os.getenv("WREN_UI_ENDPOINT")):
        self._endpoint = endpoint

    async def dry_run_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        async with session.post(
            f"{self._endpoint}/api/graphql",
            json={
                "query": "mutation PreviewSql($data: PreviewSQLDataInput) { previewSql(data: $data) }",
                "variables": {
                    "data": {
                        "dryRun": True,
                        "limit": 1,
                        "sql": remove_limit_statement(add_quotes(sql)),
                    }
                },
            },
        ) as response:
            res = await response.json()
            if res.get("data"):
                return True, None
            return False, res.get("errors", [{}])[0].get("message", "Unknown error")
