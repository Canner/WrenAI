import asyncio
import logging
import time
from typing import Dict, List, Literal, Optional

import orjson
from fastapi import Request
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import (
    trace_metadata,
)
from src.web.v1.services.ask import AskHistory
from src.web.v2.services import (
    Configurations,
    Error,
    QueryEventManager,
)

logger = logging.getLogger("wren-ai-service")


class QuestionResult(BaseModel):
    sql: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class ConversationHistory(BaseModel):
    class ConversationRequest(BaseModel):
        query: str
        additional_info: Optional[dict] = None

    request: ConversationRequest
    response: dict


# POST /v2/conversations
class ConversationRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql_data: Optional[Dict] = None
    project_id: Optional[str] = None
    mdl_hash: Optional[str] = None
    histories: Optional[List[ConversationHistory]] = Field(default_factory=list)
    configurations: Optional[Configurations] = Configurations()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class ConversationResponse(BaseModel):
    query_id: str


# although history.response may not be a sql, we still use AskHistory as the type
# because the AskHistory type is used in the Ask pipeline
def convert_conversation_history_to_ask_history(
    conversation_history: list[ConversationHistory],
) -> list[AskHistory]:
    return [
        AskHistory(question=history.request.query, sql=history.response["sql"])
        for history in conversation_history
        if history.response.get("sql")
    ]


class ConversationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        max_histories: int = 5,
    ):
        self._pipelines = pipelines
        self._query_event_manager = QueryEventManager()
        self._max_histories = max_histories

    async def _run_historical_question_pipeline(self, query: str, project_id: str):
        historical_question = await self._pipelines["historical_question"].run(
            query=query,
            project_id=project_id,
        )

        # we only return top 1 result
        historical_question_result = historical_question.get(
            "formatted_output", {}
        ).get("documents", [])[:1]

        if historical_question_result:
            return [
                {
                    "sql": historical_question_result[0].get("statement"),
                    "type": (
                        "view" if historical_question_result[0].get("viewId") else "llm"
                    ),
                    "viewId": historical_question_result[0].get("viewId"),
                }
            ], {
                "sql": historical_question_result[0].get("statement"),
                "type": (
                    "view" if historical_question_result[0].get("viewId") else "llm"
                ),
                "viewId": historical_question_result[0].get("viewId"),
            }
        else:
            return [], {}

    async def _run_sql_pairs_retrieval(
        self,
        query: str,
        project_id: str,
    ):
        sql_pairs_retrieval = await self._pipelines["sql_pairs_retrieval"].run(
            query=query,
            project_id=project_id,
        )
        return (
            sql_pairs_retrieval.get("formatted_output", {}).get("documents", []),
            sql_pairs_retrieval.get("formatted_output", {}).get("documents", []),
        )

    async def _run_instructions_retrieval(
        self,
        query: str,
        project_id: str,
    ):
        instructions_retrieval = await self._pipelines["instructions_retrieval"].run(
            query=query,
            project_id=project_id,
        )
        return (
            instructions_retrieval.get("formatted_output", {}).get("documents", []),
            instructions_retrieval.get("formatted_output", {}).get("documents", []),
        )

    async def _run_intent_classification(
        self,
        query: str,
        histories: List[ConversationHistory],
        sql_samples: List[QuestionResult],
        instructions: List[QuestionResult],
        project_id: str,
        configurations: Configurations,
        sql_data: Optional[Dict] = None,
    ):
        intent_classification_result = (
            await self._pipelines["intent_classification"].run(
                query=query,
                histories=convert_conversation_history_to_ask_history(histories),
                sql_samples=sql_samples,
                instructions=instructions,
                project_id=project_id,
                configuration=configurations,
                sql_data=sql_data,
            )
        ).get("post_process", {})

        return [
            {
                "rephrased_question": intent_classification_result.get(
                    "rephrased_question"
                ),
                "reasoning": intent_classification_result.get("reasoning"),
            }
        ], intent_classification_result

    def _run_misleading_assistance(
        self,
        query: str,
        histories: List[ConversationHistory],
        db_schemas: List[str],
        language: str,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["misleading_assistance"].run(
                query=query,
                histories=convert_conversation_history_to_ask_history(histories),
                db_schemas=db_schemas,
                language=language,
                query_id=query_id,
            )
        )

        return self._pipelines["misleading_assistance"].get_streaming_results(query_id)

    def _run_data_assistance(
        self,
        query: str,
        histories: List[ConversationHistory],
        db_schemas: List[str],
        language: str,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["data_assistance"].run(
                query=query,
                histories=convert_conversation_history_to_ask_history(histories),
                db_schemas=db_schemas,
                language=language,
                query_id=query_id,
            )
        )

        return self._pipelines["data_assistance"].get_streaming_results(query_id)

    def _run_user_guide_assistance(
        self,
        query: str,
        language: str,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["user_guide_assistance"].run(
                query=query,
                language=language,
                query_id=query_id,
            )
        )

        return self._pipelines["user_guide_assistance"].get_streaming_results(query_id)

    def _run_data_exploration_assistance(
        self,
        query: str,
        sql_data: Dict,
        language: str,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["data_exploration_assistance"].run(
                query=query,
                sql_data=sql_data,
                language=language,
                query_id=query_id,
            )
        )

        return self._pipelines["data_exploration_assistance"].get_streaming_results(
            query_id
        )

    async def _run_chart_generation(
        self,
        query: str,
        sql: str,
        data: Dict,
        language: str,
    ):
        chart_generation_result = await self._pipelines["chart_generation"].run(
            query=query,
            sql=sql,
            data=data,
            language=language,
        )

        return [
            {
                "chart_result": chart_generation_result["post_process"]["results"],
                "sql": sql,
            }
        ], {
            "chart_result": chart_generation_result["post_process"]["results"],
        }

    async def _run_retrieval(
        self,
        query: str,
        histories: List[ConversationHistory],
        project_id: str,
    ):
        retrieval_results = (
            await self._pipelines["retrieval"].run(
                query=query,
                histories=convert_conversation_history_to_ask_history(histories),
                project_id=project_id,
            )
        ).get("construct_retrieval_results", {})

        return [
            {
                "retrieved_tables": [
                    document.get("table_name")
                    for document in retrieval_results.get("retrieval_results", [])
                ],
            }
        ], retrieval_results

    def _run_followup_sql_generation_reasoning(
        self,
        query: str,
        contexts: List[str],
        histories: List[ConversationHistory],
        sql_samples: List[QuestionResult],
        instructions: List[QuestionResult],
        configuration: Configurations,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["followup_sql_generation_reasoning"].run(
                query=query,
                contexts=contexts,
                histories=convert_conversation_history_to_ask_history(histories),
                sql_samples=sql_samples,
                instructions=instructions,
                configuration=configuration,
                query_id=query_id,
            )
        )

        return self._pipelines[
            "followup_sql_generation_reasoning"
        ].get_streaming_results(query_id)

    def _run_sql_generation_reasoning(
        self,
        query: str,
        contexts: List[str],
        sql_samples: List[QuestionResult],
        instructions: List[QuestionResult],
        configuration: Configurations,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["sql_generation_reasoning"].run(
                query=query,
                contexts=contexts,
                sql_samples=sql_samples,
                instructions=instructions,
                configuration=configuration,
                query_id=query_id,
            )
        )

        return self._pipelines["sql_generation_reasoning"].get_streaming_results(
            query_id
        )

    # no emit content block at the moment
    async def _run_sql_functions_retrieval(
        self,
        project_id: str,
    ):
        sql_functions = await self._pipelines["sql_functions_retrieval"].run(
            project_id=project_id,
        )

        return sql_functions

    async def _run_followup_sql_generation(
        self,
        query: str,
        contexts: List[str],
        sql_generation_reasoning: str,
        histories: List[ConversationHistory],
        project_id: str,
        configurations: Configurations,
        sql_samples: List[QuestionResult],
        instructions: List[QuestionResult],
        has_calculated_field: bool,
        has_metric: bool,
        sql_functions: List[str],
    ):
        followup_sql_generation_results = await self._pipelines[
            "followup_sql_generation"
        ].run(
            query=query,
            contexts=contexts,
            sql_generation_reasoning=sql_generation_reasoning,
            histories=convert_conversation_history_to_ask_history(histories),
            project_id=project_id,
            configuration=configurations,
            sql_samples=sql_samples,
            instructions=instructions,
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            sql_functions=sql_functions,
        )

        if sql_valid_results := followup_sql_generation_results["post_process"][
            "valid_generation_results"
        ]:
            return [
                {
                    "sql": sql_valid_results[0].get("sql"),
                }
            ], followup_sql_generation_results
        else:
            return [], followup_sql_generation_results

    async def _run_sql_generation(
        self,
        query: str,
        contexts: List[str],
        sql_generation_reasoning: str,
        project_id: str,
        configurations: Configurations,
        sql_samples: List[QuestionResult],
        instructions: List[QuestionResult],
        has_calculated_field: bool,
        has_metric: bool,
        sql_functions: List[str],
    ):
        sql_generation_results = await self._pipelines["sql_generation"].run(
            query=query,
            contexts=contexts,
            sql_generation_reasoning=sql_generation_reasoning,
            project_id=project_id,
            configuration=configurations,
            sql_samples=sql_samples,
            instructions=instructions,
            has_calculated_field=has_calculated_field,
            has_metric=has_metric,
            sql_functions=sql_functions,
        )

        if sql_valid_results := sql_generation_results["post_process"][
            "valid_generation_results"
        ]:
            return [
                {
                    "sql": sql_valid_results[0].get("sql"),
                }
            ], sql_generation_results
        else:
            return [], sql_generation_results

    async def _run_sql_correction(
        self,
        contexts: List[str],
        invalid_generation_results: List[QuestionResult],
        project_id: str,
    ):
        sql_correction_results = await self._pipelines["sql_correction"].run(
            contexts=contexts,
            invalid_generation_results=invalid_generation_results,
            project_id=project_id,
        )

        if sql_valid_results := sql_correction_results["post_process"][
            "valid_generation_results"
        ]:
            return [
                {
                    "sql": sql_valid_results[0].get("sql"),
                }
            ], sql_correction_results
        else:
            return [], sql_correction_results

    # no emit content block at the moment
    async def _run_sql_executor(
        self,
        sql: str,
        project_id: str,
    ):
        sql_data = (
            await self._pipelines["sql_executor"].run(
                sql=sql,
                project_id=project_id,
            )
        )["execute_sql"]["results"]

        preprocessed_sql_data = (
            self._pipelines["preprocess_sql_data"]
            .run(
                sql_data=sql_data,
            )
            .get("preprocess", {})
            .get("sql_data", {})
        )

        return preprocessed_sql_data

    def _run_sql_answer(
        self,
        query: str,
        sql: str,
        sql_data: Dict,
        configurations: Configurations,
        query_id: str,
    ):
        asyncio.create_task(
            self._pipelines["sql_answer"].run(
                query=query,
                sql=sql,
                sql_data=sql_data,
                language=configurations.language,
                query_id=query_id,
            )
        )

        return self._pipelines["sql_answer"].get_streaming_results(query_id)

    @observe(name="Start Conversation")
    @trace_metadata
    async def start_conversation(
        self,
        conversation_request: ConversationRequest,
        **kwargs,
    ):
        trace_id = kwargs.get("trace_id")
        results = {
            "conversation_result": {},
            "metadata": {
                "type": "",
                "error_type": "",
                "error_message": "",
            },
        }

        query_id = conversation_request.query_id
        user_query = conversation_request.query
        project_id = conversation_request.project_id
        histories = conversation_request.histories[: self._max_histories][
            ::-1
        ]  # reverse the order of histories
        configurations = conversation_request.configurations
        sql_data = conversation_request.sql_data

        try:
            await self._query_event_manager.emit_message_start(
                query_id,
                trace_id,
            )

            if not await self._query_event_manager.emit_content_block(
                query_id,
                trace_id,
                index=0,
                emit_content_func=self._run_historical_question_pipeline,
                emit_content_func_kwargs={
                    "query": user_query,
                    "project_id": project_id,
                },
                content_block_label="HISTORICAL_QUESTION_RETRIEVAL",
                block_type="tool_use",
                should_put_in_conversation_history=True,
            ):
                sql_samples = await self._query_event_manager.emit_content_block(
                    query_id,
                    trace_id,
                    index=1,
                    emit_content_func=self._run_sql_pairs_retrieval,
                    emit_content_func_kwargs={
                        "query": user_query,
                        "project_id": project_id,
                    },
                    content_block_label="SQL_PAIRS_RETRIEVAL",
                    block_type="tool_use",
                )

                instructions = await self._query_event_manager.emit_content_block(
                    query_id,
                    trace_id,
                    index=2,
                    emit_content_func=self._run_instructions_retrieval,
                    emit_content_func_kwargs={
                        "query": user_query,
                        "project_id": project_id,
                    },
                    content_block_label="INSTRUCTIONS_RETRIEVAL",
                    block_type="tool_use",
                )

                intent_classification_result = (
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=3,
                        emit_content_func=self._run_intent_classification,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "histories": histories,
                            "sql_samples": sql_samples,
                            "instructions": instructions,
                            "project_id": project_id,
                            "configurations": configurations,
                            "sql_data": sql_data,
                        },
                        content_block_label="INTENT_CLASSIFICATION",
                        block_type="tool_use",
                    )
                )

                intent = intent_classification_result.get("intent")
                rephrased_question = intent_classification_result.get(
                    "rephrased_question"
                )
                db_schemas = intent_classification_result.get("db_schemas")
                intent_sql = intent_classification_result.get("sql")

                if rephrased_question:
                    user_query = rephrased_question

                if intent == "MISLEADING_QUERY":
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=4,
                        emit_content_func=self._run_misleading_assistance,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "histories": histories,
                            "db_schemas": db_schemas,
                            "language": configurations.language,
                            "query_id": query_id,
                        },
                        block_type="text",
                        stream=True,
                    )
                elif intent == "GENERAL":
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=4,
                        emit_content_func=self._run_data_assistance,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "histories": histories,
                            "db_schemas": db_schemas,
                            "language": configurations.language,
                            "query_id": query_id,
                        },
                        block_type="text",
                        stream=True,
                    )
                elif intent == "USER_GUIDE":
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=4,
                        emit_content_func=self._run_user_guide_assistance,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "language": configurations.language,
                            "query_id": query_id,
                        },
                        block_type="text",
                        stream=True,
                    )
                elif intent == "DATA_EXPLORATION":
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=4,
                        emit_content_func=self._run_data_exploration_assistance,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "sql_data": sql_data,
                            "language": configurations.language,
                            "query_id": query_id,
                        },
                        block_type="text",
                        stream=True,
                    )
                elif intent == "CHART":
                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=4,
                        emit_content_func=self._run_chart_generation,
                        emit_content_func_kwargs={
                            "query": user_query,
                            "sql": intent_sql,
                            "data": sql_data,
                            "language": configurations.language,
                        },
                        content_block_label="CHART_GENERATION",
                        block_type="tool_use",
                        should_put_in_conversation_history=True,
                    )
                else:  # TEXT_TO_SQL
                    retrieval_results = (
                        await self._query_event_manager.emit_content_block(
                            query_id,
                            trace_id,
                            index=4,
                            emit_content_func=self._run_retrieval,
                            emit_content_func_kwargs={
                                "query": user_query,
                                "histories": histories,
                                "project_id": project_id,
                            },
                            content_block_label="DB_SCHEMA_RETRIEVAL",
                            block_type="tool_use",
                        )
                    )

                    documents = retrieval_results.get("retrieval_results", [])
                    table_names = [document.get("table_name") for document in documents]
                    table_ddls = [document.get("table_ddl") for document in documents]

                    if table_names:
                        if histories:
                            sql_generation_reasoning = await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=5,
                                emit_content_func=self._run_followup_sql_generation_reasoning,
                                emit_content_func_kwargs={
                                    "query": user_query,
                                    "contexts": table_ddls,
                                    "histories": histories,
                                    "sql_samples": sql_samples,
                                    "instructions": instructions,
                                    "configuration": configurations,
                                    "query_id": query_id,
                                },
                                content_block_label="SQL_GENERATION_REASONING",
                                block_type="text",
                                stream=True,
                            )
                        else:
                            sql_generation_reasoning = await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=5,
                                emit_content_func=self._run_sql_generation_reasoning,
                                emit_content_func_kwargs={
                                    "query": user_query,
                                    "contexts": table_ddls,
                                    "sql_samples": sql_samples,
                                    "instructions": instructions,
                                    "configuration": configurations,
                                    "query_id": query_id,
                                },
                                content_block_label="SQL_GENERATION_REASONING",
                                block_type="text",
                                stream=True,
                            )

                        sql_functions = await self._run_sql_functions_retrieval(
                            project_id
                        )

                        has_calculated_field = retrieval_results.get(
                            "has_calculated_field", False
                        )
                        has_metric = retrieval_results.get("has_metric", False)

                        if histories:
                            text_to_sql_generation_results = await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=6,
                                emit_content_func=self._run_followup_sql_generation,
                                emit_content_func_kwargs={
                                    "query": user_query,
                                    "contexts": table_ddls,
                                    "sql_generation_reasoning": sql_generation_reasoning,
                                    "histories": histories,
                                    "project_id": project_id,
                                    "configurations": configurations,
                                    "sql_samples": sql_samples,
                                    "instructions": instructions,
                                    "has_calculated_field": has_calculated_field,
                                    "has_metric": has_metric,
                                    "sql_functions": sql_functions,
                                },
                                content_block_label="SQL_GENERATION",
                                block_type="tool_use",
                                should_put_in_conversation_history=True,
                            )
                        else:
                            text_to_sql_generation_results = await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=6,
                                emit_content_func=self._run_sql_generation,
                                emit_content_func_kwargs={
                                    "query": user_query,
                                    "contexts": table_ddls,
                                    "sql_generation_reasoning": sql_generation_reasoning,
                                    "project_id": project_id,
                                    "configurations": configurations,
                                    "sql_samples": sql_samples,
                                    "instructions": instructions,
                                    "has_calculated_field": has_calculated_field,
                                    "has_metric": has_metric,
                                    "sql_functions": sql_functions,
                                },
                                content_block_label="SQL_GENERATION",
                                block_type="tool_use",
                                should_put_in_conversation_history=True,
                            )

                        sql = ""
                        if failed_dry_run_results := text_to_sql_generation_results[
                            "post_process"
                        ]["invalid_generation_results"]:
                            if (
                                failed_dry_run_results[0]["type"] != "TIME_OUT"
                                and failed_dry_run_results[0]["type"] != "ADD_QUOTES"
                            ):
                                sql_correction_results = await self._query_event_manager.emit_content_block(
                                    query_id,
                                    trace_id,
                                    index=7,
                                    emit_content_func=self._run_sql_correction,
                                    emit_content_func_kwargs={
                                        "contexts": [],
                                        "invalid_generation_results": failed_dry_run_results,
                                        "project_id": project_id,
                                    },
                                    content_block_label="SQL_CORRECTION",
                                    block_type="tool_use",
                                )

                                if failed_dry_run_results := sql_correction_results[
                                    "post_process"
                                ]["invalid_generation_results"]:
                                    await self._query_event_manager.emit_error(
                                        query_id=query_id,
                                        trace_id=trace_id,
                                        error=Error(
                                            code="NO_RELEVANT_SQL",
                                            message=failed_dry_run_results[0]["error"],
                                            invalid_sql=failed_dry_run_results[0][
                                                "sql"
                                            ],
                                        ),
                                    )
                                else:
                                    sql = sql_correction_results["post_process"][
                                        "valid_generation_results"
                                    ][0]["sql"]
                            else:
                                await self._query_event_manager.emit_error(
                                    query_id=query_id,
                                    trace_id=trace_id,
                                    error=Error(
                                        code="NO_RELEVANT_SQL",
                                        message=failed_dry_run_results[0]["error"],
                                        invalid_sql=failed_dry_run_results[0]["sql"],
                                    ),
                                )
                        else:
                            sql = text_to_sql_generation_results["post_process"][
                                "valid_generation_results"
                            ][0]["sql"]

                        if sql:
                            sql_data = await self._run_sql_executor(
                                sql=sql,
                                project_id=project_id,
                            )

                            await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=8,
                                emit_content_func=self._run_sql_answer,
                                emit_content_func_kwargs={
                                    "query": user_query,
                                    "sql": sql,
                                    "sql_data": sql_data,
                                    "configurations": configurations,
                                    "query_id": query_id,
                                },
                                block_type="text",
                                stream=True,
                            )

            await self._query_event_manager.emit_message_stop(
                query_id,
                trace_id,
            )
        except Exception as e:
            logger.exception(f"conversation pipeline - OTHERS: {e}")

            await self._query_event_manager.emit_error(
                query_id,
                trace_id,
                Error(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)

        return results

    def stop_conversation(self, query_id: str):
        self._query_event_manager.stop_queue(query_id)

    async def get_conversation_streaming_result(self, query_id: str, request: Request):
        queue = self._query_event_manager.get_queue(query_id)

        async def event_generator():
            last_ping = time.monotonic()

            while True:
                # if client disconnects, break
                if await request.is_disconnected():
                    break

                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    now = time.monotonic()
                    if now - last_ping >= 10:
                        # sending a line that starts with a colon is the canonical way to emit an SSE “comment,”
                        # which browsers and EventSource clients ignore as data but do reset idle timeouts
                        yield ": keep-alive\n\n"
                        last_ping = now
                    continue

                payload = orjson.dumps(data).decode()
                yield f"event: {event}\n"
                yield f"data: {payload}\n\n"

                if event in ("message_stop", "error"):
                    break

            self._query_event_manager.cleanup(query_id)

        return event_generator()
