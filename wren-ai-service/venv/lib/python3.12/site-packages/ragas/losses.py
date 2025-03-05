import typing as t
from abc import ABC, abstractmethod

from pydantic import GetCoreSchemaHandler
from pydantic_core import CoreSchema, core_schema


class Loss(ABC):
    """
    Abstract base class for all loss functions.
    """

    @abstractmethod
    def __call__(self, predicted: t.List, actual: t.List) -> float:
        raise NotImplementedError

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: t.Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        """
        Define how Pydantic generates a schema for BaseRagasEmbeddings.
        """
        return core_schema.no_info_after_validator_function(
            cls, core_schema.is_instance_schema(cls)  # The validator function
        )


class MSELoss(Loss):
    """
    Mean Squared Error loss function.
    """

    reduction: t.Literal["mean", "sum"] = "mean"

    def __call__(self, predicted: t.List[float], actual: t.List[float]) -> float:

        errors = [(p - a) ** 2 for p, a in zip(predicted, actual)]
        if self.reduction == "mean":
            return sum(errors) / len(errors)
        elif self.reduction == "sum":
            return sum(errors)
        else:
            raise ValueError(f"Invalid reduction method: {self.reduction}")


class BinaryMetricLoss(Loss):
    """
    Computes the loss for binary metrics.
    Supports accuracy and F1-score.
    """

    metric: t.Literal["accuracy", "f1_score"] = "accuracy"

    def __call__(self, predicted: t.List[int], actual: t.List[int]) -> float:
        """
        Computes the loss using the specified reduction.

        Parameters
        ----------
        predicted : list[int]
            List of predicted binary values (0 or 1).
        actual : list[int]
            List of actual binary values (0 or 1).

        Returns
        -------
        float
            The computed loss based on the reduction type.
        """
        if len(predicted) != len(actual):
            raise ValueError("Predicted and actual lists must have the same length.")

        if self.metric == "accuracy":
            return self._accuracy(predicted, actual)
        elif self.metric == "f1_score":
            return self._f1_score(predicted, actual)
        else:
            raise ValueError(f"Unsupported reduction type: {self.metric}")

    def _accuracy(self, predicted: list[int], actual: t.List[int]) -> float:
        """
        Computes accuracy as the reduction operation.

        Returns
        -------
        float
            Accuracy (proportion of correct predictions).
        """
        correct = sum(p == a for p, a in zip(predicted, actual))
        return correct / len(actual)

    def _f1_score(self, predicted: t.List[int], actual: t.List[int]) -> float:
        """
        Computes F1-score as the reduction operation.

        Returns
        -------
        float
            The F1-score.
        """
        tp = sum(p == 1 and a == 1 for p, a in zip(predicted, actual))
        fp = sum(p == 1 and a == 0 for p, a in zip(predicted, actual))
        fn = sum(p == 0 and a == 1 for p, a in zip(predicted, actual))

        precision = tp / (tp + fp) if tp + fp > 0 else 0
        recall = tp / (tp + fn) if tp + fn > 0 else 0
        f1 = (
            (2 * precision * recall) / (precision + recall)
            if precision + recall > 0
            else 0
        )
        return f1
