import typing as t
from abc import ABC, abstractmethod
from dataclasses import dataclass

from langchain_core.callbacks import Callbacks

from ragas.dataset_schema import SingleMetricAnnotation
from ragas.llms.base import BaseRagasLLM
from ragas.losses import Loss
from ragas.metrics.base import MetricWithLLM
from ragas.run_config import RunConfig


@dataclass
class Optimizer(ABC):
    """
    Abstract base class for all optimizers.
    """

    metric: t.Optional[MetricWithLLM] = None
    llm: t.Optional[BaseRagasLLM] = None

    @abstractmethod
    def optimize(
        self,
        dataset: SingleMetricAnnotation,
        loss: Loss,
        config: t.Dict[t.Any, t.Any],
        run_config: t.Optional[RunConfig] = None,
        batch_size: t.Optional[int] = None,
        callbacks: t.Optional[Callbacks] = None,
        with_debugging_logs=False,
        raise_exceptions: bool = True,
    ) -> t.Dict[str, str]:
        """
        Optimizes the prompts for the given metric.

        Parameters
        ----------
        metric : MetricWithLLM
            The metric to optimize.
        train_data : Any
            The training data.
        config : InstructionConfig
            The training configuration.

        Returns
        -------
        Dict[str, str]
            The optimized prompts for given chain.
        """
        raise NotImplementedError("The method `optimize` must be implemented.")
