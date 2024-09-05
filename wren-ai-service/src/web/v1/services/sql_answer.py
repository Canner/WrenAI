import logging
from typing import Literal, Optional

from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-answer
class SqlAnswerRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    sql_summary: str
    thread_id: Optional[str] = None

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlAnswerResponse(BaseModel):
    query_id: str


# GET /v1/sql-answer/{query_id}/result
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
        pipelines: dict[str, BasicPipeline],
    ):
        self._pipelines = pipelines
        self._sql_answer_results = {}

    @async_timer
    @observe(name="SQL Answer")
    @trace_metadata
    async def sql_answer(
        self,
        sql_answer_request: SqlAnswerRequest,
    ):
        results = {
            "sql_answer_result": "",
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

            data = await self._pipelines["generation"].run(
                query=sql_answer_request.query,
                sql=sql_answer_request.sql,
                sql_summary=sql_answer_request.sql_summary,
                project_id=sql_answer_request.thread_id,
            )
            results = data["post_process"]["results"]
            if answer := results["answer"]:
                self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                    status="finished",
                    response=answer,
                )
            else:
                self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                    status="failed",
                    error=SqlAnswerResultResponse.SqlAnswerError(
                        code="OTHERS",
                        message=results["error"],
                    ),
                )

                results["metadata"]["error"]["type"] = "OTHERS"
                results["metadata"]["error"]["message"] = results["error"]

            results["sql_answer_result"] = answer
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

            results["metadata"]["error"]["type"] = "OTHERS"
            results["metadata"]["error"]["message"] = str(e)
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
