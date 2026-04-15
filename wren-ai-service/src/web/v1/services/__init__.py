from datetime import datetime
from typing import Any, Literal, Optional

import orjson
import pytz
from pydantic import AliasChoices, BaseModel, Field, model_validator

from src.core import RuntimeIdentity
from src.core.runtime_identity import normalize_scope_id, warn_on_legacy_bridge_aliases
from src.web.v1.services.runtime_models import (
    resolve_request_bridge_scope_id,
    resolve_request_runtime_scope_id,
)


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

    def show_current_time(self):
        # Get the current time in the specified timezone
        tz = pytz.timezone(
            self.timezone.name
        )  # Assuming timezone.name contains the timezone string
        current_time = datetime.now(tz)

        return f"{current_time.strftime('%Y-%m-%d %A %H:%M:%S')}"  # YYYY-MM-DD weekday_name HH:MM:SS, ex: 2024-10-23 Wednesday 12:00:00

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
    @model_validator(mode="before")
    @classmethod
    def warn_on_deprecated_bridge_aliases(cls, data: Any):
        return warn_on_legacy_bridge_aliases(data)

    _query_id: str | None = None
    runtime_scope_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("runtime_scope_id", "runtimeScopeId"),
    )
    # compatibility boundary only; new callers should send runtime_scope_id or
    # canonical runtime_identity fields instead of relying on bridge fallbacks.
    # Wave 1 removed the older project-bridge request aliases.
    project_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "project_id",
            "projectId",
            "bridge_scope_id",
            "bridgeScopeId",
        ),
    )
    retrieval_scope_ids: Optional[list[str] | str] = Field(
        default=None,
        validation_alias=AliasChoices(
            "retrieval_scope_ids",
            "retrievalScopeIds",
        ),
    )
    thread_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("thread_id", "threadId"),
    )
    runtime_identity: Optional[RuntimeIdentity] = Field(
        default=None,
        validation_alias=AliasChoices("runtime_identity", "runtimeIdentity"),
    )
    configurations: Configuration = Field(
        default_factory=Configuration,
        alias=AliasChoices("configurations", "configuration"),  # accept both keys
    )
    request_from: Literal["ui", "api"] = "ui"

    @property
    def bridge_scope_id(self) -> Optional[str]:
        return self.project_id

    def resolve_runtime_scope_id(
        self, fallback_id: str | int | None = None
    ) -> Optional[str]:
        return resolve_request_runtime_scope_id(
            runtime_scope_id=self.runtime_scope_id,
            bridge_scope_id=self.bridge_scope_id,
            runtime_identity=self.runtime_identity,
            mdl_hash=fallback_id,
        )

    def resolve_retrieval_scope_ids(
        self, fallback_id: str | int | None = None
    ) -> list[str]:
        resolved_scope_ids: list[str] = []

        primary_scope_id = self.resolve_runtime_scope_id(fallback_id=fallback_id)
        if primary_scope_id:
            resolved_scope_ids.append(primary_scope_id)

        raw_scope_ids = self.retrieval_scope_ids
        candidate_scope_ids = (
            raw_scope_ids.split(",")
            if isinstance(raw_scope_ids, str)
            else raw_scope_ids or []
        )
        for candidate_scope_id in candidate_scope_ids:
            normalized_scope_id = normalize_scope_id(candidate_scope_id)
            if (
                normalized_scope_id
                and normalized_scope_id not in resolved_scope_ids
            ):
                resolved_scope_ids.append(normalized_scope_id)

        return resolved_scope_ids

    def resolve_bridge_scope_id(
        self, fallback_id: str | int | None = None
    ) -> Optional[str]:
        return resolve_request_bridge_scope_id(
            runtime_scope_id=self.runtime_scope_id,
            bridge_scope_id=self.bridge_scope_id,
            runtime_identity=self.runtime_identity,
            mdl_hash=fallback_id,
        )

    @property
    def query_id(self) -> str:
        return self._query_id

    @query_id.setter
    def query_id(self, query_id: str):
        self._query_id = query_id


# Put the services imports here to avoid circular imports and make them accessible directly to the rest of packages
from .ask import AskService  # noqa: E402
from .ask_feedback import AskFeedbackService  # noqa: E402
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
    "AskFeedbackService",
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
