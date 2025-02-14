import asyncio

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from src.providers import LLMProvider


class LMasJudgeExample(BaseMetric):
    def __init__(self, llm_provider: LLMProvider, **_):
        self.threshold = 0
        self.score = 0
        self.llm_provider = llm_provider

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        self.score = 0
        breakpoint()

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "LMasJudgeExample"
