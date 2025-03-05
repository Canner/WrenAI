from typing import List

import numpy as np

from qdrant_client.http import models
from qdrant_client.hybrid.fusion import reciprocal_rank_fusion, distribution_based_score_fusion


def test_reciprocal_rank_fusion() -> None:
    responses = [
        [
            models.ScoredPoint(id="1", score=0.1, version=1),
            models.ScoredPoint(id="2", score=0.2, version=1),
            models.ScoredPoint(id="3", score=0.3, version=1),
        ],
        [
            models.ScoredPoint(id="5", score=12.0, version=1),
            models.ScoredPoint(id="6", score=8.0, version=1),
            models.ScoredPoint(id="7", score=5.0, version=1),
            models.ScoredPoint(id="2", score=3.0, version=1),
        ],
    ]

    fused = reciprocal_rank_fusion(responses)

    assert fused[0].id == "2"
    assert fused[1].id in ["1", "5"]
    assert np.isclose(fused[1].score, 1 / 2)
    assert fused[2].id in ["1", "5"]
    assert np.isclose(fused[2].score, 1 / 2)


def test_distribution_based_score_fusion() -> None:
    responses = [
        [
            models.ScoredPoint(id=1, version=0, score=85.0),
            models.ScoredPoint(id=0, version=0, score=76.0),
            models.ScoredPoint(id=5, version=0, score=68.0),
        ],
        [
            models.ScoredPoint(id=1, version=0, score=62.0),
            models.ScoredPoint(id=0, version=0, score=61.0),
            models.ScoredPoint(id=4, version=0, score=57.0),
            models.ScoredPoint(id=3, version=0, score=51.0),
            models.ScoredPoint(id=2, version=0, score=44.0),
        ],
    ]

    fused = distribution_based_score_fusion(responses, limit=3)

    assert fused[0].id == 1
    assert fused[1].id == 0
    assert fused[2].id == 4


def test_reciprocal_rank_fusion_empty_responses() -> None:
    responses: List[List[models.ScoredPoint]] = [[]]
    fused = reciprocal_rank_fusion(responses)
    assert fused == []

    responses = [
        [
            models.ScoredPoint(id="1", score=0.1, version=1),
            models.ScoredPoint(id="2", score=0.2, version=1),
            models.ScoredPoint(id="3", score=0.3, version=1),
        ],
        [],
    ]

    fused = reciprocal_rank_fusion(responses)

    assert fused[0].id == "1"
    assert np.isclose(fused[0].score, 1 / 2)
    assert fused[1].id == "2"
    assert np.isclose(fused[1].score, 1 / 3)
    assert fused[2].id == "3"
    assert np.isclose(fused[2].score, 1 / 4)


def test_distribution_based_score_fusion_empty_response() -> None:
    responses: List[List[models.ScoredPoint]] = [[]]
    fused = distribution_based_score_fusion(responses, limit=3)
    assert fused == []

    responses = [
        [
            models.ScoredPoint(id=1, version=0, score=85.0),
            models.ScoredPoint(id=0, version=0, score=76.0),
            models.ScoredPoint(id=5, version=0, score=68.0),
        ],
        [],
    ]

    fused = distribution_based_score_fusion(responses, limit=3)

    assert fused[0].id == 1
    assert fused[1].id == 0
    assert fused[2].id == 5
