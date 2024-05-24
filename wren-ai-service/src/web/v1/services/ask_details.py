import logging
from typing import List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

logger = logging.getLogger("wren-ai-service")


class SQLExplanation(BaseModel):
    sql: str
    summary: str
    cte_name: str


# POST /v1/ask-details
class AskDetailsRequest(BaseModel):
    _query_id: str | None = None
    query: str
    sql: str
    summary: str

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class AskDetailsResponse(BaseModel):
    query_id: str


# GET /v1/ask-details/{query_id}/result
class AskDetailsResultRequest(BaseModel):
    query_id: str


class AskDetailsResultResponse(BaseModel):
    class AskDetailsResponseDetails(BaseModel):
        description: str
        steps: List[SQLExplanation]

    class AskDetailsError(BaseModel):
        code: Literal["NO_RELEVANT_SQL", "OTHERS"]
        message: str

    status: Literal["understanding", "searching", "generating", "finished", "failed"]
    response: Optional[AskDetailsResponseDetails] = None
    error: Optional[AskDetailsError] = None


class AskDetailsService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.ask_details_results: dict[str, AskDetailsResultResponse] = {}

    def ask_details(
        self,
        ask_details_request: AskDetailsRequest,
    ):
        try:
            # ask details status can be understanding, searching, generating, finished, stopped
            # we will need to handle business logic for each status
            query_id = ask_details_request.query_id

            self.ask_details_results[query_id] = AskDetailsResultResponse(
                status="understanding"
            )

            self.ask_details_results[query_id] = AskDetailsResultResponse(
                status="searching"
            )

            self.ask_details_results[query_id] = AskDetailsResultResponse(
                status="generating"
            )

            generation_result = self._pipelines["generation"].run(
                sql=ask_details_request.sql,
            )

            ask_details_result = generation_result["post_processor"]["results"]

            if not ask_details_result["steps"]:
                ask_details_result["steps"] = [
                    {
                        "sql": ask_details_request.sql,
                        "summary": ask_details_request.summary,
                        "cte_name": "",
                    }
                ]

                self.ask_details_results[query_id] = AskDetailsResultResponse(
                    status="finished",
                    response=AskDetailsResultResponse.AskDetailsResponseDetails(
                        **ask_details_result
                    ),
                )
            else:
                self.ask_details_results[query_id] = AskDetailsResultResponse(
                    status="finished",
                    response=AskDetailsResultResponse.AskDetailsResponseDetails(
                        **ask_details_result
                    ),
                )
        except Exception as e:
            logger.error(f"ask-details pipeline - OTHERS: {e}")
            self.ask_details_results[
                ask_details_request.query_id
            ] = AskDetailsResultResponse(
                status="failed",
                error=AskDetailsResultResponse.AskDetailsError(
                    code="OTHERS",
                    message=str(e),
                ),
            )

    def get_ask_details_result(
        self,
        ask_details_result_request: AskDetailsResultRequest,
    ) -> AskDetailsResultResponse:
        if ask_details_result_request.query_id not in self.ask_details_results:
            logger.error(
                f"ask-details pipeline - OTHERS: {ask_details_result_request.query_id} is not found"
            )
            return AskDetailsResultResponse(
                status="failed",
                error=AskDetailsResultResponse.AskDetailsError(
                    code="OTHERS",
                    message=f"{ask_details_result_request.query_id} is not found",
                ),
            )

        return self.ask_details_results[ask_details_result_request.query_id]
