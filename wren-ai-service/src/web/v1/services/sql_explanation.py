import asyncio
import logging
from typing import Dict, List, Literal, Optional
from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel
from src.utils import async_timer

logger = logging.getLogger("wren-ai-service")

class SQLExplanationRequest(BaseModel):
    class Input(BaseModel):
        question: str
        steps_with_analysis_results: List[
            Dict[
                "step_sql": str,
                "step_summary": str,
                "step_sql_analysis_results": List[Dict]
            ]
        ]
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        project_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        query_id: str
        status: Literal["understanding", "generating", "finished", "failed"] = None
        response: Optional[List[List[Dict]]] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLExplanationRequest.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @async_timer
    async def generate(self, request: Input, **kwargs) -> Resource:
        try:
            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="understanding"
            )

            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="generating"
            )

            async def _task(question: str, step_with_analysis_results: Dict):
                return await self._pipelines["sql_explanation"].run(
                    question=question,
                    step_with_analysis_results=step_with_analysis_results
                )

            tasks = [
                _task(request.question, step)
                for step in request.steps_with_analysis_results
            ]
            generation_results = await asyncio.gather(*tasks)

            sql_explanation_results = [
                generation_result["post_process"]["results"]
                for generation_result in generation_results
            ]

            if sql_explanation_results:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="finished",
                    response=sql_explanation_results
                )
            else:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="failed",
                    error=self.Resource.Error(
                        code="OTHERS",
                        message="No SQL explanation is found"
                    )
                )
        except Exception as e:
            logger.exception(f"sql explanation pipeline - Failed to provide SQL explanation: {e}")
            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="failed",
                error=self.Resource.Error(
                    code="OTHERS",
                    message=str(e)
                )
            )

        return self[request.query_id]

    def __getitem__(self, query_id: str) -> Resource:
        response = self._cache.get(query_id)
        if response is None:
            message = f"SQL Explanation Resource with ID '{query_id}' not found."
            logger.exception(message)
            return self.Resource(
                query_id=query_id,
                status="failed",
                error=self.Resource.Error(
                    code="OTHERS",
                    message=message
                )
            )
        return response

    def __setitem__(self, query_id: str, value: Resource):
        self._cache[query_id] = value