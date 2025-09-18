import logging
import sys
from typing import Any, Dict, Optional

import aiohttp
from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack import component
from langfuse.decorators import observe

from src.core.engine import Engine
from src.core.pipeline import BasicPipeline

logger = logging.getLogger("wren-ai-service")


@component
class DataFetcher:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(
        self,
        sql: str,
        project_id: str | None = None,
        limit: int = 500,
    ):
        async with aiohttp.ClientSession() as session:
            _, data, addition = await self._engine.execute_sql(
                sql,
                session,
                project_id=project_id,
                dry_run=False,
                limit=limit,
            )

            if addition.get("error_message"):
                return {"results": data, "error_message": addition.get("error_message")}
            return {"results": data}


## Start of Pipeline
@observe(capture_input=False)
async def execute_sql(
    sql: str,
    data_fetcher: DataFetcher,
    project_id: str | None = None,
    limit: int = 500,
) -> dict:
    return await data_fetcher.run(
        sql=sql,
        project_id=project_id,
        limit=limit,
    )


## End of Pipeline


class SQLExecutor(BasicPipeline):
    def __init__(
        self,
        engine: Engine,
        description: str = "",
        **kwargs,
    ):
        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

        self._description = description
        self._components = {
            "data_fetcher": DataFetcher(engine=engine),
        }

    @observe(name="SQL Execution")
    async def run(
        self, sql: str, project_id: str | None = None, limit: int = 500
    ) -> dict:
        logger.info("SQL Execution pipeline is running...")
        return await self._pipe.execute(
            ["execute_sql"],
            inputs={
                "sql": sql,
                "project_id": project_id,
                "limit": limit,
                **self._components,
            },
        )
