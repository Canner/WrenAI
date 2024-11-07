import asyncio
import logging
from typing import Dict, Literal, Optional, Tuple

import orjson
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration, MetadataTraceable
from src.web.v1.services.ask import AskConfigurations

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
        response: Optional[dict] = None
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
        project_id: Optional[str] = None,
    ) -> bool:
        retrieval_result = await self._pipelines["retrieval"].run(
            query=candidate["question"],
            id=project_id,
        )
        documents = retrieval_result.get("construct_retrieval_results", [])
        generated_sql = await self._pipelines["sql_generation"].run(
            query=candidate["question"],
            contexts=documents,
            exclude=[],
            configurations=AskConfigurations(),
        )
        valid_sql = generated_sql["post_process"]["valid_generation_results"]
        logger.debug(f"Valid SQL: {valid_sql}")

        return True if valid_sql else False

    async def _recommend(
        self, input: dict, project_id: Optional[str] = None
    ) -> Tuple[list, list]:
        resp = await self._pipelines["question_recommendation"].run(**input)
        questions = resp.get("normalized", {}).get("questions", [])

        validation_tasks = [
            self._validate_question(question, project_id) for question in questions
        ]

        results = await asyncio.gather(*validation_tasks)
        zip_result = zip(questions, results)

        valid = [q for q, is_valid in zip_result if is_valid]
        invalid = [q for q, is_valid in zip_result if not is_valid]
        return valid, invalid

    @observe(name="Generate Question Recommendation")
    @trace_metadata
    async def recommend(self, request: Input, **kwargs) -> Resource:
        logger.info(
            f"Request {request.id}: Generate Question Recommendation pipeline is running..."
        )

        try:
            input = {
                "mdl": orjson.loads(request.mdl),
                "previous_questions": request.previous_questions,
                "language": request.configuration.language,
                "current_date": request.configuration.show_current_time(),
                "max_questions": request.max_questions,
                "max_categories": request.max_categories,
            }

            valid, invalid = await self._recommend(input, request.project_id)

            status = (
                "generating" if len(invalid) > 0 and request.regenerate else "finished"
            )

            self._cache[request.id] = self.Resource(
                id=request.id,
                status=status,
                response={"questions": valid},
            )

            if status == "finished":
                return self._cache[request.id].with_metadata()

            # Count questions per category in invalid questions
            category_counts = {}
            for question in invalid:
                category = question["category"]
                category_counts[category] = category_counts.get(category, 0) + 1

            logger.debug(f"Invalid questions per category: {category_counts}")

            categories = list(category_counts.keys())
            logger.info(
                f"Request {request.id}: Regenerating {len(invalid)} questions for {categories}"
            )

            valid, invalid = await self._recommend(
                {"categories": categories, **input}, request.project_id
            )

            # Group valid questions by category
            valid_by_category = {}
            for question in valid:
                category = question["category"]
                valid_by_category.setdefault(category, []).append(question)

            questions_to_add = [
                question
                for category, questions in valid_by_category.items()
                for question in questions[: category_counts[category]]
            ]

            self._cache[request.id].response["questions"] += questions_to_add
            self._cache[request.id].status = "finished"

        except orjson.JSONDecodeError as e:
            self._handle_exception(
                request,
                f"Failed to parse MDL: {str(e)}",
                code="MDL_PARSE_ERROR",
            )
        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during question recommendation generation: {str(e)}",
            )

        return self._cache[request.id].with_metadata()

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
