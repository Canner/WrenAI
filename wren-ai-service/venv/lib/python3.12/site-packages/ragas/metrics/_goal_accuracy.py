from __future__ import annotations

import typing as t
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from ragas.dataset_schema import MultiTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    MultiTurnMetric,
)
from ragas.prompt import PydanticPrompt

if t.TYPE_CHECKING:
    from langchain_core.callbacks.base import Callbacks


class WorkflowOutput(BaseModel):
    user_goal: str = Field(
        ..., description="The task or objective the user wants to achieve."
    )
    end_state: str = Field(
        ..., description="The final outcome or result of the workflow."
    )


class CompareOutcomeInput(BaseModel):
    desired_outcome: str = Field(
        ..., description="The desired outcome or result of the workflow."
    )
    arrived_outcome: str = Field(
        ..., description="The actual outcome or result of the workflow."
    )


class CompareOutcomeOutput(BaseModel):
    reason: str = Field(
        ..., description="The task or objective the user wants to achieve."
    )
    verdict: t.Literal["0", "1"] = Field(
        ..., description="The final outcome or result of the workflow."
    )


class WorkflowInput(BaseModel):
    workflow: str = Field(
        ..., description="The agentic workflow comprised of Human, AI and Tools."
    )


class InferGoalOutcomePrompt(PydanticPrompt[WorkflowInput, WorkflowOutput]):
    instruction = "Given an agentic workflow comprised of Human, AI and Tools, identify the user_goal (the task or objective the user wants to achieve) and the end_state (the final outcome or result of the workflow)."
    input_model = WorkflowInput
    output_model = WorkflowOutput
    examples = [
        (
            WorkflowInput(
                workflow="""
            Human: Hey, book a table at the nearest best Chinese restaurant for 8:00pm
            AI: Sure, let me find the best options for you.
            Tools:
                restaurant_search: {'cuisine': 'Chinese', 'time': '8:00pm'}
            ToolOutput: Found a few options: 1. Golden Dragon, 2. Jade Palace
            AI: I found some great options: Golden Dragon and Jade Palace. Which one would you prefer?
            Human: Let's go with Golden Dragon.
            AI: Great choice! I'll book a table for 8:00pm at Golden Dragon.
            Tools:
                restaurant_book: {'name': 'Golden Dragon', 'time': '8:00pm'}
            ToolOutput: Table booked at Golden Dragon for 8:00pm.
            AI: Your table at Golden Dragon is booked for 8:00pm. Enjoy your meal!
            Human: thanks
            """
            ),
            WorkflowOutput(
                user_goal="Book a table at the nearest best Chinese restaurant for 8:00pm.",
                end_state="A table is successfully booked at Golden Dragon (Chinese restaurant) for 8:00pm.",
            ),
        )
    ]


class CompareOutcomePrompt(PydanticPrompt[CompareOutcomeInput, CompareOutcomeOutput]):
    instruction = "Given user goal, desired outcome and acheived outcome compare them and identify if they are the same (1) or different(0)."
    input_model = CompareOutcomeInput
    output_model = CompareOutcomeOutput
    examples = [
        (
            CompareOutcomeInput(
                desired_outcome="A table is successfully booked at any Chinese restaurant for 8:00pm.",
                arrived_outcome="A table is successfully booked at Jade Palace (Chinese restaurant) for 8:00pm.",
            ),
            CompareOutcomeOutput(
                reason="The arrived outcome is same as the desired outcome and aligns with the user goal.",
                verdict="1",
            ),
        )
    ]


@dataclass
class AgentGoalAccuracyWithReference(MetricWithLLM, MultiTurnMetric):
    name: str = "agent_goal_accuracy"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.MULTI_TURN: {
                "user_input",
                "reference",
            }
        }
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.BINARY
    workflow_prompt: PydanticPrompt = field(
        default_factory=lambda: InferGoalOutcomePrompt()
    )
    compare_outcome_prompt: PydanticPrompt = field(
        default_factory=lambda: CompareOutcomePrompt()
    )
    max_retries: int = 1

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        raise NotImplementedError

    async def _multi_turn_ascore(
        self,
        sample: MultiTurnSample,
        callbacks: Callbacks,
    ) -> float:
        assert self.llm is not None, "LLM is not set"
        assert sample.reference is not None, "Reference is not set"

        prompt_input = WorkflowInput(workflow=sample.pretty_repr())
        response = await self.workflow_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        prompt_input = CompareOutcomeInput(
            desired_outcome=sample.reference, arrived_outcome=response.end_state
        )
        response = await self.compare_outcome_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return float(response.verdict)


@dataclass
class AgentGoalAccuracyWithoutReference(MetricWithLLM, MultiTurnMetric):
    name: str = "agent_goal_accuracy"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.MULTI_TURN: {
                "user_input",
            }
        }
    )
    workflow_prompt: PydanticPrompt = field(
        default_factory=lambda: InferGoalOutcomePrompt()
    )
    compare_outcome_prompt: PydanticPrompt = field(
        default_factory=lambda: CompareOutcomePrompt()
    )
    max_retries: int = 1

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        raise NotImplementedError

    async def _multi_turn_ascore(
        self,
        sample: MultiTurnSample,
        callbacks: Callbacks,
    ) -> float:
        assert self.llm is not None, "LLM is not set"

        prompt_input = WorkflowInput(workflow=sample.pretty_repr())
        response = await self.workflow_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        prompt_input = CompareOutcomeInput(
            desired_outcome=response.user_goal, arrived_outcome=response.end_state
        )
        response = await self.compare_outcome_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        return float(response.verdict)
