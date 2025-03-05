import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import add_quotes
from src.utils import trace_metadata
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


class SQLBreakdown(BaseModel):
    sql: str
    summary: str
    cte_name: str


# POST /v1/ask-details
class AskDetailsRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    mdl_hash: Optional[str] = None
    thread_id: Optional[str] = None
    project_id: Optional[str] = None
    configurations: Configuration = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class AskDetailsResponse(BaseModel):
    query_id: str


# GET /v1/ask-details/{query_id}/result
class AskDetailsResultRequest(BaseModel):
    query_id: str


class AskDetailsResultResponse(BaseModel):
    class AskDetailsResponseDetails(BaseModel):
        description: str
        steps: List[SQLBreakdown]

    class AskDetailsError(BaseModel):
        code: Literal["NO_RELEVANT_SQL", "OTHERS"]
        message: str

    status: Literal["understanding", "searching", "generating", "finished", "failed"]
    response: Optional[AskDetailsResponseDetails] = None
    error: Optional[AskDetailsError] = None


class AskDetailsService:
    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_details_results: Dict[str, AskDetailsResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    async def _add_summary_to_sql(self, sql: str, query: str, language: str):
        sql_summary_results = await self._pipelines["sql_summary"].run(
            query=query,
            sqls=[sql],
            language=language,
        )
        return sql_summary_results["post_process"]["sql_summary_results"]

    @observe(name="Ask Details(Breakdown SQL)")
    @trace_metadata
    async def ask_details(
        self,
        ask_details_request: AskDetailsRequest,
        **kwargs,
    ):
        results = {
            "ask_details_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            # ask details status can be understanding, searching, generating, finished, stopped
            # we will need to handle business logic for each status
            query_id = ask_details_request.query_id

            self._ask_details_results[query_id] = AskDetailsResultResponse(
                status="understanding",
            )

            self._ask_details_results[query_id] = AskDetailsResultResponse(
                status="searching",
            )

            self._ask_details_results[query_id] = AskDetailsResultResponse(
                status="generating",
            )

            generation_result = await self._pipelines["sql_breakdown"].run(
                query=ask_details_request.query,
                sql=ask_details_request.sql,
                project_id=ask_details_request.project_id,
                language=ask_details_request.configurations.language,
            )

            ask_details_result = generation_result["post_process"]["results"]

            if not ask_details_result["steps"]:
                quoted_sql, no_error = add_quotes(ask_details_request.sql)
                sql = quoted_sql if no_error else ask_details_request.sql

                sql_summary_results = await self._pipelines["sql_summary"].run(
                    query=ask_details_request.query,
                    sqls=[sql],
                    language=ask_details_request.configurations.language,
                )
                sql_summary_result = sql_summary_results["post_process"][
                    "sql_summary_results"
                ][0]

                ask_details_result["steps"] = [
                    {
                        "sql": sql_summary_result["sql"],
                        "summary": sql_summary_result["summary"],
                        "cte_name": "",
                    }
                ]
                results["metadata"]["error_type"] = "SQL_BREAKDOWN_FAILED"

            self._ask_details_results[query_id] = AskDetailsResultResponse(
                status="finished",
                response=AskDetailsResultResponse.AskDetailsResponseDetails(
                    **ask_details_result
                ),
            )

            results["ask_details_result"] = ask_details_result

            return results
        except Exception as e:
            logger.exception(f"ask-details pipeline - OTHERS: {e}")

            self._ask_details_results[
                ask_details_request.query_id
            ] = AskDetailsResultResponse(
                status="failed",
                error=AskDetailsResultResponse.AskDetailsError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def get_ask_details_result(
        self,
        ask_details_result_request: AskDetailsResultRequest,
    ) -> AskDetailsResultResponse:
        if (
            result := self._ask_details_results.get(ask_details_result_request.query_id)
        ) is None:
            logger.exception(
                f"ask-details pipeline - OTHERS: {ask_details_result_request.query_id} is not found"
            )
            return AskDetailsResultResponse(
                status="failed",
                error=AskDetailsResultResponse.AskDetailsError(
                    code="OTHERS",
                    message=f"{ask_details_result_request.query_id} is not found",
                ),
            )

        return result
