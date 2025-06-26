import asyncio
import base64
import logging
import os
from typing import Any, Dict, Optional, Tuple

import aiohttp
import orjson

from src.core.engine import Engine, remove_limit_statement
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")


@provider("wren_ui")
class WrenUI(Engine):
    def __init__(
        self,
        endpoint: str = os.getenv("WREN_UI_ENDPOINT"),
        **_,
    ):
        self._endpoint = endpoint

    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        project_id: str | None = None,
        dry_run: bool = True,
        timeout: float = 30.0,
        limit: int = 500,
        **kwargs,
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        data = {
            "sql": remove_limit_statement(sql),
            "projectId": project_id,
        }
        if dry_run:
            data["dryRun"] = True
            data["limit"] = 1
        else:
            data["limit"] = limit

        try:
            async with session.post(
                f"{self._endpoint}/api/graphql",
                json={
                    "query": "mutation PreviewSql($data: PreviewSQLDataInput) { previewSql(data: $data) }",
                    "variables": {"data": data},
                },
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                res = await response.json()
                if data := res.get("data"):
                    data = data.get("previewSql", {}) if data else {}
                    return (
                        True,
                        data,
                        {
                            "correlation_id": res.get("correlationId"),
                        },
                    )

                error_message = res.get("errors", [{}])[0].get(
                    "message", "Unknown error"
                )
                logger.error(f"Error executing SQL: {error_message}")

                return (
                    False,
                    {},
                    {
                        "error_message": error_message,
                        "correlation_id": (
                            res.get("extensions", {})
                            .get("other", {})
                            .get("correlationId")
                        ),
                    },
                )
        except asyncio.TimeoutError:
            return (
                False,
                {},
                {"error_message": f"Request timed out: {timeout} seconds"},
            )


@provider("wren_ibis")
class WrenIbis(Engine):
    def __init__(
        self,
        endpoint: str = os.getenv("WREN_IBIS_ENDPOINT"),
        source: str = os.getenv("WREN_IBIS_SOURCE"),
        manifest: str = os.getenv("WREN_IBIS_MANIFEST"),
        connection_info: str = os.getenv("WREN_IBIS_CONNECTION_INFO"),
        **_,
    ):
        self._endpoint = endpoint
        self._source = source
        self._manifest = manifest
        self._connection_info = (
            orjson.loads(base64.b64decode(connection_info)) if connection_info else {}
        )

    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        dry_run: bool = True,
        timeout: float = 30.0,
        limit: int = 500,
        **kwargs,
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        api_endpoint = f"{self._endpoint}/v3/connector/{self._source}/query"
        if dry_run:
            api_endpoint += "?dryRun=true&limit=1"
        else:
            api_endpoint += f"?limit={limit}"

        try:
            async with session.post(
                api_endpoint,
                json={
                    "sql": remove_limit_statement(sql),
                    "manifestStr": self._manifest,
                    "connectionInfo": self._connection_info,
                },
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                if dry_run:
                    res = await response.text()
                else:
                    res = await response.json()

                if response.status == 200 or response.status == 204:
                    return (
                        True,
                        res,
                        {
                            "correlation_id": "",
                        },
                    )

                return (
                    False,
                    None,
                    {
                        "error_message": res,
                        "correlation_id": "",
                    },
                )
        except asyncio.TimeoutError:
            return False, None, f"Request timed out: {timeout} seconds"

    async def dry_plan(
        self,
        session: aiohttp.ClientSession,
        sql: str,
        data_source: str,
        timeout: float = 30.0,
        allow_fallback: bool = True,
        **kwargs,
    ) -> Tuple[bool, str]:
        api_endpoint = f"{self._endpoint}/v3/connector/{data_source}/dry-plan"
        try:
            async with session.post(
                api_endpoint,
                headers={
                    "x-wren-fallback_disable": "false" if allow_fallback else "true",
                },
                json={
                    "sql": sql,
                    "manifestStr": self._manifest,
                },
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                res = await response.text()

                if response.status != 200:
                    raise Exception(f"Request failed with message: {res}")

                return True, ""
        except asyncio.TimeoutError:
            logger.error(f"Request timed out: {timeout} seconds")
            return False, f"Request timed out: {timeout} seconds"
        except Exception as e:
            logger.exception(f"Unexpected error during dry_plan: {str(e)}")
            return False, f"Unexpected error during dry_plan: {str(e)}"

    async def get_func_list(
        self,
        session: aiohttp.ClientSession,
        data_source: str,
        timeout: float = 30.0,
    ) -> list[str]:
        api_endpoint = f"{self._endpoint}/v3/connector/{data_source}/functions"
        try:
            async with session.get(api_endpoint, timeout=timeout) as response:
                res = await response.json()

                if response.status != 200:
                    raise Exception(f"Request failed with message: {res}")

                return res
        except asyncio.TimeoutError:
            logger.error(f"Request timed out: {timeout} seconds")
            return []
        except Exception as e:
            logger.exception(f"Unexpected error during get_func_list: {str(e)}")
            return []


@provider("wren_engine")
class WrenEngine(Engine):
    def __init__(
        self,
        endpoint: str = os.getenv("WREN_ENGINE_ENDPOINT"),
        manifest: str = os.getenv("WREN_ENGINE_MANIFEST"),
        **_,
    ):
        self._endpoint = endpoint
        self._manifest = manifest

    async def execute_sql(
        self,
        sql: str,
        session: aiohttp.ClientSession,
        dry_run: bool = True,
        timeout: float = 30.0,
        limit: int = 500,
        **kwargs,
    ) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
        api_endpoint = (
            f"{self._endpoint}/v1/mdl/dry-run"
            if dry_run
            else f"{self._endpoint}/v1/mdl/preview"
        )

        try:
            async with session.get(
                api_endpoint,
                json={
                    "manifest": orjson.loads(base64.b64decode(self._manifest))
                    if self._manifest
                    else {},
                    "sql": remove_limit_statement(sql),
                    "limit": 1 if dry_run else limit,
                },
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                if dry_run:
                    res = await response.text()
                else:
                    res = await response.json()

                if response.status == 200:
                    return (
                        True,
                        res,
                        {
                            "correlation_id": "",
                        },
                    )

                return (
                    False,
                    None,
                    {
                        "error_message": res,
                        "correlation_id": "",
                    },
                )
        except asyncio.TimeoutError:
            return False, None, f"Request timed out: {timeout} seconds"
