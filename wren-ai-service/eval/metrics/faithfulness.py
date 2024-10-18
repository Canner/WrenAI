import asyncio

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.utils import get_contexts_from_sql


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
