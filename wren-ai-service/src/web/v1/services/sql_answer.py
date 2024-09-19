import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-answers
class SqlAnswerRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    sql_summary: str
    thread_id: Optional[str] = None
    user_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlAnswerResponse(BaseModel):
    query_id: str


# GET /v1/sql-answers/{query_id}/result
class SqlAnswerResultRequest(BaseModel):
    query_id: str


class SqlAnswerResultResponse(BaseModel):
    class SqlAnswerError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["understanding", "processing", "finished", "failed"]
    response: Optional[str] = None
    error: Optional[SqlAnswerError] = None


class SqlAnswerService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_answer_results: Dict[str, SqlAnswerResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @async_timer
    @observe(name="SQL Answer")
    @trace_metadata
    async def sql_answer(
        self,
        sql_answer_request: SqlAnswerRequest,
        **kwargs,
    ):
        results = {
            "sql_answer_result": {},
            "metadata": {
                "error": {
                    "type": "",
                    "message": "",
                }
            },
        }

        try:
            query_id = sql_answer_request.query_id

            self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                status="understanding",
            )

            self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                status="processing",
            )

            data = await self._pipelines["sql_answer"].run(
                query=sql_answer_request.query,
                sql=sql_answer_request.sql,
                sql_summary=sql_answer_request.sql_summary,
                project_id=sql_answer_request.thread_id,
            )
            api_results = data["post_process"]["results"]
            if answer := api_results["answer"]:
                self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                    status="finished",
                    response=answer,
                )
            else:
                self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                    status="failed",
                    error=SqlAnswerResultResponse.SqlAnswerError(
                        code="OTHERS",
                        message=api_results["error"],
                    ),
                )

                results["metadata"]["error_type"] = "OTHERS"
                results["metadata"]["error_message"] = api_results["error"]

            results["sql_answer_result"] = {
                "answer": api_results["answer"],
                "reasoning": api_results["reasoning"],
            }
            return results
        except Exception as e:
            logger.exception(f"sql answer pipeline - OTHERS: {e}")

            self._sql_answer_results[
                sql_answer_request.query_id
            ] = SqlAnswerResultResponse(
                status="failed",
                error=SqlAnswerResultResponse.SqlAnswerError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def get_sql_answer_result(
        self,
        sql_answer_result_request: SqlAnswerResultRequest,
    ) -> SqlAnswerResultResponse:
        if (
            result := self._sql_answer_results.get(sql_answer_result_request.query_id)
        ) is None:
            logger.exception(
                f"sql answer pipeline - OTHERS: {sql_answer_result_request.query_id} is not found"
            )
            return SqlAnswerResultResponse(
                status="failed",
                error=SqlAnswerResultResponse.SqlAnswerError(
                    code="OTHERS",
                    message=f"{sql_answer_result_request.query_id} is not found",
                ),
            )

        return result
