import logging
from typing import Dict, Literal, Optional

from cachetools import TTLCache
from langfuse.decorators import observe
from pydantic import BaseModel

from src.core.pipeline import BasicPipeline
from src.utils import trace_metadata
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")


# POST /v1/sql-questions
class SqlQuestionRequest(BaseModel):
    _query_id: str | None = None
    sqls: list[str]
    project_id: Optional[str] = None
    configurations: Optional[Configuration] = Configuration()

    @property
    def query_id(self) -> str:
        """
        Get the unique identifier for the SQL question query.
        
        Returns:
            str: The query ID associated with the SQL question request.
        """
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        """
        Set the query ID for the SQL question request.
        
        Parameters:
            query_id (str): A unique identifier for the SQL question request.
        """
        self._query_id = query_id


class SqlQuestionResponse(BaseModel):
    query_id: str


# GET /v1/sql-questions/{query_id}
class SqlQuestionResultRequest(BaseModel):
    query_id: str


class SqlQuestionResultResponse(BaseModel):
    class SqlQuestionError(BaseModel):
        code: Literal["OTHERS"]
        message: str

    status: Literal["generating", "succeeded", "failed"]
    error: Optional[SqlQuestionError] = None
    questions: Optional[list[str]] = None


class SqlQuestionService:
    def __init__(
        self,
        pipelines: Dict[str, BasicPipeline],
        maxsize: int = 1_000_000,
        ttl: int = 120,
    ):
        """
        Initialize the SqlQuestionService with pipelines and caching configuration.
        
        Parameters:
            pipelines (Dict[str, BasicPipeline]): A dictionary of pipelines used for processing SQL questions.
            maxsize (int, optional): Maximum number of entries in the result cache. Defaults to 1,000,000.
            ttl (int, optional): Time-to-live for cache entries in seconds. Defaults to 120 seconds.
        
        Attributes:
            _pipelines (Dict[str, BasicPipeline]): Stores the provided pipelines for SQL question processing.
            _sql_question_results (TTLCache): A time-limited cache to store SQL question results with specified max size and TTL.
        """
        self._pipelines = pipelines
        self._sql_question_results: Dict[str, SqlQuestionResultResponse] = TTLCache(
            maxsize=maxsize, ttl=ttl
        )

    @observe(name="SQL Question")
    @trace_metadata
    async def sql_question(
        self,
        sql_question_request: SqlQuestionRequest,
        **kwargs,
    ):
        """
        Asynchronously process SQL questions and generate results using a predefined pipeline.
        
        This method takes a SQL question request, runs it through a SQL question generation pipeline,
        and caches the results with different status states (generating, succeeded, or failed).
        
        Parameters:
            sql_question_request (SqlQuestionRequest): Request containing SQL statements, project ID, 
                and configuration for question generation.
            **kwargs: Additional keyword arguments for flexible method invocation.
        
        Returns:
            dict: A dictionary containing:
                - 'sql_question_result': Generated SQL questions
                - 'metadata': Error information if processing fails
        
        Raises:
            Exception: Captures and logs any errors during SQL question generation, 
            updating the result cache with a failure status.
        
        Notes:
            - Uses an internal pipeline for SQL question generation
            - Manages result caching with different processing states
            - Provides comprehensive error tracking and logging
        """
        results = {
            "sql_question_result": {},
            "metadata": {
                "error": {
                    "type": "",
                    "message": "",
                }
            },
        }

        try:
            query_id = sql_question_request.query_id

            self._sql_question_results[query_id] = SqlQuestionResultResponse(
                status="generating",
            )

            sql_questions_result = (
                await self._pipelines["sql_question_generation"].run(
                    sqls=sql_question_request.sqls,
                    configuration=sql_question_request.configurations,
                )
            )["post_process"]

            self._sql_question_results[query_id] = SqlQuestionResultResponse(
                status="succeeded",
                questions=sql_questions_result,
            )

            results["sql_question_result"] = sql_questions_result
            return results
        except Exception as e:
            logger.exception(f"sql question pipeline - OTHERS: {e}")

            self._sql_question_results[
                sql_question_request.query_id
            ] = SqlQuestionResultResponse(
                status="failed",
                error=SqlQuestionResultResponse.SqlQuestionError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

            results["metadata"]["error_type"] = "OTHERS"
            results["metadata"]["error_message"] = str(e)
            return results

    def get_sql_question_result(
        self,
        sql_question_result_request: SqlQuestionResultRequest,
    ) -> SqlQuestionResultResponse:
        """
        Retrieves the result of a SQL question from the cache based on the provided query ID.
        
        Parameters:
            sql_question_result_request (SqlQuestionResultRequest): A request containing the query ID to retrieve results for.
        
        Returns:
            SqlQuestionResultResponse: The cached result of the SQL question, or a failure response if the query ID is not found.
        
        Raises:
            No explicit exceptions are raised, but logs an error if the query ID is not in the cache.
        
        Notes:
            - Uses a TTL cache (`self._sql_question_results`) to store and retrieve SQL question results.
            - Returns a failure response with an "OTHERS" error code if the query ID is not found.
        """
        if (
            result := self._sql_question_results.get(
                sql_question_result_request.query_id
            )
        ) is None:
            logger.exception(
                f"sql question pipeline - OTHERS: {sql_question_result_request.query_id} is not found"
            )
            return SqlQuestionResultResponse(
                status="failed",
                error=SqlQuestionResultResponse.SqlQuestionError(
                    code="OTHERS",
                    message=f"{sql_question_result_request.query_id} is not found",
                ),
            )

        return result
