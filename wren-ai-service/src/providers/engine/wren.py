import base64
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
        logger.info("Using Engine: wren_ui")

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


@provider("wren_ibis")
class WrenIbis(Engine):
    def __init__(
        self,
        endpoint: str = os.getenv("WREN_IBIS_ENDPOINT"),
        source: str = os.getenv("WREN_IBIS_SOURCE"),
        manifest: str = os.getenv("WREN_IBIS_MANIFEST"),
        connection_info: dict = (
            orjson.loads(base64.b64decode(os.getenv("WREN_IBIS_CONNECTION_INFO")))
            if os.getenv("WREN_IBIS_CONNECTION_INFO")
            else {}
        ),
    ):
        self._endpoint = endpoint
        self._source = source
        self._manifest = manifest
        self._connection_info = connection_info
        logger.info("Using Engine: wren_ibis")

    async def dry_run_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        async with session.post(
            f"{self._endpoint}/v2/connector/{self._source}/query?dryRun=true",
            json={
                "sql": remove_limit_statement(add_quotes(sql)),
                "manifestStr": self._manifest,
                "connectionInfo": self._connection_info,
            },
        ) as response:
            if response.status == 204:
                return True, None
            res = await response.text()

            return False, res


@provider("wren_engine")
class WrenEngine(Engine):
    def __init__(self, endpoint: str = os.getenv("WREN_ENGINE_ENDPOINT")):
        self._endpoint = endpoint
        logger.info("Using Engine: wren_engine")

    async def dry_run_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        properties: Dict[str, Any] = {
            "manifest": os.getenv("WREN_ENGINE_MANIFEST"),
        },
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        async with session.get(
            f"{self._endpoint}/v1/mdl/dry-run",
            json={
                "manifest": orjson.loads(base64.b64decode(properties.get("manifest")))
                if properties.get("manifest")
                else {},
                "sql": remove_limit_statement(add_quotes(sql)),
            },
        ) as response:
            if response.status == 200:
                return True, None
            res = await response.text()
            return False, res
