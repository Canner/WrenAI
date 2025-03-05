import random

from qdrant_client import models
from qdrant_client.local.local_collection import LocalCollection, DEFAULT_VECTOR_NAME


def test_get_vectors():
    collection = LocalCollection(
        models.CreateCollection(
            vectors=models.VectorParams(size=2, distance=models.Distance.MANHATTAN)
        )
    )
    collection.upsert(
        points=[
            models.PointStruct(id=i, vector=[random.random(), random.random()]) for i in range(10)
        ]
    )

    assert collection._get_vectors(idx=1, with_vectors=DEFAULT_VECTOR_NAME)
    assert collection._get_vectors(idx=2, with_vectors=True)
    assert collection._get_vectors(idx=3, with_vectors=False) is None
