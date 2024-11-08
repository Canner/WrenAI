import asyncio
import logging
from typing import Callable, Dict, Literal, Optional

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

    def _partial_update(self, request_id: str, candidate: dict, valid_sql: str):
        current = self._cache[request_id]
        current.response = current.response or {"questions": {}}
        current.response["questions"].setdefault(candidate["category"], []).append(
            {**candidate, "sql": valid_sql}
        )

    @observe(name="Validate Question")
    async def _validate_question(
        self,
        candidate: dict,
        request_id: str,
        project_id: Optional[str] = None,
        hook: Optional[Callable] = lambda *_: None,
    ) -> bool:
        try:
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

            post_process = generated_sql["post_process"]

            if len(post_process["valid_generation_results"]) == 0:
                return False

            valid_sql = post_process["valid_generation_results"][0]["sql"]
            logger.debug(f"Request {request_id}: Valid SQL: {valid_sql}")

            hook(request_id, candidate, valid_sql)

            return True

        except Exception as e:
            logger.error(f"Request {request_id}: Error validating question: {str(e)}")

        return False

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

            resp = await self._pipelines["question_recommendation"].run(**input)
            questions = resp.get("normalized", {}).get("questions", [])

            validation_tasks = [
                self._validate_question(
                    question, request.id, request.project_id, self._partial_update
                )
                for question in questions
            ]

            results = await asyncio.gather(*validation_tasks, return_exceptions=True)
            zip_result = list(zip(questions, results))

            invalid = [question for question, is_valid in zip_result if not is_valid]

            resource = self._cache[request.id]
            resource.status = (
                "generating" if len(invalid) > 0 and request.regenerate else "finished"
            )

            if resource.status == "finished":
                return resource.with_metadata()

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
