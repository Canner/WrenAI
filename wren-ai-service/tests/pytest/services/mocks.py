from typing import Optional

from src.pipelines.generation import sql_generation, sql_summary
from src.pipelines.retrieval import historical_question, retrieval
from src.web.v1.services.ask import AskConfigurations


class RetrievalMock(retrieval.Retrieval):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, id: Optional[str] = None):
        return {"construct_retrieval_results": self._documents}


class HistoricalQuestionMock(historical_question.HistoricalQuestion):
    def __init__(self, documents: list = []):
        self._documents = documents

    async def run(self, query: str, id: Optional[str] = None):
        return {"formatted_output": {"documents": self._documents}}


class GenerationMock(sql_generation.SQLGeneration):
    def __init__(self, valid: list = [], invalid: list = []):
        self._valid = valid
        self._invalid = invalid

    async def run(
        self,
        query: str,
        contexts: list[str],
        exclude: list[dict],
        project_id: str | None = None,
        configurations: AskConfigurations | None = None,
    ):
        return {
            "post_process": {
                "valid_generation_results": self._valid,
                "invalid_generation_results": self._invalid,
            }
        }


class SQLSummaryMock(sql_summary.SQLSummary):
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
    ):
        return {"post_process": {"sql_summary_results": self._results}}
