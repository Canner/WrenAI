import json
from typing import List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

from src.utils import clean_generation_result


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

    status: Literal["understanding", "searching", "generating", "finished"]
    response: Optional[AskDetailsResponseDetails] = None


class AskDetailsService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.ask_details_results: dict[str, AskDetailsResultResponse] = {}

    def ask_details(
        self,
        ask_details_request: AskDetailsRequest,
    ) -> AskDetailsResponse:
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

        cleaned_generation_result = json.loads(
            clean_generation_result(generation_result["generator"]["replies"][0])
        )

        self.ask_details_results[query_id] = AskDetailsResultResponse(
            status="finished",
            response=AskDetailsResultResponse.AskDetailsResponseDetails(
                **cleaned_generation_result
            ),
        )

    def get_ask_details_result(
        self,
        ask_details_result_request: AskDetailsResultRequest,
    ) -> AskDetailsResultResponse:
        return self.ask_details_results[ask_details_result_request.query_id]
