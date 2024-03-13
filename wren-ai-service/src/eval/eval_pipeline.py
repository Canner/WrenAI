from typing import Any, Dict, List, Optional

from haystack import Pipeline
from haystack_integrations.components.evaluators.ragas import (
    RagasEvaluator,
    RagasMetric,
)

from src.core.pipeline import BasicPipeline


class Evaluation(BasicPipeline):
    def __init__(
        self,
        metrics: Optional[List[RagasMetric]] = [
            RagasMetric.ANSWER_CORRECTNESS,
            # RagasMetric.FAITHFULNESS,  # Not supported at the moment
            RagasMetric.ANSWER_SIMILARITY,
            RagasMetric.CONTEXT_UTILIZATION,
            RagasMetric.CONTEXT_PRECISION,
            RagasMetric.CONTEXT_RECALL,
            # RagasMetric.ASPECT_CRITIQUE,  # Not supported at the moment
            RagasMetric.CONTEXT_RELEVANCY,
            RagasMetric.ANSWER_RELEVANCY,
        ],
        metric_params: Optional[Dict[str, Any]] = None,
    ):
        self._pipeline = Pipeline()
        self.component_names = []

        for metric in metrics:
            component_name = f"evaluator_{metric.name}"
            self._pipeline.add_component(
                component_name,
                RagasEvaluator(
                    metric=metric,
                    metric_params=metric_params[metric.name] if metric_params else None,
                ),
            )
            self.component_names.append(component_name)

    def run(self, data) -> Dict[str, Any]:
        return self._pipeline.run(data)
