from typing import Literal, Optional

import orjson
from pydantic import AliasChoices, BaseModel, Field


class MetadataTraceable:
    def with_metadata(self) -> dict:
        return {
            "resource": self,
            "metadata": {
                **self._error_metadata(),
            },
        }

    def _error_metadata(self):
        return {
            "error_type": self.error and self.error.code,
            "error_message": self.error and self.error.message,
            "request_from": self.request_from,
        }


class Configuration(BaseModel):
    class Timezone(BaseModel):
        name: str = "UTC"
        utc_offset: str = ""  # Deprecated, will be removed in the future

    language: str = "English"
    timezone: Timezone = Timezone()


class SSEEvent(BaseModel):
    class SSEEventMessage(BaseModel):
        message: str

        def to_dict(self):
            return {"message": self.message}

    data: SSEEventMessage

    def serialize(self):
        return f"data: {orjson.dumps(self.data.to_dict()).decode()}\n\n"


# for POST, PATCH, UPDATE, DELETE requests
class BaseRequest(BaseModel):
    _query_id: str | None = None
    project_id: Optional[str] = None
    thread_id: Optional[str] = None
    configurations: Configuration = Field(
        default_factory=Configuration,
        alias=AliasChoices("configurations", "configuration"),  # accept both keys
    )
    request_from: Literal["ui", "api", "slack"] = "ui"

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


# Put the services imports here to avoid circular imports and make them accessible directly to the rest of packages
from .ask import AskService  # noqa: E402
from .chart import ChartService  # noqa: E402
from .chart_adjustment import ChartAdjustmentService  # noqa: E402
from .instructions import InstructionsService  # noqa: E402
from .question_recommendation import QuestionRecommendation  # noqa: E402
from .relationship_recommendation import RelationshipRecommendation  # noqa: E402
from .semantics_description import SemanticsDescription  # noqa: E402
from .semantics_preparation import SemanticsPreparationService  # noqa: E402
from .sql_answer import SqlAnswerService  # noqa: E402
from .sql_corrections import SqlCorrectionService  # noqa: E402
from .sql_pairs import SqlPairsService  # noqa: E402
from .sql_question import SqlQuestionService  # noqa: E402

__all__ = [
    "AskService",
    "ChartService",
    "ChartAdjustmentService",
    "QuestionRecommendation",
    "RelationshipRecommendation",
    "SemanticsDescription",
    "SemanticsPreparationService",
    "SqlAnswerService",
    "SqlCorrectionService",
    "SqlPairsService",
    "SqlQuestionService",
    "InstructionsService",
]
