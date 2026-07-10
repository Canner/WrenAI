from datetime import datetime
from enum import Enum
from typing import Any

DIALECT_SQL = "dialectSql"
PLANNED_SQL = "plannedSql"


class ErrorCode(int, Enum):
    GENERIC_USER_ERROR = 1
    NOT_FOUND = 2
    MDL_NOT_FOUND = 3
    INVALID_SQL = 4
    INVALID_MDL = 5
    DUCKDB_FILE_NOT_FOUND = 6
    ATTACH_DUCKDB_ERROR = 7
    VALIDATION_RULE_NOT_FOUND = 8
    VALIDATION_ERROR = 9
    VALIDATION_PARAMETER_ERROR = 10
    GET_CONNECTION_ERROR = 11
    INVALID_CONNECTION_INFO = 12
    MODEL_NOT_FOUND = 13
    BLOCKED_FUNCTION = 14
    GENERIC_INTERNAL_ERROR = 100
    LEGACY_ENGINE_ERROR = 101
    NOT_IMPLEMENTED = 102
    IBIS_PROJECT_ERROR = 103
    SQLGLOT_ERROR = 104
    GENERIC_EXTERNAL_ERROR = 200
    DATABASE_TIMEOUT = 201


class ErrorPhase(int, Enum):
    REQUEST_RECEIVED = 1
    MDL_EXTRACTION = 2
    SQL_PARSING = 3
    SQL_PLANNING = 4
    SQL_TRANSPILE = 5
    SQL_EXECUTION = 6
    SQL_DRY_RUN = 7
    RESPONSE_GENERATION = 8
    METADATA_FETCHING = 9
    VALIDATION = 10
    SQL_SUBSTITUTE = 11
    SQL_POLICY_CHECK = 12


class WrenError(Exception):
    error_code: ErrorCode
    message: str
    phase: ErrorPhase | None = None
    metadata: dict[str, Any] | None = None
    timestamp: str | None = None

    def __init__(
        self,
        error_code: ErrorCode,
        message: str,
        phase: ErrorPhase | None = None,
        metadata: dict[str, Any] | None = None,
        cause: Exception | None = None,
    ):
        self.error_code = error_code
        self.message = message
        self.phase = phase
        self.metadata = metadata
        self.timestamp = datetime.now().isoformat()
        super().__init__(message)
        if cause is not None:
            self.__cause__ = cause

    def __str__(self) -> str:
        parts = [f"[{self.error_code.name}] {self.message}"]
        if self.phase:
            parts.append(f"phase={self.phase.name}")
        return " ".join(parts)


class DatabaseTimeoutError(WrenError):
    def __init__(self, message: str):
        enhanced_message = (
            f"{message!s}.\n"
            "It seems your database is not responding or the query is taking too long. "
            "Please check your database status and query performance."
        )
        super().__init__(
            error_code=ErrorCode.DATABASE_TIMEOUT,
            message=enhanced_message,
        )
