from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field
from typing import Dict

from pydantic import BaseModel

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.prompt import PydanticPrompt, StringIO

if t.TYPE_CHECKING:
    from langchain.callbacks.base import Callbacks

logger = logging.getLogger(__name__)


class ExtractedKeyphrases(BaseModel):
    keyphrases: t.List[str]


class QuestionsGenerated(BaseModel):
    questions: t.List[str]


class AnswersGenerated(BaseModel):
    answers: t.List[str]


class ExtractKeyphrasePrompt(PydanticPrompt[StringIO, ExtractedKeyphrases]):
    name: str = "extract_keyphrases"
    instruction: str = (
        "Extract keyphrases of type: Person, Organization, Location, Date/Time, Monetary Values, and Percentages."
    )
    input_model = StringIO
    output_model = ExtractedKeyphrases
    examples: t.List[t.Tuple[StringIO, ExtractedKeyphrases]] = [
        (
            StringIO(
                text="Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023."
            ),
            ExtractedKeyphrases(
                keyphrases=[
                    "Apple Inc.",
                    "Cupertino, California",
                    "Steve Jobs",
                    "1976",
                    "$3 trillion",
                    "2023",
                ]
            ),
        )
    ]


class GenerateQuestionsPromptInput(BaseModel):
    text: str
    keyphrases: t.List[str]


class GenerateQuestionsPrompt(
    PydanticPrompt[GenerateQuestionsPromptInput, QuestionsGenerated]
):
    name: str = "generate_questions"
    instruction: str = (
        "Based on the given text and keyphrases, generate closed-ended questions that can be answered with '1' if the question can be answered using the text, or '0' if it cannot. The questions should ALWAYS result in a '1' based on the given text."
    )
    input_model = GenerateQuestionsPromptInput
    output_model = QuestionsGenerated
    examples: t.List[t.Tuple[GenerateQuestionsPromptInput, QuestionsGenerated]] = [
        (
            GenerateQuestionsPromptInput(
                text="Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
                keyphrases=[
                    "Apple Inc.",
                    "Cupertino, California",
                    "Steve Jobs",
                    "1976",
                    "$3 trillion",
                    "2023",
                ],
            ),
            QuestionsGenerated(
                questions=[
                    "Is Apple Inc. a technology company?",
                    "Is Apple Inc. based in Cupertino, California?",
                    "Was Apple Inc. founded by Steve Jobs?",
                    "Was Apple Inc. founded in 1976?",
                    "Did Apple Inc. reach a market capitalization of $3 trillion?",
                    "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?",
                ]
            ),
        )
    ]


class SummaryAndQuestions(BaseModel):
    summary: str
    questions: t.List[str]


class GenerateAnswersPrompt(PydanticPrompt[SummaryAndQuestions, AnswersGenerated]):
    name: str = "generate_answers"
    instruction: str = (
        "Based on the list of close-ended '1' or '0' questions, generate a JSON with key 'answers', which is a list of strings that determines whether the provided summary contains sufficient information to answer EACH question. Answers should STRICTLY be either '1' or '0'. Answer '0' if the provided summary does not contain enough information to answer the question and answer '1' if the provided summary can answer the question."
    )
    input_model = SummaryAndQuestions
    output_model = AnswersGenerated
    examples: t.List[t.Tuple[SummaryAndQuestions, AnswersGenerated]] = [
        (
            SummaryAndQuestions(
                summary="Apple Inc. is a technology company based in Cupertino, California. Founded by Steve Jobs in 1976, it reached a market capitalization of $3 trillion in 2023.",
                questions=[
                    "Is Apple Inc. a technology company?",
                    "Is Apple Inc. based in Cupertino, California?",
                    "Was Apple Inc. founded by Steve Jobs?",
                    "Was Apple Inc. founded in 1976?",
                    "Did Apple Inc. reach a market capitalization of $3 trillion?",
                    "Did Apple Inc. reach a market capitalization of $3 trillion in 2023?",
                    "Is Apple Inc. a major software company?",
                    "Is Apple Inc. known for the iPhone?",
                    "Was Steve Jobs the co-founder of Apple Inc.?",
                ],
            ),
            AnswersGenerated(
                answers=[
                    "1",
                    "1",
                    "1",
                    "1",
                    "1",
                    "1",
                    "0",
                    "0",
                    "1",
                ]
            ),
        )
    ]


@dataclass
class SummarizationScore(MetricWithLLM, SingleTurnMetric):
    name: str = "summary_score"
    max_retries: int = 1
    length_penalty: bool = True
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {
                "reference_contexts",
                "response",
            }
        }
    )
    output_type: t.Optional[MetricOutputType] = MetricOutputType.CONTINUOUS
    coeff: float = 0.5
    question_generation_prompt: PydanticPrompt = field(
        default_factory=GenerateQuestionsPrompt
    )
    answer_generation_prompt: PydanticPrompt = field(
        default_factory=GenerateAnswersPrompt
    )
    extract_keyphrases_prompt: PydanticPrompt = field(
        default_factory=ExtractKeyphrasePrompt
    )

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)

    async def _ascore(self, row: Dict, callbacks: Callbacks) -> float:
        text: str = "\n".join(row["reference_contexts"])
        summary: str = row["response"]
        keyphrases = await self._extract_keyphrases(text, callbacks)
        questions = await self._get_questions(text, keyphrases, callbacks)
        answers = await self._get_answers(questions, summary, callbacks)

        scores = {}
        qa_score = self._compute_qa_score(answers)
        scores["qa_score"] = qa_score
        if self.length_penalty:
            conciseness_score = self._compute_conciseness_score(text, summary)
            scores["conciseness_score"] = conciseness_score
        return self._compute_score(scores)

    def _compute_score(self, scores) -> float:
        return (
            scores["qa_score"] * (1 - self.coeff)
            + scores.get("conciseness_score", 0) * self.coeff
        )

    def _compute_qa_score(self, answers: t.List[str]) -> float:
        correct = sum([1 for a in answers if a.lower() == "1"])
        return correct / len(answers)

    def _compute_conciseness_score(self, text, summary) -> float:
        return 1 - min(len(summary), len(text)) / (len(text) + 1e-10)

    async def _extract_keyphrases(self, text: str, callbacks: Callbacks) -> t.List[str]:
        assert self.llm is not None, "LLM is not initialized"

        response: ExtractedKeyphrases = await self.extract_keyphrases_prompt.generate(
            data=StringIO(text=text), llm=self.llm, callbacks=callbacks
        )
        if not response:
            logging.error("No keyphrases generated, unable to calculate the score.")
            return []

        return response.keyphrases

    async def _get_questions(
        self, text: str, keyphrases: list[str], callbacks: Callbacks
    ) -> t.List[str]:
        assert self.llm is not None, "LLM is not initialized"
        response: QuestionsGenerated = await self.question_generation_prompt.generate(
            data=GenerateQuestionsPromptInput(text=text, keyphrases=keyphrases),
            llm=self.llm,
            callbacks=callbacks,
        )
        if not response:
            logging.error("No questions generated, unable to calculate the score.")
            return []

        return response.questions

    async def _get_answers(
        self, questions: t.List[str], summary: str, callbacks: Callbacks
    ) -> t.List[str]:
        assert self.llm is not None, "LLM is not initialized"
        response: AnswersGenerated = await self.answer_generation_prompt.generate(
            data=SummaryAndQuestions(questions=questions, summary=summary),
            llm=self.llm,
            callbacks=callbacks,
        )
        return response.answers


summarization_score = SummarizationScore()
