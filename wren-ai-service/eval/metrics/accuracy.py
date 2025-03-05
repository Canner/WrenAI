import asyncio
import re
import traceback

import orjson
import pandas as pd
from deepeval.evaluate import TestResult
from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.utils import get_data_from_wren_engine, get_openai_client


class AccuracyMetric(BaseMetric):
    def __init__(self, engine_info: dict, enable_semantics_comparison: bool = False):
        self.threshold = 0
        self.score = 0
        self.engine_info = engine_info
        self.enable_semantics_comparison = enable_semantics_comparison
        if self.enable_semantics_comparison:
            self._openai_client = get_openai_client()

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    def _is_subset(self, expected: pd.DataFrame, actual: pd.DataFrame) -> bool:
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

    def _count_partial_matches(
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

    def _rewrite_sql(self, sql: str) -> str:
        # Pattern to match double quotes after WHERE clause, including multiple occurrences
        pattern = r'(WHERE\s+.*?)(")(.+?)(")(.*)$'
        replacement = r"\1'\3'\5"

        # Apply the replacement repeatedly until no more changes
        new_sql = re.sub(pattern, replacement, sql, flags=re.IGNORECASE | re.DOTALL)
        while new_sql != sql:
            sql = new_sql
            new_sql = re.sub(pattern, replacement, sql, flags=re.IGNORECASE | re.DOTALL)

        return sql

    async def _retrieve_data(self, sql: str) -> pd.DataFrame:
        response = await get_data_from_wren_engine(sql=sql, **self.engine_info)

        df = pd.DataFrame(**response)
        sorted_columns = sorted(df.columns)
        return df[sorted_columns].sort_values(by=sorted_columns)

    async def _check_sql_semantics(self, expected_sql: str, actual_sql: str):
        _system_prompt = (
            "### TASK ### \n"
            + "You are a great data anlyst, please carefully check the semantics of two given SQLs if they are the same. \n"
            + "The output should be a JSON format with the following schema: \n"
            + "{ \n"
            + '   "reasoning": <REASONING_STRING> \n'
            + '   "same": <BOOL> \n'
            + "}"
        )

        _user_prompt = (
            "### QUESTION ### \n"
            + f"Expected SQL: {expected_sql} \n"
            + f"Actual SQL: {actual_sql} \n"
            + "\n"
            + "Please think step by step"
        )

        response = await self._openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _system_prompt},
                {"role": "user", "content": _user_prompt},
            ],
            response_format={"type": "json_object"},
        )

        print(
            f"response of _check_sql_semantics: {response.choices[0].message.content}"
        )

        return 1 if orjson.loads(response.choices[0].message.content)["same"] else 0

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        try:
            enable_rewrite = test_case.additional_metadata.get("enable_rewrite", False)
            rewritten_expected_output = test_case.expected_output

            if enable_rewrite:
                rewritten_expected_output = self._rewrite_sql(test_case.expected_output)

            expected_dataset = await self._retrieve_data(rewritten_expected_output)
            actual_dataset = await self._retrieve_data(test_case.actual_output)

            print(f"expected columns: {set(expected_dataset.columns)}")
            print(f"actual columns: {set(actual_dataset.columns)}")

            if expected_dataset.equals(actual_dataset) or self._is_subset(
                expected_dataset, actual_dataset
            ):
                self.success = True
                self.score = 1
                return self.score

            self.score = self._count_partial_matches(expected_dataset, actual_dataset)
            # use llm to check sql semantics
            if self.score == 0 and self.enable_semantics_comparison:
                # TODO: we may need to upload the sql semantics result to langfuse
                print(f"before _check_sql_semantics: {self.score}")
                print(f"expected sql: {rewritten_expected_output}")
                print(f"actual sql: {test_case.actual_output}")
                self.score = await self._check_sql_semantics(
                    rewritten_expected_output, test_case.actual_output
                )
                print(f"after _check_sql_semantics: {self.score}")
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
