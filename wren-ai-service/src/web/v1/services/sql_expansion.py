import logging
from typing import Dict, List, Literal, Optional
from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel
from src.core.pipeline import BasicPipeline
from src.utils import async_timer, remove_sql_summary_duplicates, trace_metadata
from src.web.v1.services.ask import AskError, AskHistory
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")

class SQLExpansionRequest(BaseModel):
    class Input(BaseModel):
        query: str
        history: AskHistory
        project_id: Optional[str] = None
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        user_id: Optional[str] = None
        configurations: Dict[
            "language": str
        ] = {"language": "English"}

    class Resource(BaseModel):
        class Result(BaseModel):
            description: str
            steps: List[SQLBreakdown]

        class Error(BaseModel):
            code: Literal["NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
            message: str

        query_id: str
        status: Literal[
            "understanding", "searching", "generating", "finished", "failed", "stopped"
        ] = None
        response: Optional[Result] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, SQLExpansionRequest.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _is_stopped(self, query_id: str):
        if (
            result := self._cache.get(query_id)
        ) is not None and result.status == "stopped":
            return True
        return False

    def _get_failed_dry_run_results(self, invalid_generation_results: list[dict]):
        return list(
            filter(lambda x: x["type"] == "DRY_RUN", invalid_generation_results)
        )

    @async_timer
    @observe(name="SQL Expansion")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Resource:
        try:
            if not self._is_stopped(request.query_id):
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="understanding"
                )

            if not self._is_stopped(request.query_id):
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="searching"
                )

                query_for_retrieval = (
                    request.history.summary
                    + " "
                    + request.query
                )
                retrieval_result = await self._pipelines["retrieval"].run(
                    query=query_for_retrieval,
                    id=request.project_id,
                )
                documents = retrieval_result.get("construct_retrieval_results", [])

                if not documents:
                    logger.exception(
                        f"sql expansion pipeline - NO_RELEVANT_DATA: {request.query}"
                    )
                    self[request.query_id] = self.Resource(
                        query_id=request.query_id,
                        status="failed",
                        error=self.Resource.Error(
                            code="NO_RELEVANT_DATA",
                            message="No relevant data"
                        )
                    )
                    return self[request.query_id]

            if not self._is_stopped(request.query_id):
                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="generating"
                )

                sql_expansion_generation_results = await self._pipelines[
                    "sql_expansion"
                ].run(
                    query=request.query,
                    contexts=documents,
                    history=request.history,
                    project_id=request.project_id,
                )

                valid_generation_results = []
                if sql_valid_results := sql_expansion_generation_results[
                    "post_process"
                ]["valid_generation_results"]:
                    valid_generation_results += sql_valid_results

                if failed_dry_run_results := self._get_failed_dry_run_results(
                    sql_expansion_generation_results["post_process"][
                        "invalid_generation_results"
                    ]
                ):
                    sql_correction_results = await self._pipelines[
                        "sql_correction"
                    ].run(
                        contexts=documents,
                        invalid_generation_results=failed_dry_run_results,
                        project_id=request.project_id,
                    )
                    valid_generation_results += sql_correction_results["post_process"][
                        "valid_generation_results"
                    ]

                valid_sql_summary_results = []
                if valid_generation_results:
                    sql_summary_results = await self._pipelines["sql_summary"].run(
                        query=request.query,
                        sqls=valid_generation_results,
                        language=request.configurations["language"],
                    )
                    valid_sql_summary_results = sql_summary_results["post_process"][
                        "sql_summary_results"
                    ]
                    valid_sql_summary_results = remove_sql_summary_duplicates(
                        valid_sql_summary_results
                    )

                if not valid_sql_summary_results:
                    logger.exception(
                        f"sql expansion pipeline - NO_RELEVANT_SQL: {request.query}"
                    )
                    self[request.query_id] = self.Resource(
                        query_id=request.query_id,
                        status="failed",
                        error=self.Resource.Error(
                            code="NO_RELEVANT_SQL",
                            message="No relevant SQL"
                        )
                    )
                    return self[request.query_id]

                api_results = self.Resource.Result(
                    description=request.history.summary,
                    steps=[
                        {
                            "sql": valid_generation_results[0]["sql"],
                            "summary": valid_sql_summary_results[0]["summary"],
                            "cte_name": "",
                        }
                    ],
                )

                self[request.query_id] = self.Resource(
                    query_id=request.query_id,
                    status="finished",
                    response=api_results
                )

                return self[request.query_id]
        except Exception as e:
            logger.exception(f"sql expansion pipeline - OTHERS: {e}")
            self[request.query_id] = self.Resource(
                query_id=request.query_id,
                status="failed",
                error=self.Resource.Error(
                    code="OTHERS",
                    message=str(e)
                )
            )
            return self[request.query_id]

    def stop(self, request: Dict[str, str]) -> None:
        self[request["query_id"]] = self.Resource(status="stopped")

    def __getitem__(self, query_id: str) -> Resource:
        response = self._cache.get(query_id)
        if response is None:
            message = f"SQL Expansion Resource with ID '{query_id}' not found."
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