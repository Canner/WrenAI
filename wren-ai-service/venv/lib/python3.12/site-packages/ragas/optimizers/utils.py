import numpy as np
from numpy.typing import NDArray


def hamming_distance(vectors: NDArray[np.int_]) -> NDArray[np.int_]:
    """
    Calculate the Hamming distance between pairs of vectors in a list of lists.

    Args:
    vectors (list of lists): A list where each inner list is a vector.

    Returns:
    list of tuples: A list of tuples containing the pair indices and their Hamming distance.
    """

    # Validate that all vectors have the same dimension
    length = len(vectors[0])
    if any(len(v) != length for v in vectors):
        raise ValueError("All vectors must have the same dimensions.")

    # Calculate Hamming distances for all pairs
    distances = np.zeros((len(vectors), len(vectors)), dtype=int)
    for i in range(len(vectors)):
        for j in range(i + 1, len(vectors)):
            distance = np.sum(vectors[i] != vectors[j])
            distances[i][j] = distance

    return distances
