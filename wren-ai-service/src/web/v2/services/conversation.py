import asyncio
import logging
import time
from typing import Dict, List, Literal, Optional

import orjson
from fastapi import Request
from langfuse.decorators import observe
from pydantic import BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
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
    question: str
    sql: str


# POST /v2/conversations
class ConversationRequest(BaseModel):
    _query_id: str | None = None
    query: str
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


class ConversationService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        max_histories: int = 5,
    ):
        self._pipelines = pipelines
        self._query_event_manager = QueryEventManager()
        self._max_histories = max_histories

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

        try:
            await self._query_event_manager.emit_message_start(
                query_id,
                trace_id,
            )

            historical_question = await self._pipelines["historical_question"].run(
                query=user_query,
                project_id=project_id,
            )
            # we only return top 1 result
            historical_question_result = historical_question.get(
                "formatted_output", {}
            ).get("documents", [])[:1]

            if historical_question_result:
                historical_question_result = QuestionResult(
                    sql=historical_question_result[0].get("statement"),
                    type="view"
                    if historical_question_result[0].get("viewId")
                    else "llm",
                    viewId=historical_question_result[0].get("viewId"),
                )

                await self._query_event_manager.emit_content_block(
                    query_id,
                    trace_id,
                    index=0,
                    pieces=[
                        {
                            "sql": historical_question_result.sql,
                            "type": historical_question_result.type,
                            "viewId": historical_question_result.viewId,
                        }
                    ],
                    block_type="tool_use",
                )
            else:
                # Run both pipeline operations concurrently
                sql_samples_task, instructions_task = await asyncio.gather(
                    self._pipelines["sql_pairs_retrieval"].run(
                        query=user_query,
                        project_id=project_id,
                    ),
                    self._pipelines["instructions_retrieval"].run(
                        query=user_query,
                        project_id=project_id,
                    ),
                )

                # Extract results from completed tasks
                sql_samples = sql_samples_task["formatted_output"].get("documents", [])
                instructions = instructions_task["formatted_output"].get(
                    "documents", []
                )

                intent_classification_result = (
                    await self._pipelines["intent_classification"].run(
                        query=user_query,
                        histories=histories,
                        sql_samples=sql_samples,
                        instructions=instructions,
                        project_id=project_id,
                        configuration=configurations,
                    )
                ).get("post_process", {})

                await self._query_event_manager.emit_content_block(
                    query_id,
                    trace_id,
                    index=0,
                    pieces=[
                        {
                            "rephrased_question": intent_classification_result.get(
                                "rephrased_question"
                            ),
                            "intent": intent_classification_result.get("intent"),
                            "reasoning": intent_classification_result.get("reasoning"),
                        }
                    ],
                    block_type="tool_use",
                )

                intent = intent_classification_result.get("intent")
                rephrased_question = intent_classification_result.get(
                    "rephrased_question"
                )

                if rephrased_question:
                    user_query = rephrased_question

                if intent == "MISLEADING_QUERY":
                    asyncio.create_task(
                        self._pipelines["misleading_assistance"].run(
                            query=user_query,
                            histories=histories,
                            db_schemas=intent_classification_result.get("db_schemas"),
                            language=configurations.language,
                            query_id=query_id,
                        )
                    )

                    async for chunk in self._pipelines[
                        "misleading_assistance"
                    ].get_streaming_results(query_id):
                        await self._query_event_manager.emit_content_block(
                            query_id,
                            trace_id,
                            index=2,
                            pieces=chunk,
                            block_type="text",
                        )
                elif intent == "GENERAL":
                    asyncio.create_task(
                        self._pipelines["data_assistance"].run(
                            query=user_query,
                            histories=histories,
                            db_schemas=intent_classification_result.get("db_schemas"),
                            language=configurations.language,
                            query_id=query_id,
                        )
                    )

                    async for chunk in self._pipelines[
                        "data_assistance"
                    ].get_streaming_results(query_id):
                        await self._query_event_manager.emit_content_block(
                            query_id,
                            trace_id,
                            index=3,
                            pieces=chunk,
                            block_type="text",
                        )
                elif intent == "USER_GUIDE":
                    asyncio.create_task(
                        self._pipelines["user_guide_assistance"].run(
                            query=user_query,
                            language=configurations.language,
                            query_id=query_id,
                        )
                    )

                    async for chunk in self._pipelines[
                        "user_guide_assistance"
                    ].get_streaming_results(query_id):
                        await self._query_event_manager.emit_content_block(
                            query_id,
                            trace_id,
                            index=4,
                            pieces=chunk,
                            block_type="text",
                        )
                else:  # TEXT_TO_SQL
                    retrieval_result = await self._pipelines["retrieval"].run(
                        query=user_query,
                        histories=histories,
                        project_id=project_id,
                    )
                    _retrieval_result = retrieval_result.get(
                        "construct_retrieval_results", {}
                    )
                    documents = _retrieval_result.get("retrieval_results", [])
                    table_names = [document.get("table_name") for document in documents]
                    table_ddls = [document.get("table_ddl") for document in documents]

                    await self._query_event_manager.emit_content_block(
                        query_id,
                        trace_id,
                        index=5,
                        pieces=[{"retrieved_tables": table_names}],
                        block_type="tool_use",
                    )

                    if table_names:
                        if histories:
                            _reasoning_pipeline_name = (
                                "followup_sql_generation_reasoning"
                            )
                            asyncio.create_task(
                                self._pipelines[_reasoning_pipeline_name].run(
                                    query=user_query,
                                    contexts=table_ddls,
                                    histories=histories,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=configurations,
                                    query_id=query_id,
                                )
                            )
                        else:
                            _reasoning_pipeline_name = "sql_generation_reasoning"
                            asyncio.create_task(
                                self._pipelines[_reasoning_pipeline_name].run(
                                    query=user_query,
                                    contexts=table_ddls,
                                    sql_samples=sql_samples,
                                    instructions=instructions,
                                    configuration=configurations,
                                    query_id=query_id,
                                )
                            )

                        sql_generation_reasoning = ""
                        async for chunk in self._pipelines[
                            _reasoning_pipeline_name
                        ].get_streaming_results(query_id):
                            sql_generation_reasoning += chunk
                            await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=6,
                                pieces=chunk,
                                block_type="text",
                            )

                        sql_functions = await self._pipelines[
                            "sql_functions_retrieval"
                        ].run(
                            project_id=project_id,
                        )

                        has_calculated_field = _retrieval_result.get(
                            "has_calculated_field", False
                        )
                        has_metric = _retrieval_result.get("has_metric", False)

                        if histories:
                            text_to_sql_generation_results = await self._pipelines[
                                "followup_sql_generation"
                            ].run(
                                query=user_query,
                                contexts=table_ddls,
                                sql_generation_reasoning=sql_generation_reasoning,
                                histories=histories,
                                project_id=project_id,
                                configuration=configurations,
                                sql_samples=sql_samples,
                                instructions=instructions,
                                has_calculated_field=has_calculated_field,
                                has_metric=has_metric,
                                sql_functions=sql_functions,
                            )
                        else:
                            text_to_sql_generation_results = await self._pipelines[
                                "sql_generation"
                            ].run(
                                query=user_query,
                                contexts=table_ddls,
                                sql_generation_reasoning=sql_generation_reasoning,
                                project_id=project_id,
                                configuration=configurations,
                                sql_samples=sql_samples,
                                instructions=instructions,
                                has_calculated_field=has_calculated_field,
                                has_metric=has_metric,
                                sql_functions=sql_functions,
                            )

                        if sql_valid_results := text_to_sql_generation_results[
                            "post_process"
                        ]["valid_generation_results"]:
                            question_result = QuestionResult(
                                sql=sql_valid_results[0].get("sql"),
                                type="llm",
                            )
                            await self._query_event_manager.emit_content_block(
                                query_id,
                                trace_id,
                                index=7,
                                pieces=[
                                    {
                                        "sql": question_result.sql,
                                        "type": question_result.type,
                                    }
                                ],
                                block_type="tool_use",
                            )
                        elif failed_dry_run_results := text_to_sql_generation_results[
                            "post_process"
                        ]["invalid_generation_results"]:
                            if failed_dry_run_results[0]["type"] != "TIME_OUT":
                                sql_correction_results = await self._pipelines[
                                    "sql_correction"
                                ].run(
                                    contexts=[],
                                    invalid_generation_results=failed_dry_run_results,
                                    project_id=project_id,
                                )

                                if sql_valid_results := sql_correction_results[
                                    "post_process"
                                ]["valid_generation_results"]:
                                    question_result = QuestionResult(
                                        sql=sql_valid_results[0].get("sql"),
                                        type="llm",
                                    )
                                    await self._query_event_manager.emit_content_block(
                                        query_id,
                                        trace_id,
                                        index=7,
                                        pieces=[
                                            {
                                                "sql": question_result.sql,
                                                "type": question_result.type,
                                            }
                                        ],
                                        block_type="tool_use",
                                    )
                                else:
                                    await self._query_event_manager.emit_error(
                                        query_id=query_id,
                                        trace_id=trace_id,
                                        error=Error(
                                            code="NO_RELEVANT_SQL",
                                            message=failed_dry_run_results[0]["error"],
                                        ),
                                    )
                            else:
                                await self._query_event_manager.emit_error(
                                    query_id=query_id,
                                    trace_id=trace_id,
                                    error=Error(
                                        code="NO_RELEVANT_SQL",
                                        message=failed_dry_run_results[0]["error"],
                                    ),
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
