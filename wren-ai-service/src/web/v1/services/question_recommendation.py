import asyncio
import logging
from typing import Dict, Literal, Optional

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration, MetadataTraceable

logger = logging.getLogger("wren-ai-service")


class QuestionRecommendation:
    class Input(BaseModel):
        id: str
        mdl: str
        previous_questions: list[str] = []
        project_id: Optional[str] = None
        max_questions: Optional[int] = 5
        max_categories: Optional[int] = 3
        regenerate: Optional[bool] = False
        configuration: Optional[Configuration] = Configuration()

    class Resource(BaseModel, MetadataTraceable):
        class Error(BaseModel):
            code: Literal["OTHERS", "MDL_PARSE_ERROR", "RESOURCE_NOT_FOUND"]
            message: str

        id: str
        status: Literal["generating", "finished", "failed"] = "generating"
        response: Optional[dict] = {"questions": {}}
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, QuestionRecommendation.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _handle_exception(
        self,
        input: Input,
        error_message: str,
        code: str = "OTHERS",
    ):
        self._cache[input.id] = self.Resource(
            id=input.id,
            status="failed",
            error=self.Resource.Error(code=code, message=error_message),
        )
        logger.error(error_message)

    @observe(name="Validate Question")
    async def _validate_question(
        self,
        candidate: dict,
        request_id: str,
        max_questions: int,
        max_categories: int,
        project_id: Optional[str] = None,
        configuration: Optional[Configuration] = Configuration(),
    ):
        try:
            retrieval_result = await self._pipelines["retrieval"].run(
                query=candidate["question"],
                id=project_id,
            )
            _retrieval_result = retrieval_result.get("construct_retrieval_results", {})
            documents = _retrieval_result.get("retrieval_results", [])
            has_calculated_field = _retrieval_result.get("has_calculated_field", False)
            has_metric = _retrieval_result.get("has_metric", False)

            sql_generation_reasoning = (
                (
                    await self._pipelines["sql_generation_reasoning"].run(
                        query=candidate["question"],
                        contexts=documents,
                        configuration=configuration,
                    )
                )
                .get("post_process", {})
                .get("reasoning_plan")
            )

            generated_sql = await self._pipelines["sql_generation"].run(
                query=candidate["question"],
                contexts=documents,
                sql_generation_reasoning=sql_generation_reasoning,
                configuration=configuration,
                project_id=project_id,
                has_calculated_field=has_calculated_field,
                has_metric=has_metric,
            )

            post_process = generated_sql["post_process"]

            if len(post_process["valid_generation_results"]) == 0:
                return post_process

            valid_sql = post_process["valid_generation_results"][0]["sql"]

            # Partial update the resource
            current = self._cache[request_id]
            questions = current.response["questions"]

            if (
                candidate["category"] not in questions
                and len(questions) >= max_categories
            ):
                # Skip to update the question dictionary if it is already full
                return post_process

            currnet_category = questions.setdefault(candidate["category"], [])

            if len(currnet_category) >= max_questions:
                # Skip to update the questions for the category if it is already full
                return post_process

            currnet_category.append({**candidate, "sql": valid_sql})
            return post_process

        except Exception as e:
            logger.error(f"Request {request_id}: Error validating question: {str(e)}")

    async def _recommend(self, request: dict, input: Input):
        resp = await self._pipelines["question_recommendation"].run(**request)
        questions = resp.get("normalized", {}).get("questions", [])
        validation_tasks = [
            self._validate_question(
                question,
                input.id,
                input.max_questions,
                input.max_categories,
                input.project_id,
                input.configuration,
            )
            for question in questions
        ]

        await asyncio.gather(*validation_tasks, return_exceptions=True)

    @observe(name="Generate Question Recommendation")
    @trace_metadata
    async def recommend(self, input: Input, **kwargs) -> Resource:
        logger.info(
            f"Request {input.id}: Generate Question Recommendation pipeline is running..."
        )

        try:
            request = {
                "mdl": orjson.loads(input.mdl),
                "previous_questions": input.previous_questions,
                "language": input.configuration.language,
                "current_date": input.configuration.show_current_time(),
                "max_questions": input.max_questions,
                "max_categories": input.max_categories,
            }

            await self._recommend(request, input)

            resource = self._cache[input.id]
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
                input,
            )

            self._cache[input.id].status = "finished"

        except orjson.JSONDecodeError as e:
            self._handle_exception(
                input,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
            )
        except Exception as e:
            self._handle_exception(
                input,
                f"An error occurred during question recommendation generation: {str(e)}",
            )

        return self._cache[input.id].with_metadata()

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Question Recommendation Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(code="RESOURCE_NOT_FOUND", message=message),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value
