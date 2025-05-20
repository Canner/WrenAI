from typing import Optional

from src.pipelines import generation, retrieval
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory


class RetrievalMock(retrieval.DbSchemaRetrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, project_id: Optional[str] = None):
        return {"construct_retrieval_results": self._documents}


class SqlPairsRetrievalMock(retrieval.SqlPairsRetrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, project_id: Optional[str] = None):
        return {"formatted_output": {"documents": self._documents}}


class InstructionsRetrievalMock(retrieval.Instructions):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, project_id: Optional[str] = None):
        return {"formatted_output": {"documents": self._documents}}


class HistoricalQuestionMock(retrieval.HistoricalQuestionRetrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, project_id: Optional[str] = None):
        return {"formatted_output": {"documents": self._documents}}


class IntentClassificationMock(generation.IntentClassification):
    def __init__(self, intent: str = "TEXT_TO_SQL"):
        self._intent = intent

    async def run(
        self,
        query: str,
        project_id: Optional[str] = None,
        histories: Optional[list[AskHistory]] = None,
        configuration: Configuration | None = None,
        sql_samples: Optional[list[dict]] = None,
        instructions: Optional[list[dict]] = None,
    ):
        return {"post_process": {"intent": self._intent, "db_schemas": []}}


class GenerationMock(generation.SQLGeneration):
    def __init__(self, valid: list = [], invalid: list = []):
        self._valid = valid
        self._invalid = invalid

    async def run(
        self,
        query: str,
        contexts: list[str],
        exclude: list[dict],
        project_id: str | None = None,
        configuration: Configuration | None = None,
    ):
        return {
            "post_process": {
                "valid_generation_results": self._valid,
                "invalid_generation_results": self._invalid,
            }
        }
