import asyncio
import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import BaseRequest, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class QuestionRecommendation:
    class PreviewColumn(BaseModel):
        name: str
        type: Optional[str] = None
        role: Optional[Literal["dimension", "measure"]] = None

    class Error(BaseModel):
        code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
        message: str

    class Event(BaseModel, MetadataTraceable):
        event_id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: dict = {"questions": {}}
        error: Optional["QuestionRecommendation.Error"] = None
        trace_id: Optional[str] = None
        request_from: Literal["ui", "api"] = "ui"

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        allow_sql_functions_retrieval: bool = True,
        maxsize: int = 1_000_000,
        ttl: int = 120,
        allow_sql_knowledge_retrieval: bool = True,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, QuestionRecommendation.Event] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )
        self._allow_sql_functions_retrieval = allow_sql_functions_retrieval
        self._allow_sql_knowledge_retrieval = allow_sql_knowledge_retrieval

    def _handle_exception(
        self,
        event_id: str,
        error_message: str,
        code: str = "OTHERS",
        trace_id: Optional[str] = None,
        request_from: Literal["ui", "api"] = "ui",
    ):
        self._cache[event_id] = self.Event(
            event_id=event_id,
            status="failed",
            error=self.Error(code=code, message=error_message),
            trace_id=trace_id,
            request_from=request_from,
        )
        logger.error(error_message)

    @observe(name="Validate Question")
    async def _validate_question(
        self,
        candidate: dict,
        request_id: str,
        max_questions: int,
        max_categories: int,
        runtime_scope_id: Optional[str] = None,
        allow_data_preview: bool = True,
    ):
        candidate_question = (
            candidate.get("question")
            or candidate.get("prompt")
            or candidate.get("label")
        )
        if not candidate_question:
            return {"error": "missing_question"}

        normalized_candidate = {
            **candidate,
            "question": candidate_question,
            "label": candidate.get("label") or candidate_question,
            "prompt": candidate.get("prompt") or candidate_question,
        }

        async def _document_retrieval() -> tuple[list[str], bool, bool, bool]:
            retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                query=normalized_candidate["question"],
                runtime_scope_id=runtime_scope_id,
            )
            _retrieval_result = retrieval_result.get("construct_retrieval_results", {})
            documents = _retrieval_result.get("retrieval_results", [])
            table_ddls = [document.get("table_ddl") for document in documents]
            has_calculated_field = _retrieval_result.get("has_calculated_field", False)
            has_metric = _retrieval_result.get("has_metric", False)
            has_json_field = _retrieval_result.get("has_json_field", False)
            return table_ddls, has_calculated_field, has_metric, has_json_field

        async def _sql_pairs_retrieval() -> list[dict]:
            sql_pairs_result = await self._pipelines["sql_pairs_retrieval"].run(
                query=normalized_candidate["question"],
                runtime_scope_id=runtime_scope_id,
            )
            sql_samples = sql_pairs_result["formatted_output"].get("documents", [])
            return sql_samples

        async def _instructions_retrieval() -> list[dict]:
            result = await self._pipelines["instructions_retrieval"].run(
                query=normalized_candidate["question"],
                runtime_scope_id=runtime_scope_id,
                scope="sql",
            )
            instructions = result["formatted_output"].get("instructions", [])
            return instructions

        try:
            _document, sql_samples, instructions = await asyncio.gather(
                _document_retrieval(),
                _sql_pairs_retrieval(),
                _instructions_retrieval(),
            )
            table_ddls, has_calculated_field, has_metric, has_json_field = _document

            if self._allow_sql_functions_retrieval:
                sql_functions = await self._pipelines["sql_functions_retrieval"].run(
                    runtime_scope_id=runtime_scope_id,
                )
            else:
                sql_functions = []

            if self._allow_sql_knowledge_retrieval:
                sql_knowledge = await self._pipelines["sql_knowledge_retrieval"].run(
                    runtime_scope_id=runtime_scope_id,
                )
            else:
                sql_knowledge = None

            generated_sql = await self._pipelines["sql_generation"].run(
                query=normalized_candidate["question"],
                contexts=table_ddls,
                runtime_scope_id=runtime_scope_id,
                sql_samples=sql_samples,
                instructions=instructions,
                has_calculated_field=has_calculated_field,
                has_metric=has_metric,
                has_json_field=has_json_field,
                sql_functions=sql_functions,
                allow_data_preview=allow_data_preview,
                sql_knowledge=sql_knowledge,
            )

            post_process = generated_sql["post_process"]

            if len(post_process["valid_generation_result"]) == 0:
                return post_process

            valid_sql = post_process["valid_generation_result"]["sql"]

            # Partial update the resource
            current = self._cache[request_id]
            questions = current.response["questions"]

            if (
                normalized_candidate["category"] not in questions
                and len(questions) >= max_categories
            ):
                # Skip to update the question dictionary if it is already full
                return post_process

            currnet_category = questions.setdefault(
                normalized_candidate["category"], []
            )

            if len(currnet_category) >= max_questions:
                # Skip to update the questions for the category if it is already full
                return post_process

            currnet_category.append({**normalized_candidate, "sql": valid_sql})
            return post_process

        except Exception as e:
            logger.error(f"Request {request_id}: Error validating question: {str(e)}")

    class Request(BaseRequest):
        event_id: str
        mdl: str
        previous_questions: list[str] = []
        user_question: Optional[str] = None
        source_question: Optional[str] = None
        source_answer: Optional[str] = None
        source_sql: Optional[str] = None
        source_chart_type: Optional[str] = None
        source_chart_title: Optional[str] = None
        source_chart_encodings: list[str] = []
        source_dimension_columns: list[str] = []
        source_intent_lineage: list[str] = []
        source_measure_columns: list[str] = []
        source_preview_column_count: Optional[int] = None
        source_preview_columns: list[dict] = []
        source_preview_row_count: Optional[int] = None
        source_response_kind: Optional[str] = None
        max_questions: int = 5
        max_categories: int = 3
        regenerate: bool = False
        allow_data_preview: bool = True

    async def _recommend(self, request: dict):
        resp = await self._pipelines["question_recommendation"].run(**request)
        questions = resp.get("normalized", {}).get("questions", [])
        validation_tasks = [
            self._validate_question(
                question,
                request["event_id"],
                request["max_questions"],
                request["max_categories"],
                runtime_scope_id=request["runtime_scope_id"],
                allow_data_preview=request["allow_data_preview"],
            )
            for question in questions
        ]

        await asyncio.gather(*validation_tasks, return_exceptions=True)

    @observe(name="Generate Question Recommendation")
    @trace_metadata
    async def recommend(self, input: Request, **kwargs) -> Event:
        logger.info(
            f"Request {input.event_id}: Generate Question Recommendation pipeline is running..."
        )
        trace_id = kwargs.get("trace_id")

        try:
            runtime_scope_id = input.resolve_runtime_scope_id()
            mdl = orjson.loads(input.mdl)
            retrieval_result = await self._pipelines["db_schema_retrieval"].run(
                tables=[model["name"] for model in mdl["models"]],
                runtime_scope_id=runtime_scope_id,
            )
            _retrieval_result = retrieval_result.get("construct_retrieval_results", {})
            documents = _retrieval_result.get("retrieval_results", [])
            table_ddls = [document.get("table_ddl") for document in documents]

            request = {
                "contexts": table_ddls,
                "previous_questions": input.previous_questions,
                "user_question": input.user_question,
                "source_question": input.source_question,
                "source_answer": input.source_answer,
                "source_sql": input.source_sql,
                "source_chart_type": input.source_chart_type,
                "source_chart_title": input.source_chart_title,
                "source_chart_encodings": input.source_chart_encodings,
                "source_dimension_columns": input.source_dimension_columns,
                "source_intent_lineage": input.source_intent_lineage,
                "source_measure_columns": input.source_measure_columns,
                "source_preview_column_count": input.source_preview_column_count,
                "source_preview_columns": input.source_preview_columns,
                "source_preview_row_count": input.source_preview_row_count,
                "source_response_kind": input.source_response_kind,
                "language": input.configurations.language,
                "max_questions": input.max_questions,
                "max_categories": input.max_categories,
                "runtime_scope_id": runtime_scope_id,
                "event_id": input.event_id,
                "allow_data_preview": input.allow_data_preview,
            }

            await self._recommend(request)

            resource = self._cache[input.event_id]
            resource.trace_id = trace_id
            response = resource.response

            categories_count = {
                category: input.max_questions - len(questions)
                for category, questions in response["questions"].items()
                if len(questions) < input.max_questions
            }
            categories = list(categories_count.keys())
            need_regenerate = len(categories) > 0 and input.regenerate

            resource.status = "generating" if need_regenerate else "finished"

            if resource.status == "finished":
                return resource.with_metadata()

            await self._recommend(
                {
                    **request,
                    "categories": categories,
                    "max_categories": len(categories),
                },
            )

            self._cache[input.event_id].status = "finished"
            self._cache[input.event_id].request_from = input.request_from

        except orjson.JSONDecodeError as e:
            self._handle_exception(
                input.event_id,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
                trace_id=trace_id,
                request_from=input.request_from,
            )
        except Exception as e:
            self._handle_exception(
                input.event_id,
                f"An error occurred during question recommendation generation: {str(e)}",
                trace_id=trace_id,
                request_from=input.request_from,
            )

        return self._cache[input.event_id].with_metadata()

    def __getitem__(self, id: str) -> Event:
        response = self._cache.get(id)

        if response is None:
            message = f"Question Recommendation Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Event(
                event_id=id,
                status="failed",
                error=self.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Event):
        self._cache[id] = value
