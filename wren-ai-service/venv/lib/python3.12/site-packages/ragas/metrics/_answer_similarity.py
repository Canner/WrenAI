from __future__ import annotations

import logging
import typing as t
from dataclasses import dataclass, field

import numpy as np

from ragas.dataset_schema import SingleTurnSample
from ragas.embeddings.base import HuggingfaceEmbeddings
from ragas.metrics.base import (
    MetricOutputType,
    MetricType,
    MetricWithEmbeddings,
    SingleTurnMetric,
)

if t.TYPE_CHECKING:
    from langchain_core.callbacks.base import Callbacks


logger = logging.getLogger(__name__)


@dataclass
class SemanticSimilarity(MetricWithEmbeddings, SingleTurnMetric):
    """
    Scores the semantic similarity of ground truth with generated answer.
    cross encoder score is used to quantify semantic similarity.
    SAS paper: https://arxiv.org/pdf/2108.06130.pdf

    Attributes
    ----------
    name : str
    model_name:
        The model to be used for calculating semantic similarity
        Defaults open-ai-embeddings
        select cross-encoder model for best results
        https://huggingface.co/spaces/mteb/leaderboard
    threshold:
        The threshold if given used to map output to binary
        Default 0.5
    """

    name: str = "semantic_similarity"
    _required_columns: t.Dict[MetricType, t.Set[str]] = field(
        default_factory=lambda: {MetricType.SINGLE_TURN: {"reference", "response"}}
    )
    output_type = MetricOutputType.CONTINUOUS
    is_cross_encoder: bool = False
    threshold: t.Optional[float] = None

    def __post_init__(self):
        # only for cross encoder
        if isinstance(self.embeddings, HuggingfaceEmbeddings):
            self.is_cross_encoder = True if self.embeddings.is_cross_encoder else False
            self.embeddings.encode_kwargs = {
                **self.embeddings.encode_kwargs,
            }

    async def _single_turn_ascore(
        self, sample: SingleTurnSample, callbacks: Callbacks
    ) -> float:
        row = sample.to_dict()
        return await self._ascore(row, callbacks)

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        assert self.embeddings is not None, "embeddings must be set"

        ground_truth = t.cast(str, row["reference"])
        answer = t.cast(str, row["response"])

        # Handle embeddings for empty strings
        ground_truth = ground_truth or " "
        answer = answer or " "

        if self.is_cross_encoder and isinstance(self.embeddings, HuggingfaceEmbeddings):
            raise NotImplementedError(
                "async score [ascore()] not implemented for HuggingFace embeddings"
            )
        else:
            embedding_1 = np.array(await self.embeddings.embed_text(ground_truth))
            embedding_2 = np.array(await self.embeddings.embed_text(answer))
            # Normalization factors of the above embeddings
            norms_1 = np.linalg.norm(embedding_1, keepdims=True)
            norms_2 = np.linalg.norm(embedding_2, keepdims=True)
            embedding_1_normalized = embedding_1 / norms_1
            embedding_2_normalized = embedding_2 / norms_2
            similarity = embedding_1_normalized @ embedding_2_normalized.T
            score = similarity.flatten()

        assert isinstance(score, np.ndarray), "Expects ndarray"
        if self.threshold:
            score = score >= self.threshold

        return score.tolist()[0]


class AnswerSimilarity(SemanticSimilarity):
    name: str = "answer_similarity"

    async def _ascore(self, row: t.Dict, callbacks: Callbacks) -> float:
        return await super()._ascore(row, callbacks)


answer_similarity = AnswerSimilarity()
