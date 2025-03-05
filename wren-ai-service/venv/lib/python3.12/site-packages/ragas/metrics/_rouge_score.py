import typing as t
from dataclasses import dataclass, field

from langchain_core.callbacks import Callbacks

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import MetricType, SingleTurnMetric
from ragas.run_config import RunConfig


@dataclass
class RougeScore(SingleTurnMetric):
    name: str = "rouge_score"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )
    rouge_type: t.Literal["rouge1", "rougeL"] = "rougeL"
    measure_type: t.Literal["fmeasure", "precision", "recall"] = "fmeasure"

    def __post_init__(self):
        try:
            from rouge_score import rouge_scorer
        except ImportError as e:
            raise ImportError(
                f"{e.name} is required for rouge score. Please install it using `pip install {e.name}"
            )
        self.rouge_scorer = rouge_scorer

    def init(self, run_config: RunConfig):
        pass

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        assert isinstance(sample.reference, str), "Sample reference must be a string"
        assert isinstance(sample.response, str), "Sample response must be a string"
        scorer = self.rouge_scorer.RougeScorer([self.rouge_type], use_stemmer=True)
        scores = scorer.score(sample.reference, sample.response)
        return getattr(scores[self.rouge_type], self.measure_type)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)
