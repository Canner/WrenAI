import logging
from typing import Dict, Literal, Optional
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel
from src.core.pipeline import BasicPipeline
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")

class SQLAnswerRequest(BaseModel):
    class Input(BaseModel):
        query: str
        sql: str
        sql_summary: str
        thread_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["OTHERS"]
            message: str

        query_id: str
        status: Literal["understanding", "processing", "finished", "failed"] = None
        response: Optional[str] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLAnswerRequest.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @async_timer
    @observe(name="SQL Answer")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Resource:
        try:
            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="understanding"
            )

            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="processing"
            )

            data = await self._pipelines["sql_answer"].run(
                query=request.query,
                sql=request.sql,
                sql_summary=request.sql_summary,
                project_id=request.thread_id,
            )
            api_results = data["post_process"]["results"]
            if answer := api_results["answer"]:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="finished",
                    response=answer
                )
            else:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="failed",
                    error=self.Resource.Error(
                        code="OTHERS",
                        message=api_results["error"]
                    )
                )

        except Exception as e:
            logger.exception(f"sql answer pipeline - OTHERS: {e}")
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
            message = f"SQL Answer Resource with ID '{query_id}' not found."
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