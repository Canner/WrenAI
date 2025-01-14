import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-questions
class SqlQuestionRequest(BaseModel):
    _query_id: str | None = None
    sqls: list[str]
    project_id: Optional[str] = None
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlQuestionResponse(BaseModel):
    query_id: str


# GET /v1/sql-questions/{query_id}
class SqlQuestionResultRequest(BaseModel):
    query_id: str


class SqlQuestionResultResponse(BaseModel):
    class SqlQuestionError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["generating", "succeeded", "failed"]
    error: Optional[SqlQuestionError] = None
    questions: Optional[list[str]] = None


class SqlQuestionService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_question_results: Dict[str, SqlQuestionResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @observe(name="SQL Question")
    @trace_metadata
    async def sql_question(
        self,
        sql_question_request: SqlQuestionRequest,
        **kwargs,
    ):
        results = {
            "sql_question_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            query_id = sql_question_request.query_id

            self._sql_question_results[query_id] = SqlQuestionResultResponse(
                status="generating",
            )

            sql_questions_result = (
                await self._pipelines["sql_question_generation"].run(
                    sqls=sql_question_request.sqls,
                    configuration=sql_question_request.configurations,
                )
            )["post_process"]

            self._sql_question_results[query_id] = SqlQuestionResultResponse(
                status="succeeded",
                questions=sql_questions_result,
            )

            results["sql_question_result"] = sql_questions_result
            return results
        except Exception as e:
            logger.exception(f"sql question pipeline - OTHERS: {e}")

            self._sql_question_results[
                sql_question_request.query_id
            ] = SqlQuestionResultResponse(
                status="failed",
                error=SqlQuestionResultResponse.SqlQuestionError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def get_sql_question_result(
        self,
        sql_question_result_request: SqlQuestionResultRequest,
    ) -> SqlQuestionResultResponse:
        if (
            result := self._sql_question_results.get(
                sql_question_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"sql question pipeline - OTHERS: {sql_question_result_request.query_id} is not found"
            )
            return SqlQuestionResultResponse(
                status="failed",
                error=SqlQuestionResultResponse.SqlQuestionError(
                    code="OTHERS",
                    message=f"{sql_question_result_request.query_id} is not found",
                ),
            )

        return result
