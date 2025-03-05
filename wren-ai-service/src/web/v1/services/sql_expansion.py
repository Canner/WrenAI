import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskError, AskHistory
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-expansions
class SqlExpansionRequest(BaseModel):
    _query_id: str | None = None
    query: str
    history: AskHistory
    # for identifying which collection to access from vectordb
    project_id: Optional[str] = None
    mdl_hash: Optional[str] = None
    thread_id: Optional[str] = None
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SqlExpansionResponse(BaseModel):
    query_id: str


# PATCH /v1/sql-expansions/{query_id}
class StopSqlExpansionRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class StopSqlExpansionResponse(BaseModel):
    query_id: str


# GET /v1/sql-expansions/{query_id}/result
class SqlExpansionResultRequest(BaseModel):
    query_id: str


class SqlExpansionResultResponse(BaseModel):
    class SqlExpansionResult(BaseModel):
        description: str
        steps: List[SQLBreakdown]

    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[SqlExpansionResult] = None
    error: Optional[AskError] = None


class SqlExpansionService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._sql_expansion_results: Dict[str, SqlExpansionResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    def _is_stopped(self, query_id: str):
        if (
            result := self._sql_expansion_results.get(query_id)
        ) is not None and result.status == "stopped":
            return True

        return False

    def _get_failed_dry_run_results(self, invalid_generation_results: list[dict]):
        return list(
            filter(lambda x: x["type"] == "DRY_RUN", invalid_generation_results)
        )

    @observe(name="SQL Expansion")
    @trace_metadata
    async def sql_expansion(
        self,
        sql_expansion_request: SqlExpansionRequest,
        **kwargs,
    ):
        results = {
            "sql_expansion_result": {},
            "metadata": {
                "error_type": "",
                "error_message": "",
            },
        }

        try:
            query_id = sql_expansion_request.query_id

            if not self._is_stopped(query_id):
                self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                    status="understanding",
                )

            if not self._is_stopped(query_id):
                self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                    status="searching",
                )

                query_for_retrieval = sql_expansion_request.query
                retrieval_result = await self._pipelines["retrieval"].run(
                    query=query_for_retrieval,
                    id=sql_expansion_request.project_id,
                )
                _retrieval_result = retrieval_result.get(
                    "construct_retrieval_results", {}
                )
                documents = _retrieval_result.get("retrieval_results", [])

                if not documents:
                    logger.exception(
                        f"sql expansion pipeline - NO_RELEVANT_DATA: {sql_expansion_request.query}"
                    )
                    self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                        status="failed",
                        error=AskError(
                            code="NO_RELEVANT_DATA",
                            message="No relevant data",
                        ),
                    )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    return results

            if not self._is_stopped(query_id):
                self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                    status="generating",
                )

                sql_expansion_generation_results = await self._pipelines[
                    "sql_expansion"
                ].run(
                    query=sql_expansion_request.query,
                    contexts=documents,
                    history=sql_expansion_request.history,
                    project_id=sql_expansion_request.project_id,
                    configuration=sql_expansion_request.configurations,
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
                        project_id=sql_expansion_request.project_id,
                    )
                    valid_generation_results += sql_correction_results["post_process"][
                        "valid_generation_results"
                    ]

                valid_sql_summary_results = []
                if valid_generation_results:
                    sql_summary_results = await self._pipelines["sql_summary"].run(
                        query=sql_expansion_request.query,
                        sqls=[result.get("sql") for result in valid_generation_results],
                        language=sql_expansion_request.configurations.language,
                    )
                    valid_sql_summary_results = sql_summary_results["post_process"][
                        "sql_summary_results"
                    ]

                if not valid_sql_summary_results:
                    logger.exception(
                        f"sql expansion pipeline - NO_RELEVANT_SQL: {sql_expansion_request.query}"
                    )
                    self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                        status="failed",
                        error=AskError(
                            code="NO_RELEVANT_SQL",
                            message="No relevant SQL",
                        ),
                    )
                    results["metadata"]["error_type"] = "NO_RELEVANT_SQL"
                    return results

                api_results = SqlExpansionResultResponse.SqlExpansionResult(
                    # at the moment, we skip the description, since no description is generated in ai pipelines
                    description="",
                    steps=[
                        {
                            "sql": valid_sql_summary_results[0]["sql"],
                            "summary": valid_sql_summary_results[0]["summary"],
                            "cte_name": "",
                        }
                    ],
                )

                self._sql_expansion_results[query_id] = SqlExpansionResultResponse(
                    status="finished",
                    response=api_results,
                )

                results["sql_expansion_result"] = api_results
                return results
        except Exception as e:
            logger.exception(f"sql expansion pipeline - OTHERS: {e}")

            self._sql_expansion_results[
                sql_expansion_request.query_id
            ] = SqlExpansionResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def stop_sql_expansion(
        self,
        stop_sql_expansion_request: StopSqlExpansionRequest,
    ):
        self._sql_expansion_results[
            stop_sql_expansion_request.query_id
        ] = SqlExpansionResultResponse(status="stopped")

    def get_sql_expansion_result(
        self,
        sql_expansion_result_request: SqlExpansionResultRequest,
    ) -> SqlExpansionResultResponse:
        if (
            result := self._sql_expansion_results.get(
                sql_expansion_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"sql-expansion pipeline - OTHERS: {sql_expansion_result_request.query_id} is not found"
            )
            return SqlExpansionResultResponse(
                status="failed",
                error=AskError(
                    code="OTHERS",
                    message=f"{sql_expansion_result_request.query_id} is not found",
                ),
            )

        return result
