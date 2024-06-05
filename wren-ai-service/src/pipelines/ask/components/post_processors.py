import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

import aiohttp
import orjson
from haystack import component

from src.engine import (
    add_quotes,
    clean_generation_result,
    dry_run_sql,
)

logger = logging.getLogger("wren-ai-service")


@component
class GenerationPostProcessor:
    @component.output_types(
        valid_generation_results=List[Optional[Dict[str, Any]]],
        invalid_generation_results=List[Optional[Dict[str, Any]]],
    )
    async def run(self, replies: List[str]):
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
                cleaned_generation_result
            )

            return {
                "valid_generation_results": valid_generation_results,
                "invalid_generation_results": invalid_generation_results,
            }
        except Exception as e:
            logger.error(f"Error in GenerationPostProcessor: {e}")

            return {
                "valid_generation_results": [],
                "invalid_generation_results": [],
            }

    async def _classify_invalid_generation_results(
        self,
        generation_results: List[Dict[str, str]],
    ) -> List[Optional[Dict[str, str]]]:
        valid_generation_results = []
        invalid_generation_results = []

        async def _task(result: Dict[str, str]):
            quoted_sql = add_quotes(result["sql"])

            response = await dry_run_sql(
                quoted_sql, session, endpoint=os.getenv("WREN_ENGINE_ENDPOINT")
            )

            if response.get("status") == 200:
                valid_generation_results.append(
                    {
                        "sql": quoted_sql,
                        "summary": result["summary"],
                    }
                )
            else:
                invalid_generation_results.append(
                    {
                        "sql": quoted_sql,
                        "summary": result["summary"],
                        "error": response.get("body", {}).get("message"),
                    }
                )

        async with aiohttp.ClientSession() as session:
            tasks = [
                _task(generation_result) for generation_result in generation_results
            ]
            await asyncio.gather(*tasks)

        return valid_generation_results, invalid_generation_results
