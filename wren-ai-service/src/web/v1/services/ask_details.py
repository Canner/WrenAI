import logging
from typing import Dict, List, Literal, Optional

from cachetools import TTLCache
from haystack import Pipeline
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.engine import add_quotes
from src.utils import async_timer, trace_metadata

logger = logging.getLogger("wren-ai-service")


class SQLBreakdown(BaseModel):
    sql: str
    summary: str
    cte_name: str


class AskDetails:
    class Input(BaseModel):
        class Configurations(BaseModel):
            language: str = "English"

        id: str
        query: str
        sql: str
        summary: str
        mdl_hash: Optional[str] = None
        thread_id: Optional[str] = None
        project_id: Optional[str] = None
        user_id: Optional[str] = None
        configurations: Configurations = Configurations(language="English")

    class Resource(BaseModel):
        class Error(BaseModel):
            code: Literal["NO_RELEVANT_SQL", "OTHERS", "RESOURCE_NOT_FOUND"]
            message: str

        class Details(BaseModel):
            description: str
            steps: List[SQLBreakdown]

        id: str
        status: Literal["understanding", "searching", "generating", "finished", "failed"]
        response: Optional[Details] = None
        error: Optional[Error] = None

    def __init__(
        self,
        pipelines: Dict[str, Pipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        self._pipelines = pipelines
        self._cache: Dict[str, AskDetails.Resource] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

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

    @async_timer
    @observe(name="Ask Details (Breakdown SQL)")
    @trace_metadata
    async def generate(self, request: Input, **kwargs) -> Dict:
        logger.info("Ask Details pipeline is running...")

        try:
            # Update status through the pipeline stages
            for status in ["understanding", "searching", "generating"]:
                self._cache[request.id] = self.Resource(
                    id=request.id,
                    status=status,
                )

            generation_result = await self._pipelines["sql_breakdown"].run(
                query=request.query,
                sql=request.sql,
                project_id=request.project_id,
                language=request.configurations.language,
            )

            ask_details_result = generation_result["post_process"]["results"]

            if not ask_details_result["steps"]:
                quoted_sql, no_error = add_quotes(request.sql)
                ask_details_result["steps"] = [
                    {
                        "sql": quoted_sql if no_error else request.sql,
                        "summary": request.summary,
                        "cte_name": "",
                    }
                ]

            self._cache[request.id] = self.Resource(
                id=request.id,
                status="finished",
                response=self.Resource.Details(**ask_details_result),
            )

            return {
                "ask_details_result": ask_details_result,
                "metadata": {
                    "error_type": "SQL_BREAKDOWN_FAILED" if not ask_details_result["steps"] else "",
                    "error_message": "",
                },
            }

        except Exception as e:
            self._handle_exception(
                request,
                f"An error occurred during Ask Details generation: {str(e)}",
            )
            
            return {
                "ask_details_result": {},
                "metadata": {
                    "error_type": "OTHERS",
                    "error_message": str(e),
                },
            }

    def __getitem__(self, id: str) -> Resource:
        response = self._cache.get(id)

        if response is None:
            message = f"Ask Details Resource with ID '{id}' not found."
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