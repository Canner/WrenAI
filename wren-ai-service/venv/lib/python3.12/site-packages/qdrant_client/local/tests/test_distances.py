import numpy as np

from qdrant_client.http import models
from qdrant_client.local.distances import calculate_distance
from qdrant_client.local.multi_distances import calculate_multi_distance
from qdrant_client.local.sparse_distances import calculate_distance_sparse


def test_distances() -> None:
    query = np.array([1.0, 2.0, 3.0])
    vectors = np.array([[1.0, 2.0, 3.0], [1.0, 2.0, 3.0]])
    assert np.allclose(calculate_distance(query, vectors, models.Distance.DOT), [14.0, 14.0])
    assert np.allclose(calculate_distance(query, vectors, models.Distance.EUCLID), [0.0, 0.0])
    assert np.allclose(calculate_distance(query, vectors, models.Distance.MANHATTAN), [0.0, 0.0])
    # cosine modifies vectors inplace
    assert np.allclose(calculate_distance(query, vectors, models.Distance.COSINE), [1.0, 1.0])

    query = np.array([1.0, 0.0, 1.0])
    vectors = np.array([[1.0, 2.0, 3.0], [0.0, 1.0, 0.0]])

    assert np.allclose(
        calculate_distance(query, vectors, models.Distance.DOT), [4.0, 0.0], atol=0.0001
    )
    assert np.allclose(
        calculate_distance(query, vectors, models.Distance.EUCLID),
        [2.82842712, 1.7320508],
        atol=0.0001,
    )

    assert np.allclose(
        calculate_distance(query, vectors, models.Distance.MANHATTAN),
        [4.0, 3.0],
        atol=0.0001,
    )
    # cosine modifies vectors inplace
    assert np.allclose(
        calculate_distance(query, vectors, models.Distance.COSINE),
        [0.75592895, 0.0],
        atol=0.0001,
    )

    sparse_query = models.SparseVector(indices=[1, 2], values=[1, 2])
    sparse_vectors = [models.SparseVector(indices=[10, 20], values=[1, 2])]

    assert calculate_distance_sparse(sparse_query, sparse_vectors) == [np.float32("-inf")]

    sparse_vectors = [
        models.SparseVector(indices=[1, 2], values=[3, 4]),
        models.SparseVector(indices=[1, 2, 3], values=[1, 2, 3]),
    ]
    assert np.allclose(
        calculate_distance_sparse(sparse_query, sparse_vectors), [11.0, 5], atol=0.0001
    )

    multivector_query = np.array([[1, 2, 3], [3, 4, 5]])
    docs = [np.array([[1, 2, 3], [0, 1, 2]])]
    assert calculate_multi_distance(multivector_query, docs, models.Distance.DOT)[0] == 40.0
