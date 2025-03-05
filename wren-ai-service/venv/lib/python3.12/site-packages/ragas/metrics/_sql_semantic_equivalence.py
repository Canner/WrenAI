from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks


logger = logging.getLogger(__name__)


class EquivalenceInput(BaseModel):
    reference: str = Field(..., description="Reference SQL")
    response: str = Field(..., description="Generated SQL")
    database_schema: str = Field(..., description="Reference SQL schema")


class EquivalenceOutput(BaseModel):
    response_query_explaination: str = Field(
        ..., description="Explanation of the generated SQL"
    )
    reference_query_explaination: str = Field(
        ..., description="Explanation of the reference SQL"
    )
    equivalence: bool = Field(
        ..., description="Whether the generated SQL is equivalent to the reference SQL"
    )


class EquivalencePrompt(PydanticPrompt[EquivalenceInput, EquivalenceOutput]):
    instruction = """
    Explain and compare two SQL queries (Q1 and Q2) based on the provided database schema. First, explain each query, then determine if they have significant logical differences.
    """
    input_model = EquivalenceInput
    output_model = EquivalenceOutput
    examples = [
        (
            EquivalenceInput(
                reference="SELECT id, name FROM users WHERE active = 1;",
                response="SELECT id, name FROM users WHERE active = true;",
                database_schema="""
                    Table users:
                    - id: INT
                    - name: VARCHAR
                    - active: BOOLEAN
                """,
            ),
            EquivalenceOutput(
                response_query_explaination="The generated SQL query retrieves the id and name of users where the active field is true.",
                reference_query_explaination="The reference SQL query retrieves the id and name of users where the active field equals 1.",
                equivalence=True,
            ),
        )
    ]


@dataclass
class LLMSQLEquivalence(MetricWithLLM, SingleTurnMetric):
    name: str = "llm_sql_equivalence_with_reference"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {"response", "reference", "reference_contexts"}
        }
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.BINARY
    equivalence_prompt: PydanticPrompt = EquivalencePrompt()

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        assert self.llm is not None, "LLM is not initialized"
        assert isinstance(sample.reference, str), "Sample reference must be a string"
        assert isinstance(sample.response, str), "Sample response must be a string"
        assert isinstance(
            sample.reference_contexts, list
        ), "Sample reference_contexts must be a List"

        database_schema = "\n".join(sample.reference_contexts)
        input_data = EquivalenceInput(
            reference=sample.reference,
            response=sample.response,
            database_schema=database_schema,
        )
        response = await self.equivalence_prompt.generate(
            data=input_data, llm=self.llm, callbacks=callbacks
        )
        return int(response.equivalence)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)
