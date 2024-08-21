import asyncio
import traceback

import pandas as pd
from deepeval.evaluate import TestResult
from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.utils import get_contexts_from_sql, get_data_from_wren_engine


class AccuracyMetric(BaseMetric):
    def __init__(self, engine_config: dict):
        self.threshold = 0
        self.score = 0
        self._engine_config = engine_config

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    def is_subset(self, expected: pd.DataFrame, actual: pd.DataFrame) -> bool:
        if not set(expected.columns).issubset(set(actual.columns)):
            return False

        common_columns = sorted(expected.columns)

        expected_sorted = expected[common_columns]
        actual_sorted = actual[common_columns]
        # Ensure that the data types are the same
        actual_sorted = actual_sorted.astype(expected_sorted.dtypes.to_dict())

        merged = pd.merge(
            actual_sorted,
            expected_sorted,
            on=common_columns,
            how="left",
            indicator=True,
        )
        return all(merged["_merge"] == "both")

    def count_partial_matches(
        self, expected: pd.DataFrame, actual: pd.DataFrame
    ) -> int:
        intersection = set(expected.columns).intersection(set(actual.columns))
        common_columns = sorted(intersection)
        if not common_columns:
            return 0

        expected_sorted = expected[common_columns]
        actual_sorted = actual[common_columns]
        # Ensure that the data types are the same
        actual_sorted = actual_sorted.astype(expected_sorted.dtypes.to_dict())

        merged = pd.merge(
            actual_sorted,
            expected_sorted,
            on=common_columns,
            how="left",
            indicator=True,
        )
        if all(merged["_merge"] == "both"):
            return len(intersection) / len(expected.columns)
        else:
            return 0

    async def _retrieve_data(self, sql: str) -> pd.DataFrame:
        response = await get_data_from_wren_engine(sql=sql, **self._engine_config)
        df = pd.DataFrame(**response)
        sorted_columns = sorted(df.columns)
        return df[sorted_columns].sort_values(by=sorted_columns)

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        try:
            expected_dataset = await self._retrieve_data(test_case.expected_output)
            actual_dataset = await self._retrieve_data(test_case.actual_output)

            print(f"expected columns: {set(expected_dataset.columns)}")
            print(f"actual columns: {set(actual_dataset.columns)}")

            if expected_dataset.equals(actual_dataset) or self.is_subset(
                expected_dataset, actual_dataset
            ):
                self.success = True
                self.score = 1
                return self.score

            self.score = self.count_partial_matches(expected_dataset, actual_dataset)
        except Exception as e:
            self.error = f"Error occurred while evaluating the metric: {e}"
            traceback.print_exc()

        # if didn't pass any of the above checks
        self.success = False
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Accuracy(column-based)"


class AccuracyMultiCandidateMetric(BaseMetric):
    def __init__(self):
        self.threshold = 0
        self.score = 0
        self._questions = {}

    def collect(self, test_case: LLMTestCase, result: TestResult):
        for metric in result.metrics_data:
            if metric.name != "Accuracy(column-based)":
                continue

            # or 0 to avoid when metric.error is exist
            self._questions[test_case.input] = (
                self._questions.get(test_case.input, 0) or metric.score or 0
            )

    def measure(self):
        if not self._questions:
            return 0
        self.score = sum(self._questions.values()) / len(self._questions)
        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Accuracy(question-based)"


class AnswerRelevancyMetric(BaseMetric):
    def __init__(self, engine_config: dict):
        self.threshold = 0
        self.score = 0
        self._engine_config = engine_config

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        actual_units = await get_contexts_from_sql(
            sql=test_case.actual_output, **self._engine_config
        )

        expected_units = await get_contexts_from_sql(
            sql=test_case.expected_output, **self._engine_config
        )

        intersection = set(actual_units) & set(expected_units)
        self.score = len(intersection) / len(actual_units)

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "AnswerRelevancy(column-based)"


class FaithfulnessMetric(BaseMetric):
    def __init__(self, engine_config: dict):
        self.threshold = 0
        self.score = 0
        self._engine_config = engine_config

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        actual_units = await get_contexts_from_sql(
            sql=test_case.actual_output, **self._engine_config
        )
        intersection = set(actual_units) & set(test_case.retrieval_context)
        self.score = len(intersection) / len(actual_units)

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "Faithfulness(column-based)"


class ContextualRelevancyMetric(BaseMetric):
    def __init__(self):
        self.threshold = 0
        self.score = 0

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        intersection = set(test_case.retrieval_context) & set(test_case.context)
        self.score = len(intersection) / len(test_case.retrieval_context)

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ContextualRelevancy(column-based)"


class ContextualRecallMetric(BaseMetric):
    def __init__(self, engine_config: dict):
        self.threshold = 0
        self.score = 0
        self._engine_config = engine_config

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        expected_units = await get_contexts_from_sql(
            sql=test_case.expected_output, **self._engine_config
        )

        intersection = set(test_case.retrieval_context) & set(expected_units)
        self.score = len(intersection) / len(expected_units)

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ContextualRecall(column-based)"


class ContextualPrecisionMetric(BaseMetric):
    def __init__(self):
        self.threshold = 0
        self.score = 0

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        context = test_case.context
        retrieval_context = test_case.retrieval_context

        intersection = set(context) & set(retrieval_context)
        intersection_count = len(intersection)

        if intersection_count == 0:
            self.success = False
            return self.score

        n = len(retrieval_context)
        summation = 0
        for k in range(1, n + 1):
            intersection_up_to_k = len(set(context[:k]) & set(retrieval_context[:k]))
            rk = len(set(context[:k]) & set(retrieval_context[k - 1 : k])) > 0
            summation += (intersection_up_to_k / k) * rk

        self.score = (1 / intersection_count) * summation

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ContextualPrecision(column-based)"
