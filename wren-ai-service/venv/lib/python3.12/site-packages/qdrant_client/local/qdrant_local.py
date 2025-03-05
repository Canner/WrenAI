import importlib.metadata
import itertools
import json
import logging
import os
import shutil
from copy import deepcopy
from io import TextIOWrapper
from typing import (
    Any,
    Dict,
    Generator,
    Iterable,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    Union,
    get_args,
    Set,
)
from uuid import uuid4

import numpy as np
import portalocker

from qdrant_client._pydantic_compat import to_dict
from qdrant_client.client_base import QdrantBase
from qdrant_client.conversions import common_types as types
from qdrant_client.http import models as rest_models
from qdrant_client.http.models.models import RecommendExample
from qdrant_client.local.local_collection import (
    LocalCollection,
    DEFAULT_VECTOR_NAME,
    ignore_mentioned_ids_filter,
)

META_INFO_FILENAME = "meta.json"


class QdrantLocal(QdrantBase):
    """
    Everything Qdrant server can do, but locally.

    Use this implementation to run vector search without running a Qdrant server.
    Everything that works with local Qdrant will work with server Qdrant as well.

    Use for small-scale data, demos, and tests.
    If you need more speed or size, use Qdrant server.
    """

    def __init__(self, location: str, force_disable_check_same_thread: bool = False) -> None:
        """
        Initialize local Qdrant.

        Args:
            location: Where to store data. Can be a path to a directory or `:memory:` for in-memory storage.
            force_disable_check_same_thread: Disable SQLite check_same_thread check. Use only if you know what you are doing.
        """
        super().__init__()
        self.force_disable_check_same_thread = force_disable_check_same_thread
        self.location = location
        self.persistent = location != ":memory:"
        self.collections: Dict[str, LocalCollection] = {}
        self.aliases: Dict[str, str] = {}
        self._flock_file: Optional[TextIOWrapper] = None
        self._load()
        self._closed: bool = False

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self, **kwargs: Any) -> None:
        self._closed = True
        for collection in self.collections.values():
            if collection is not None:
                collection.close()
            else:
                logging.warning(
                    f"Collection appears to be None before closing. The existing collections are: "
                    f"{list(self.collections.keys())}"
                )

        try:
            if self._flock_file is not None and not self._flock_file.closed:
                portalocker.unlock(self._flock_file)
                self._flock_file.close()
        except TypeError:  # sometimes portalocker module can be garbage collected before
            # QdrantLocal instance
            pass

    def _load(self) -> None:
        if not self.persistent:
            return
        meta_path = os.path.join(self.location, META_INFO_FILENAME)
        if not os.path.exists(meta_path):
            os.makedirs(self.location, exist_ok=True)
            with open(meta_path, "w") as f:
                f.write(json.dumps({"collections": {}, "aliases": {}}))
        else:
            with open(meta_path, "r") as f:
                meta = json.load(f)
                for collection_name, config_json in meta["collections"].items():
                    config = rest_models.CreateCollection(**config_json)
                    collection_path = self._collection_path(collection_name)
                    self.collections[collection_name] = LocalCollection(
                        config,
                        collection_path,
                        force_disable_check_same_thread=self.force_disable_check_same_thread,
                    )
                self.aliases = meta["aliases"]

        lock_file_path = os.path.join(self.location, ".lock")
        if not os.path.exists(lock_file_path):
            os.makedirs(self.location, exist_ok=True)
            with open(lock_file_path, "w") as f:
                f.write("tmp lock file")
        self._flock_file = open(lock_file_path, "r+")
        try:
            portalocker.lock(
                self._flock_file,
                portalocker.LockFlags.EXCLUSIVE | portalocker.LockFlags.NON_BLOCKING,
            )
        except portalocker.exceptions.LockException:
            raise RuntimeError(
                f"Storage folder {self.location} is already accessed by another instance of Qdrant client."
                f" If you require concurrent access, use Qdrant server instead."
            )

    def _save(self) -> None:
        if not self.persistent:
            return

        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        meta_path = os.path.join(self.location, META_INFO_FILENAME)
        with open(meta_path, "w") as f:
            f.write(
                json.dumps(
                    {
                        "collections": {
                            collection_name: to_dict(collection.config)
                            for collection_name, collection in self.collections.items()
                        },
                        "aliases": self.aliases,
                    }
                )
            )

    def _get_collection(self, collection_name: str) -> LocalCollection:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        if collection_name in self.collections:
            return self.collections[collection_name]
        if collection_name in self.aliases:
            return self.collections[self.aliases[collection_name]]
        raise ValueError(f"Collection {collection_name} not found")

    def search_batch(
        self,
        collection_name: str,
        requests: Sequence[types.SearchRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        collection = self._get_collection(collection_name)

        return [
            collection.search(
                query_vector=request.vector,
                query_filter=request.filter,
                limit=request.limit,
                offset=request.offset,
                with_payload=request.with_payload,
                with_vectors=request.with_vector,
                score_threshold=request.score_threshold,
            )
            for request in requests
        ]

    def search(
        self,
        collection_name: str,
        query_vector: Union[
            types.NumpyArray,
            Sequence[float],
            Tuple[str, List[float]],
            types.NamedVector,
            types.NamedSparseVector,
        ],
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        **kwargs: Any,
    ) -> List[types.ScoredPoint]:
        collection = self._get_collection(collection_name)
        return collection.search(
            query_vector=query_vector,
            query_filter=query_filter,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
        )

    def search_matrix_offsets(
        self,
        collection_name: str,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
        **kwargs: Any,
    ) -> types.SearchMatrixOffsetsResponse:
        collection = self._get_collection(collection_name)
        return collection.search_matrix_offsets(
            query_filter=query_filter, limit=limit, sample=sample, using=using
        )

    def search_matrix_pairs(
        self,
        collection_name: str,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
        **kwargs: Any,
    ) -> types.SearchMatrixPairsResponse:
        collection = self._get_collection(collection_name)
        return collection.search_matrix_pairs(
            query_filter=query_filter, limit=limit, sample=sample, using=using
        )

    def search_groups(
        self,
        collection_name: str,
        query_vector: Union[
            types.NumpyArray,
            Sequence[float],
            Tuple[str, List[float]],
            types.NamedVector,
        ],
        group_by: str,
        query_filter: Optional[rest_models.Filter] = None,
        search_params: Optional[rest_models.SearchParams] = None,
        limit: int = 10,
        group_size: int = 1,
        with_payload: Union[bool, Sequence[str], rest_models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        **kwargs: Any,
    ) -> types.GroupsResult:
        collection = self._get_collection(collection_name)
        with_lookup_collection = None
        if with_lookup is not None:
            if isinstance(with_lookup, str):
                with_lookup_collection = self._get_collection(with_lookup)
            else:
                with_lookup_collection = self._get_collection(with_lookup.collection)

        return collection.search_groups(
            query_vector=query_vector,
            query_filter=query_filter,
            limit=limit,
            group_by=group_by,
            group_size=group_size,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
            with_lookup=with_lookup,
            with_lookup_collection=with_lookup_collection,
        )

    def _resolve_query_input(
        self,
        collection_name: str,
        query: Optional[types.Query],
        using: Optional[str],
        lookup_from: Optional[types.LookupLocation],
    ) -> Tuple[types.Query, Set[types.PointId]]:
        """
        Resolves any possible ids into vectors and returns a new query object, along with a set of the mentioned
        point ids that should be filtered when searching.
        """

        lookup_collection_name = lookup_from.collection if lookup_from else collection_name
        collection = self._get_collection(lookup_collection_name)

        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME
        vector_name = (
            lookup_from.vector
            if lookup_from is not None and lookup_from.vector is not None
            else search_in_vector_name
        )

        sparse = vector_name in collection.sparse_vectors
        multi = vector_name in collection.multivectors
        if sparse:
            collection_vectors = collection.sparse_vectors
        elif multi:
            collection_vectors = collection.multivectors
        else:
            collection_vectors = collection.vectors

        # mentioned ids in the search collection which should be excluded from search
        mentioned_ids: Set[types.PointId] = set()

        def input_into_vector(
            vector_input: types.VectorInput,
        ) -> types.VectorInput:
            if isinstance(vector_input, get_args(types.PointId)):
                point_id = vector_input  # rename for clarity
                if point_id not in collection.ids:
                    raise ValueError(f"Point {point_id} is not found in the collection")

                idx = collection.ids[point_id]
                if vector_name in collection_vectors:
                    vec = collection_vectors[vector_name][idx]
                else:
                    raise ValueError(f"Vector {vector_name} not found")
                if isinstance(vec, np.ndarray):
                    vec = vec.tolist()
                if collection_name == lookup_collection_name:
                    mentioned_ids.add(point_id)
                return vec
            else:
                return vector_input

        query = deepcopy(query)
        if isinstance(query, rest_models.NearestQuery):
            query.nearest = input_into_vector(query.nearest)

        elif isinstance(query, rest_models.RecommendQuery):
            if query.recommend.negative is not None:
                query.recommend.negative = [
                    input_into_vector(vector_input) for vector_input in query.recommend.negative
                ]
            if query.recommend.positive is not None:
                query.recommend.positive = [
                    input_into_vector(vector_input) for vector_input in query.recommend.positive
                ]

        elif isinstance(query, rest_models.DiscoverQuery):
            query.discover.target = input_into_vector(query.discover.target)
            pairs = (
                query.discover.context
                if isinstance(query.discover.context, list)
                else [query.discover.context]
            )
            query.discover.context = [
                rest_models.ContextPair(
                    positive=input_into_vector(pair.positive),
                    negative=input_into_vector(pair.negative),
                )
                for pair in pairs
            ]
        elif isinstance(query, rest_models.ContextQuery):
            pairs = query.context if isinstance(query.context, list) else [query.context]
            query.context = [
                rest_models.ContextPair(
                    positive=input_into_vector(pair.positive),
                    negative=input_into_vector(pair.negative),
                )
                for pair in pairs
            ]
        elif isinstance(query, rest_models.OrderByQuery):
            pass
        elif isinstance(query, rest_models.FusionQuery):
            pass

        return query, mentioned_ids

    def _resolve_prefetches_input(
        self,
        prefetch: Optional[Union[Sequence[types.Prefetch], types.Prefetch]],
        collection_name: str,
    ) -> List[types.Prefetch]:
        if prefetch is None:
            return []

        if isinstance(prefetch, list) and len(prefetch) == 0:
            return []

        prefetches = []
        if isinstance(prefetch, types.Prefetch):
            prefetches = [prefetch]
            prefetches.extend(
                prefetch.prefetch if isinstance(prefetch.prefetch, list) else [prefetch.prefetch]
            )
        elif isinstance(prefetch, Sequence):
            prefetches = list(prefetch)

        return [
            self._resolve_prefetch_input(prefetch, collection_name)
            for prefetch in prefetches
            if prefetch is not None
        ]

    def _resolve_prefetch_input(
        self, prefetch: types.Prefetch, collection_name: str
    ) -> types.Prefetch:
        if prefetch.query is None:
            return prefetch

        prefetch = deepcopy(prefetch)
        query, mentioned_ids = self._resolve_query_input(
            collection_name,
            prefetch.query,
            prefetch.using,
            prefetch.lookup_from,
        )
        prefetch.query = query

        prefetch.filter = ignore_mentioned_ids_filter(prefetch.filter, list(mentioned_ids))

        prefetch.prefetch = self._resolve_prefetches_input(prefetch.prefetch, collection_name)

        return prefetch

    def query_points(
        self,
        collection_name: str,
        query: Optional[types.Query] = None,
        using: Optional[str] = None,
        prefetch: Union[types.Prefetch, List[types.Prefetch], None] = None,
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        **kwargs: Any,
    ) -> types.QueryResponse:
        collection = self._get_collection(collection_name)

        if query is not None:
            query, mentioned_ids = self._resolve_query_input(
                collection_name, query, using, lookup_from
            )
            query_filter = ignore_mentioned_ids_filter(query_filter, list(mentioned_ids))

        prefetch = self._resolve_prefetches_input(prefetch, collection_name)
        return collection.query_points(
            query=query,
            prefetch=prefetch,
            query_filter=query_filter,
            using=using,
            score_threshold=score_threshold,
            limit=limit,
            offset=offset or 0,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    def query_batch_points(
        self,
        collection_name: str,
        requests: Sequence[types.QueryRequest],
        **kwargs: Any,
    ) -> List[types.QueryResponse]:
        collection = self._get_collection(collection_name)

        return [
            collection.query_points(
                query=request.query,
                prefetch=request.prefetch,
                query_filter=request.filter,
                limit=request.limit,
                offset=request.offset or 0,
                with_payload=request.with_payload,
                with_vectors=request.with_vector,
                score_threshold=request.score_threshold,
                using=request.using,
                lookup_from_collection=self._get_collection(request.lookup_from.collection)
                if request.lookup_from
                else None,
                lookup_from_vector_name=request.lookup_from.vector
                if request.lookup_from
                else None,
            )
            for request in requests
        ]

    def query_points_groups(
        self,
        collection_name: str,
        group_by: str,
        query: Union[
            types.PointId,
            List[float],
            List[List[float]],
            types.SparseVector,
            types.Query,
            types.NumpyArray,
            types.Document,
            None,
        ] = None,
        using: Optional[str] = None,
        prefetch: Union[types.Prefetch, List[types.Prefetch], None] = None,
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        group_size: int = 3,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        **kwargs: Any,
    ) -> types.GroupsResult:
        collection = self._get_collection(collection_name)
        if query is not None:
            query, mentioned_ids = self._resolve_query_input(
                collection_name, query, using, lookup_from
            )
            query_filter = ignore_mentioned_ids_filter(query_filter, list(mentioned_ids))
        with_lookup_collection = None
        if with_lookup is not None:
            if isinstance(with_lookup, str):
                with_lookup_collection = self._get_collection(with_lookup)
            else:
                with_lookup_collection = self._get_collection(with_lookup.collection)

        return collection.query_groups(
            query=query,
            query_filter=query_filter,
            using=using,
            prefetch=prefetch,
            limit=limit,
            group_by=group_by,
            group_size=group_size,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
            with_lookup=with_lookup,
            with_lookup_collection=with_lookup_collection,
        )

    def recommend_batch(
        self,
        collection_name: str,
        requests: Sequence[types.RecommendRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        collection = self._get_collection(collection_name)

        return [
            collection.recommend(
                positive=request.positive,
                negative=request.negative,
                query_filter=request.filter,
                limit=request.limit,
                offset=request.offset,
                with_payload=request.with_payload,
                with_vectors=request.with_vector,
                score_threshold=request.score_threshold,
                using=request.using,
                lookup_from_collection=self._get_collection(request.lookup_from.collection)
                if request.lookup_from
                else None,
                lookup_from_vector_name=request.lookup_from.vector
                if request.lookup_from
                else None,
                strategy=request.strategy,
            )
            for request in requests
        ]

    def recommend(
        self,
        collection_name: str,
        positive: Optional[Sequence[RecommendExample]] = None,
        negative: Optional[Sequence[RecommendExample]] = None,
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        offset: int = 0,
        with_payload: Union[bool, List[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, List[str]] = False,
        score_threshold: Optional[float] = None,
        using: Optional[str] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        strategy: Optional[types.RecommendStrategy] = None,
        **kwargs: Any,
    ) -> List[types.ScoredPoint]:
        collection = self._get_collection(collection_name)
        return collection.recommend(
            positive=positive,
            negative=negative,
            query_filter=query_filter,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
            using=using,
            lookup_from_collection=self._get_collection(lookup_from.collection)
            if lookup_from
            else None,
            lookup_from_vector_name=lookup_from.vector if lookup_from else None,
            strategy=strategy,
        )

    def recommend_groups(
        self,
        collection_name: str,
        group_by: str,
        positive: Optional[Sequence[Union[types.PointId, List[float]]]] = None,
        negative: Optional[Sequence[Union[types.PointId, List[float]]]] = None,
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        group_size: int = 1,
        score_threshold: Optional[float] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        using: Optional[str] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        strategy: Optional[types.RecommendStrategy] = None,
        **kwargs: Any,
    ) -> types.GroupsResult:
        collection = self._get_collection(collection_name)
        with_lookup_collection = None
        if with_lookup is not None:
            if isinstance(with_lookup, str):
                with_lookup_collection = self._get_collection(with_lookup)
            else:
                with_lookup_collection = self._get_collection(with_lookup.collection)

        return collection.recommend_groups(
            positive=positive,
            negative=negative,
            group_by=group_by,
            group_size=group_size,
            query_filter=query_filter,
            limit=limit,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
            using=using,
            lookup_from_collection=self._get_collection(lookup_from.collection)
            if lookup_from
            else None,
            lookup_from_vector_name=lookup_from.vector if lookup_from else None,
            with_lookup=with_lookup,
            with_lookup_collection=with_lookup_collection,
            strategy=strategy,
        )

    def discover(
        self,
        collection_name: str,
        target: Optional[types.TargetVector] = None,
        context: Optional[Sequence[types.ContextExamplePair]] = None,
        query_filter: Optional[types.Filter] = None,
        search_params: Optional[types.SearchParams] = None,
        limit: int = 10,
        offset: int = 0,
        with_payload: Union[bool, List[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, List[str]] = False,
        using: Optional[str] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        consistency: Optional[types.ReadConsistency] = None,
        timeout: Optional[int] = None,
        **kwargs: Any,
    ) -> List[types.ScoredPoint]:
        collection = self._get_collection(collection_name)
        return collection.discover(
            target=target,
            context=context,
            query_filter=query_filter,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
            using=using,
            lookup_from_collection=self._get_collection(lookup_from.collection)
            if lookup_from
            else None,
            lookup_from_vector_name=lookup_from.vector if lookup_from else None,
        )

    def discover_batch(
        self,
        collection_name: str,
        requests: Sequence[types.DiscoverRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        collection = self._get_collection(collection_name)

        return [
            collection.discover(
                target=request.target,
                context=request.context,
                query_filter=request.filter,
                limit=request.limit,
                offset=request.offset,
                with_payload=request.with_payload,
                with_vectors=request.with_vector,
                using=request.using,
                lookup_from_collection=self._get_collection(request.lookup_from.collection)
                if request.lookup_from
                else None,
                lookup_from_vector_name=request.lookup_from.vector
                if request.lookup_from
                else None,
            )
            for request in requests
        ]

    def scroll(
        self,
        collection_name: str,
        scroll_filter: Optional[types.Filter] = None,
        limit: int = 10,
        order_by: Optional[types.OrderBy] = None,
        offset: Optional[types.PointId] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        **kwargs: Any,
    ) -> Tuple[List[types.Record], Optional[types.PointId]]:
        collection = self._get_collection(collection_name)
        return collection.scroll(
            scroll_filter=scroll_filter,
            limit=limit,
            order_by=order_by,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    def count(
        self,
        collection_name: str,
        count_filter: Optional[types.Filter] = None,
        exact: bool = True,
        **kwargs: Any,
    ) -> types.CountResult:
        collection = self._get_collection(collection_name)
        return collection.count(count_filter=count_filter)

    def facet(
        self,
        collection_name: str,
        key: str,
        facet_filter: Optional[types.Filter] = None,
        limit: int = 10,
        exact: bool = False,
        **kwargs: Any,
    ) -> types.FacetResponse:
        collection = self._get_collection(collection_name)
        return collection.facet(key=key, facet_filter=facet_filter, limit=limit)

    def upsert(
        self, collection_name: str, points: types.Points, **kwargs: Any
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.upsert(points)
        return self._default_update_result()

    def update_vectors(
        self,
        collection_name: str,
        points: Sequence[types.PointVectors],
        **kwargs: Any,
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.update_vectors(points)
        return self._default_update_result()

    def delete_vectors(
        self,
        collection_name: str,
        vectors: Sequence[str],
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.delete_vectors(vectors, points)
        return self._default_update_result()

    def retrieve(
        self,
        collection_name: str,
        ids: Sequence[types.PointId],
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        **kwargs: Any,
    ) -> List[types.Record]:
        collection = self._get_collection(collection_name)
        return collection.retrieve(ids, with_payload, with_vectors)

    @classmethod
    def _default_update_result(cls, operation_id: int = 0) -> types.UpdateResult:
        return types.UpdateResult(
            operation_id=operation_id,
            status=rest_models.UpdateStatus.COMPLETED,
        )

    def delete(
        self, collection_name: str, points_selector: types.PointsSelector, **kwargs: Any
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.delete(points_selector)
        return self._default_update_result()

    def set_payload(
        self,
        collection_name: str,
        payload: types.Payload,
        points: types.PointsSelector,
        key: Optional[str] = None,
        **kwargs: Any,
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.set_payload(payload=payload, selector=points, key=key)
        return self._default_update_result()

    def overwrite_payload(
        self,
        collection_name: str,
        payload: types.Payload,
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.overwrite_payload(payload=payload, selector=points)
        return self._default_update_result()

    def delete_payload(
        self,
        collection_name: str,
        keys: Sequence[str],
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.delete_payload(keys=keys, selector=points)
        return self._default_update_result()

    def clear_payload(
        self, collection_name: str, points_selector: types.PointsSelector, **kwargs: Any
    ) -> types.UpdateResult:
        collection = self._get_collection(collection_name)
        collection.clear_payload(selector=points_selector)
        return self._default_update_result()

    def batch_update_points(
        self,
        collection_name: str,
        update_operations: Sequence[types.UpdateOperation],
        **kwargs: Any,
    ) -> List[types.UpdateResult]:
        collection = self._get_collection(collection_name)
        collection.batch_update_points(update_operations)
        return [self._default_update_result()] * len(update_operations)

    def update_collection_aliases(
        self, change_aliases_operations: Sequence[types.AliasOperations], **kwargs: Any
    ) -> bool:
        for operation in change_aliases_operations:
            if isinstance(operation, rest_models.CreateAliasOperation):
                self._get_collection(operation.create_alias.collection_name)
                self.aliases[operation.create_alias.alias_name] = (
                    operation.create_alias.collection_name
                )
            elif isinstance(operation, rest_models.DeleteAliasOperation):
                self.aliases.pop(operation.delete_alias.alias_name, None)
            elif isinstance(operation, rest_models.RenameAliasOperation):
                new_name = operation.rename_alias.new_alias_name
                old_name = operation.rename_alias.old_alias_name
                self.aliases[new_name] = self.aliases.pop(old_name)
            else:
                raise ValueError(f"Unknown operation: {operation}")
        self._save()
        return True

    def get_collection_aliases(
        self, collection_name: str, **kwargs: Any
    ) -> types.CollectionsAliasesResponse:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        return types.CollectionsAliasesResponse(
            aliases=[
                rest_models.AliasDescription(
                    alias_name=alias_name,
                    collection_name=name,
                )
                for alias_name, name in self.aliases.items()
                if name == collection_name
            ]
        )

    def get_aliases(self, **kwargs: Any) -> types.CollectionsAliasesResponse:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        return types.CollectionsAliasesResponse(
            aliases=[
                rest_models.AliasDescription(
                    alias_name=alias_name,
                    collection_name=name,
                )
                for alias_name, name in self.aliases.items()
            ]
        )

    def get_collections(self, **kwargs: Any) -> types.CollectionsResponse:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        return types.CollectionsResponse(
            collections=[
                rest_models.CollectionDescription(name=name)
                for name, _ in self.collections.items()
            ]
        )

    def get_collection(self, collection_name: str, **kwargs: Any) -> types.CollectionInfo:
        collection = self._get_collection(collection_name)
        return collection.info()

    def collection_exists(self, collection_name: str, **kwargs: Any) -> bool:
        try:
            self._get_collection(collection_name)
            return True
        except ValueError:
            return False

    def update_collection(
        self,
        collection_name: str,
        sparse_vectors_config: Optional[Mapping[str, types.SparseVectorParams]] = None,
        **kwargs: Any,
    ) -> bool:
        _collection = self._get_collection(collection_name)

        if sparse_vectors_config is not None:
            for vector_name, vector_params in sparse_vectors_config.items():
                _collection.update_sparse_vectors_config(vector_name, vector_params)

            return True
        return False

    def _collection_path(self, collection_name: str) -> Optional[str]:
        if self.persistent:
            return os.path.join(self.location, "collection", collection_name)
        else:
            return None

    def delete_collection(self, collection_name: str, **kwargs: Any) -> bool:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        _collection = self.collections.pop(collection_name, None)
        del _collection
        self.aliases = {
            alias_name: name
            for alias_name, name in self.aliases.items()
            if name != collection_name
        }
        collection_path = self._collection_path(collection_name)
        if collection_path is not None:
            shutil.rmtree(collection_path, ignore_errors=True)
        self._save()
        return True

    def create_collection(
        self,
        collection_name: str,
        vectors_config: Union[types.VectorParams, Mapping[str, types.VectorParams]],
        init_from: Optional[types.InitFrom] = None,
        sparse_vectors_config: Optional[Mapping[str, types.SparseVectorParams]] = None,
        **kwargs: Any,
    ) -> bool:
        if self.closed:
            raise RuntimeError("QdrantLocal instance is closed. Please create a new instance.")

        src_collection = None
        from_collection_name = None
        if init_from is not None:
            from_collection_name = (
                init_from if isinstance(init_from, str) else init_from.collection
            )
            src_collection = self._get_collection(from_collection_name)

        if collection_name in self.collections:
            raise ValueError(f"Collection {collection_name} already exists")
        collection_path = self._collection_path(collection_name)
        if collection_path is not None:
            os.makedirs(collection_path, exist_ok=True)

        collection = LocalCollection(
            rest_models.CreateCollection(
                vectors=vectors_config,
                sparse_vectors=sparse_vectors_config,
            ),
            location=collection_path,
            force_disable_check_same_thread=self.force_disable_check_same_thread,
        )
        self.collections[collection_name] = collection

        if src_collection and from_collection_name:
            batch_size = 100
            records, next_offset = self.scroll(from_collection_name, limit=2, with_vectors=True)
            self.upload_records(
                collection_name, records
            )  # it is not crucial to replace upload_records here
            # since it is an internal usage, and we don't have custom shard keys in qdrant local
            while next_offset is not None:
                records, next_offset = self.scroll(
                    from_collection_name, offset=next_offset, limit=batch_size, with_vectors=True
                )
                self.upload_records(collection_name, records)

        self._save()
        return True

    def recreate_collection(
        self,
        collection_name: str,
        vectors_config: Union[types.VectorParams, Mapping[str, types.VectorParams]],
        init_from: Optional[types.InitFrom] = None,
        sparse_vectors_config: Optional[Mapping[str, types.SparseVectorParams]] = None,
        **kwargs: Any,
    ) -> bool:
        self.delete_collection(collection_name)
        return self.create_collection(
            collection_name, vectors_config, init_from, sparse_vectors_config
        )

    def upload_points(
        self, collection_name: str, points: Iterable[types.PointStruct], **kwargs: Any
    ) -> None:
        self._upload_points(collection_name, points)

    def upload_records(
        self, collection_name: str, records: Iterable[types.Record], **kwargs: Any
    ) -> None:
        # upload_records in local mode behaves like upload_records with wait=True in server mode
        self._upload_points(collection_name, records)

    def _upload_points(
        self,
        collection_name: str,
        points: Iterable[Union[types.PointStruct, types.Record]],
    ) -> None:
        collection = self._get_collection(collection_name)
        collection.upsert(
            [
                rest_models.PointStruct(
                    id=point.id,
                    vector=point.vector or {},
                    payload=point.payload or {},
                )
                for point in points
            ]
        )

    def upload_collection(
        self,
        collection_name: str,
        vectors: Union[
            Dict[str, types.NumpyArray], types.NumpyArray, Iterable[types.VectorStruct]
        ],
        payload: Optional[Iterable[Dict[Any, Any]]] = None,
        ids: Optional[Iterable[types.PointId]] = None,
        **kwargs: Any,
    ) -> None:
        # upload_collection in local mode behaves like upload_collection with wait=True in server mode
        def uuid_generator() -> Generator[str, None, None]:
            while True:
                yield str(uuid4())

        collection = self._get_collection(collection_name)
        if isinstance(vectors, dict) and any(isinstance(v, np.ndarray) for v in vectors.values()):
            assert (
                len(set([arr.shape[0] for arr in vectors.values()])) == 1
            ), "Each named vector should have the same number of vectors"

            num_vectors = next(iter(vectors.values())).shape[0]
            # convert Dict[str, np.ndarray] to List[Dict[str, List[float]]]
            vectors = [
                {name: vectors[name][i].tolist() for name in vectors.keys()}
                for i in range(num_vectors)
            ]

        collection.upsert(
            [
                rest_models.PointStruct(
                    id=point_id,
                    vector=(vector.tolist() if isinstance(vector, np.ndarray) else vector) or {},
                    payload=payload or {},
                )
                for (point_id, vector, payload) in zip(
                    ids or uuid_generator(),
                    iter(vectors),
                    payload or itertools.cycle([{}]),
                )
            ]
        )

    def create_payload_index(
        self,
        collection_name: str,
        field_name: str,
        field_schema: Optional[types.PayloadSchemaType] = None,
        field_type: Optional[types.PayloadSchemaType] = None,
        **kwargs: Any,
    ) -> types.UpdateResult:
        logging.warning(
            "Payload indexes have no effect in the local Qdrant. Please use server Qdrant if you need payload indexes."
        )
        return self._default_update_result()

    def delete_payload_index(
        self, collection_name: str, field_name: str, **kwargs: Any
    ) -> types.UpdateResult:
        logging.warning(
            "Payload indexes have no effect in the local Qdrant. Please use server Qdrant if you need payload indexes."
        )
        return self._default_update_result()

    def list_snapshots(
        self, collection_name: str, **kwargs: Any
    ) -> List[types.SnapshotDescription]:
        return []

    def create_snapshot(
        self, collection_name: str, **kwargs: Any
    ) -> Optional[types.SnapshotDescription]:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def delete_snapshot(self, collection_name: str, snapshot_name: str, **kwargs: Any) -> bool:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def list_full_snapshots(self, **kwargs: Any) -> List[types.SnapshotDescription]:
        return []

    def create_full_snapshot(self, **kwargs: Any) -> types.SnapshotDescription:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def delete_full_snapshot(self, snapshot_name: str, **kwargs: Any) -> bool:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def recover_snapshot(self, collection_name: str, location: str, **kwargs: Any) -> bool:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def list_shard_snapshots(
        self, collection_name: str, shard_id: int, **kwargs: Any
    ) -> List[types.SnapshotDescription]:
        return []

    def create_shard_snapshot(
        self, collection_name: str, shard_id: int, **kwargs: Any
    ) -> Optional[types.SnapshotDescription]:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need snapshots."
        )

    def delete_shard_snapshot(
        self, collection_name: str, shard_id: int, snapshot_name: str, **kwargs: Any
    ) -> bool:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need snapshots."
        )

    def recover_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        location: str,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError(
            "Snapshots are not supported in the local Qdrant. Please use server Qdrant if you need snapshots."
        )

    def lock_storage(self, reason: str, **kwargs: Any) -> types.LocksOption:
        raise NotImplementedError(
            "Locks are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def unlock_storage(self, **kwargs: Any) -> types.LocksOption:
        raise NotImplementedError(
            "Locks are not supported in the local Qdrant. Please use server Qdrant if you need full snapshots."
        )

    def get_locks(self, **kwargs: Any) -> types.LocksOption:
        return types.LocksOption(
            error_message=None,
            write=False,
        )

    def create_shard_key(
        self,
        collection_name: str,
        shard_key: types.ShardKey,
        shards_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        placement: Optional[List[int]] = None,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError(
            "Sharding is not supported in the local Qdrant. Please use server Qdrant if you need sharding."
        )

    def delete_shard_key(
        self,
        collection_name: str,
        shard_key: types.ShardKey,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError(
            "Sharding is not supported in the local Qdrant. Please use server Qdrant if you need sharding."
        )

    def info(self) -> types.VersionInfo:
        version = importlib.metadata.version("qdrant-client")
        return rest_models.VersionInfo(
            title="qdrant - vector search engine", version=version, commit=None
        )
