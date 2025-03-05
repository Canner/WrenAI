import logging
import typing as t
from dataclasses import dataclass, field
from io import StringIO

import numpy as np
from langchain_core.callbacks import Callbacks

from ragas.dataset_schema import SingleTurnSample
from ragas.metrics.base import MetricType, SingleTurnMetric
from ragas.run_config import RunConfig

logger = logging.getLogger(__name__)


@dataclass
class DataCompyScore(SingleTurnMetric):
    name: str = "data_compare_score"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )
    mode: t.Literal["rows", "columns"] = "rows"
    metric: t.Literal["precision", "recall", "f1"] = "f1"

    def __post_init__(self):
        try:
            import datacompy
            import pandas as pd
        except ImportError as e:
            raise ImportError(
                f"{e.name} is required for bleu score. Please install it using `pip install {e.name}`"
            )

        self.data_compare = datacompy
        self.pd = pd
        if self.mode not in ["rows", "columns"]:
            raise ValueError("Mode should be either rows or columns")

        if self.metric not in ["precision", "recall", "f1"]:
            raise ValueError("Metric should be either precision, recall or f1")

    def init(self, run_config: RunConfig):
        pass

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        reference = sample.reference
        response = sample.response
        assert isinstance(reference, str), "Expecting a string"
        assert isinstance(response, str), "Expecting a string"
        try:
            reference_df = self.pd.read_csv(StringIO(reference))
            response_df = self.pd.read_csv(StringIO(response))
        except Exception as e:
            logging.error(f"Error in reading csv: {e}")
            return np.nan

        compare = self.data_compare.Compare(reference_df, response_df, on_index=True)
        if self.mode == "rows":
            recall = compare.count_matching_rows() / reference_df.shape[0]
            precision = compare.count_matching_rows() / response_df.shape[0]
        else:
            matched_cols = len(
                [col for col in compare.column_stats if col["unequal_cnt"] == 0]
            )
            recall = matched_cols / reference_df.shape[1]
            precision = matched_cols / response_df.shape[1]

        if self.metric == "precision":
            return precision
        elif self.metric == "recall":
            return recall
        else:
            return 2 * (precision * recall) / (precision + recall)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._single_turn_ascore(SingleTurnSample(**row), callbacks)
