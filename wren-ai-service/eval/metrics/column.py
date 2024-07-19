import asyncio

import orjson
import pandas as pd
import sqlglot
from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase
from sqlglot.diff import Keep, Move

from eval.utils import get_data_from_wren_engine


class AccuracyMetric(BaseMetric):
    def __init__(self, engine_config: dict):
        self.threshold = 10
        self.score = 0
        self._engine_config = {
            "data_source": engine_config["source"],
            "mdl_json": engine_config["manifest"],
            "connection_info": engine_config["connection_info"],
            "api_endpoint": engine_config["api_endpoint"],
            "timeout": 10,
            "limit": 10,
        }

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    def is_subset(self, expected: pd.DataFrame, actual: pd.DataFrame) -> bool:
        is_column_subset = set(actual.columns).issubset(set(expected.columns))

        if not is_column_subset:
            return False

        common_columns = actual.columns
        expected_sorted = expected[sorted(common_columns)]
        actual_sorted = actual[sorted(common_columns)]

        merged = pd.merge(
            actual_sorted,
            expected_sorted,
            on=list(common_columns),
            how="left",
            indicator=True,
        )
        return all(merged["_merge"] == "both")

    async def _retrieve_data(self, sql: str) -> pd.DataFrame:
        response = await get_data_from_wren_engine(sql=sql, **self._engine_config)
        df = pd.DataFrame(**response)
        return df[sorted(df.columns)]

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        expected = test_case.expected_output
        expected_dataset = await self._retrieve_data(expected)

        actual_output = orjson.loads(test_case.actual_output)
        for actual in actual_output["valid_generation_results"]:
            if self._semantic_check(expected, actual["sql"]):
                self.success = True
                self.score = 1
                return self.score

            actual_dataset = await self._retrieve_data(actual["sql"])
            if expected_dataset.equals(actual_dataset) or self.is_subset(
                expected_dataset, actual_dataset
            ):
                self.success = True
                self.score = 1
                return self.score

        # if didn't pass any of the above checks
        self.success = False
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Accuracy(column-based)"

    def _semantic_check(self, expected: str, actual: str) -> bool:
        for result in sqlglot.diff(
            sqlglot.parse_one(expected, read=sqlglot.Dialects.TRINO),
            sqlglot.parse_one(actual, read=sqlglot.Dialects.TRINO),
        ):
            if type(result) not in [Keep, Move]:
                return False
        return True
