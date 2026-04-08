"""Query explainability and audit trail (Wave 4 P1, category: functional).

Minimal vertical slice for the wren-ai-service "show which model, schema
object, and validation step produced every answer" backlog item.

Provides an in-memory append-only audit log keyed by query id, with
serialisation helpers so other components can persist or stream entries.

Feature-flagged: callers must set WREN_AUDIT_TRAIL=1 (or call
`AuditTrail.enable()` programmatically) for `record()` to do anything.
Disabled by default to keep the existing query path untouched.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

FEATURE_FLAG_ENV = "WREN_AUDIT_TRAIL"
SCHEMA_VERSION = "1.0.0"


@dataclass
class AuditEntry:
    query_id: str
    prompt: str
    model: str
    schema_objects: list[str] = field(default_factory=list)
    validation_steps: list[str] = field(default_factory=list)
    final_sql: str | None = None
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AuditTrail:
    """Thread-safe append-only audit trail."""

    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []
        self._lock = threading.Lock()
        self._enabled = os.environ.get(FEATURE_FLAG_ENV, "").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    @property
    def enabled(self) -> bool:
        return self._enabled

    def enable(self) -> None:
        self._enabled = True

    def disable(self) -> None:
        self._enabled = False

    def record(self, entry: AuditEntry) -> bool:
        if not self._enabled:
            return False
        with self._lock:
            self._entries.append(entry)
        return True

    def get(self, query_id: str) -> AuditEntry | None:
        with self._lock:
            for e in self._entries:
                if e.query_id == query_id:
                    return e
        return None

    def all(self) -> list[AuditEntry]:
        with self._lock:
            return list(self._entries)

    def to_json(self) -> str:
        return json.dumps(
            {
                "schema_version": SCHEMA_VERSION,
                "entries": [e.to_dict() for e in self.all()],
            },
            indent=2,
        )


_default = AuditTrail()


def default_trail() -> AuditTrail:
    return _default
