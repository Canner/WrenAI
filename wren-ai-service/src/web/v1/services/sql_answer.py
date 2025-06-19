import asyncio
import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-answers
class SqlAnswerRequest(BaseRequest):
    query: str
    sql: str
    sql_data: Dict
    custom_instruction: Optional[str] = None


class SqlAnswerResponse(BaseModel):
    query_id: str


# GET /v1/sql-answers/{query_id}
class SqlAnswerResultRequest(BaseModel):
    query_id: str


class SqlAnswerResultResponse(BaseModel):
    class SqlAnswerError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["preprocessing", "succeeded", "failed"]
    num_rows_used_in_llm: Optional[int] = None
    error: Optional[SqlAnswerError] = None
    trace_id: Optional[str] = None


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

    @observe(name="SQL Answer")
    @trace_metadata
    async def sql_answer(
        self,
        sql_answer_request: SqlAnswerRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "metadata": {
                "error": {
                    "type": "",
                    "message": "",
                },
                "request_from": sql_answer_request.request_from,
            },
        }

        try:
            query_id = sql_answer_request.query_id

            self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                status="preprocessing",
                trace_id=trace_id,
            )

            preprocessed_sql_data = self._pipelines["preprocess_sql_data"].run(
                sql_data=sql_answer_request.sql_data,
            )["preprocess"]

            if preprocessed_sql_data.get("num_rows_used_in_llm") == 0:
                results["metadata"]["error_type"] = "NO_DATA"
                results["metadata"]["error_message"] = "No data to answer"

            self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                status="succeeded",
                num_rows_used_in_llm=preprocessed_sql_data.get("num_rows_used_in_llm"),
                trace_id=trace_id,
            )

            asyncio.create_task(
                self._pipelines["sql_answer"].run(
                    query=sql_answer_request.query,
                    sql=sql_answer_request.sql,
                    sql_data=preprocessed_sql_data.get("sql_data", {}),
                    language=sql_answer_request.configurations.language,
                    query_id=query_id,
                    custom_instruction=sql_answer_request.custom_instruction,
                )
            )

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
                trace_id=trace_id,
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

    async def get_sql_answer_streaming_result(
        self,
        query_id: str,
    ):
        if (
            self._sql_answer_results.get(query_id)
            and self._sql_answer_results.get(query_id).status == "succeeded"
        ):
            async for chunk in self._pipelines["sql_answer"].get_streaming_results(
                query_id
            ):
                event = SSEEvent(
                    data=SSEEvent.SSEEventMessage(message=chunk),
                )
                yield event.serialize()
