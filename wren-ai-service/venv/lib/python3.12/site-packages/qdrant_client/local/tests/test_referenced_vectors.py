import copy

import pytest


from qdrant_client.local.qdrant_local import QdrantLocal
from qdrant_client import models


@pytest.fixture(scope="module", autouse=True)
def client():
    """
    Sets up multiple collections with a bunch of points
    """
    client = QdrantLocal(":memory:")
    client.create_collection(
        "collection_default",
        vectors_config=models.VectorParams(
            size=4,
            distance=models.Distance.DOT,
        ),
    )

    client.create_collection(
        "collection_multiple_vectors",
        vectors_config={
            "": models.VectorParams(
                size=4,
                distance=models.Distance.DOT,
            ),
            "byte": models.VectorParams(
                size=4, distance=models.Distance.DOT, datatype=models.Datatype.UINT8
            ),
            "colbert": models.VectorParams(
                size=4,
                distance=models.Distance.DOT,
                multivector_config=models.MultiVectorConfig(
                    comparator=models.MultiVectorComparator.MAX_SIM
                ),
            ),
        },
        sparse_vectors_config={"sparse": models.SparseVectorParams()},
    )

    client.upsert(
        "collection_default",
        [
            models.PointStruct(id=1, vector=[0.25, 0.0, 0.0, 0.0]),
        ],
    )

    client.upsert(
        "collection_multiple_vectors",
        [
            models.PointStruct(
                id=1,
                vector={
                    "": [0.0, 0.25, 0.0, 0.0],
                    "byte": [0, 25, 0, 0],
                    "colbert": [[0.0, 0.25, 0.0, 0.0], [0.0, 0.25, 0.0, 0.0]],
                    "sparse": models.SparseVector(indices=[1], values=[0.25]),
                },
            ),
        ],
    )

    return client


@pytest.mark.parametrize(
    "query",
    [
        models.NearestQuery(nearest=1),
        models.RecommendQuery(recommend=models.RecommendInput(positive=[1], negative=[1])),
        models.DiscoverQuery(
            discover=models.DiscoverInput(
                target=1, context=[models.ContextPair(**{"positive": 1, "negative": 1})]
            )
        ),
        models.ContextQuery(context=[models.ContextPair(**{"positive": 1, "negative": 1})]),
        models.OrderByQuery(order_by=models.OrderBy(key="price", direction=models.Direction.ASC)),
        models.FusionQuery(fusion=models.Fusion.RRF),
    ],
)
@pytest.mark.parametrize(
    "using, lookup_from, expected, mentioned",
    [
        (None, None, [0.25, 0.0, 0.0, 0.0], True),
        ("", None, [0.25, 0.0, 0.0, 0.0], True),
        (
            "byte",
            models.LookupLocation(collection="collection_multiple_vectors"),
            [0, 25, 0, 0],
            False,
        ),
        (
            "",
            models.LookupLocation(collection="collection_multiple_vectors", vector="colbert"),
            [[0.0, 0.25, 0.0, 0.0], [0.0, 0.25, 0.0, 0.0]],
            False,
        ),
        (
            None,
            models.LookupLocation(collection="collection_multiple_vectors", vector="sparse"),
            models.SparseVector(indices=[1], values=[0.25]),
            False,
        ),
    ],
)
def test_vector_dereferencing(client, query, using, lookup_from, expected, mentioned):
    resolved, mentioned_ids = client._resolve_query_input(
        collection_name="collection_default",
        query=copy.deepcopy(query),
        using=using,
        lookup_from=lookup_from,
    )

    if isinstance(resolved, models.NearestQuery):
        assert resolved.nearest == expected
    elif isinstance(resolved, models.RecommendQuery):
        assert resolved.recommend.positive == [expected]
        assert resolved.recommend.negative == [expected]
    elif isinstance(resolved, models.DiscoverQuery):
        assert resolved.discover.target == expected
        assert resolved.discover.context[0].positive == expected
        assert resolved.discover.context[0].negative == expected
    elif isinstance(resolved, models.ContextQuery):
        assert resolved.context[0].positive == expected
        assert resolved.context[0].negative == expected
    else:
        mentioned = False
        assert resolved == query

    if mentioned:
        assert mentioned_ids == {1}
