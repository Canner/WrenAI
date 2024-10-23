import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, remove_sql_summary_duplicates, trace_metadata
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


class AskHistory(BaseModel):
    sql: str
    summary: str
    steps: List[SQLBreakdown]


class AskConfigurations(BaseModel):
    class FiscalYear(BaseModel):
        start: str
        end: str

    fiscal_year: Optional[FiscalYear] = None
    language: str = "English"


class Ask:
    class Input(BaseModel):
        query: str
        project_id: Optional[str] = None
        mdl_hash: Optional[str] = Field(alias="id")
        thread_id: Optional[str] = None
        user_id: Optional[str] = None
        history: Optional[AskHistory] = None
        configurations: AskConfigurations = AskConfigurations(language="English")

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["MISLEADING_QUERY", "NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"]
            message: str

        query_id: str
        status: Literal["understanding", "searching", "generating", "finished", "failed", "stopped"]
        response: Optional[List[AskResult]] = None
        error: Optional[Error] = None


# POST /v1/asks
class AskRequest(BaseModel):
    _query_id: str | None = None
    query: str
    # for identifying which collection to access from vectordb
    project_id: Optional[str] = None
    # don't recommend to use id as a field name, but it's used in the older version of API spec
    # so we need to support as a choice, and will remove it in the future
    mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
    thread_id: Optional[str] = None
    user_id: Optional[str] = None
    history: Optional[AskHistory] = None
    configurations: AskConfigurations = AskConfigurations(language="English")

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class AskResponse(BaseModel):
    query_id: str


# PATCH /v1/asks/{query_id}
class StopAskRequest(BaseModel):
    _query_id: str | None = None
    status: Literal["stopped"]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class StopAskResponse(BaseModel):
    query_id: str


# GET /v1/asks/{query_id}/result
class AskResult(BaseModel):
    sql: str
    summary: str
    type: Literal["llm", "view"] = "llm"
    viewId: Optional[str] = None


class AskError(BaseModel):
    code: Literal[
        "MISLEADING_QUERY", "NO_RELEVANT_DATA", "NO_RELEVANT_SQL", "OTHERS"
    ]  # MISLEADING_QUERY is not in use now, we may add it back in the future when we implement the clarification pipeline
    message: str


class AskResultRequest(BaseModel):
    query_id: str


class AskResultResponse(BaseModel):
    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[List[AskResult]] = None
    error: Optional[AskError] = None


class AskService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, Ask.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

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

    async def _add_summary_to_sql_candidates(
        self, sqls: list[str], query: str, language: str
    ):
        sql_summary_results = await self._pipelines["sql_summary"].run(
            query=query,
            sqls=sqls,
            language=language,
        )
        valid_sql_summary_results = sql_summary_results["post_process"][
            "sql_summary_results"
        ]
        # remove duplicates of valid_sql_summary_results, which consists of a sql and a summary
        return remove_sql_summary_duplicates(valid_sql_summary_results)

    @async_timer
    @observe(name="Ask Question")
    @trace_metadata
    async def ask(
        self,
        input: Ask.Input,
    ) -> Ask.Resource:
        query_id = self._generate_query_id()  # Implement this method
        resource = Ask.Resource(query_id=query_id, status="understanding")
        self._cache[query_id] = resource

        try:
            # Implement the ask logic here, updating the resource status and response
            # as you progress through the pipeline stages
            # ...

            return resource
        except Exception as e:
            resource.status = "failed"
            resource.error = Ask.Resource.Error(code="OTHERS", message=str(e))
            return resource

    def stop_ask(
        self,
        query_id: str,
    ) -> Ask.Resource:
        if resource := self._cache.get(query_id):
            resource.status = "stopped"
        else:
            resource = Ask.Resource(query_id=query_id, status="stopped")
            self._cache[query_id] = resource
        return resource

    def get_ask_result(
        self,
        query_id: str,
    ) -> Ask.Resource:
        if resource := self._cache.get(query_id):
            return resource
        return Ask.Resource(
            query_id=query_id,
            status="failed",
            error=Ask.Resource.Error(
                code="OTHERS",
                message=f"{query_id} is not found",
            ),
        )
