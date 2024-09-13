import asyncio
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
class SQLBreakdownGenerationPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        results=Optional[Dict[str, Any]],
    )
    async def run(
        self,
        replies: List[str],
        project_id: str | None = None,
    ) -> Dict[str, Any]:
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
            step["sql"], no_error = add_quotes(step["sql"])
            if not no_error:
                return {
                    "results": {
                        "description": cleaned_generation_result["description"],
                        "steps": [],
                    },
                }

        sql = self._build_cte_query(steps)
        logger.debug(f"SQLBreakdownGenerationPostProcessor: steps: {pformat(steps)}")
        logger.debug(f"SQLBreakdownGenerationPostProcessor: final sql: {sql}")

        if not await self._check_if_sql_executable(sql, project_id=project_id):
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
        project_id: str | None = None,
    ):
        async with aiohttp.ClientSession() as session:
            status, _, error = await self._engine.execute_sql(
                sql,
                session,
                project_id=project_id,
            )

        if not status:
            logger.exception(f"SQL is not executable: {error}")

        return status


@component
class SQLGenerationPostProcessor:
    def __init__(self, engine: Engine):
        self._engine = engine

    @component.output_types(
        valid_generation_results=List[Optional[Dict[str, Any]]],
        invalid_generation_results=List[Optional[Dict[str, Any]]],
    )
    async def run(
        self,
        replies: List[str],
        project_id: str | None = None,
    ) -> dict:
        try:
            cleaned_generation_result = orjson.loads(
                clean_generation_result(replies[0])
            )["results"]

            if isinstance(cleaned_generation_result, dict):
                cleaned_generation_result = [cleaned_generation_result]

            (
                valid_generation_results,
                invalid_generation_results,
            ) = await self._classify_invalid_generation_results(
                cleaned_generation_result, project_id=project_id
            )

            return {
                "valid_generation_results": valid_generation_results,
                "invalid_generation_results": invalid_generation_results,
            }
        except Exception as e:
            logger.exception(f"Error in SQLGenerationPostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }

    async def _classify_invalid_generation_results(
        self, generation_results: List[Dict[str, str]], project_id: str | None = None
    ) -> List[Optional[Dict[str, str]]]:
        valid_generation_results = []
        invalid_generation_results = []

        async def _task(result: Dict[str, str]):
            quoted_sql, no_error = add_quotes(result["sql"])

            if no_error:
                status, _, error = await self._engine.execute_sql(
                    quoted_sql, session, project_id=project_id
                )

                if status:
                    valid_generation_results.append(
                        {
                            "sql": quoted_sql,
                        }
                    )
                else:
                    invalid_generation_results.append(
                        {
                            "sql": quoted_sql,
                            "type": "DRY_RUN",
                            "error": error,
                        }
                    )
            else:
                invalid_generation_results.append(
                    {
                        "sql": result["sql"],
                        "type": "ADD_QUOTES",
                        "error": "add_quotes failed",
                    }
                )

        async with aiohttp.ClientSession() as session:
            tasks = [
                _task(generation_result) for generation_result in generation_results
            ]
            await asyncio.gather(*tasks)

        return valid_generation_results, invalid_generation_results
