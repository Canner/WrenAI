from __future__ import annotations

import typing as t
import warnings
from dataclasses import dataclass, field

from ragas.dataset_schema import MultiTurnSample, SingleTurnSample
from ragas.messages import AIMessage
from ragas.metrics._string import ExactMatch
from ragas.metrics.base import MetricType, MultiTurnMetric, SingleTurnMetric

if t.TYPE_CHECKING:
    from langchain_core.callbacks.base import Callbacks


@dataclass
class ToolCallAccuracy(MultiTurnMetric):
    name: str = "tool_call_accuracy"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {
            MetricType.MULTI_TURN: {
                "user_input",
                "reference_tool_calls",
            }
        }
    )

    arg_comparison_metric: SingleTurnMetric = field(
        default_factory=lambda: ExactMatch()
    )

    def init(self, run_config):
        pass

    async def _get_arg_score(
        self, preds: t.Dict[str, t.Any], refs: t.Dict[str, t.Any], callbacks: Callbacks
    ) -> float:
        if not refs and not preds:
            return 1.0
        if not refs:
            return 0.0

        score = 0.0
        for arg in refs.keys():
            if arg in preds:
                score += await self.arg_comparison_metric.single_turn_ascore(
                    SingleTurnSample(
                        response=str(preds[arg]), reference=str(refs[arg])
                    ),
                    callbacks,
                )

        return score / len(refs.keys())

    def is_sequence_aligned(
        self, pred_sequence: t.List[str], ref_sequence: t.List[str]
    ) -> bool:
        ref_index = 0  # Index to track position in reference sequence
        for pred in pred_sequence:
            if ref_index < len(ref_sequence) and pred == ref_sequence[ref_index]:
                ref_index += 1
            if ref_index == len(ref_sequence):
                return True
        return False

    async def _multi_turn_ascore(
        self, sample: MultiTurnSample, callbacks: Callbacks
    ) -> float:
        assert (
            sample.reference_tool_calls is not None
        ), "Reference tool calls is not set"

        pred_tool_calls = []
        for item in sample.user_input:
            if isinstance(item, AIMessage) and item.tool_calls is not None:
                pred_tool_calls.extend(item.tool_calls)

        tool_call_pred_sequence = [tool_call.name for tool_call in pred_tool_calls]
        tool_call_ref_sequence = [
            tool_call.name for tool_call in sample.reference_tool_calls
        ]

        sequence_aligned = int(
            self.is_sequence_aligned(tool_call_pred_sequence, tool_call_ref_sequence)
        )

        if pred_tool_calls:
            score = 0.0
            reference_tool_calls = sample.reference_tool_calls
            for ref_tool_call in reference_tool_calls:
                for pred_tool_call in pred_tool_calls:
                    if ref_tool_call.name == pred_tool_call.name:
                        arg_score = await self._get_arg_score(
                            pred_tool_call.args, ref_tool_call.args, callbacks
                        )
                        score += arg_score

            score /= len(reference_tool_calls)
        else:
            warnings.warn("No tool calls found in the user input")
            return 0.0

        return score * sequence_aligned

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await self._multi_turn_ascore(MultiTurnSample(**row), callbacks)
