import asyncio
import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel

from src.utils import async_timer

logger = logging.getLogger("wren-ai-service")


class SQLExplanation:
    class StepWithAnalysisResult(BaseModel):
        sql: str
        summary: str
        sql_analysis_results: List[Dict]

    class Input(BaseModel):
        id: str
        question: str
        steps_with_analysis_results: List[StepWithAnalysisResult]
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        project_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        id: str
        status: Literal["understanding", "generating", "finished", "failed"] = "understanding"
        response: Optional[List[List[Dict]]] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLExplanation.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    @async_timer
    async def sql_explanation(self, input: Input, **kwargs) -> Resource:
        resource = self.Resource(id=input.id)
        self._cache[input.id] = resource

        try:
            resource.status = "generating"
            self._cache[input.id] = resource

            async def _task(question: str, step_with_analysis_results: StepWithAnalysisResult):
                return await self._pipelines["sql_explanation"].run(
                    question=question,
                    step_with_analysis_results=step_with_analysis_results,
                )

            tasks = [
                _task(input.question, step_with_analysis_results)
                for step_with_analysis_results in input.steps_with_analysis_results
            ]
            generation_results = await asyncio.gather(*tasks)

            sql_explanation_results = [
                generation_result["post_process"]["results"]
                for generation_result in generation_results
            ]

            if sql_explanation_results:
                resource.status = "finished"
                resource.response = sql_explanation_results
            else:
                resource.status = "failed"
                resource.error = self.Resource.Error(
                    code="OTHERS",
                    message="No SQL explanation is found",
                )

            self._cache[input.id] = resource

        except Exception as e:
            logger.exception(f"sql explanation pipeline - Failed to provide SQL explanation: {e}")
            resource.status = "failed"
            resource.error = self.Resource.Error(
                code="OTHERS",
                message=str(e),
            )
            self._cache[input.id] = resource

        return resource

    def get_sql_explanation_result(self, id: str) -> Resource:
        if resource := self._cache.get(id):
            return resource
        
        return self.Resource(
            id=id,
            status="failed",
            error=self.Resource.Error(
                code="OTHERS",
                message=f"{id} is not found",
            ),
        )
