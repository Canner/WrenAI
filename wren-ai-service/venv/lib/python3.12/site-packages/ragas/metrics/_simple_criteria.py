from __future__ import annotations

import logging
import typing as t
from collections import Counter

from pydantic import BaseModel, Field

from ragas.dataset_schema import MultiTurnSample, SingleTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    MultiTurnMetric,
    SingleTurnMetric,
)
from ragas.prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks.base import Callbacks

    from ragas.llms import BaseRagasLLM


logger = logging.getLogger(__name__)


class SimpleCriteriaOutput(BaseModel):
    reason: str = Field(description="Reason for the scoring")
    score: int = Field(description="The score for the submission")


class SingleTurnSimpleCriteriaInput(BaseModel):
    user_input: t.Optional[str] = Field(
        description="The input to the llm system", default=None
    )
    response: t.Optional[str] = Field(
        description="The response from the llm system", default=None
    )
    retrieved_contexts: t.Optional[t.List[str]] = Field(
        description="The retrieved contexts from the llm system", default=None
    )
    reference_contexts: t.Optional[t.List[str]] = Field(
        description="The reference contexts for the evaluation", default=None
    )
    reference: t.Optional[str] = Field(
        description="The reference answer for evaluation", default=None
    )


class MultiTurnSimpleCriteriaInput(BaseModel):
    user_input: str = Field(description="The input to the model")
    reference: t.Optional[str] = Field(
        description="The reference response", default=None
    )


class SingleTurnSimpleCriteriaPrompt(
    PydanticPrompt[SingleTurnSimpleCriteriaInput, SimpleCriteriaOutput]
):
    instruction = "Evaluate the input based on the criteria defined."
    input_model = SingleTurnSimpleCriteriaInput
    output_model = SimpleCriteriaOutput


class MultiTurnSimpleCriteriaPrompt(
    PydanticPrompt[MultiTurnSimpleCriteriaInput, SimpleCriteriaOutput]
):
    instruction = "Evaluate the input based on the criteria defined."
    input_model = MultiTurnSimpleCriteriaInput
    output_model = SimpleCriteriaOutput


class SimpleCriteriaScore(MetricWithLLM, SingleTurnMetric, MultiTurnMetric):
    """
    Judges the submission to give binary results using the criteria specified
    in the metric definition.

    Attributes
    ----------
    name: str
        name of the metrics
    definition: str
        criteria to score the submission
    strictness: int
        The number of times self consistency checks is made. Final judgement is
        made using majority vote.
    """

    def __init__(
        self,
        name: str,
        definition: str,
        llm: t.Optional[BaseRagasLLM] = None,
        required_columns: t.Optional[t.Dict[MetricType, t.Set[str]]] = None,
        output_type: t.Optional[MetricOutputType] = MetricOutputType.DISCRETE,
        single_turn_prompt: t.Optional[PydanticPrompt] = None,
        multi_turn_prompt: t.Optional[PydanticPrompt] = None,
        strictness: int = 1,
    ):
        if required_columns is None:
            required_columns = {
                MetricType.SINGLE_TURN: {
                    "user_input:optional",
                    "response:optional",
                    "retrieved_contexts:optional",
                    "reference:optional",
                    "reference_contexts:optional",
                },
                MetricType.MULTI_TURN: {
                    "user_input:optional",
                    "reference:optional",
                },
            }
        super().__init__(
            name=name,
            llm=llm,
            _required_columns=required_columns,
            output_type=output_type,
        )

        self._definition = definition
        self.single_turn_prompt = single_turn_prompt or SingleTurnSimpleCriteriaPrompt()
        self.multi_turn_prompt = multi_turn_prompt or MultiTurnSimpleCriteriaPrompt()

        # ensure odd number of checks to avoid tie in majority vote.
        self.strictness = strictness
        self.strictness = (
            self.strictness if self.strictness % 2 != 0 else self.strictness + 1
        )

    def __repr__(self) -> str:
        return f"{self.name}(required_columns={self.required_columns}, llm={self.llm}, definition={self._definition})"

    @property
    def definition(self) -> str:
        return self._definition

    @definition.setter
    def definition(self, value: str) -> None:
        self._definition = value
        # Update the instruction for both prompts with the new definition
        instruction = f"\nCriteria Definition: {self._definition}"
        self.single_turn_prompt.instruction += instruction
        self.multi_turn_prompt.instruction += instruction

    def _compute_score(
        self, safe_loaded_responses: t.List[SimpleCriteriaOutput]
    ) -> float:
        if self.strictness > 1:
            score = Counter([item.score for item in safe_loaded_responses]).most_common(
                1
            )[0][0]
        else:
            score = safe_loaded_responses[0].score

        return score

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "set LLM before use"

        user_input, response, retrieved_contexts, reference = (
            row.get("user_input"),
            row.get("response"),
            row.get("retrieved_contexts"),
            row.get("reference"),
        )

        prompt_input = SingleTurnSimpleCriteriaInput(
            user_input=user_input,
            response=response,
            retrieved_contexts=retrieved_contexts,
            reference=reference,
        )

        response = await self.single_turn_prompt.generate(
            data=prompt_input,
            llm=self.llm,
            callbacks=callbacks,
        )

        return self._compute_score([response])

    async def _multi_turn_ascore(
        self, sample: MultiTurnSample, callbacks: Callbacks
    ) -> float:
        assert self.llm is not None, "LLM is not set"

        interaction = sample.pretty_repr()
        prompt_input = MultiTurnSimpleCriteriaInput(
            user_input=interaction,
            reference=sample.reference,
        )
        response = await self.multi_turn_prompt.generate(
            data=prompt_input,
            llm=self.llm,
            callbacks=callbacks,
        )
        return self._compute_score([response])
