from __future__ import annotations

import logging
import typing as t

from datasets import Dataset, Sequence

from ragas.dataset_schema import EvaluationDataset, MultiTurnSample, SingleTurnSample
from ragas.metrics.base import Metric, MetricType, MultiTurnMetric, SingleTurnMetric

logger = logging.getLogger(__name__)


def remap_column_names(dataset: Dataset, column_map: dict[str, str]) -> Dataset:
    """
    Remap the column names in case dataset uses different column names
    """

    inverse_column_map = {v: k for k, v in column_map.items()}
    return dataset.rename_columns(inverse_column_map)


def handle_deprecated_ground_truths(ds: Dataset) -> Dataset:
    if "ground_truths" in ds.features and "ground_truth" not in ds.features:
        column_names = "ground_truths"
        if (
            isinstance(ds.features[column_names], Sequence)
            and ds.features[column_names].feature.dtype == "string"
        ):
            logger.warning(
                "passing column names as 'ground_truths' is deprecated and will be removed in the next version, please use 'ground_truth' instead. Note that `ground_truth` should be of type string and not Sequence[string] like `ground_truths`"
            )
            gt = [gt[0] for gt in ds["ground_truths"]]
            ds = ds.add_column(
                "ground_truth",
                gt,
                new_fingerprint=ds._fingerprint
                + "a",  # adding random to fingerprint to avoid caching
            )
    return ds


def get_supported_metric_type(ds: EvaluationDataset):
    """
    get the supported metric type for the given dataset
    """

    sample_type = ds.get_sample_type()
    if sample_type == SingleTurnSample:
        return MetricType.SINGLE_TURN.name
    elif sample_type == MultiTurnSample:
        return MetricType.MULTI_TURN.name
    else:
        raise ValueError(f"Unsupported sample type {sample_type}")


def validate_required_columns(ds: EvaluationDataset, metrics: t.Sequence[Metric]):
    metric_type = get_supported_metric_type(ds)
    for m in metrics:
        required_columns = set(m.required_columns.get(metric_type, []))
        available_columns = set(ds.features())
        if not required_columns.issubset(available_columns):
            raise ValueError(
                f"The metric [{m.name}] that is used requires the following "
                f"additional columns {list(required_columns - available_columns)} "
                f"to be present in the dataset."
            )


def validate_supported_metrics(ds: EvaluationDataset, metrics: t.Sequence[Metric]):
    data_type = ds.get_sample_type()
    for m in metrics:
        if data_type == SingleTurnSample:
            flag = isinstance(m, SingleTurnMetric)
        elif data_type == MultiTurnSample:
            flag = isinstance(m, MultiTurnMetric)
        else:
            raise ValueError(f"Unsupported sample type {data_type}")

        if not flag:
            raise ValueError(
                f"The metric '{m.name}' does not support the sample type {data_type}."
            )
