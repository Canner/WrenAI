import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import AliasChoices, BaseModel, Field

from src.core.pipeline import BasicPipeline
from src.utils import async_timer, remove_sql_summary_duplicates, trace_metadata
from src.web.v1.services.ask_details import SQLBreakdown

logger = logging.getLogger("wren-ai-service")


class Ask:
    class Input(BaseModel):
        class FiscalYear(BaseModel):
            start: str
            end: str

        class History(BaseModel):
            sql: str
            summary: str
            steps: List[SQLBreakdown]

        class Configurations(BaseModel):
            fiscal_year: Optional[FiscalYear] = None
            language: str = "English"

        id: str
        query: str
        project_id: Optional[str] = None
        mdl_hash: Optional[str] = Field(validation_alias=AliasChoices("mdl_hash", "id"))
        thread_id: Optional[str] = None
        user_id: Optional[str] = None
        history: Optional[History] = None
        configurations: Configurations = Configurations(language="English")

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal[
                "MISLEADING_QUERY",
                "NO_RELEVANT_DATA",
                "NO_RELEVANT_SQL",
                "OTHERS",
                "RESOURCE_NOT_FOUND"
            ]
            message: str

        class Result(BaseModel):
            sql: str
            summary: str
            type: Literal["llm", "view"] = "llm"
            viewId: Optional[str] = None

        id: str
        status: Literal[
            "understanding",
            "searching",
            "generating",
            "finished",
            "failed",
            "stopped"
        ]
        response: Optional[List[Result]] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, Ask.Resource] = TTLCache(maxsize=maxsize, ttl=ttl)

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

    def _update_status(self, id: str, status: str, response: Optional[List[Resource.Result]] = None):
        self._cache[id] = self.Resource(
            id=id,
            status=status,
            response=response,
        )

    def _is_stopped(self, id: str) -> bool:
        if (result := self._cache.get(id)) is not None and result.status == "stopped":
            return True
        return False

    async def _add_summary_to_sql_candidates(
        self, sqls: list[str], query: str, language: str
    ) -> list[dict]:
        sql_summary_results = await self._pipelines["sql_summary"].run(
            query=query,
            sqls=sqls,
            language=language,
        )
        valid_results = sql_summary_results["post_process"]["sql_summary_results"]
        return remove_sql_summary_duplicates(valid_results)

    def _get_failed_dry_run_results(self, invalid_generation_results: list[dict]) -> list[dict]:
        return list(
            filter(lambda x: x["type"] == "DRY_RUN", invalid_generation_results)
        )

    @async_timer
    @observe(name="Ask Question")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Dict:
        logger.info("Ask pipeline is running...")
        results = {
            "ask_result": {},
            "metadata": {"error_type": "", "error_message": ""},
        }

        try:
            if not self._is_stopped(request.id):
                # Understanding phase
                self._update_status(request.id, "understanding")

                # Prepare query for retrieval
                query_for_retrieval = (
                    f"{request.history.summary} {request.query}"
                    if request.history
                    else request.query
                )

                # Searching phase
                self._update_status(request.id, "searching")
                retrieval_result = await self._pipelines["retrieval"].run(
                    query=query_for_retrieval,
                    id=request.project_id,
                )
                documents = retrieval_result.get("construct_retrieval_results", [])

                if not documents:
                    self._handle_exception(
                        request,
                        "No relevant data",
                        code="NO_RELEVANT_DATA"
                    )
                    results["metadata"]["error_type"] = "NO_RELEVANT_DATA"
                    return results

                # Generating phase
                self._update_status(request.id, "generating")

                # Historical question processing
                historical_question = await self._pipelines["historical_question"].run(
                    query=query_for_retrieval,
                    id=request.project_id,
                )
                historical_results = historical_question.get("formatted_output", {}).get("documents", [])[:1]

                api_results = []
                if historical_results:
                    api_results = [
                        self.Resource.Result(
                            sql=result.get("statement"),
                            summary=result.get("summary"),
                            type="view",
                            viewId=result.get("viewId"),
                        )
                        for result in historical_results
                    ]
                    self._update_status(request.id, "generating", api_results)

                # SQL Generation
                if request.history:
                    generation_results = await self._pipelines["followup_sql_generation"].run(
                        query=request.query,
                        contexts=documents,
                        history=request.history,
                        project_id=request.project_id,
                        configurations=request.configurations,
                    )
                else:
                    generation_results = await self._pipelines["sql_generation"].run(
                        query=request.query,
                        contexts=documents,
                        exclude=historical_results,
                        project_id=request.project_id,
                        configurations=request.configurations,
                    )

                # Process valid results
                if sql_valid_results := generation_results["post_process"]["valid_generation_results"]:
                    valid_summaries = await self._add_summary_to_sql_candidates(
                        sql_valid_results,
                        request.query,
                        request.configurations.language,
                    )
                    api_results = (
                        api_results + 
                        [self.Resource.Result(**result) for result in valid_summaries]
                    )[:3]
                    self._update_status(request.id, "generating", api_results)

                # Process failed dry runs
                if failed_dry_runs := self._get_failed_dry_run_results(
                    generation_results["post_process"]["invalid_generation_results"]
                ):
                    correction_results = await self._pipelines["sql_correction"].run(
                        contexts=documents,
                        invalid_generation_results=failed_dry_runs,
                        project_id=request.project_id,
                    )
                    
                    if valid_corrections := correction_results["post_process"]["valid_generation_results"]:
                        valid_summaries = await self._add_summary_to_sql_candidates(
                            valid_corrections,
                            request.query,
                            request.configurations.language,
                        )
                        api_results = (
                            api_results +
                            [self.Resource.Result(**result) for result in valid_summaries]
                        )[:3]

                # Finalize results
                if api_results:
                    self._update_status(request.id, "finished", api_results)
                    results["ask_result"] = api_results
                else:
                    self._handle_exception(
                        request,
                        "No relevant SQL",
                        code="NO_RELEVANT_SQL"
                    )
                    results["metadata"]["error_type"] = "NO_RELEVANT_SQL"

                return results

        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during Ask generation: {str(e)}",
            )
            results["metadata"].update({
                "error_type": "OTHERS",
                "error_message": str(e),
            })
            return results

    def stop(self, id: str):
        self._update_status(id, "stopped")

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Ask Resource with ID '{id}' not found."
            logger.exception(message)
            return self.Resource(
                id=id,
                status="failed",
                error=self.Resource.Error(
                    code="RESOURCE_NOT_FOUND",
                    message=message,
                ),
            )

        return response

    def __setitem__(self, id: str, value: Resource):
        self._cache[id] = value