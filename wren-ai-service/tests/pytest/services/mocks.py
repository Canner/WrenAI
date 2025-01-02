from typing import Optional

from src.pipelines import generation, retrieval
from src.web.v1.services import Configuration
from src.web.v1.services.ask import AskHistory


class RetrievalMock(retrieval.Retrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, id: Optional[str] = None):
        return {"construct_retrieval_results": self._documents}


class HistoricalQuestionMock(retrieval.HistoricalQuestionRetrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, id: Optional[str] = None):
        return {"formatted_output": {"documents": self._documents}}


class IntentClassificationMock(generation.IntentClassification):
    def __init__(self, intent: str = "MISLEADING_QUERY"):
        self._intent = intent

    async def run(
        self,
        query: str,
        id: Optional[str] = None,
        history: Optional[AskHistory] = None,
        configuration: Configuration | None = None,
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


class SQLSummaryMock(generation.SQLSummary):
    """
    Example for the results:
     [
         {
             "sql": "select 1",
             "summary": "the description of the sql",
         }
     ]
    """

    def __init__(self, results: list = []):
        self._results = results

    async def run(
        self,
        query: str,
        sqls: list[str],
        language: str,
    ):
        return {"post_process": {"sql_summary_results": self._results}}
