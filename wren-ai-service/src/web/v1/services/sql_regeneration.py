import logging
from typing import Dict, List, Literal, Optional
from cachetools import TTLCache
from haystack import Pipeline
from pydantic import BaseModel
from src.utils import async_timer
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")

class SQLRegenerationRequest(BaseModel):
    class Input(BaseModel):
        description: str
        steps: List[
            Dict[
                "summary": str,
                "sql": str,
                "cte_name": str,
                "corrections": List[
                    Dict[
                        "before": Dict[
                            "type": Literal["filter", "selectItems", "relation", "groupByKeys", "sortings"],
                            "value": str
                        ],
                        "after": Dict[
                            "type": Literal["sql_expression", "nl_expression"],
                            "value": str
                        ]
                    ]
                ]
            ]
        ]
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

        query_id: str
        status: Literal["understanding", "generating", "finished", "failed"] = None
        response: Optional[ResponseDetails] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLRegenerationRequest.Resource] = TTLCache(
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

            generation_result = await self._pipelines["sql_regeneration"].run(
                description=request.description,
                steps=request.steps,
                project_id=request.project_id,
            )

            sql_regeneration_result = generation_result[
                "sql_regeneration_post_process"
            ]["results"]

            if not sql_regeneration_result["steps"]:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="failed",
                    error=self.Resource.Error(
                        code="NO_RELEVANT_SQL",
                        message="SQL is not executable"
                    )
                )
            else:
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="finished",
                    response=self.Resource.ResponseDetails(
                        description=sql_regeneration_result["description"],
                        steps=sql_regeneration_result["steps"]
                    )
                )
        except Exception as e:
            logger.exception(f"sql regeneration pipeline - OTHERS: {e}")
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
            message = f"SQL Regeneration Resource with ID '{query_id}' not found."
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