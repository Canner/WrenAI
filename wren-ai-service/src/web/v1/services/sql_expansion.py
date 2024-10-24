import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, remove_sql_summary_duplicates, trace_metadata
from src.web.v1.services.ask import AskHistory
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")

class SqlExpansion:
    class Input(BaseModel):
        query_id: str
        query: str
        history: AskHistory
        project_id: Optional[str] = None
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        user_id: Optional[str] = None
        language: str = "English"

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
            message: str

        class SqlExpansionResult(BaseModel):
            description: str
            steps: List[SQLBreakdown]

        query_id: str
        status: Literal["understanding", "searching", "generating", "finished", "failed", "stopped"] = "understanding"
        response: Optional[SqlExpansionResult] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SqlExpansion.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

    def _is_stopped(self, query_id: str) -> bool:
        if resource := self._cache.get(query_id):
            return resource.status == "stopped"
        return False

    def _get_failed_dry_run_results(self, invalid_generation_results: list[dict]):
        return list(filter(lambda x: x["type"] == "DRY_RUN", invalid_generation_results))

    @async_timer
    @observe(name="SQL Expansion")
    @trace_metadata
    async def sql_expansion(self, input: Input, **kwargs) -> Resource:
        resource = self.Resource(query_id=input.query_id)
        self._cache[input.query_id] = resource

        try:
            if not self._is_stopped(input.query_id):
                resource.status = "searching"
                self._cache[input.query_id] = resource

                query_for_retrieval = input.history.summary + " " + input.query
                retrieval_result = await self._pipelines["retrieval"].run(
                    query=query_for_retrieval,
                    id=input.project_id,
                )
                documents = retrieval_result.get("construct_retrieval_results", [])

                if not documents:
                    resource.status = "failed"
                    resource.error = self.Resource.Error(
                        code="NO_RELEVANT_DATA",
                        message="No relevant data",
                    )
                    self._cache[input.query_id] = resource
                    return resource

            if not self._is_stopped(input.query_id):
                resource.status = "generating"
                self._cache[input.query_id] = resource

                sql_expansion_generation_results = await self._pipelines["sql_expansion"].run(
                    query=input.query,
                    contexts=documents,
                    history=input.history,
                    project_id=input.project_id,
                )

                valid_generation_results = sql_expansion_generation_results["post_process"]["valid_generation_results"]

                if failed_dry_run_results := self._get_failed_dry_run_results(
                    sql_expansion_generation_results["post_process"]["invalid_generation_results"]
                ):
                    sql_correction_results = await self._pipelines["sql_correction"].run(
                        contexts=documents,
                        invalid_generation_results=failed_dry_run_results,
                        project_id=input.project_id,
                    )
                    valid_generation_results += sql_correction_results["post_process"]["valid_generation_results"]

                valid_sql_summary_results = []
                if valid_generation_results:
                    sql_summary_results = await self._pipelines["sql_summary"].run(
                        query=input.query,
                        sqls=valid_generation_results,
                        language=input.language,
                    )
                    valid_sql_summary_results = sql_summary_results["post_process"]["sql_summary_results"]
                    valid_sql_summary_results = remove_sql_summary_duplicates(valid_sql_summary_results)

                if not valid_sql_summary_results:
                    resource.status = "failed"
                    resource.error = self.Resource.Error(
                        code="NO_RELEVANT_SQL",
                        message="No relevant SQL",
                    )
                    self._cache[input.query_id] = resource
                    return resource

                api_results = self.Resource.SqlExpansionResult(
                    description=input.history.summary,
                    steps=[
                        {
                            "sql": valid_generation_results[0]["sql"],
                            "summary": valid_sql_summary_results[0]["summary"],
                            "cte_name": "",
                        }
                    ],
                )

                resource.status = "finished"
                resource.response = api_results
                self._cache[input.query_id] = resource

            return resource

        except Exception as e:
            logger.exception(f"sql expansion pipeline - OTHERS: {e}")
            resource.status = "failed"
            resource.error = self.Resource.Error(
                code="OTHERS",
                message=str(e),
            )
            self._cache[input.query_id] = resource
            return resource

    def stop_sql_expansion(self, query_id: str) -> Resource:
        resource = self._cache.get(query_id, self.Resource(query_id=query_id))
        resource.status = "stopped"
        self._cache[query_id] = resource
        return resource

    def get_sql_expansion_result(self, query_id: str) -> Resource:
        if resource := self._cache.get(query_id):
            return resource
        
        return self.Resource(
            query_id=query_id,
            status="failed",
            error=self.Resource.Error(
                code="OTHERS",
                message=f"{query_id} is not found",
            ),
        )
