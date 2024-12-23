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

        return f'{current_time.strftime("%Y-%m-%d %A %H:%M:%S")}'  # YYYY-MM-DD weekday_name HH:MM:SS, ex: 2024-10-23 Wednesday 12:00:00

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
