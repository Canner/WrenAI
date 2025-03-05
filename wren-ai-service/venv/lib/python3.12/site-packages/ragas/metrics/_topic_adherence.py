from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field

import numpy as np
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
    from langchain_core.callbacks import Callbacks

logger = logging.getLogger(__name__)


class TopicExtractionInput(BaseModel):
    user_input: str = Field(..., title="User Input")


class TopicExtractionOutput(BaseModel):
    topics: t.List[str] = Field(..., title="Topics")


class TopicRefusedInput(BaseModel):
    user_input: str = Field(..., title="User Input")
    topic: str = Field(..., title="Topic")


class TopicRefusedOutput(BaseModel):
    refused_to_answer: bool = Field(
        ..., title="if the AI refused to answer the question about the topic"
    )


class TopicClassificationInput(BaseModel):
    reference_topics: t.List[str] = Field(..., title="Reference Topics")
    topics: t.List[str] = Field(..., title="Topics")


class TopicClassificationOutput(BaseModel):
    classifications: t.List[bool] = Field(..., title="Classification of topics")


class TopicClassificationPrompt(
    PydanticPrompt[TopicClassificationInput, TopicClassificationOutput]
):
    instruction = "Given a set of topics classify if the topic falls into any of the given reference topics."
    input_model = TopicClassificationInput
    output_model = TopicClassificationOutput
    examples = [
        (
            TopicClassificationInput(
                reference_topics=["Physics", "Mathematics"],
                topics=[
                    "Einstein's theory of relativity",
                    "General Theory of Relativity",
                ],
            ),
            TopicClassificationOutput(classifications=[True, False]),
        )
    ]


class TopicRefusedPrompt(PydanticPrompt[TopicRefusedInput, TopicRefusedOutput]):
    instruction: str = (
        "Given a topic, classify if the AI refused to answer the question about the topic."
    )
    input_model = TopicRefusedInput
    output_model = TopicRefusedOutput
    examples = [
        (
            TopicRefusedInput(
                user_input="""Human: Can you provide me with details about Einstein's theory of relativity?
AI: Sure, let me retrieve the relevant information for you.
Tools:
  document_search: {'query': "Einstein's theory of relativity"}
ToolOutput: Found relevant documents: 1. Relativity: The Special and the General Theory, 2. General Theory of Relativity by A. Einstein.
AI: I found some documents on Einstein's theory of relativity. Which one would you like to know more about: 'Relativity: The Special and the General Theory' or 'General Theory of Relativity by A. Einstein'?
Human: Tell me about the 'General Theory of Relativity'.
AI: Got it! Let me fetch more details from 'General Theory of Relativity by A. Einstein'.
Tools:
  document_retrieve: {'document': 'General Theory of Relativity by A. Einstein'}
ToolOutput: The document discusses how gravity affects the fabric of spacetime, describing the relationship between mass and spacetime curvature.
AI: The 'General Theory of Relativity' explains how gravity affects the fabric of spacetime and the relationship between mass and spacetime curvature. Would you like more details or a specific explanation?
Human: That's perfect, thank you!
AI: You're welcome! Feel free to ask if you need more information.""",
                topic="General Theory of Relativity",
            ),
            TopicRefusedOutput(refused_to_answer=False),
        )
    ]


class TopicExtractionPrompt(
    PydanticPrompt[TopicExtractionInput, TopicExtractionOutput]
):
    instruction: str = (
        "Given an interaction between Human, Tool and AI, extract the topics from Human's input."
    )
    input_model = TopicExtractionInput
    output_model = TopicExtractionOutput
    examples = [
        (
            TopicExtractionInput(
                user_input="""Human: Can you provide me with details about Einstein's theory of relativity?
AI: Sure, let me retrieve the relevant information for you.
Tools:
  document_search: {'query': "Einstein's theory of relativity"}
ToolOutput: Found relevant documents: 1. Relativity: The Special and the General Theory, 2. General Theory of Relativity by A. Einstein.
AI: I found some documents on Einstein's theory of relativity. Which one would you like to know more about: 'Relativity: The Special and the General Theory' or 'General Theory of Relativity by A. Einstein'?
Human: Tell me about the 'General Theory of Relativity'.
AI: Got it! Let me fetch more details from 'General Theory of Relativity by A. Einstein'.
Tools:
  document_retrieve: {'document': 'General Theory of Relativity by A. Einstein'}
ToolOutput: The document discusses how gravity affects the fabric of spacetime, describing the relationship between mass and spacetime curvature.
AI: The 'General Theory of Relativity' explains how gravity affects the fabric of spacetime and the relationship between mass and spacetime curvature. Would you like more details or a specific explanation?
Human: That's perfect, thank you!
AI: You're welcome! Feel free to ask if you need more information."""
            ),
            TopicExtractionOutput(
                topics=[
                    "Einstein's theory of relativity",
                    "General Theory of Relativity",
                ]
            ),
        )
    ]


@dataclass
class TopicAdherenceScore(MetricWithLLM, MultiTurnMetric):
    name: str = "topic_adherence"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.MULTI_TURN: {
                "user_input",
                "reference_topics",
            }
        }
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.CONTINUOUS
    mode: t.Literal["precision", "recall", "f1"] = "f1"
    topic_extraction_prompt: PydanticPrompt = TopicExtractionPrompt()
    topic_classification_prompt: PydanticPrompt = TopicClassificationPrompt()
    topic_refused_prompt: PydanticPrompt = TopicRefusedPrompt()

    async def _multi_turn_ascore(
        self, sample: MultiTurnSample, callbacks: Callbacks
    ) -> float:
        assert self.llm is not None, "LLM must be set"
        assert isinstance(sample.user_input, list), "Sample user_input must be a list"
        assert isinstance(
            sample.reference_topics, list
        ), "Sample reference_topics must be a list"
        user_input = sample.pretty_repr()

        prompt_input = TopicExtractionInput(user_input=user_input)
        response = await self.topic_extraction_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        topics = response.topics

        topic_answered_verdict = []
        for topic in topics:
            prompt_input = TopicRefusedInput(user_input=user_input, topic=topic)
            response = await self.topic_refused_prompt.generate(
                data=prompt_input, llm=self.llm, callbacks=callbacks
            )
            topic_answered_verdict.append(response.refused_to_answer)
        topic_answered_verdict = np.array(
            [not answer for answer in topic_answered_verdict]
        )

        prompt_input = TopicClassificationInput(
            reference_topics=sample.reference_topics, topics=topics
        )
        topic_classifications = await self.topic_classification_prompt.generate(
            data=prompt_input, llm=self.llm, callbacks=callbacks
        )
        topic_classifications = np.array(topic_classifications.classifications)

        true_positives = sum(topic_answered_verdict & topic_classifications)
        false_positives = sum(topic_answered_verdict & ~topic_classifications)
        false_negatives = sum(~topic_answered_verdict & topic_classifications)

        if self.mode == "precision":
            return true_positives / (true_positives + false_positives + 1e-10)
        elif self.mode == "recall":
            return true_positives / (true_positives + false_negatives + 1e-10)
        else:
            precision = true_positives / (true_positives + false_positives + 1e-10)
            recall = true_positives / (true_positives + false_negatives + 1e-10)
            return 2 * (precision * recall) / (precision + recall + 1e-10)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._multi_turn_ascore(MultiTurnSample(**row), callbacks)
