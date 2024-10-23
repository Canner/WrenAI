import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel

from src.utils import async_timer
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


class SQLRegeneration:
    class DecisionPoint(BaseModel):
        type: Literal["filter", "selectItems", "relation", "groupByKeys", "sortings"]
        value: str

    class CorrectionPoint(BaseModel):
        type: Literal["sql_expression", "nl_expression"]
        value: str

    class UserCorrection(BaseModel):
        before: DecisionPoint
        after: CorrectionPoint

    class SQLExplanationWithUserCorrections(BaseModel):
        summary: str
        sql: str
        cte_name: str
        corrections: List[UserCorrection]

    class Input(BaseModel):
        id: str
        description: str
        steps: List[SQLExplanationWithUserCorrections]
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        project_id: Optional[str] = None
        user_id: Optional[str] = None

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["NO_RELEVANT_SQL", "OTHERS"]
            message: str

        class ResponseDetails(BaseModel):
            description: str
            steps: List[SQLBreakdown]

        id: str
        status: Literal["understanding", "generating", "finished", "failed"] = "understanding"
        response: Optional[ResponseDetails] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLRegeneration.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    @async_timer
    async def sql_regeneration(self, input: Input, **kwargs) -> Resource:
        resource = self.Resource(id=input.id)
        self._cache[input.id] = resource

        try:
            resource.status = "generating"
            self._cache[input.id] = resource

            generation_result = await self._pipelines["sql_regeneration"].run(
                description=input.description,
                steps=input.steps,
                project_id=input.project_id,
            )

            sql_regeneration_result = generation_result["sql_regeneration_post_process"]["results"]

            if not sql_regeneration_result["steps"]:
                resource.status = "failed"
                resource.error = self.Resource.Error(
                    code="NO_RELEVANT_SQL",
                    message="SQL is not executable",
                )
            else:
                resource.status = "finished"
                resource.response = self.Resource.ResponseDetails(**sql_regeneration_result)

            self._cache[input.id] = resource

        except Exception as e:
            logger.exception(f"sql regeneration pipeline - OTHERS: {e}")
            resource.status = "failed"
            resource.error = self.Resource.Error(
                code="OTHERS",
                message=str(e),
            )
            self._cache[input.id] = resource

    def get_sql_regeneration_result(self, id: str) -> Resource:
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
