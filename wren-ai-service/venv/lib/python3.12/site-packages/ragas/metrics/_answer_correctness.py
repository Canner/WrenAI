from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field

import numpy as np
from pydantic import BaseModel

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics._answer_similarity import AnswerSimilarity
from ragas.metrics._faithfulness import (
    StatementGeneratorInput,
    StatementGeneratorOutput,
    StatementGeneratorPrompt,
)
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithEmbeddings,
    MetricWithLLM,
    SingleTurnMetric,
)
from ragas.metrics.utils import fbeta_score
from ragas.prompt import PydanticPrompt
from ragas.run_config import RunConfig

if t.TYPE_CHECKING:
    from langchain_core.callbacks import Callbacks

logger = logging.getLogger(__name__)


class QuestionAnswerGroundTruth(BaseModel):
    question: str
    answer: list[str]
    ground_truth: list[str]


class StatementsWithReason(BaseModel):
    statement: str
    reason: str


class ClassificationWithReason(BaseModel):
    TP: list[StatementsWithReason]
    FP: list[StatementsWithReason]
    FN: list[StatementsWithReason]


class CorrectnessClassifier(
    PydanticPrompt[QuestionAnswerGroundTruth, ClassificationWithReason]
):
    instruction = "Given a ground truth and an answer statements, analyze each statement and classify them in one of the following categories: TP (true positive): statements that are present in answer that are also directly supported by the one or more statements in ground truth, FP (false positive): statements present in the answer but not directly supported by any statement in ground truth, FN (false negative): statements found in the ground truth but not present in answer. Each statement can only belong to one of the categories. Provide a reason for each classification."
    input_model = QuestionAnswerGroundTruth
    output_model = ClassificationWithReason
    examples = [
        (
            QuestionAnswerGroundTruth(
                question="What powers the sun and what is its primary function?",
                answer=[
                    "The sun is powered by nuclear fission, similar to nuclear reactors on Earth.",
                    "The primary function of the sun is to provide light to the solar system.",
                ],
                ground_truth=[
                    "The sun is powered by nuclear fusion, where hydrogen atoms fuse to form helium.",
                    "This fusion process in the sun's core releases a tremendous amount of energy.",
                    "The energy from the sun provides heat and light, which are essential for life on Earth.",
                    "The sun's light plays a critical role in Earth's climate system.",
                    "Sunlight helps to drive the weather and ocean currents.",
                ],
            ),
            ClassificationWithReason(
                TP=[
                    StatementsWithReason(
                        statement="The primary function of the sun is to provide light to the solar system.",
                        reason="This statement is somewhat supported by the ground truth mentioning the sun providing light and its roles, though it focuses more broadly on the sun's energy.",
                    )
                ],
                FP=[
                    StatementsWithReason(
                        statement="The sun is powered by nuclear fission, similar to nuclear reactors on Earth.",
                        reason="This statement is incorrect and contradicts the ground truth which states that the sun is powered by nuclear fusion.",
                    )
                ],
                FN=[
                    StatementsWithReason(
                        statement="The sun is powered by nuclear fusion, where hydrogen atoms fuse to form helium.",
                        reason="This accurate description of the sun’s power source is not included in the answer.",
                    ),
                    StatementsWithReason(
                        statement="This fusion process in the sun's core releases a tremendous amount of energy.",
                        reason="This process and its significance are not mentioned in the answer.",
                    ),
                    StatementsWithReason(
                        statement="The energy from the sun provides heat and light, which are essential for life on Earth.",
                        reason="The answer only mentions light, omitting the essential aspects of heat and its necessity for life, which the ground truth covers.",
                    ),
                    StatementsWithReason(
                        statement="The sun's light plays a critical role in Earth's climate system.",
                        reason="This broader impact of the sun’s light on Earth's climate system is not addressed in the answer.",
                    ),
                    StatementsWithReason(
                        statement="Sunlight helps to drive the weather and ocean currents.",
                        reason="The effect of sunlight on weather patterns and ocean currents is omitted in the answer.",
                    ),
                ],
            ),
        ),
        (
            QuestionAnswerGroundTruth(
                question="What is the boiling point of water?",
                answer=[
                    "The boiling point of water is 100 degrees Celsius at sea level"
                ],
                ground_truth=[
                    "The boiling point of water is 100 degrees Celsius (212 degrees Fahrenheit) at sea level.",
                    "The boiling point of water can change with altitude.",
                ],
            ),
            ClassificationWithReason(
                TP=[
                    StatementsWithReason(
                        statement="The boiling point of water is 100 degrees Celsius at sea level",
                        reason="This statement is directly supported by the ground truth which specifies the boiling point of water as 100 degrees Celsius at sea level.",
                    )
                ],
                FP=[],
                FN=[
                    StatementsWithReason(
                        statement="The boiling point of water can change with altitude.",
                        reason="This additional information about how the boiling point of water can vary with altitude is not mentioned in the answer.",
                    )
                ],
            ),
        ),
    ]


