import asyncio

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase


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
