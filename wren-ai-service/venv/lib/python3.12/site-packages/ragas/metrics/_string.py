import typing as t
from dataclasses import dataclass, field
from enum import Enum

from langchain_core.callbacks import Callbacks

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import MetricType, SingleTurnMetric
from ragas.run_config import RunConfig


class DistanceMeasure(Enum):
    LEVENSHTEIN = "levenshtein"
    HAMMING = "hamming"
    JARO = "jaro"
    JARO_WINKLER = "jaro_winkler"


@dataclass
class ExactMatch(SingleTurnMetric):
    name: str = "exact_match"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )

    def init(self, run_config: RunConfig):
        pass

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        return float(sample.reference == sample.response)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)


@dataclass
class StringPresence(SingleTurnMetric):
    name: str = "string_present"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )

    def init(self, run_config: RunConfig):
        pass

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert isinstance(reference, str), "Expecting a string"
        assert isinstance(response, str), "Expecting a string"
        return float(reference in response)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)


@dataclass
class NonLLMStringSimilarity(SingleTurnMetric):
    name: str = "non_llm_string_similarity"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )
    distance_measure: DistanceMeasure = DistanceMeasure.LEVENSHTEIN

    def __post_init__(self):
        try:
            from rapidfuzz import distance
        except ImportError:
            raise ImportError(
                "rapidfuzz is required for string distance. Please install it using `pip install rapidfuzz`"
            )

        self.distance_measure_map = {
            DistanceMeasure.LEVENSHTEIN: distance.Levenshtein,
            DistanceMeasure.HAMMING: distance.Hamming,
            DistanceMeasure.JARO: distance.Jaro,
            DistanceMeasure.JARO_WINKLER: distance.JaroWinkler,
        }

    def init(self, run_config: RunConfig):
        pass

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert isinstance(reference, str), "Expecting a string"
        assert isinstance(response, str), "Expecting a string"
        return 1 - self.distance_measure_map[self.distance_measure].normalized_distance(
            reference, response
        )

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)