@dataclass
class AnswerCorrectness(MetricWithLLM, MetricWithEmbeddings, SingleTurnMetric):
    """
    Measures answer correctness compared to ground truth as a combination of
    factuality and semantic similarity.

    Attributes
    ----------
    name: string
        The name of the metrics
    weights:
        a list of two weights corresponding to factuality and semantic similarity
        Defaults [0.75, 0.25]
    answer_similarity:
        The AnswerSimilarity object
    """

    name: str = "answer_correctness"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.SINGLE_TURN: {"user_input", "response", "reference"}
        }
    )
    output_type = MetricOutputType.CONTINUOUS
    correctness_prompt: PydanticPrompt = field(default_factory=CorrectnessClassifier)
    statement_generator_prompt: PydanticPrompt = field(
        default_factory=StatementGeneratorPrompt
    )
    weights: list[float] = field(default_factory=lambda: [0.75, 0.25])
    beta: float = 1.0
    answer_similarity: t.Optional[AnswerSimilarity] = None
    max_retries: int = 1

    def __post_init__(self):
        if len(self.weights) != 2:
            raise ValueError(
                "Expects a list of two weights. First for factuality, second for semantic similarity"
            )
        if all([w == 0 for w in self.weights]):
            raise ValueError("At least one weight must be non-zero")
        if not all([w >= 0 for w in self.weights]):
            raise ValueError("Weights must be non-negative")

        if type(self.beta) is not float:
            raise ValueError(
                "Beta must be a float. A beta > 1 gives more weight to recall, while beta < 1 favors precision."
            )

    def init(self, run_config: RunConfig):
        super().init(run_config)
        if self.answer_similarity is None and self.weights[1] != 0:
            self.answer_similarity = AnswerSimilarity(embeddings=self.embeddings)

    def _compute_statement_presence(
        self, prediction: ClassificationWithReason
    ) -> float:
        tp = len(prediction.TP)
        fp = len(prediction.FP)
        fn = len(prediction.FN)
        score = fbeta_score(tp, fp, fn, self.beta)
        return score

    async def _create_simplified_statements(
        self, question: str, text: str, callbacks: Callbacks
    ) -> StatementGeneratorOutput:
        assert self.llm is not None, "llm is not set"

        prompt_input = StatementGeneratorInput(question=question, answer=text)
        statements = await self.statement_generator_prompt.generate(
            llm=self.llm,
            data=prompt_input,
            callbacks=callbacks,
        )

        return statements

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        score = await self._ascore(row, callbacks)
        return score

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.llm is not None, "LLM must be set"

        # extract the statements from the answer and the ground truth
        question = row["user_input"]
        statements: t.Dict[str, t.List[str]] = {}
        for item in ["response", "reference"]:
            statements_x = await self._create_simplified_statements(
                question, row[item], callbacks
            )
            statements_x = statements_x.statements
            statements[item] = statements_x

        if not all([val == [] for val in statements.values()]):
            ground_truth = [statement for statement in statements["reference"]]
            answer = [statement for statement in statements["response"]]
            answers = await self.correctness_prompt.generate(
                llm=self.llm,
                data=QuestionAnswerGroundTruth(
                    question=question,
                    answer=answer,
                    ground_truth=ground_truth,
                ),
                callbacks=callbacks,
            )
            if answers is None:
                return np.nan

            f1_score = self._compute_statement_presence(answers)
        else:
            f1_score = 1.0

        if self.weights[1] == 0:
            similarity_score = 0.0
        else:
            assert self.answer_similarity is not None, "AnswerSimilarity must be set"

            similarity_score = await self.answer_similarity.ascore(
                row, callbacks=callbacks
            )

        score = np.average(
            [f1_score, similarity_score],
            weights=self.weights,
        )

        return float(score)


answer_correctness = AnswerCorrectness()
