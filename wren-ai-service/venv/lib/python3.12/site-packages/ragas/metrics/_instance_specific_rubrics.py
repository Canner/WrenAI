from __future__ import annotations

import typing as t

from pydantic import Field

from ragas.dataset_schema import MultiTurnSample, SingleTurnSample
from ragas.metrics._domain_specific_rubrics import (
    MultiTurnInputWithoutRubric,
    ScoreFeedback,
    SingleTurnInputWithoutRubric,
)
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    MultiTurnMetric,
    SingleTurnMetric,
)
from ragas.prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.llms import BaseRagasLLM


class SingleTurnInputWithRubric(SingleTurnInputWithoutRubric):
    rubrics: t.Dict[str, str] = Field(
        ..., description="The rubric for evaluating this instance"
    )


class MultiTurnInputWithRubric(MultiTurnInputWithoutRubric):
    rubrics: t.Dict[str, str] = Field(
        ..., description="The rubric for evaluating this instance"
    )


class SingleTurnPrompt(PydanticPrompt[SingleTurnInputWithRubric, ScoreFeedback]):
    instruction = "Your task is to assign an appropriate score and provide feedback to the inputs based solely on the scoring criteria passed in the input."
    input_model = SingleTurnInputWithRubric
    output_model = ScoreFeedback


class MultiTurnPrompt(PydanticPrompt[MultiTurnInputWithRubric, ScoreFeedback]):
    instruction = "Your task is to assign an appropriate score and provide feedback to the inputs based solely on the scoring criteria passed in the input."
    input_model = MultiTurnInputWithRubric
    output_model = ScoreFeedback


class InstanceRubrics(MetricWithLLM, SingleTurnMetric, MultiTurnMetric):
    def __init__(
        self,
        name: str = "instance_rubrics",
        llm: t.Optional[BaseRagasLLM] = None,
        required_columns: t.Optional[t.Dict[MetricType, t.Set[str]]] = None,
        output_type: t.Optional[MetricOutputType] = MetricOutputType.DISCRETE,
        single_turn_prompt: t.Optional[PydanticPrompt] = None,
        multi_turn_prompt: t.Optional[PydanticPrompt] = None,
        max_retries: int = 1,
    ):
        self._required_columns = required_columns or {
            MetricType.SINGLE_TURN: {
                "rubrics",
                "user_input:optional",
                "response:optional",
                "retrieved_contexts:optional",
                "reference:optional",
                "reference_contexts:optional",
            },
            MetricType.MULTI_TURN: {
                "rubrics",
                "user_input:optional",
                "reference:optional",
            },
        }
        self.output_type = output_type
        super().__init__(name=name, llm=llm, _required_columns=self._required_columns)

        self.single_turn_prompt = single_turn_prompt or SingleTurnPrompt()
        self.multi_turn_prompt = multi_turn_prompt or MultiTurnPrompt()
        self.max_retries = max_retries

    def __repr__(self) -> str:
        return f"{self.name}(required_columns={self.required_columns}, llm={self.llm})"

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "LLM is not set"

        user_input, contexts, response, reference, rubrics = (
            row.get("user_input"),
            row.get("retrieved_contexts"),
            row.get("response"),
            row.get("reference"),
            row.get("rubrics"),
        )
        if contexts is not None:
            contexts = "\n".join(contexts)
            user_input = f"{user_input} answer using context: {contexts}"

        if rubrics is None:
            raise ValueError(f"Rubrics are not set for the sample: {row}")
        prompt_input = SingleTurnInputWithRubric(
            user_input=user_input,
            response=response,
            reference=reference,
            rubrics=rubrics,
        )

        response = await self.single_turn_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return response.score

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)

    async def _multi_turn_ascore(
        self, sample: MultiTurnSample, callbacks: Callbacks
    ) -> float:
        assert self.llm is not None, "LLM is not set"
        assert sample.rubrics is not None, "Rubrics are not set"
        assert sample.reference is not None, "Reference is not set"

        interaction = sample.pretty_repr()
        reference = sample.reference
        rubrics = sample.rubrics
        prompt_input = MultiTurnInputWithRubric(
            user_input=interaction,
            reference=reference,
            rubrics=rubrics,
        )
        output = await self.multi_turn_prompt.generate(
            data=prompt_input,
            llm=self.llm,
            callbacks=callbacks,
        )
        return output.score
