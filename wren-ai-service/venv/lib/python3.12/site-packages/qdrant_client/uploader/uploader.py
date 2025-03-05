from abc import ABC
from itertools import count, islice
from typing import Any, Dict, Generator, Iterable, List, Optional, Union

import numpy as np

from qdrant_client.conversions import common_types as types
from qdrant_client.conversions.common_types import Record
from qdrant_client.http.models import ExtendedPointId
from qdrant_client.parallel_processor import Worker


def iter_batch(iterable: Union[Iterable, Generator], size: int) -> Iterable:
    """
    >>> list(iter_batch([1,2,3,4,5], 3))
    [[1, 2, 3], [4, 5]]
    """
    source_iter = iter(iterable)
    while source_iter:
        b = list(islice(source_iter, size))
        if len(b) == 0:
            break
        yield b


class BaseUploader(Worker, ABC):
    @classmethod
    def iterate_records_batches(
        cls,
        records: Iterable[Union[Record, types.PointStruct]],
        batch_size: int,
    ) -> Iterable:
        record_batches = iter_batch(records, batch_size)
        for record_batch in record_batches:
            ids_batch, vectors_batch, payload_batch = [], [], []

            for record in record_batch:
                ids_batch.append(record.id)
                vectors_batch.append(record.vector)
                payload_batch.append(record.payload)

            yield ids_batch, vectors_batch, payload_batch

    @classmethod
    def iterate_batches(
        cls,
        vectors: Union[
            Dict[str, types.NumpyArray], types.NumpyArray, Iterable[types.VectorStruct]
        ],
        payload: Optional[Iterable[dict]],
        ids: Optional[Iterable[ExtendedPointId]],
        batch_size: int,
    ) -> Iterable:
        if ids is None:
            ids_batches: Iterable = (None for _ in count())
        else:
            ids_batches = iter_batch(ids, batch_size)

        if payload is None:
            payload_batches: Iterable = (None for _ in count())
        else:
            payload_batches = iter_batch(payload, batch_size)

        if isinstance(vectors, np.ndarray):
            vector_batches: Iterable[Any] = cls._vector_batches_from_numpy(vectors, batch_size)
        elif isinstance(vectors, dict) and any(
            isinstance(value, np.ndarray) for value in vectors.values()
        ):
            vector_batches = cls._vector_batches_from_numpy_named_vectors(vectors, batch_size)
        else:
            vector_batches = iter_batch(vectors, batch_size)

        yield from zip(ids_batches, vector_batches, payload_batches)

    @staticmethod
    def _vector_batches_from_numpy(vectors: types.NumpyArray, batch_size: int) -> Iterable[float]:
        for i in range(0, vectors.shape[0], batch_size):
            yield vectors[i : i + batch_size].tolist()

    @staticmethod
    def _vector_batches_from_numpy_named_vectors(
        vectors: Dict[str, types.NumpyArray], batch_size: int
    ) -> Iterable[Dict[str, List[float]]]:
        assert (
            len(set([arr.shape[0] for arr in vectors.values()])) == 1
        ), "Each named vector should have the same number of vectors"

        num_vectors = next(iter(vectors.values())).shape[0]
        # Convert Dict[str, np.ndarray] to Generator(Dict[str, List[float]])
        vector_batches = (
            {name: vectors[name][i].tolist() for name in vectors.keys()}
            for i in range(num_vectors)
        )
        yield from iter_batch(vector_batches, batch_size)
