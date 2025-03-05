from enum import Enum
from typing import List, Optional, Union

import numpy as np

from qdrant_client.conversions import common_types as types
from qdrant_client.http import models

EPSILON = 1.1920929e-7  # https://doc.rust-lang.org/std/f32/constant.EPSILON.html
# https://github.com/qdrant/qdrant/blob/7164ac4a5987d28f1c93f5712aef8e09e7d93555/lib/segment/src/spaces/simple_avx.rs#L99C10-L99C10


class DistanceOrder(str, Enum):
    BIGGER_IS_BETTER = "bigger_is_better"
    SMALLER_IS_BETTER = "smaller_is_better"


class RecoQuery:
    def __init__(
        self,
        positive: Optional[List[List[float]]] = None,
        negative: Optional[List[List[float]]] = None,
    ):
        positive = positive if positive is not None else []
        negative = negative if negative is not None else []

        self.positive: List[types.NumpyArray] = [np.array(vector) for vector in positive]
        self.negative: List[types.NumpyArray] = [np.array(vector) for vector in negative]

        assert not np.isnan(self.positive).any(), "Positive vectors must not contain NaN"
        assert not np.isnan(self.negative).any(), "Negative vectors must not contain NaN"


class ContextPair:
    def __init__(self, positive: List[float], negative: List[float]):
        self.positive: types.NumpyArray = np.array(positive)
        self.negative: types.NumpyArray = np.array(negative)

        assert not np.isnan(self.positive).any(), "Positive vector must not contain NaN"
        assert not np.isnan(self.negative).any(), "Negative vector must not contain NaN"


class DiscoveryQuery:
    def __init__(self, target: List[float], context: List[ContextPair]):
        self.target: types.NumpyArray = np.array(target)
        self.context = context

        assert not np.isnan(self.target).any(), "Target vector must not contain NaN"


class ContextQuery:
    def __init__(self, context_pairs: List[ContextPair]):
        self.context_pairs = context_pairs


DenseQueryVector = Union[
    DiscoveryQuery,
    ContextQuery,
    RecoQuery,
]


def distance_to_order(distance: models.Distance) -> DistanceOrder:
    """
    Convert distance to order
    Args:
        distance: distance to convert
    Returns:
        order
    """
    if distance == models.Distance.EUCLID:
        return DistanceOrder.SMALLER_IS_BETTER
    elif distance == models.Distance.MANHATTAN:
        return DistanceOrder.SMALLER_IS_BETTER

    return DistanceOrder.BIGGER_IS_BETTER


def cosine_similarity(query: types.NumpyArray, vectors: types.NumpyArray) -> types.NumpyArray:
    """
    Calculate cosine distance between query and vectors
    Args:
        query: query vector
        vectors: vectors to calculate distance with
    Returns:
        distances
    """
    vectors_norm = np.linalg.norm(vectors, axis=-1)[:, np.newaxis]
    vectors /= np.where(vectors_norm != 0.0, vectors_norm, EPSILON)

    if len(query.shape) == 1:
        query_norm = np.linalg.norm(query)
        query /= np.where(query_norm != 0.0, query_norm, EPSILON)
        return np.dot(vectors, query)

    query_norm = np.linalg.norm(query, axis=-1)[:, np.newaxis]
    query /= np.where(query_norm != 0.0, query_norm, EPSILON)
    return np.dot(query, vectors.T)


def dot_product(query: types.NumpyArray, vectors: types.NumpyArray) -> types.NumpyArray:
    """
    Calculate dot product between query and vectors
    Args:
        query: query vector.
        vectors: vectors to calculate distance with
    Returns:
        distances
    """
    if len(query.shape) == 1:
        return np.dot(vectors, query)
    else:
        return np.dot(query, vectors.T)


def euclidean_distance(query: types.NumpyArray, vectors: types.NumpyArray) -> types.NumpyArray:
    """
    Calculate euclidean distance between query and vectors
    Args:
        query: query vector.
        vectors: vectors to calculate distance with
    Returns:
        distances
    """
    if len(query.shape) == 1:
        return np.linalg.norm(vectors - query, axis=-1)
    else:
        return np.linalg.norm(vectors - query[:, np.newaxis], axis=-1)


def manhattan_distance(query: types.NumpyArray, vectors: types.NumpyArray) -> types.NumpyArray:
    """
    Calculate manhattan distance between query and vectors
    Args:
        query: query vector.
        vectors: vectors to calculate distance with
    Returns:
        distances
    """
    if len(query.shape) == 1:
        return np.sum(np.abs(vectors - query), axis=-1)
    else:
        return np.sum(np.abs(vectors - query[:, np.newaxis]), axis=-1)


