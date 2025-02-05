from datetime import datetime
from typing import Optional

import orjson
import pytz
from pydantic import BaseModel


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
        }


class Configuration(BaseModel):
    class FiscalYear(BaseModel):
        start: str
        end: str

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

    fiscal_year: Optional[FiscalYear] = None
    language: Optional[str] = "English"
    timezone: Optional[Timezone] = Timezone()


class SSEEvent(BaseModel):
    class SSEEventMessage(BaseModel):
        message: str

        def to_dict(self):
            return {"message": self.message}

    data: SSEEventMessage

    def serialize(self):
        return f"data: {orjson.dumps(self.data.to_dict()).decode()}\n\n"


# Put the services imports here to avoid circular imports and make them accessible directly to the rest of packages
from .ask import AskService  # noqa: E402
from .ask_details import AskDetailsService  # noqa: E402
from .chart import ChartService  # noqa: E402
from .chart_adjustment import ChartAdjustmentService  # noqa: E402
from .question_recommendation import QuestionRecommendation  # noqa: E402
from .relationship_recommendation import RelationshipRecommendation  # noqa: E402
from .semantics_description import SemanticsDescription  # noqa: E402
from .semantics_preparation import SemanticsPreparationService  # noqa: E402
from .sql_answer import SqlAnswerService  # noqa: E402
from .sql_expansion import SqlExpansionService  # noqa: E402
from .sql_explanation import SqlExplanationService  # noqa: E402
from .sql_pairs import SqlPairsService  # noqa: E402
from .sql_question import SqlQuestionService  # noqa: E402
from .sql_regeneration import SqlRegenerationService  # noqa: E402

__all__ = [
    "AskService",
    "AskDetailsService",
    "ChartService",
    "ChartAdjustmentService",
    "QuestionRecommendation",
    "RelationshipRecommendation",
    "SemanticsDescription",
    "SemanticsPreparationService",
    "SqlAnswerService",
    "SqlExpansionService",
    "SqlExplanationService",
    "SqlPairsService",
    "SqlQuestionService",
    "SqlRegenerationService",
]
