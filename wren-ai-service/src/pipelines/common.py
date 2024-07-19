import logging
from pprint import pformat
from typing import Any, Dict, List, Optional

import aiohttp
import orjson
from haystack import component

from src.core.engine import (
    Engine,
    add_quotes,
    clean_generation_result,
)

logger = logging.getLogger("wren-ai-service")


@component
class GenerationPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(self, replies: List[str]) -> Dict[str, Any]:
        cleaned_generation_result = orjson.loads(clean_generation_result(replies[0]))

        steps = cleaned_generation_result.get("steps", [])
        if not steps:
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        # make sure the last step has an empty cte_name
        steps[-1]["cte_name"] = ""

        for step in steps:
            step["sql"] = add_quotes(step["sql"])

        sql = self._build_cte_query(steps)
        logger.debug(f"GenerationPostProcessor: steps: {pformat(steps)}")
        logger.debug(f"GenerationPostProcessor: final sql: {sql}")

        if not await self._check_if_sql_executable(sql):
            return {
                "results": {
                    "description": cleaned_generation_result["description"],
                    "steps": [],
                },
            }

        return {
            "results": {
                "description": cleaned_generation_result["description"],
                "steps": steps,
            },
        }

    def _build_cte_query(self, steps) -> str:
        ctes = ",\n".join(
            f"{step['cte_name']} AS ({step['sql']})"
            for step in steps
            if step["cte_name"]
        )

        return f"WITH {ctes}\n" + steps[-1]["sql"] if ctes else steps[-1]["sql"]

    async def _check_if_sql_executable(
        self,
        sql: str,
    ):
        async with aiohttp.ClientSession() as session:
            status, error = await self._engine.dry_run_sql(sql, session)

        if not status:
            logger.exception(f"SQL is not executable: {error}")

        return status
