import asyncio
import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.pipelines.generation.utils.sql import (
    construct_valid_table_columns,
    construct_valid_table_names,
    find_invalid_column_references,
    find_invalid_table_references,
    normalize_sql_column_references_to_schema,
    normalize_sql_table_references_to_schema,
)
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, SSEEvent

logger = logging.getLogger("wren-ai-service")

NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE = (
    "No relevant data found in the active datasource for this question."
)


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

    async def _load_active_schema_contexts(
        self, project_id: Optional[str], query: str
    ) -> list[str]:
        retrieval_pipeline = self._pipelines.get("db_schema_retrieval")
        if not retrieval_pipeline or not (query or "").strip():
            return []

        retrieval_result = await retrieval_pipeline.run(
            query=query,
            histories=[],
            project_id=project_id,
            enable_column_pruning=False,
        )
        documents = retrieval_result.get("construct_retrieval_results", {}).get(
            "retrieval_results", []
        )
        return [
            document["table_ddl"]
            for document in documents
            if isinstance(document, dict) and document.get("table_ddl")
        ]

    def _normalize_and_validate_sql(
        self, sql: str, schema_contexts: list[str]
    ) -> str | None:
        valid_table_names = construct_valid_table_names(schema_contexts)
        valid_table_columns = construct_valid_table_columns(schema_contexts)
        normalized_sql = normalize_sql_table_references_to_schema(
            sql,
            valid_table_names,
        )
        normalized_sql = normalize_sql_column_references_to_schema(
            normalized_sql,
            valid_table_columns,
        )
        if find_invalid_table_references(normalized_sql, valid_table_names):
            return None
        if find_invalid_column_references(normalized_sql, valid_table_columns):
            return None
        return normalized_sql

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

            schema_contexts = await self._load_active_schema_contexts(
                sql_answer_request.project_id,
                sql_answer_request.query,
            )
            normalized_sql = self._normalize_and_validate_sql(
                sql_answer_request.sql,
                schema_contexts,
            )
            if not normalized_sql:
                self._sql_answer_results[query_id] = SqlAnswerResultResponse(
                    status="failed",
                    error=SqlAnswerResultResponse.SqlAnswerError(
                        code="OTHERS",
                        message=NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE,
                    ),
                    trace_id=trace_id,
                )
                results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                results["metadata"]["error_message"] = (
                    NO_RELEVANT_ACTIVE_DATASOURCE_MESSAGE
                )
                return results

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
                    sql=normalized_sql,
                    sql_data=preprocessed_sql_data.get("sql_data", {}),
                    language=sql_answer_request.configurations.language,
                    current_time=sql_answer_request.configurations.show_current_time(),
                    query_id=query_id,
                    custom_instruction=sql_answer_request.custom_instruction,
                    contexts=schema_contexts,
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
