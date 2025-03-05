from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from ragas.metrics._faithfulness import NLIStatementInput, NLIStatementPrompt
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.metrics.utils import fbeta_score
from ragas.prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

    from ragas.dataset_schema import SingleTurnSample


logger = logging.getLogger(__name__)


class ClaimDecompositionInput(BaseModel):
    response: str = Field(..., title="Response")


class ClaimDecompositionOutput(BaseModel):
    claims: t.List[str] = Field(..., title="Decomposed Claims")


# Define an enum for decomposition types
class DecompositionType(Enum):
    LOW_ATOMICITY_LOW_COVERAGE = "low_atomicity_low_coverage"
    LOW_ATOMICITY_HIGH_COVERAGE = "low_atomicity_high_coverage"
    HIGH_ATOMICITY_LOW_COVERAGE = "high_atomicity_low_coverage"
    HIGH_ATOMICITY_HIGH_COVERAGE = "high_atomicity_high_coverage"


# Example input data
example1_input = ClaimDecompositionInput(
    response="Charles Babbage was a French mathematician, philosopher, and food critic."
)

# Define the examples using the Pydantic structure
claim_decomposition_examples = {
    DecompositionType.LOW_ATOMICITY_LOW_COVERAGE: [
        (
            example1_input,
            ClaimDecompositionOutput(
                claims=["Charles Babbage was a mathematician and philosopher."]
            ),
        )
    ],
    DecompositionType.LOW_ATOMICITY_HIGH_COVERAGE: [
        (
            example1_input,
            ClaimDecompositionOutput(
                claims=[
                    "Charles Babbage was a French mathematician, philosopher, and food critic."
                ]
            ),
        )
    ],
    DecompositionType.HIGH_ATOMICITY_LOW_COVERAGE: [
        (
            example1_input,
            ClaimDecompositionOutput(
                claims=[
                    "Charles Babbage was a mathematician.",
                    "Charles Babbage was a philosopher.",
                ]
            ),
        )
    ],
    DecompositionType.HIGH_ATOMICITY_HIGH_COVERAGE: [
        (
            example1_input,
            ClaimDecompositionOutput(
                claims=[
                    "Charles Babbage was a mathematician.",
                    "Charles Babbage was a philosopher.",
                    "Charles Babbage was a food critic.",
                    "Charles Babbage was French.",
                ]
            ),
        )
    ],
}

# Example input data with two sentences
example2_input = ClaimDecompositionInput(
    response="Albert Einstein was a German theoretical physicist. He developed the theory of relativity and also contributed to the development of quantum mechanics."
)

# Adding examples to the dictionary with different decomposition types
claim_decomposition_examples[DecompositionType.LOW_ATOMICITY_LOW_COVERAGE].append(
    (
        example2_input,
        ClaimDecompositionOutput(
            claims=[
                "Albert Einstein was a German physicist.",
                "Albert Einstein developed relativity and contributed to quantum mechanics.",
            ]
        ),
    )
)

claim_decomposition_examples[DecompositionType.LOW_ATOMICITY_HIGH_COVERAGE].append(
    (
        example2_input,
        ClaimDecompositionOutput(
            claims=[
                "Albert Einstein was a German theoretical physicist.",
                "Albert Einstein developed the theory of relativity and also contributed to the development of quantum mechanics.",
            ]
        ),
    )
)

claim_decomposition_examples[DecompositionType.HIGH_ATOMICITY_LOW_COVERAGE].append(
    (
        example2_input,
        ClaimDecompositionOutput(
            claims=[
                "Albert Einstein was a German theoretical physicist.",
                "Albert Einstein developed the theory of relativity.",
            ]
        ),
    )
)

claim_decomposition_examples[DecompositionType.HIGH_ATOMICITY_HIGH_COVERAGE].append(
    (
        example2_input,
        ClaimDecompositionOutput(
            claims=[
                "Albert Einstein was a German theoretical physicist.",
                "Albert Einstein developed the theory of relativity.",
                "Albert Einstein contributed to the development of quantum mechanics.",
            ]
        ),
    )
)


