from typing import Optional, List, Union

import numpy as np

from qdrant_client.http import models
from qdrant_client.conversions import common_types as types
from qdrant_client.local.distances import (
    distance_to_order,
    DistanceOrder,
    calculate_distance,
    scaled_fast_sigmoid,
    EPSILON,
    fast_sigmoid,
)


class MultiRecoQuery:
    def __init__(
        self,
        positive: Optional[List[List[List[float]]]] = None,  # list of matrices
        negative: Optional[List[List[List[float]]]] = None,  # list of matrices
    ):
        positive = positive if positive is not None else []
        negative = negative if negative is not None else []

        self.positive: List[types.NumpyArray] = [np.array(vector) for vector in positive]
        self.negative: List[types.NumpyArray] = [np.array(vector) for vector in negative]

        assert not np.isnan(self.positive).any(), "Positive vectors must not contain NaN"
        assert not np.isnan(self.negative).any(), "Negative vectors must not contain NaN"


class MultiContextPair:
    def __init__(self, positive: List[List[float]], negative: List[List[float]]):
        self.positive: types.NumpyArray = np.array(positive)
        self.negative: types.NumpyArray = np.array(negative)

        assert not np.isnan(self.positive).any(), "Positive vector must not contain NaN"
        assert not np.isnan(self.negative).any(), "Negative vector must not contain NaN"


class MultiDiscoveryQuery:
    def __init__(self, target: List[List[float]], context: List[MultiContextPair]):
        self.target: types.NumpyArray = np.array(target)
        self.context = context

        assert not np.isnan(self.target).any(), "Target vector must not contain NaN"


class MultiContextQuery:
    def __init__(self, context_pairs: List[MultiContextPair]):
        self.context_pairs = context_pairs


MultiQueryVector = Union[
    MultiDiscoveryQuery,
    MultiContextQuery,
    MultiRecoQuery,
]


def calculate_multi_distance(
    query_matrix: types.NumpyArray,
    matrices: List[types.NumpyArray],
    distance_type: models.Distance,
) -> types.NumpyArray:
    assert not np.isnan(query_matrix).any(), "Query matrix must not contain NaN"
    assert len(query_matrix.shape) == 2, "Query must be a matrix"

    reverse = distance_to_order(distance_type) == DistanceOrder.SMALLER_IS_BETTER
    similarities: List[float] = []
    # max sim
    for matrix in matrices:
        sim_matrix = calculate_distance(query_matrix, matrix, distance_type)
        op = np.max if not reverse else np.min
        similarity = float(np.sum(op(sim_matrix, axis=-1)))
        similarities.append(similarity)
    return np.array(similarities)


def calculate_multi_distance_core(
    query_matrix: types.NumpyArray,
    matrices: List[types.NumpyArray],
    distance_type: models.Distance,
) -> types.NumpyArray:
    def euclidean(m: types.NumpyArray, q: types.NumpyArray) -> types.NumpyArray:
        return -np.square(m - q, dtype=np.float32).sum(axis=1, dtype=np.float32)

    def manhattan(m: types.NumpyArray, q: types.NumpyArray) -> types.NumpyArray:
        return -np.abs(m - q, dtype=np.float32).sum(axis=1, dtype=np.float32)

    assert not np.isnan(query_matrix).any(), "Query vector must not contain NaN"
    if distance_type in [models.Distance.EUCLID, models.Distance.MANHATTAN]:
        query_matrix = query_matrix[:, np.newaxis]
        similarities: List[float] = []
        dist_func = euclidean if distance_type == models.Distance.EUCLID else manhattan
        for matrix in matrices:
            sim_matrix = dist_func(matrix, query_matrix)
            similarity = float(np.sum(np.max(sim_matrix, axis=-1)))
            similarities.append(similarity)
        return np.array(similarities)

    return calculate_multi_distance(query_matrix, matrices, distance_type)


def calculate_multi_recommend_best_scores(
    query: MultiRecoQuery, matrices: List[types.NumpyArray], distance_type: models.Distance
) -> types.NumpyArray:
    def get_best_scores(examples: List[types.NumpyArray]) -> types.NumpyArray:
        matrix_count = len(matrices)

        # Get scores to all examples
        scores: List[types.NumpyArray] = []
        for example in examples:
            score = calculate_multi_distance_core(example, matrices, distance_type)
            scores.append(score)

        # Keep only max for each vector
        if len(scores) == 0:
            scores.append(np.full(matrix_count, -np.inf))
        best_scores = np.array(scores, dtype=np.float32).max(axis=0)

        return best_scores

    pos = get_best_scores(query.positive)
    neg = get_best_scores(query.negative)

    # Choose from the best positive or the best negative,
    # in both cases we apply sigmoid and then negate depending on the order
    return np.where(
        pos > neg,
        np.fromiter((scaled_fast_sigmoid(xi) for xi in pos), pos.dtype),
        np.fromiter((-scaled_fast_sigmoid(xi) for xi in neg), neg.dtype),
    )


def calculate_multi_discovery_ranks(
    context: List[MultiContextPair],
    matrices: List[types.NumpyArray],
    distance_type: models.Distance,
) -> types.NumpyArray:
    overall_ranks = np.zeros(len(matrices), dtype=np.int32)
    for pair in context:
        # Get distances to positive and negative vectors
        pos = calculate_multi_distance_core(pair.positive, matrices, distance_type)
        neg = calculate_multi_distance_core(pair.negative, matrices, distance_type)

        pair_ranks = np.array(
            [
                1 if is_bigger else 0 if is_equal else -1
                for is_bigger, is_equal in zip(pos > neg, pos == neg)
            ]
        )

        overall_ranks += pair_ranks

    return overall_ranks


def calculate_multi_discovery_scores(
    query: MultiDiscoveryQuery, matrices: List[types.NumpyArray], distance_type: models.Distance
) -> types.NumpyArray:
    ranks = calculate_multi_discovery_ranks(query.context, matrices, distance_type)

    # Get distances to target
    distances_to_target = calculate_multi_distance_core(query.target, matrices, distance_type)

    sigmoided_distances = np.fromiter(
        (scaled_fast_sigmoid(xi) for xi in distances_to_target), np.float32
    )

    return ranks + sigmoided_distances


def calculate_multi_context_scores(
    query: MultiContextQuery, matrices: List[types.NumpyArray], distance_type: models.Distance
) -> types.NumpyArray:
    overall_scores = np.zeros(len(matrices), dtype=np.float32)
    for pair in query.context_pairs:
        # Get distances to positive and negative vectors
        pos = calculate_multi_distance_core(pair.positive, matrices, distance_type)
        neg = calculate_multi_distance_core(pair.negative, matrices, distance_type)

        difference = pos - neg - EPSILON
        pair_scores = np.fromiter(
            (fast_sigmoid(xi) for xi in np.minimum(difference, 0.0)), np.float32
        )
        overall_scores += pair_scores

    return overall_scores
