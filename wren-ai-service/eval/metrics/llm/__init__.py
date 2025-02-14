import asyncio

import orjson
from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase
from haystack.components.builders.prompt_builder import PromptBuilder
from pydantic import BaseModel

from src.providers import LLMProvider


class EvalResult(BaseModel):
    score: float
    reason: str


_MODEL_KWARGS = {
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "eval_result",
            "schema": EvalResult.model_json_schema(),
        },
    }
}


def format(response: dict) -> EvalResult:
    reply = response.get("replies", [])[0]
    return EvalResult.model_validate_json(orjson.loads(reply))


class QuestionCoherenceJudge(BaseMetric):
    # todo: optimize the prompts
    _system_prompt = """
    You are a helpful assistant that evaluates the coherence of a question.
    """
    _test_case_prompt = """
    Question: {question}
    """

    def __init__(self, llm_provider: LLMProvider, **_):
        self.threshold = 0
        self.score = 0
        self.llm_provider = llm_provider
        self.llm = llm_provider.get_generator(
            system_prompt=self._system_prompt,
            generation_kwargs=_MODEL_KWARGS,
        )
        self.prompt_builder = PromptBuilder(template=self._test_case_prompt)

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        prompt = self.prompt_builder.run(question=test_case.input)
        response = await self.llm(prompt.get("prompt"))
        result = format(response)

        self.score = result.score
        self.reason = result.reason

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "QuestionCoherenceJudge"


class ReasoningValidityJudge(BaseMetric):
    # todo: optimize the prompts
    _system_prompt = """
    You are a helpful assistant that evaluates the coherence of a question.
    """
    _test_case_prompt = """
    Question: {question}
    """

    def __init__(self, llm_provider: LLMProvider, **_):
        self.threshold = 0
        self.score = 0
        self.llm_provider = llm_provider
        self.llm = llm_provider.get_generator(
            system_prompt=self._system_prompt,
            generation_kwargs=_MODEL_KWARGS,
        )
        self.prompt_builder = PromptBuilder(template=self._test_case_prompt)

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        prompt = self.prompt_builder.run(question=test_case.input)
        response = await self.llm(prompt.get("prompt"))
        result = format(response)

        self.score = result.score
        self.reason = result.reason

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ReasoningValidityJudge"


class SqlSemanticsJudge(BaseMetric):
    # todo: optimize the prompts
    _system_prompt = """
    You are a helpful assistant that evaluates the coherence of a question.
    """
    _test_case_prompt = """
    Question: {question}
    """

    def __init__(self, llm_provider: LLMProvider, **_):
        self.threshold = 0
        self.score = 0
        self.llm_provider = llm_provider
        self.llm = llm_provider.get_generator(
            system_prompt=self._system_prompt,
            generation_kwargs=_MODEL_KWARGS,
        )
        self.prompt_builder = PromptBuilder(template=self._test_case_prompt)

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        prompt = self.prompt_builder.run(question=test_case.input)
        response = await self.llm(prompt.get("prompt"))
        result = format(response)

        self.score = result.score
        self.reason = result.reason

        self.success = self.score >= self.threshold
        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "SqlSemanticsJudge"
