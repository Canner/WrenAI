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

    @observe(name="Generate Question Recommendation")
    @trace_metadata
    async def recommend(self, request: Input, **kwargs) -> Resource:
        logger.info("Generate Question Recommendation pipeline is running...")

        try:
            input = {
                "mdl": orjson.loads(request.mdl),
                "previous_questions": request.previous_questions,
                "language": request.configuration.language,
                "current_date": request.configuration.show_current_time(),
                "max_questions": request.max_questions,
                "max_categories": request.max_categories,
            }

            resp = await self._pipelines["question_recommendation"].run(**input)
            questions = resp.get("normalized", {}).get("questions", [])

            validation_tasks = [
                self._validate_question(question, request.project_id)
                for question in questions
            ]

            validation_results = await asyncio.gather(*validation_tasks)

            validated_questions = [
                question
                for question, is_valid in zip(questions, validation_results)
                if is_valid
            ]

            self._cache[request.id] = self.Resource(
                id=request.id,
                status="finished",
                response={"questions": validated_questions},
            )
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
