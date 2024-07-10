import logging
import os
from typing import Any, Dict, Optional, Tuple

import aiohttp
import orjson

from src.core.engine import Engine, add_quotes, remove_limit_statement
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")


@provider("wren_ui")
class WrenUI(Engine):
    def __init__(self, endpoint: str = os.getenv("WREN_UI_ENDPOINT")):
        self._endpoint = endpoint

    async def dry_run_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        properties: Dict[str, Any] = {},
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


@provider("wren_ibis")
class WrenIbis(Engine):
    def __init__(self, endpoint: str = os.getenv("WREN_IBIS_ENDPOINT")):
        self._endpoint = endpoint

    async def dry_run_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        properties: Dict[str, Any] = {
            "source": os.getenv("WREN_IBIS_SOURCE"),
            "manifest": os.getenv("WREN_IBIS_MANIFEST"),
            "connection_info": orjson.loads(
                os.getenv("WREN_IBIS_CONNECTION_INFO", "{}")
            ),
        },
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        async with session.post(
            f"{self._endpoint}/v2/connector/{properties.get('source', '')}/query?dryRun=true",
            json={
                "sql": remove_limit_statement(add_quotes(sql)),
                "manifestStr": properties.get("manifest", ""),
                "connectionInfo": properties.get("connection_info", {}),
            },
        ) as response:
            if response.status == 204:
                return True, None
            res = await response.text()

            return False, res