def calculate_distance(
    query: types.NumpyArray, vectors: types.NumpyArray, distance_type: models.Distance
) -> types.NumpyArray:
    assert not np.isnan(query).any(), "Query vector must not contain NaN"

    if distance_type == models.Distance.COSINE:
        return cosine_similarity(query, vectors)
    elif distance_type == models.Distance.DOT:
        return dot_product(query, vectors)
    elif distance_type == models.Distance.EUCLID:
        return euclidean_distance(query, vectors)
    elif distance_type == models.Distance.MANHATTAN:
        return manhattan_distance(query, vectors)
    else:
        raise ValueError(f"Unknown distance type {distance_type}")


def calculate_distance_core(
    query: types.NumpyArray, vectors: types.NumpyArray, distance_type: models.Distance
) -> types.NumpyArray:
    """
    Calculate same internal distances as in core, rather than the final displayed distance
    """
    assert not np.isnan(query).any(), "Query vector must not contain NaN"

    if distance_type == models.Distance.EUCLID:
        return -np.square(vectors - query, dtype=np.float32).sum(axis=1, dtype=np.float32)
    if distance_type == models.Distance.MANHATTAN:
        return -np.abs(vectors - query, dtype=np.float32).sum(axis=1, dtype=np.float32)
    else:
        return calculate_distance(query, vectors, distance_type)


def fast_sigmoid(x: np.float32) -> np.float32:
    if np.isnan(x) or np.isinf(x):
        # To avoid divisions on NaNs or inf, which gets: RuntimeWarning: invalid value encountered in scalar divide
        return x
    return x / np.add(1.0, abs(x))


def scaled_fast_sigmoid(x: np.float32) -> np.float32:
    return 0.5 * (np.add(fast_sigmoid(x), 1.0))


def calculate_recommend_best_scores(
    query: RecoQuery, vectors: types.NumpyArray, distance_type: models.Distance
) -> types.NumpyArray:
    def get_best_scores(examples: List[types.NumpyArray]) -> types.NumpyArray:
        vector_count = vectors.shape[0]

        # Get scores to all examples
        scores: List[types.NumpyArray] = []
        for example in examples:
            score = calculate_distance_core(example, vectors, distance_type)
            scores.append(score)

        # Keep only max for each vector
        if len(scores) == 0:
            scores.append(np.full(vector_count, -np.inf))
        best_scores = np.array(scores, dtype=np.float32).max(axis=0)

        return best_scores

    pos = get_best_scores(query.positive)
    neg = get_best_scores(query.negative)

    # Choose from best positive or best negative,
    # in in both cases we apply sigmoid and then negate depending on the order
    return np.where(
        pos > neg,
        np.fromiter((scaled_fast_sigmoid(xi) for xi in pos), pos.dtype),
        np.fromiter((-scaled_fast_sigmoid(xi) for xi in neg), neg.dtype),
    )


def calculate_discovery_ranks(
    context: List[ContextPair],
    vectors: types.NumpyArray,
    distance_type: models.Distance,
) -> types.NumpyArray:
    overall_ranks = np.zeros(vectors.shape[0], dtype=np.int32)
    for pair in context:
        # Get distances to positive and negative vectors
        pos = calculate_distance_core(pair.positive, vectors, distance_type)
        neg = calculate_distance_core(pair.negative, vectors, distance_type)

        pair_ranks = np.array(
            [
                1 if is_bigger else 0 if is_equal else -1
                for is_bigger, is_equal in zip(pos > neg, pos == neg)
            ]
        )

        overall_ranks += pair_ranks

    return overall_ranks


def calculate_discovery_scores(
    query: DiscoveryQuery, vectors: types.NumpyArray, distance_type: models.Distance
) -> types.NumpyArray:
    ranks = calculate_discovery_ranks(query.context, vectors, distance_type)

    # Get distances to target
    distances_to_target = calculate_distance_core(query.target, vectors, distance_type)

    sigmoided_distances = np.fromiter(
        (scaled_fast_sigmoid(xi) for xi in distances_to_target), np.float32
    )

    return ranks + sigmoided_distances


def calculate_context_scores(
    query: ContextQuery, vectors: types.NumpyArray, distance_type: models.Distance
) -> types.NumpyArray:
    overall_scores = np.zeros(vectors.shape[0], dtype=np.float32)
    for pair in query.context_pairs:
        # Get distances to positive and negative vectors
        pos = calculate_distance_core(pair.positive, vectors, distance_type)
        neg = calculate_distance_core(pair.negative, vectors, distance_type)

        difference = pos - neg - EPSILON
        pair_scores = np.fromiter(
            (fast_sigmoid(xi) for xi in np.minimum(difference, 0.0)), np.float32
        )
        overall_scores += pair_scores

    return overall_scores
