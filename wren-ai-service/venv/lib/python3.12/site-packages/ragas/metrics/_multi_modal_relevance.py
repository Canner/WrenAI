from __future__ import annotations

import typing as t
from dataclasses import dataclass, field

import numpy as np
from pydantic import BaseModel, Field

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.prompt import ImageTextPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks


class RelevanceInput(BaseModel):
    user_input: str = Field(description="user input")
    response: str = Field(description="response from AI")
    retrieved_contexts: list[str] = Field(description="contexts retrieved from the LLM")

    def to_string_list(self):
        return [
            f"Question: {self.user_input}",
            f"Response: {self.response}",
            "retrieved_contexts: ",
        ] + self.retrieved_contexts


class RelevanceOutput(BaseModel):
    relevance: bool = Field(description="boolean indicating if request was relevance")


class MultiModalRelevancePrompt(ImageTextPrompt[RelevanceInput, RelevanceOutput]):
    # refer https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/evaluation/multi_modal/relevancy.py
    instruction = """
Your task is to evaluate if the response for the query is in line with the images and textual context information provided.
You have two options to answer. Either True / False.
Answer - True, if the response for the query is in line with context information otherwise False.
"""
    input_model = RelevanceInput
    output_model = RelevanceOutput
    examples = [
        (
            RelevanceInput(
                user_input="What is the primary ingredient in a traditional Margherita pizza?",
                response="The primary ingredients in a Margherita pizza are tomatoes, mozzarella cheese, and fresh basil.",
                retrieved_contexts=[
                    "A traditional Margherita pizza consists of a thin crust.",
                    "The main toppings include tomatoes, mozzarella cheese, fresh basil, salt, and olive oil.",
                    "It is one of the simplest and most classic types of pizza.",
                ],
            ),
            RelevanceOutput(relevance=True),
        ),
        (
            RelevanceInput(
                user_input="Who won the Best Actor award at the Oscars in 2021?",
                response="The Best Actor award in 2021 was won by Leonardo DiCaprio.",
                retrieved_contexts=[
                    "The 93rd Academy Awards were held in 2021.",
                    "Anthony Hopkins won the Best Actor award for his role in 'The Father'.",
                    "The event was unique due to COVID-19 restrictions.",
                ],
            ),
            RelevanceOutput(relevance=False),
        ),
    ]


@dataclass
class MultiModalRelevance(MetricWithLLM, SingleTurnMetric):
    name: str = "relevance_rate"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {
                "user_input",
                "response",
                "retrieved_contexts",
            }
        }
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.CONTINUOUS

    relevance_prompt: ImageTextPrompt = MultiModalRelevancePrompt()

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        prompt_input = RelevanceInput(
            user_input=row["user_input"],
            response=row["response"],
            retrieved_contexts=row["retrieved_contexts"],
        )
        assert self.llm is not None, "LLM is not set"
        prompt_response = await self.relevance_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        if prompt_response is None:
            return np.nan
        return float(prompt_response.relevance)

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)


multimodal_relevance = MultiModalRelevance()
