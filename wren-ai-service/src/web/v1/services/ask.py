import json
from typing import List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel

from src.utils import clean_generation_result


# POST /v1/semantics-preparations
class SemanticsPreparationRequest(BaseModel):
    mdl: str
    id: str


class SemanticsPreparationResponse(BaseModel):
    id: str


# GET /v1/semantics-preparations/{task_id}/status
class SemanticsPreparationStatusRequest(BaseModel):
    id: str


class SemanticsPreparationStatusResponse(BaseModel):
    status: Literal["indexing", "finished", "failed"]


class SQLExplanation(BaseModel):
    sql: str
    summary: str
    cte_name: str


# POST /v1/asks
class AskRequest(BaseModel):
    class AskResponseDetails(BaseModel):
        sql: str
        summary: str
        steps: List[SQLExplanation]

    _query_id: str | None = None
    query: str
    id: str  # for identifying which collection to access from vectordb, the same hash string for identifying which mdl model deployment from backend
    history: Optional[AskResponseDetails] = None

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
class AskResultRequest(BaseModel):
    query_id: str


class AskResultResponse(BaseModel):
    class AskResult(BaseModel):
        sql: str
        summary: str

    status: Literal[
        "understanding", "searching", "generating", "finished", "failed", "stopped"
    ]
    response: Optional[List[AskResult]] = None
    error: Optional[str] = None


class AskService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.prepare_semantics_statuses: dict[
            str, SemanticsPreparationStatusResponse.status
        ] = {}
        self.ask_results: dict[str, AskResultResponse] = {}

    def prepare_semantics(self, prepare_semantics_request: SemanticsPreparationRequest):
        self.prepare_semantics_statuses[
            prepare_semantics_request.id
        ] = SemanticsPreparationStatusResponse(status="indexing")

        try:
            self._pipelines["indexing"].run(prepare_semantics_request.mdl)

            self.prepare_semantics_statuses[
                prepare_semantics_request.id
            ] = SemanticsPreparationStatusResponse(status="finished")
        except Exception as e:
            # TODO: log the error
            print(f"Failed to prepare semantics: {e}")
            self.prepare_semantics_statuses[
                prepare_semantics_request.id
            ] = SemanticsPreparationStatusResponse(status="failed")

    def get_prepare_semantics_status(
        self, prepare_semantics_status_request: SemanticsPreparationStatusRequest
    ) -> SemanticsPreparationStatusResponse:
        return self.prepare_semantics_statuses[prepare_semantics_status_request.id]

    def ask(
        self,
        ask_request: AskRequest,
    ):
        # ask status can be understanding, searching, generating, finished, failed, stopped
        # we will need to handle business logic for each status
        query_id = ask_request.query_id

        self.ask_results[query_id] = AskResultResponse(status="understanding")
        self.ask_results[query_id] = AskResultResponse(status="searching")

        retrieval_result = self._pipelines["retrieval"].run(
            query=ask_request.query,
        )

        self.ask_results[query_id] = AskResultResponse(status="generating")

        generation_result = self._pipelines["generation"].run(
            query=ask_request.query,
            contexts=retrieval_result["retriever"]["documents"],
            history=ask_request.history,
        )

        cleaned_generation_results = [
            json.loads(clean_generation_result(reply))
            for reply in generation_result["generator"]["replies"]
        ]

        if not cleaned_generation_results[0]["sql"]:
            self.ask_results[query_id] = AskResultResponse(
                status="failed", error="Failed to generate SQL"
            )
        else:
            self.ask_results[query_id] = AskResultResponse(
                status="finished",
                response=[
                    AskResultResponse.AskResult(**result)
                    for result in cleaned_generation_results
                ],
            )

    def stop_ask(
        self,
        stop_ask_request: StopAskRequest,
    ):
        self.ask_results[stop_ask_request.query_id] = AskResultResponse(
            status="stopped",
        )

    def get_ask_result(
        self,
        ask_result_request: AskResultRequest,
    ) -> AskResultResponse:
        return self.ask_results[ask_result_request.query_id]
