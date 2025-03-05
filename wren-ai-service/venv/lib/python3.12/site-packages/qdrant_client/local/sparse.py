import numpy as np

from qdrant_client.http.models import SparseVector


def empty_sparse_vector() -> SparseVector:
    return SparseVector(
        indices=[],
        values=[],
    )


def validate_sparse_vector(vector: SparseVector) -> None:
    assert len(vector.indices) == len(
        vector.values
    ), "Indices and values must have the same length"
    assert not np.isnan(vector.values).any(), "Values must not contain NaN"
    assert len(vector.indices) == len(set(vector.indices)), "Indices must be unique"


def is_sorted(vector: SparseVector) -> bool:
    for i in range(1, len(vector.indices)):
        if vector.indices[i] < vector.indices[i - 1]:
            return False
    return True


def sort_sparse_vector(vector: SparseVector) -> SparseVector:
    if is_sorted(vector):
        return vector

    sorted_indices = np.argsort(vector.indices)
    return SparseVector(
        indices=[vector.indices[i] for i in sorted_indices],
        values=[vector.values[i] for i in sorted_indices],
    )
