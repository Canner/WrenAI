import asyncio
import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest
from src.web.v1.services.ask import AskError, AskResult

logger = logging.getLogger("wren-ai-service")


# POST /v1/ask-feedbacks
class AskFeedbackRequest(BaseRequest):
    question: str
    tables: List[str]
    sql_generation_reasoning: str
    sql: str


class AskFeedbackResponse(BaseModel):
    query_id: str


# PATCH /v1/ask-feedbacks/{query_id}
class StopAskFeedbackRequest(BaseRequest):
    status: Literal["stopped"]


class StopAskFeedbackResponse(BaseModel):
    query_id: str


# GET /v1/ask-feedbacks/{query_id}
class AskFeedbackResultRequest(BaseModel):
    query_id: str


class AskFeedbackResultResponse(BaseModel):
    status: Literal[
        "searching",
        "generating",
        "correcting",
        "finished",
        "failed",
        "stopped",
    ]
    invalid_sql: Optional[str] = None
    error: Optional[AskError] = None
    response: Optional[List[AskResult]] = None
    trace_id: Optional[str] = None


class AskFeedbackService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_sql_functions_retrieval: bool = True,
        allow_sql_diagnosis: bool = True,
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._ask_feedback_results: Dict[str, AskFeedbackResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_sql_diagnosis = allow_sql_diagnosis

    def _is_stopped(self, query_id: str, container: dict):
        if (
            result := container.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    @observe(name="Ask Feedback")
    @trace_metadata
    async def ask_feedback(
        self,
        ask_feedback_request: AskFeedbackRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "ask_feedback_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
                "request_from": ask_feedback_request.request_from,
            },
        }

        query_id = ask_feedback_request.query_id
        allow_sql_functions_retrieval = self._allow_sql_functions_retrieval
        allow_sql_diagnosis = self._allow_sql_diagnosis
        api_results = []
        error_message = None
        invalid_sql = None

        try:
            if not self._is_stopped(query_id, self._ask_feedback_results):
                self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                    status="searching",
                    trace_id=trace_id,
                )

                (
                    retrieval_task,
                    sql_samples_task,
                    instructions_task,
                ) = await asyncio.gather(
                    self._pipelines["db_schema_retrieval"].run(
                        tables=ask_feedback_request.tables,
                        project_id=ask_feedback_request.project_id,
                    ),
                    self._pipelines["sql_pairs_retrieval"].run(
                        query=ask_feedback_request.question,
                        project_id=ask_feedback_request.project_id,
                    ),
                    self._pipelines["instructions_retrieval"].run(
                        query=ask_feedback_request.question,
                        project_id=ask_feedback_request.project_id,
                        scope="sql",
                    ),
                )

                if allow_sql_functions_retrieval:
                    sql_functions = await self._pipelines[
                        "sql_functions_retrieval"
                    ].run(
                        project_id=ask_feedback_request.project_id,
                    )
                else:
                    sql_functions = []

                # Extract results from completed tasks
                _retrieval_result = retrieval_task.get(
                    "construct_retrieval_results", {}
                )
                has_calculated_field = _retrieval_result.get(
                    "has_calculated_field", False
                )
                has_metric = _retrieval_result.get("has_metric", False)
                has_json_field = _retrieval_result.get("has_json_field", False)
                documents = _retrieval_result.get("retrieval_results", [])
                table_ddls = [document.get("table_ddl") for document in documents]
                sql_samples = sql_samples_task["formatted_output"].get("documents", [])
                instructions = instructions_task["formatted_output"].get(
                    "documents", []
                )

            if not self._is_stopped(query_id, self._ask_feedback_results):
                self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                    status="generating",
                    trace_id=trace_id,
                )

                text_to_sql_generation_results = await self._pipelines[
                    "sql_regeneration"
                ].run(
                    contexts=table_ddls,
                    sql_generation_reasoning=ask_feedback_request.sql_generation_reasoning,
                    sql=ask_feedback_request.sql,
                    project_id=ask_feedback_request.project_id,
                    sql_samples=sql_samples,
                    instructions=instructions,
                    has_calculated_field=has_calculated_field,
                    has_metric=has_metric,
                    has_json_field=has_json_field,
                    sql_functions=sql_functions,
                )

                if sql_valid_result := text_to_sql_generation_results["post_process"][
                    "valid_generation_result"
                ]:
                    api_results = [
                        AskResult(
                            **{
                                "sql": sql_valid_result.get("sql"),
                                "type": "llm",
                            }
                        )
                    ]
                elif failed_dry_run_result := text_to_sql_generation_results[
                    "post_process"
                ]["invalid_generation_result"]:
                    if failed_dry_run_result["type"] != "TIME_OUT":
                        original_sql = failed_dry_run_result["original_sql"]
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]

                        self._ask_feedback_results[
                            query_id
                        ] = AskFeedbackResultResponse(
                            status="correcting",
                            trace_id=trace_id,
                        )

                        can_be_corrected = True
                        if allow_sql_diagnosis:
                            sql_diagnosis_results = await self._pipelines[
                                "sql_diagnosis"
                            ].run(
                                contexts=table_ddls,
                                original_sql=original_sql,
                                invalid_sql=invalid_sql,
                                error_message=error_message,
                            )
                            sql_diagnosis_reasoning = sql_diagnosis_results[
                                "post_process"
                            ].get("reasoning")
                            can_be_corrected = sql_diagnosis_results[
                                "post_process"
                            ].get("can_be_corrected")

                        if can_be_corrected:
                            sql_correction_results = await self._pipelines[
                                "sql_correction"
                            ].run(
                                contexts=table_ddls,
                                instructions=instructions,
                                invalid_generation_result={
                                    "sql": original_sql,
                                    "error": sql_diagnosis_reasoning
                                    if allow_sql_diagnosis
                                    else error_message,
                                },
                                project_id=ask_feedback_request.project_id,
                                sql_functions=sql_functions,
                            )

                            if valid_generation_result := sql_correction_results[
                                "post_process"
                            ]["valid_generation_result"]:
                                api_results = [
                                    AskResult(
                                        **{
                                            "sql": valid_generation_result.get("sql"),
                                            "type": "llm",
                                        }
                                    )
                                ]
                            elif failed_dry_run_result := sql_correction_results[
                                "post_process"
                            ]["invalid_generation_result"]:
                                invalid_sql = failed_dry_run_result["sql"]
                                error_message = failed_dry_run_result["error"]
                    else:
                        invalid_sql = failed_dry_run_result["sql"]
                        error_message = failed_dry_run_result["error"]

            if api_results:
                if not self._is_stopped(query_id, self._ask_feedback_results):
                    self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                        status="finished",
                        response=api_results,
                        trace_id=trace_id,
                    )
                results["ask_feedback_result"] = api_results
            else:
                logger.exception("ask feedback pipeline - NO_RELEVANT_SQL")
                if not self._is_stopped(query_id, self._ask_feedback_results):
                    self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                        status="failed",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message=error_message or "No relevant SQL",
                        ),
                        invalid_sql=invalid_sql,
                        trace_id=trace_id,
                    )
                results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                results["metadata"]["error_message"] = error_message

            return results

        except Exception as e:
            logger.exception(f"ask feedback pipeline - OTHERS: {e}")

            self._ask_feedback_results[query_id] = AskFeedbackResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
                trace_id=trace_id,
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def stop_ask_feedback(
        self,
        stop_ask_feedback_request: StopAskFeedbackRequest,
    ):
        self._ask_feedback_results[
            stop_ask_feedback_request.query_id
        ] = AskFeedbackResultResponse(
            status="stopped",
        )

    def get_ask_feedback_result(
        self,
        ask_feedback_result_request: AskFeedbackResultRequest,
    ) -> AskFeedbackResultResponse:
        if (
            result := self._ask_feedback_results.get(
                ask_feedback_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"ask feedback pipeline - OTHERS: {ask_feedback_result_request.query_id} is not found"
            )
            return AskFeedbackResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=f"{ask_feedback_result_request.query_id} is not found",
                ),
            )

        return result