class ClaimDecompositionPrompt(
    PydanticPrompt[ClaimDecompositionInput, ClaimDecompositionOutput]
):
    instruction = """
    Decompose and break down each of the input sentences into one or more standalone statements. Each statement should be a standalone claim that can be independently verified.
    Follow the level of atomicity and coverage as shown in the examples.
    """
    input_model = ClaimDecompositionInput
    output_model = ClaimDecompositionOutput


@dataclass
class FactualCorrectness(MetricWithLLM, SingleTurnMetric):
    """
    FactualCorrectness is a metric class that evaluates the factual correctness of responses
    generated by a language model. It uses claim decomposition and natural language inference (NLI)
    to verify the claims made in the responses against reference texts.

    Attributes:
        name (str): The name of the metric, default is "factual_correctness".
        _required_columns (Dict[MetricType, Set[str]]): A dictionary specifying the required columns
            for each metric type. Default is {"SINGLE_TURN": {"response", "reference"}}.
        mode (Literal["precision", "recall", "f1"]): The mode of evaluation, can be "precision",
            "recall", or "f1". Default is "f1".
        beta (float): The beta value used for the F1 score calculation. A beta > 1 gives more weight
            to recall, while beta < 1 favors precision. Default is 1.0.
        atomicity (Literal["low", "high"]): The level of atomicity for claim decomposition. Default is "low".
        coverage (Literal["low", "high"]): The level of coverage for claim decomposition. Default is "low".
        claim_decomposition_prompt (PydanticPrompt): The prompt used for claim decomposition.
        nli_prompt (PydanticPrompt): The prompt used for natural language inference (NLI).

    """

    name: str = "factual_correctness"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"response", "reference"}}
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.CONTINUOUS
    mode: t.Literal["precision", "recall", "f1"] = "f1"
    beta: float = 1.0
    atomicity: t.Literal["low", "high"] = "low"
    coverage: t.Literal["low", "high"] = "low"
    claim_decomposition_prompt: PydanticPrompt = ClaimDecompositionPrompt()
    nli_prompt: PydanticPrompt = NLIStatementPrompt()
    language: str = "english"

    def __post_init__(self):
        value = f"{self.atomicity}_atomicity_{self.coverage}_coverage"
        for item in DecompositionType:
            if item.value == value:
                self.claim_decomposition_prompt.examples.extend(
                    claim_decomposition_examples[item]
                )
        if not self.claim_decomposition_prompt.examples:
            logger.warning(
                f"No examples found for the atomicity and coverage level: {value}"
            )

        if type(self.beta) is not float:
            raise ValueError(
                "Beta must be a float. A beta > 1 gives more weight to recall, while beta < 1 favors precision."
            )

    async def decompose_claims(
        self, response: str, callbacks: Callbacks
    ) -> t.List[str]:
        assert self.llm is not None, "LLM must be set"

        prompt_input = ClaimDecompositionInput(response=response)
        result = await self.claim_decomposition_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return result.claims

    async def verify_claims(
        self, premise: str, hypothesis_list: t.List[str], callbacks: Callbacks
    ) -> NDArray[np.bool_]:
        assert self.llm is not None, "LLM must be set"
        prompt_input = NLIStatementInput(context=premise, statements=hypothesis_list)
        response = await self.nli_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return np.array([bool(result.verdict) for result in response.statements])

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert self.llm is not None, "LLM must be set"
        assert reference is not None, "Reference is not set"
        assert response is not None, "Response is not set"

        response_claims = await self.decompose_claims(response, callbacks)
        reference_response = await self.verify_claims(
            premise=reference, hypothesis_list=response_claims, callbacks=callbacks
        )

        if self.mode != "precision":
            reference_claims = await self.decompose_claims(reference, callbacks)
            response_reference = await self.verify_claims(
                premise=response, hypothesis_list=reference_claims, callbacks=callbacks
            )
        else:
            response_reference = np.array([])

        tp = sum(reference_response)
        fp = sum(~reference_response)
        if self.mode != "precision":
            response_reference = np.array(response_reference, dtype=bool)
            fn = sum(~response_reference)
        else:
            fn = 0

        if self.mode == "precision":
            score = tp / (tp + fp + 1e-8)
        elif self.mode == "recall":
            score = tp / (tp + fn + 1e-8)
        else:
            score = fbeta_score(tp, fp, fn, self.beta)

        return np.round(score, 2)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)
