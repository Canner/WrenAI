import asyncio

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase


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
