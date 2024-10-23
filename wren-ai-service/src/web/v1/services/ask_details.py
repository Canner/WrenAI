import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import add_quotes
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


class SQLBreakdown(BaseModel):
    sql: str
    summary: str
    cte_name: str


class AskDetails:
    class Input(BaseModel):
        query: str
        sql: str
        summary: str
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        project_id: Optional[str] = None
        user_id: Optional[str] = None
        language: str = "English"

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["NO_RELEVANT_SQL", "OTHERS"]
            message: str

        class ResponseDetails(BaseModel):
            description: str
            steps: List[SQLBreakdown]

        query_id: str
        status: Literal["understanding", "searching", "generating", "finished", "failed"]
        response: Optional[ResponseDetails] = None
        error: Optional[Error] = None


class AskDetailsService:
    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, AskDetails.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    @async_timer
    @observe(name="Ask Details(Breakdown SQL)")
    @trace_metadata
    async def ask_details(
        self,
        input: AskDetails.Input,
        **kwargs,
    ):
        query_id = self._generate_query_id()  # Implement this method
        resource = AskDetails.Resource(query_id=query_id, status="understanding")
        self._cache[query_id] = resource

        try:
            resource.status = "searching"
            self._cache[query_id] = resource

            resource.status = "generating"
            self._cache[query_id] = resource

            generation_result = await self._pipelines["sql_breakdown"].run(
                query=input.query,
                sql=input.sql,
                project_id=input.project_id,
                language=input.language,
            )

            ask_details_result = generation_result["post_process"]["results"]

            if not ask_details_result["steps"]:
                quoted_sql, no_error = add_quotes(input.sql)
                ask_details_result["steps"] = [
                    {
                        "sql": quoted_sql if no_error else input.sql,
                        "summary": input.summary,
                        "cte_name": "",
                    }
                ]

            resource.status = "finished"
            resource.response = AskDetails.Resource.ResponseDetails(**ask_details_result)
            self._cache[query_id] = resource

            return resource
        except Exception as e:
            logger.exception(f"ask-details pipeline - OTHERS: {e}")
            resource.status = "failed"
            resource.error = AskDetails.Resource.Error(
                code="OTHERS",
                message=str(e),
            )
            self._cache[query_id] = resource
            return resource

    def get_ask_details_result(self, query_id: str) -> AskDetails.Resource:
        if resource := self._cache.get(query_id):
            return resource
        
        return AskDetails.Resource(
            query_id=query_id,
            status="failed",
            error=AskDetails.Resource.Error(
                code="OTHERS",
                message=f"{query_id} is not found",
            ),
        )
