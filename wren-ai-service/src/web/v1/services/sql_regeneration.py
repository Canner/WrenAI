from typing import List, Literal, Optional

from haystack import Pipeline
from pydantic import BaseModel


# POST /v1/sql-regeneration
class DecisionPoint(BaseModel):
    type: Literal["filters"]
    value: str


class CorrectionPoint(BaseModel):
    type: Literal["sql_highlight", "ui_highlight"]
    value: str | DecisionPoint


class Correction(BaseModel):
    before: DecisionPoint
    after: CorrectionPoint


class SQLRegenerationRequest(BaseModel):
    _query_id: str | None = None
    corrections: List[Correction]

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


class SQLRegenerationResponse(BaseModel):
    query_id: str


# GET /v1/sql-regeneration/{query_id}/result
class SQLRegenerationResultRequest(BaseModel):
    query_id: str


class SQLExplanation(BaseModel):
    sql: str
    summary: str
    cte_name: str


class SQLRegenerationResultResponse(BaseModel):
    class SQLRegenerationResponseDetails(BaseModel):
        description: str
        steps: List[SQLExplanation]

    class SQLRegenerationError(BaseModel):
        code: Literal["NO_RELEVANT_SQL", "OTHERS"]
        message: str

    status: Literal["understanding", "generating", "finished", "failed"]
    response: Optional[SQLRegenerationResponseDetails] = None
    error: Optional[SQLRegenerationError] = None


class SQLRegenerationService:
    def __init__(self, pipelines: dict[str, Pipeline]):
        self._pipelines = pipelines
        self.sql_regeneration_results: dict[str, SQLRegenerationResultResponse] = {}

    def sql_regeneration() -> SQLRegenerationResponse:
        pass

    def get_sql_regeneration_result() -> SQLRegenerationResultResponse:
        pass
