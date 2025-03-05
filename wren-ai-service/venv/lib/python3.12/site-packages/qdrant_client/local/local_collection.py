import json
import math
import uuid
from collections import OrderedDict, defaultdict
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Sequence,
    Tuple,
    Union,
    get_args,
    Set,
)
from copy import deepcopy

import numpy as np

from qdrant_client import grpc as grpc
from qdrant_client._pydantic_compat import construct, to_jsonable_python as _to_jsonable_python
from qdrant_client.conversions import common_types as types
from qdrant_client.conversions.common_types import get_args_subscribed
from qdrant_client.conversions.conversion import GrpcToRest
from qdrant_client.http import models
from qdrant_client.http.models import PointIdsList, ScoredPoint
from qdrant_client.http.models.models import Distance, ExtendedPointId, SparseVector, OrderValue
from qdrant_client.hybrid.fusion import reciprocal_rank_fusion, distribution_based_score_fusion
from qdrant_client.local.distances import (
    ContextPair,
    ContextQuery,
    DenseQueryVector,
    DiscoveryQuery,
    DistanceOrder,
    RecoQuery,
    calculate_context_scores,
    calculate_discovery_scores,
    calculate_distance,
    calculate_recommend_best_scores,
    distance_to_order,
)
from qdrant_client.local.multi_distances import (
    MultiQueryVector,
    MultiRecoQuery,
    MultiDiscoveryQuery,
    MultiContextQuery,
    MultiContextPair,
    calculate_multi_distance,
    calculate_multi_recommend_best_scores,
    calculate_multi_discovery_scores,
    calculate_multi_context_scores,
)
from qdrant_client.local.json_path_parser import JsonPathItem, parse_json_path
from qdrant_client.local.order_by import to_order_value
from qdrant_client.local.payload_filters import calculate_payload_mask
from qdrant_client.local.payload_value_extractor import value_by_key, parse_uuid
from qdrant_client.local.payload_value_setter import set_value_by_key
from qdrant_client.local.persistence import CollectionPersistence
from qdrant_client.local.sparse import (
    empty_sparse_vector,
    sort_sparse_vector,
    validate_sparse_vector,
)
from qdrant_client.local.sparse_distances import (
    SparseContextPair,
    SparseContextQuery,
    SparseDiscoveryQuery,
    SparseQueryVector,
    SparseRecoQuery,
    calculate_distance_sparse,
    calculate_sparse_context_scores,
    calculate_sparse_discovery_scores,
    calculate_sparse_recommend_best_scores,
    merge_positive_and_negative_avg,
    sparse_avg,
)

DEFAULT_VECTOR_NAME = ""
EPSILON = 1.1920929e-7  # https://doc.rust-lang.org/std/f32/constant.EPSILON.html
# https://github.com/qdrant/qdrant/blob/7164ac4a5987d28f1c93f5712aef8e09e7d93555/lib/segment/src/spaces/simple_avx.rs#L99C10-L99C10


def to_jsonable_python(x: Any) -> Any:
    try:
        return json.loads(json.dumps(x, allow_nan=True))
    except Exception:
        return json.loads(json.dumps(x, allow_nan=True, default=_to_jsonable_python))


class LocalCollection:
    """
    LocalCollection is a class that represents a collection of vectors in the local storage.
    """

    def __init__(
        self,
        config: models.CreateCollection,
        location: Optional[str] = None,
        force_disable_check_same_thread: bool = False,
    ) -> None:
        """
        Create or load a collection from the local storage.
        Args:
            location: path to the collection directory. If None, the collection will be created in memory.
            force_disable_check_same_thread: force disable check_same_thread for sqlite3 connection. default: False
        """
        self.vectors_config, self.multivectors_config = self._resolve_vectors_config(
            config.vectors
        )
        sparse_vectors_config = config.sparse_vectors
        self.vectors: Dict[str, types.NumpyArray] = {
            name: np.zeros((0, params.size), dtype=np.float32)
            for name, params in self.vectors_config.items()
        }
        self.sparse_vectors: Dict[str, List[SparseVector]] = (
            {name: [] for name, params in sparse_vectors_config.items()}
            if sparse_vectors_config is not None
            else {}
        )
        self.sparse_vectors_idf: Dict[
            str, Dict[int, int]
        ] = {}  # vector_name: {idx_in_vocab: doc frequency}
        self.multivectors: Dict[str, List[types.NumpyArray]] = {
            name: [] for name in self.multivectors_config
        }
        self.payload: List[models.Payload] = []
        self.deleted = np.zeros(0, dtype=bool)
        self._all_vectors_keys = (
            list(self.vectors.keys())
            + list(self.sparse_vectors.keys())
            + list(self.multivectors.keys())
        )
        self.deleted_per_vector = {
            name: np.zeros(0, dtype=bool) for name in self._all_vectors_keys
        }
        self.ids: Dict[models.ExtendedPointId, int] = {}  # Mapping from external id to internal id
        self.ids_inv: List[models.ExtendedPointId] = []  # Mapping from internal id to external id
        self.persistent = location is not None
        self.storage = None
        self.config = config
        if location is not None:
            self.storage = CollectionPersistence(location, force_disable_check_same_thread)
        self.load_vectors()

    @staticmethod
    def _resolve_vectors_config(
        vectors: Dict[str, models.VectorParams],
    ) -> Tuple[Dict[str, models.VectorParams], Dict[str, models.VectorParams]]:
        vectors_config = {}
        multivectors_config = {}
        if isinstance(vectors, models.VectorParams):
            if vectors.multivector_config is not None:
                multivectors_config = {DEFAULT_VECTOR_NAME: vectors}
            else:
                vectors_config = {DEFAULT_VECTOR_NAME: vectors}
            return vectors_config, multivectors_config

        for name, params in vectors.items():
            if params.multivector_config is not None:
                multivectors_config[name] = params
            else:
                vectors_config[name] = params

        return vectors_config, multivectors_config

    def close(self) -> None:
        if self.storage is not None:
            self.storage.close()

    def _update_idf_append(self, vector: SparseVector, vector_name: str) -> None:
        if vector_name not in self.sparse_vectors_idf:
            self.sparse_vectors_idf[vector_name] = defaultdict(int)
        for idx in vector.indices:
            self.sparse_vectors_idf[vector_name][idx] += 1

    def _update_idf_remove(self, vector: SparseVector, vector_name: str) -> None:
        for idx in vector.indices:
            self.sparse_vectors_idf[vector_name][idx] -= 1

    @classmethod
    def _compute_idf(cls, df: int, n: int) -> float:
        # ((n - df + 0.5) / (df + 0.5) + 1.).ln()
        return math.log((n - df + 0.5) / (df + 0.5) + 1)

    def _rescore_idf(self, vector: SparseVector, vector_name: str) -> SparseVector:
        num_docs = self.count(count_filter=None).count
        new_values = []
        idf_store = self.sparse_vectors_idf[vector_name]

        for idx, value in zip(vector.indices, vector.values):
            document_frequency = idf_store.get(idx, 0)
            idf = self._compute_idf(document_frequency, num_docs)
            new_values.append(value * idf)

        return SparseVector(indices=vector.indices, values=new_values)

    def load_vectors(self) -> None:
        if self.storage is not None:
            vectors = defaultdict(list)
            sparse_vectors = defaultdict(list)
            multivectors = defaultdict(list)
            deleted_ids = []

            for idx, point in enumerate(self.storage.load()):
                # id tracker
                self.ids[point.id] = idx
                # no gaps in idx
                self.ids_inv.append(point.id)

                # payload tracker
                self.payload.append(to_jsonable_python(point.payload) or {})

                # persisted named vectors
                loaded_vector = point.vector

                # add default name to anonymous dense or multivector
                if isinstance(point.vector, list):
                    loaded_vector = {DEFAULT_VECTOR_NAME: point.vector}

                # handle dense vectors
                all_dense_vector_names = list(self.vectors.keys())
                for name in all_dense_vector_names:
                    v = loaded_vector.get(name)
                    if v is not None:
                        vectors[name].append(v)
                    else:
                        vectors[name].append(
                            np.ones(self.vectors_config[name].size, dtype=np.float32)
                        )
                        deleted_ids.append((idx, name))

                # handle sparse vectors
                all_sparse_vector_names = list(self.sparse_vectors.keys())
                for name in all_sparse_vector_names:
                    v = loaded_vector.get(name)
                    if v is not None:
                        sparse_vectors[name].append(v)
                    else:
                        sparse_vectors[name].append(empty_sparse_vector())
                        deleted_ids.append((idx, name))

                # handle multivectors
                all_multivector_names = list(self.multivectors.keys())
                for name in all_multivector_names:
                    v = loaded_vector.get(name)
                    if v is not None:
                        multivectors[name].append(v)
                    else:
                        multivectors[name].append(np.array([]))
                        deleted_ids.append((idx, name))

            # setup dense vectors by name
            for name, named_vectors in vectors.items():
                self.vectors[name] = np.array(named_vectors)
                self.deleted_per_vector[name] = np.zeros(len(self.payload), dtype=bool)

            # setup sparse vectors by name
            for name, named_vectors in sparse_vectors.items():
                self.sparse_vectors[name] = named_vectors
                self.deleted_per_vector[name] = np.zeros(len(self.payload), dtype=bool)
                for vector in named_vectors:
                    self._update_idf_append(vector, name)

            # setup multivectors by name
            for name, named_vectors in multivectors.items():
                self.multivectors[name] = [np.array(vector) for vector in named_vectors]
                self.deleted_per_vector[name] = np.zeros(len(self.payload), dtype=bool)

            # track deleted points by named vector
            for idx, name in deleted_ids:
                self.deleted_per_vector[name][idx] = 1

            self.deleted = np.zeros(len(self.payload), dtype=bool)

    @classmethod
    def _resolve_query_vector_name(
        cls,
        query_vector: Union[
            List[float],
            Tuple[str, List[float]],
            List[List[float]],
            Tuple[str, List[List[float]]],
            types.NamedVector,
            types.NamedSparseVector,
            DenseQueryVector,
            Tuple[str, DenseQueryVector],
            Tuple[str, SparseQueryVector],
            MultiQueryVector,
            Tuple[str, MultiQueryVector],
            types.NumpyArray,
        ],
    ) -> Tuple[
        str, Union[DenseQueryVector, SparseQueryVector, MultiQueryVector, types.NumpyArray]
    ]:
        # SparseQueryVector is not in the method's signature, because sparse vectors can only be used as named vectors,
        # and there is no default name for them
        vector: Union[DenseQueryVector, SparseQueryVector, MultiQueryVector, types.NumpyArray]
        if isinstance(query_vector, tuple):
            name, query = query_vector
            if isinstance(query, list):
                vector = np.array(query)
            else:
                vector = query
        elif isinstance(query_vector, np.ndarray):
            name = DEFAULT_VECTOR_NAME
            vector = query_vector
        elif isinstance(query_vector, types.NamedVector):
            name = query_vector.name
            vector = np.array(query_vector.vector)
        elif isinstance(query_vector, types.NamedSparseVector):
            name = query_vector.name
            vector = query_vector.vector
        elif isinstance(query_vector, list):
            name = DEFAULT_VECTOR_NAME
            vector = np.array(query_vector)
        elif isinstance(query_vector, get_args(DenseQueryVector)):
            name = DEFAULT_VECTOR_NAME
            vector = query_vector
        elif isinstance(query_vector, get_args(MultiQueryVector)):
            name = DEFAULT_VECTOR_NAME
            vector = query_vector
        else:
            raise ValueError(f"Unsupported vector type {type(query_vector)}")

        return name, vector

    def get_vector_params(self, name: str) -> models.VectorParams:
        if isinstance(self.config.vectors, dict):
            if name in self.config.vectors:
                return self.config.vectors[name]
            else:
                raise ValueError(f"Vector {name} is not found in the collection")

        if isinstance(self.config.vectors, models.VectorParams):
            if name != DEFAULT_VECTOR_NAME:
                raise ValueError(f"Vector {name} is not found in the collection")

            return self.config.vectors

        raise ValueError(f"Malformed config.vectors: {self.config.vectors}")

    @classmethod
    def _check_include_pattern(cls, pattern: str, key: str) -> bool:
        """
        >>> LocalCollection._check_include_pattern('a', 'a')
        True
        >>> LocalCollection._check_include_pattern('a.b', 'b')
        False
        >>> LocalCollection._check_include_pattern('a.b', 'a.b')
        True
        >>> LocalCollection._check_include_pattern('a.b', 'a.b.c')
        True
        >>> LocalCollection._check_include_pattern('a.b[]', 'a.b[].c')
        True
        >>> LocalCollection._check_include_pattern('a.b[]', 'a.b.c')
        False
        >>> LocalCollection._check_include_pattern('a', 'a.b')
        True
        >>> LocalCollection._check_include_pattern('a.b', 'a')
        True
        >>> LocalCollection._check_include_pattern('a', 'aa.b.c')
        False
        >>> LocalCollection._check_include_pattern('a_b', 'a')
        False
        """
        pattern_parts = pattern.replace(".", "[.").split("[")
        key_parts = key.replace(".", "[.").split("[")
        return all(p == v for p, v in zip(pattern_parts, key_parts))

    @classmethod
    def _check_exclude_pattern(cls, pattern: str, key: str) -> bool:
        if len(pattern) > len(key):
            return False
        pattern_parts = pattern.replace(".", "[.").split("[")
        key_parts = key.replace(".", "[.").split("[")
        return all(p == v for p, v in zip(pattern_parts, key_parts))

    @classmethod
    def _filter_payload(
        cls, payload: Any, predicate: Callable[[str], bool], path: str = ""
    ) -> Any:
        if isinstance(payload, dict):
            res = {}
            if path != "":
                new_path = path + "."
            else:
                new_path = path

            for key, value in payload.items():
                if predicate(new_path + key):
                    res[key] = cls._filter_payload(value, predicate, new_path + key)
            return res
        elif isinstance(payload, list):
            res_array = []
            path = path + "[]"
            for idx, value in enumerate(payload):
                if predicate(path):
                    res_array.append(cls._filter_payload(value, predicate, path))
            return res_array
        else:
            return payload

    @classmethod
    def _process_payload(
        cls,
        payload: dict,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
    ) -> Optional[dict]:
        if not with_payload:
            return None

        if isinstance(with_payload, bool):
            return payload

        if isinstance(with_payload, list):
            return cls._filter_payload(
                payload,
                lambda key: any(
                    map(lambda pattern: cls._check_include_pattern(pattern, key), with_payload)  # type: ignore
                ),
            )

        if isinstance(with_payload, models.PayloadSelectorInclude):
            return cls._filter_payload(
                payload,
                lambda key: any(
                    map(
                        lambda pattern: cls._check_include_pattern(pattern, key),
                        with_payload.include,  # type: ignore
                    )
                ),
            )

        if isinstance(with_payload, models.PayloadSelectorExclude):
            return cls._filter_payload(
                payload,
                lambda key: all(
                    map(
                        lambda pattern: not cls._check_exclude_pattern(pattern, key),
                        with_payload.exclude,  # type: ignore
                    )
                ),
            )

        return payload

    def _get_payload(
        self,
        idx: int,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        return_copy: bool = True,
    ) -> Optional[models.Payload]:
        payload = self.payload[idx]
        processed_payload = self._process_payload(payload, with_payload)
        return deepcopy(processed_payload) if return_copy else processed_payload

    def _get_vectors(
        self, idx: int, with_vectors: Union[bool, Sequence[str], None] = False
    ) -> Optional[models.VectorStruct]:
        if with_vectors is False or with_vectors is None:
            return None

        dense_vectors = {
            name: self.vectors[name][idx].tolist()
            for name in self.vectors
            if not self.deleted_per_vector[name][idx]
        }

        sparse_vectors = {
            name: self.sparse_vectors[name][idx]
            for name in self.sparse_vectors
            if not self.deleted_per_vector[name][idx]
        }

        multivectors = {
            name: self.multivectors[name][idx].tolist()
            for name in self.multivectors
            if not self.deleted_per_vector[name][idx]
        }

        # merge vectors
        all_vectors = {**dense_vectors, **sparse_vectors, **multivectors}

        if isinstance(with_vectors, list):
            all_vectors = {name: all_vectors[name] for name in with_vectors if name in all_vectors}

        if len(all_vectors) == 1 and DEFAULT_VECTOR_NAME in all_vectors:
            return all_vectors[DEFAULT_VECTOR_NAME]

        return all_vectors

    def _payload_and_non_deleted_mask(
        self,
        payload_filter: Optional[models.Filter],
        vector_name: Optional[str] = None,
    ) -> np.ndarray:
        """
        Calculate mask for filtered payload and non-deleted points. True - accepted, False - rejected
        """
        payload_mask = calculate_payload_mask(
            payloads=self.payload,
            payload_filter=payload_filter,
            ids_inv=self.ids_inv,
        )

        # in deleted: 1 - deleted, 0 - not deleted
        # in payload_mask: 1 - accepted, 0 - rejected
        # in mask: 1 - ok, 0 - rejected
        mask = payload_mask & ~self.deleted

        if vector_name is not None:
            # in deleted: 1 - deleted, 0 - not deleted
            mask = mask & ~self.deleted_per_vector[vector_name]

        return mask

    def search(
        self,
        query_vector: Union[
            List[float],
            Tuple[str, List[float]],
            List[List[float]],
            Tuple[str, List[List[float]]],
            types.NamedVector,
            types.NamedSparseVector,
            DenseQueryVector,
            Tuple[str, DenseQueryVector],
            SparseQueryVector,
            Tuple[str, SparseQueryVector],
            MultiQueryVector,
            Tuple[str, MultiQueryVector],
            types.NumpyArray,
        ],
        query_filter: Optional[types.Filter] = None,
        limit: int = 10,
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
    ) -> List[models.ScoredPoint]:
        name, query_vector = self._resolve_query_vector_name(query_vector)

        result: List[models.ScoredPoint] = []
        sparse_scoring = False
        rescore_idf = False

        # early exit if the named vector does not exist
        if isinstance(query_vector, get_args(SparseQueryVector)):
            if name not in self.sparse_vectors:
                raise ValueError(f"Sparse vector {name} is not found in the collection")
            vectors = self.sparse_vectors[name]
            if self.config.sparse_vectors[name].modifier == models.Modifier.IDF:
                rescore_idf = True
            distance = Distance.DOT
            sparse_scoring = True
        elif isinstance(query_vector, get_args(MultiQueryVector)) or (
            isinstance(query_vector, np.ndarray) and len(query_vector.shape) == 2
        ):
            if name not in self.multivectors:
                raise ValueError(f"Multivector {name} is not found in the collection")
            vectors = self.multivectors[name]
            distance = self.get_vector_params(name).distance
        else:
            if name not in self.vectors:
                raise ValueError(f"Dense vector {name} is not found in the collection")
            vectors = self.vectors[name]
            distance = self.get_vector_params(name).distance

        vectors = vectors[: len(self.payload)]
        if isinstance(query_vector, np.ndarray):
            if len(query_vector.shape) == 1:
                scores = calculate_distance(query_vector, vectors, distance)
            else:
                scores = calculate_multi_distance(query_vector, vectors, distance)
        elif isinstance(query_vector, RecoQuery):
            scores = calculate_recommend_best_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, SparseRecoQuery):
            if rescore_idf:
                query_vector = query_vector.transform_sparse(lambda x: self._rescore_idf(x, name))
            scores = calculate_sparse_recommend_best_scores(query_vector, vectors)
        elif isinstance(query_vector, MultiRecoQuery):
            scores = calculate_multi_recommend_best_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, DiscoveryQuery):
            scores = calculate_discovery_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, SparseDiscoveryQuery):
            if rescore_idf:
                query_vector = query_vector.transform_sparse(lambda x: self._rescore_idf(x, name))
            scores = calculate_sparse_discovery_scores(query_vector, vectors)
        elif isinstance(query_vector, MultiDiscoveryQuery):
            scores = calculate_multi_discovery_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, ContextQuery):
            scores = calculate_context_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, SparseContextQuery):
            if rescore_idf:
                query_vector = query_vector.transform_sparse(lambda x: self._rescore_idf(x, name))
            scores = calculate_sparse_context_scores(query_vector, vectors)
        elif isinstance(query_vector, MultiContextQuery):
            scores = calculate_multi_context_scores(query_vector, vectors, distance)
        elif isinstance(query_vector, SparseVector):
            validate_sparse_vector(query_vector)
            if rescore_idf:
                query_vector = self._rescore_idf(query_vector, name)
            # sparse vector query must be sorted by indices for dot product to work with persisted vectors
            query_vector = sort_sparse_vector(query_vector)
            scores = calculate_distance_sparse(query_vector, vectors)
        else:
            raise (ValueError(f"Unsupported query vector type {type(query_vector)}"))

        mask = self._payload_and_non_deleted_mask(query_filter, vector_name=name)

        required_order = distance_to_order(distance)

        if required_order == DistanceOrder.BIGGER_IS_BETTER or isinstance(
            query_vector,
            (
                DiscoveryQuery,
                ContextQuery,
                RecoQuery,
                MultiDiscoveryQuery,
                MultiContextQuery,
                MultiRecoQuery,
            ),  # sparse structures are not required, sparse always uses DOT
        ):
            order = np.argsort(scores)[::-1]
        else:
            order = np.argsort(scores)
        offset = offset if offset is not None else 0
        for idx in order:
            if len(result) >= limit + offset:
                break

            if not mask[idx]:
                continue

            score = scores[idx]
            # skip undefined scores from sparse vectors
            if sparse_scoring and score == -np.inf:
                continue
            point_id = self.ids_inv[idx]

            if score_threshold is not None:
                if required_order == DistanceOrder.BIGGER_IS_BETTER:
                    if score < score_threshold:
                        break
                else:
                    if score > score_threshold:
                        break

            scored_point = construct(
                models.ScoredPoint,
                id=point_id,
                score=float(score),
                version=0,
                payload=self._get_payload(idx, with_payload),
                vector=self._get_vectors(idx, with_vectors),
            )

            result.append(scored_point)

        return result[offset:]

    def query_points(
        self,
        query: Optional[types.Query] = None,
        prefetch: Optional[List[types.Prefetch]] = None,
        query_filter: Optional[types.Filter] = None,
        limit: int = 10,
        offset: int = 0,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        using: Optional[str] = None,
        **kwargs: Any,
    ) -> types.QueryResponse:
        """
        Queries points in the local collection, resolving any prefetches first.

        Assumes all vectors have been homogenized so that there are no ids in the inputs
        """
        prefetches = []
        if prefetch is not None:
            prefetches = prefetch if isinstance(prefetch, list) else [prefetch]

        if len(prefetches) > 0:
            # It is a hybrid/re-scoring query
            sources = [self._prefetch(prefetch, offset) for prefetch in prefetches]

            # Merge sources
            scored_points = self._merge_sources(
                sources=sources,
                query=query,
                limit=limit,
                offset=offset,
                using=using,
                query_filter=query_filter,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )
        else:
            # It is a base query
            scored_points = self._query_collection(
                query=query,
                using=using,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )

        return types.QueryResponse(points=scored_points)

    def _prefetch(self, prefetch: types.Prefetch, offset: int) -> List[types.ScoredPoint]:
        if prefetch.limit is not None:
            prefetch.limit = prefetch.limit + offset

        inner_prefetches = []
        if prefetch.prefetch is not None:
            inner_prefetches = (
                prefetch.prefetch if isinstance(prefetch.prefetch, list) else [prefetch.prefetch]
            )

        if len(inner_prefetches) > 0:
            sources = [
                self._prefetch(inner_prefetch, offset) for inner_prefetch in inner_prefetches
            ]

            # Merge sources
            return self._merge_sources(
                sources=sources,
                query=prefetch.query,
                limit=prefetch.limit,
                offset=0,
                using=prefetch.using,
                query_filter=prefetch.filter,
                with_payload=False,
                with_vectors=False,
                score_threshold=prefetch.score_threshold,
            )
        else:
            # Base case: fetch from collection
            return self._query_collection(
                query=prefetch.query,
                using=prefetch.using,
                query_filter=prefetch.filter,
                limit=prefetch.limit,
                offset=0,
                with_payload=False,
                with_vectors=False,
                score_threshold=prefetch.score_threshold,
            )

    def _merge_sources(
        self,
        sources: List[List[types.ScoredPoint]],
        query: types.Query,
        limit: int,
        offset: int,
        using: Optional[str] = None,
        query_filter: Optional[types.Filter] = None,
        score_threshold: Optional[float] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> List[types.ScoredPoint]:
        if isinstance(query, models.FusionQuery):
            # Fuse results
            if query.fusion == models.Fusion.RRF:
                # RRF: Reciprocal Rank Fusion
                fused = reciprocal_rank_fusion(responses=sources, limit=limit + offset)
            elif query.fusion == models.Fusion.DBSF:
                # DBSF: Distribution-Based Score Fusion
                fused = distribution_based_score_fusion(responses=sources, limit=limit + offset)
            else:
                raise ValueError(f"Fusion method {query.fusion} does not exist")

            # Fetch payload and vectors
            ids = [point.id for point in fused]
            fetched_points = self.retrieve(
                ids, with_payload=with_payload, with_vectors=with_vectors
            )
            for fetched, scored in zip(fetched_points, fused):
                scored.payload = fetched.payload
                scored.vector = fetched.vector

            return fused[offset:]
        else:
            # Re-score
            sources_ids = set()
            for source in sources:
                for point in source:
                    sources_ids.add(point.id)

            if len(sources_ids) == 0:
                # no need to perform a query if there are no matches for the sources
                return []
            else:
                filter_with_sources = _include_ids_in_filter(query_filter, list(sources_ids))
                return self._query_collection(
                    query=query,
                    using=using,
                    query_filter=filter_with_sources,
                    limit=limit,
                    offset=offset,
                    with_payload=with_payload,
                    with_vectors=with_vectors,
                    score_threshold=score_threshold,
                )

    def _query_collection(
        self,
        query: Optional[types.Query] = None,
        using: Optional[str] = None,
        query_filter: Optional[types.Filter] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = False,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
    ) -> List[types.ScoredPoint]:
        """
        Performs the query on the collection, assuming it didn't have any prefetches.
        """

        using = using or DEFAULT_VECTOR_NAME
        limit = limit or 10
        offset = offset or 0

        if query is None:
            records, _ = self.scroll(
                scroll_filter=query_filter,
                limit=limit + offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
            )
            return [record_to_scored_point(record) for record in records[offset:]]
        elif isinstance(query, models.NearestQuery):
            return self.search(
                query_vector=(using, query.nearest),
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )
        elif isinstance(query, models.RecommendQuery):
            return self.recommend(
                positive=query.recommend.positive,
                negative=query.recommend.negative,
                strategy=query.recommend.strategy,
                using=using,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )
        elif isinstance(query, models.DiscoverQuery):
            return self.discover(
                target=query.discover.target,
                context=query.discover.context,
                using=using,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )
        elif isinstance(query, models.ContextQuery):
            return self.discover(
                context=query.context,
                using=using,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )
        elif isinstance(query, models.OrderByQuery):
            records, _ = self.scroll(
                scroll_filter=query_filter,
                order_by=query.order_by,
                limit=limit + offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
            )
            return [record_to_scored_point(record) for record in records[offset:]]
        elif isinstance(query, models.SampleQuery):
            if query.sample == models.Sample.RANDOM:
                return self._sample_randomly(
                    limit=limit + offset,
                    query_filter=query_filter,
                    with_payload=with_payload,
                    with_vectors=with_vectors,
                )
            else:
                raise ValueError(f"Unknown Sample variant: {query.sample}")
        elif isinstance(query, models.FusionQuery):
            raise AssertionError("Cannot perform fusion without prefetches")
        else:
            # most likely a VectorInput, delegate to search
            return self.search(
                query_vector=(using, query),
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
                score_threshold=score_threshold,
            )

    def query_groups(
        self,
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
        limit: int = 10,
        group_size: int = 3,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        with_lookup_collection: Optional["LocalCollection"] = None,
    ) -> models.GroupsResult:
        max_limit = len(self.ids_inv)
        # rewrite prefetch with larger limit
        if prefetch is not None:
            if isinstance(prefetch, list):
                tmp = []
                for p in prefetch:
                    tmp.append(set_prefetch_limit_recursively(p, max_limit))
                    prefetch = tmp
            else:
                prefetch = set_prefetch_limit_recursively(prefetch, max_limit)

        points = self.query_points(
            query=query,
            query_filter=query_filter,
            prefetch=prefetch,
            using=using,
            limit=len(self.ids_inv),
            with_payload=True,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
        )

        groups = OrderedDict()

        for point in points.points:
            if not isinstance(point.payload, dict):
                continue

            group_values = value_by_key(point.payload, group_by)
            if group_values is None:
                continue

            group_values = list(set(v for v in group_values if isinstance(v, (str, int))))

            point.payload = self._process_payload(point.payload, with_payload)

            for group_value in group_values:
                if group_value not in groups:
                    groups[group_value] = models.PointGroup(id=group_value, hits=[])

                if len(groups[group_value].hits) >= group_size:
                    continue

                groups[group_value].hits.append(point)

        groups_result: List[models.PointGroup] = list(groups.values())[:limit]

        if isinstance(with_lookup, str):
            with_lookup = models.WithLookup(
                collection=with_lookup,
                with_payload=None,
                with_vectors=None,
            )

        if with_lookup is not None and with_lookup_collection is not None:
            for group in groups_result:
                lookup = with_lookup_collection.retrieve(
                    ids=[group.id],
                    with_payload=with_lookup.with_payload,
                    with_vectors=with_lookup.with_vectors,
                )
                group.lookup = next(iter(lookup), None)

        return models.GroupsResult(groups=groups_result)

    def search_groups(
        self,
        query_vector: Union[
            Sequence[float],
            List[List[float]],
            Tuple[
                str,
                Union[
                    models.Vector,
                    RecoQuery,
                    SparseRecoQuery,
                    MultiRecoQuery,
                    types.NumpyArray,
                ],
            ],
            types.NamedVector,
            types.NamedSparseVector,
            RecoQuery,
            SparseRecoQuery,
            MultiRecoQuery,
            types.NumpyArray,
        ],
        group_by: str,
        query_filter: Optional[models.Filter] = None,
        limit: int = 10,
        group_size: int = 1,
        with_payload: Union[bool, Sequence[str], models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        with_lookup_collection: Optional["LocalCollection"] = None,
    ) -> models.GroupsResult:
        points = self.search(
            query_vector=query_vector,
            query_filter=query_filter,
            limit=len(self.ids_inv),
            with_payload=True,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
        )

        groups = OrderedDict()

        for point in points:
            if not isinstance(point.payload, dict):
                continue

            group_values = value_by_key(point.payload, group_by)
            if group_values is None:
                continue

            group_values = list(set(v for v in group_values if isinstance(v, (str, int))))

            point.payload = self._process_payload(point.payload, with_payload)

            for group_value in group_values:
                if group_value not in groups:
                    groups[group_value] = models.PointGroup(id=group_value, hits=[])

                if len(groups[group_value].hits) >= group_size:
                    continue

                groups[group_value].hits.append(point)

        groups_result: List[models.PointGroup] = list(groups.values())[:limit]

        if isinstance(with_lookup, str):
            with_lookup = models.WithLookup(
                collection=with_lookup,
                with_payload=None,
                with_vectors=None,
            )

        if with_lookup is not None and with_lookup_collection is not None:
            for group in groups_result:
                lookup = with_lookup_collection.retrieve(
                    ids=[group.id],
                    with_payload=with_lookup.with_payload,
                    with_vectors=with_lookup.with_vectors,
                )
                group.lookup = next(iter(lookup), None)

        return models.GroupsResult(groups=groups_result)

    def facet(
        self,
        key: str,
        facet_filter: Optional[types.Filter] = None,
        limit: int = 10,
    ) -> types.FacetResponse:
        facet_hits: Dict[types.FacetValue, int] = defaultdict(int)

        mask = self._payload_and_non_deleted_mask(facet_filter)

        for idx, payload in enumerate(self.payload):
            if not mask[idx]:
                continue

            if not isinstance(payload, dict):
                continue

            values = value_by_key(payload, key)

            if values is None:
                continue

            # Only count the same value for each point once
            values_set: Set[types.FacetValue] = set()

            # Sanitize to use only valid values
            for v in values:
                if type(v) not in get_args_subscribed(types.FacetValue):
                    continue

                # If values are UUIDs, format with hyphens
                as_uuid = parse_uuid(v)
                if as_uuid:
                    v = str(as_uuid)

                values_set.add(v)

            for v in values_set:
                facet_hits[v] += 1

        hits = [
            models.FacetValueHit(value=value, count=count)
            for value, count in sorted(
                facet_hits.items(),
                # order by count descending, then by value ascending
                key=lambda x: (-x[1], x[0]),
            )[:limit]
        ]

        return types.FacetResponse(hits=hits)

    def retrieve(
        self,
        ids: Sequence[types.PointId],
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> List[models.Record]:
        result = []

        for point_id in ids:
            if point_id not in self.ids:
                continue

            idx = self.ids[point_id]
            if self.deleted[idx] == 1:
                continue

            result.append(
                models.Record(
                    id=point_id,
                    payload=self._get_payload(idx, with_payload),
                    vector=self._get_vectors(idx, with_vectors),
                )
            )

        return result

    def _preprocess_recommend_input(
        self,
        positive: Optional[Sequence[models.VectorInput]] = None,
        negative: Optional[Sequence[models.VectorInput]] = None,
        strategy: Optional[types.RecommendStrategy] = None,
        query_filter: Optional[types.Filter] = None,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
    ) -> Tuple[
        List[List[float]],
        List[List[float]],
        List[models.SparseVector],
        List[models.SparseVector],
        List[List[List[float]]],
        List[List[List[float]]],
        types.Filter,
    ]:
        def examples_into_vectors(
            examples: Sequence[models.VectorInput],
            acc: Union[List[List[float]], List[models.SparseVector], List[List[List[float]]]],
        ) -> None:
            for example in examples:
                if isinstance(example, get_args(types.PointId)):
                    if example not in collection.ids:
                        raise ValueError(f"Point {example} is not found in the collection")

                    idx = collection.ids[example]
                    vec = collection_vectors[vector_name][idx]
                    if isinstance(vec, np.ndarray):
                        vec = vec.tolist()
                    acc.append(vec)
                    if collection == self:
                        mentioned_ids.append(example)
                else:
                    acc.append(example)

        collection = lookup_from_collection if lookup_from_collection is not None else self
        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME
        vector_name = (
            lookup_from_vector_name
            if lookup_from_vector_name is not None
            else search_in_vector_name
        )

        positive = positive if positive is not None else []
        negative = negative if negative is not None else []

        # Validate input depending on strategy
        if strategy == types.RecommendStrategy.AVERAGE_VECTOR:
            if len(positive) == 0:
                raise ValueError("Positive list is empty")
        elif strategy == types.RecommendStrategy.BEST_SCORE:
            if len(positive) == 0 and len(negative) == 0:
                raise ValueError("No positive or negative examples given")

        # Turn every example into vectors
        positive_vectors: List[List[float]] = []
        negative_vectors: List[List[float]] = []
        sparse_positive_vectors: List[models.SparseVector] = []
        sparse_negative_vectors: List[models.SparseVector] = []
        positive_multivectors: List[List[List[float]]] = []
        negative_multivectors: List[List[List[float]]] = []
        mentioned_ids: List[ExtendedPointId] = []

        sparse = vector_name in collection.sparse_vectors
        multi = vector_name in collection.multivectors
        if sparse:
            collection_vectors = collection.sparse_vectors
            examples_into_vectors(positive, sparse_positive_vectors)
            examples_into_vectors(negative, sparse_negative_vectors)
        elif multi:
            collection_vectors = collection.multivectors
            examples_into_vectors(positive, positive_multivectors)
            examples_into_vectors(negative, negative_multivectors)
        else:
            collection_vectors = collection.vectors
            examples_into_vectors(positive, positive_vectors)
            examples_into_vectors(negative, negative_vectors)

        # Edit query filter
        query_filter = ignore_mentioned_ids_filter(query_filter, mentioned_ids)

        return (
            positive_vectors,
            negative_vectors,
            sparse_positive_vectors,
            sparse_negative_vectors,
            positive_multivectors,
            negative_multivectors,
            query_filter,
        )

    @staticmethod
    def _recommend_average_dense(
        positive_vectors: List[List[float]], negative_vectors: List[List[float]]
    ) -> types.NumpyArray:
        positive_vectors_np = np.stack(positive_vectors)
        negative_vectors_np = np.stack(negative_vectors) if len(negative_vectors) > 0 else None

        mean_positive_vector = np.mean(positive_vectors_np, axis=0)

        if negative_vectors_np is not None:
            vector = (
                mean_positive_vector + mean_positive_vector - np.mean(negative_vectors_np, axis=0)
            )
        else:
            vector = mean_positive_vector
        return vector

    @staticmethod
    def _recommend_average_sparse(
        positive_vectors: List[models.SparseVector],
        negative_vectors: List[models.SparseVector],
    ) -> models.SparseVector:
        for i, vector in enumerate(positive_vectors):
            validate_sparse_vector(vector)
            positive_vectors[i] = sort_sparse_vector(vector)

        for i, vector in enumerate(negative_vectors):
            validate_sparse_vector(vector)
            negative_vectors[i] = sort_sparse_vector(vector)

        mean_positive_vector = sparse_avg(positive_vectors)

        if negative_vectors:
            mean_negative_vector = sparse_avg(negative_vectors)
            vector = merge_positive_and_negative_avg(mean_positive_vector, mean_negative_vector)
        else:
            vector = mean_positive_vector
        return vector

    def _construct_recommend_query(
        self,
        positive: Optional[Sequence[models.VectorInput]] = None,
        negative: Optional[Sequence[models.VectorInput]] = None,
        query_filter: Optional[types.Filter] = None,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
        strategy: Optional[types.RecommendStrategy] = None,
    ) -> Tuple[
        Union[RecoQuery, SparseRecoQuery, MultiRecoQuery, models.SparseVector, types.NumpyArray],
        types.Filter,
    ]:
        strategy = strategy if strategy is not None else types.RecommendStrategy.AVERAGE_VECTOR

        (
            positive_vectors,
            negative_vectors,
            sparse_positive_vectors,
            sparse_negative_vectors,
            multi_positive_vectors,
            multi_negative_vectors,
            edited_query_filter,
        ) = self._preprocess_recommend_input(
            positive,
            negative,
            strategy,
            query_filter,
            using,
            lookup_from_collection,
            lookup_from_vector_name,
        )

        if strategy == types.RecommendStrategy.AVERAGE_VECTOR:
            # Validate input
            if positive_vectors:
                query_vector = self._recommend_average_dense(
                    positive_vectors,
                    negative_vectors,
                )
            elif sparse_positive_vectors:
                query_vector = self._recommend_average_sparse(
                    sparse_positive_vectors,
                    sparse_negative_vectors,
                )
            elif multi_positive_vectors:
                raise TypeError(
                    "Multivectors do not support recommend average, consider using "
                    "strategy=models.RecommendStrategy.BEST_SCORE"
                )
            else:
                raise ValueError("No positive examples given with 'average_vector' strategy")

        elif strategy == types.RecommendStrategy.BEST_SCORE:
            if positive_vectors or negative_vectors:
                query_vector = RecoQuery(
                    positive=positive_vectors,
                    negative=negative_vectors,
                )
            elif sparse_positive_vectors or sparse_negative_vectors:
                query_vector = SparseRecoQuery(
                    positive=sparse_positive_vectors, negative=sparse_negative_vectors
                )
            elif multi_positive_vectors or multi_negative_vectors:
                query_vector = MultiRecoQuery(
                    positive=multi_positive_vectors, negative=multi_negative_vectors
                )
            else:
                raise ValueError(
                    "No positive or negative examples given with 'best_score' strategy"
                )
        else:
            raise ValueError(
                f"strategy `{strategy}` is not a valid strategy, choose one from {types.RecommendStrategy}"
            )
        return query_vector, edited_query_filter

    def recommend(
        self,
        positive: Optional[Sequence[models.VectorInput]] = None,
        negative: Optional[Sequence[models.VectorInput]] = None,
        query_filter: Optional[types.Filter] = None,
        limit: int = 10,
        offset: int = 0,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
        strategy: Optional[types.RecommendStrategy] = None,
    ) -> List[models.ScoredPoint]:
        query_vector, edited_query_filter = self._construct_recommend_query(
            positive,
            negative,
            query_filter,
            using,
            lookup_from_collection,
            lookup_from_vector_name,
            strategy,
        )
        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME

        return self.search(
            query_vector=(search_in_vector_name, query_vector),
            query_filter=edited_query_filter,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
        )

    def recommend_groups(
        self,
        group_by: str,
        positive: Optional[Sequence[models.VectorInput]] = None,
        negative: Optional[Sequence[models.VectorInput]] = None,
        query_filter: Optional[models.Filter] = None,
        limit: int = 10,
        group_size: int = 1,
        score_threshold: Optional[float] = None,
        with_payload: Union[bool, Sequence[str], models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        with_lookup_collection: Optional["LocalCollection"] = None,
        strategy: Optional[types.RecommendStrategy] = None,
    ) -> types.GroupsResult:
        strategy = strategy if strategy is not None else types.RecommendStrategy.AVERAGE_VECTOR

        query_vector, edited_query_filter = self._construct_recommend_query(
            positive,
            negative,
            query_filter,
            using,
            lookup_from_collection,
            lookup_from_vector_name,
            strategy,
        )

        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME

        return self.search_groups(
            query_vector=(search_in_vector_name, query_vector),
            query_filter=edited_query_filter,
            group_by=group_by,
            group_size=group_size,
            limit=limit,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
            with_lookup=with_lookup,
            with_lookup_collection=with_lookup_collection,
        )

    def search_matrix_offsets(
        self,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
    ) -> types.SearchMatrixOffsetsResponse:
        ids, all_scores = self._search_distance_matrix(
            query_filter=query_filter, limit=limit, sample=sample, using=using
        )

        offsets_row = []
        offsets_col = []

        offset_by_id = {point_id: idx for idx, point_id in enumerate(ids)}

        for row_offset, scored_points in enumerate(all_scores):
            for scored_point in scored_points:
                offsets_row.append(row_offset)
                offsets_col.append(offset_by_id[scored_point.id])

        # flatten the scores
        scores = []
        for sample_scores in all_scores:
            for score in sample_scores:
                scores.append(score.score)

        return types.SearchMatrixOffsetsResponse(
            offsets_row=offsets_row,
            offsets_col=offsets_col,
            scores=scores,
            ids=ids,
        )

    def search_matrix_pairs(
        self,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
    ) -> types.SearchMatrixPairsResponse:
        ids, all_scores = self._search_distance_matrix(
            query_filter=query_filter, limit=limit, sample=sample, using=using
        )
        pairs = []
        for sample_id, sample_scores in list(zip(ids, all_scores)):
            for sample_score in sample_scores:
                pairs.append(
                    types.SearchMatrixPair(
                        a=sample_id, b=sample_score.id, score=sample_score.score
                    )
                )

        return types.SearchMatrixPairsResponse(
            pairs=pairs,
        )

    def _search_distance_matrix(
        self,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
    ) -> Tuple[List[ExtendedPointId], List[List[ScoredPoint]]]:
        samples: List[ScoredPoint] = []
        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME
        # Sample random points from the whole collection to filter out the ones without vectors
        # TODO: use search_filter once with have an HasVector like condition
        candidates = self._sample_randomly(
            len(self.ids), query_filter, False, search_in_vector_name
        )
        for candidate in candidates:
            # check if enough samples are collected
            if len(samples) == sample:
                break
            # check if the candidate has a vector
            if candidate.vector is not None:
                samples.append(candidate)

        # can't build a matrix with less than 2 results
        if len(samples) < 2:
            return [], []

        # sort samples by id
        samples = sorted(samples, key=lambda x: x.id)
        # extract the ids
        ids = [sample.id for sample in samples]
        scores: List[List[ScoredPoint]] = []

        # Query `limit` neighbors for each sample
        for sampled_id_index, sampled in enumerate(samples):
            ids_to_includes = [x for (i, x) in enumerate(ids) if i != sampled_id_index]
            sampling_filter = _include_ids_in_filter(query_filter, ids_to_includes)
            sampled_vector = sampled.vector
            search_vector = (
                sampled_vector[search_in_vector_name]
                if isinstance(sampled_vector, dict)
                else sampled_vector
            )
            samples_scores = self.search(
                query_vector=(search_in_vector_name, search_vector),
                query_filter=sampling_filter,
                limit=limit,
                with_payload=False,
                with_vectors=False,
            )
            scores.append(samples_scores)

        return ids, scores

    @staticmethod
    def _preprocess_target(
        target: Optional[models.VectorInput], collection: "LocalCollection", vector_name: str
    ) -> Tuple[models.Vector, types.PointId]:
        # todo: context can no longer be grpc.TargetVector, but models.VectorInput, currently, grpc types are not supported
        target = (
            GrpcToRest.convert_target_vector(target)
            if target is not None and isinstance(target, grpc.TargetVector)
            else target
        )
        if isinstance(target, get_args(types.PointId)):
            if target not in collection.ids:
                raise ValueError(f"Point {target} is not found in the collection")

            idx = collection.ids[target]
            if vector_name in collection.vectors:
                target_vector = collection.vectors[vector_name][idx].tolist()
            elif vector_name in collection.sparse_vectors:
                target_vector = collection.sparse_vectors[vector_name][idx]
            else:
                target_vector = collection.multivectors[vector_name][idx].tolist()

            return target_vector, target

        return target, None

    def _preprocess_context(
        self, context: List[models.ContextPair], collection: "LocalCollection", vector_name: str
    ) -> Tuple[
        List[ContextPair], List[SparseContextPair], List[MultiContextPair], List[types.PointId]
    ]:
        # todo: context can no longer be ContextExamplePair, currently grpc types are not supported
        context = [
            (
                GrpcToRest.convert_context_example_pair(pair)
                if isinstance(pair, grpc.ContextExamplePair)
                else pair
            )
            for pair in context
        ]
        mentioned_ids = []
        dense_context_vectors = []
        sparse_context_vectors = []
        multi_context_vectors = []

        for pair in context:
            pair_vectors = []
            for example in [pair.positive, pair.negative]:
                if isinstance(example, get_args(types.PointId)):
                    if example not in collection.ids:
                        raise ValueError(f"Point {example} is not found in the collection")

                    idx = collection.ids[example]
                    if vector_name in collection.vectors:
                        vector = collection.vectors[vector_name][idx].tolist()
                    elif vector_name in collection.sparse_vectors:
                        vector = collection.sparse_vectors[vector_name][idx]
                    else:
                        vector = collection.multivectors[vector_name][idx].tolist()

                    pair_vectors.append(vector)
                    if collection == self:
                        mentioned_ids.append(example)
                else:
                    pair_vectors.append(example)

            if isinstance(pair_vectors[0], SparseVector) and isinstance(
                pair_vectors[1], SparseVector
            ):
                sparse_context_vectors.append(
                    SparseContextPair(positive=pair_vectors[0], negative=pair_vectors[1])
                )
            elif isinstance(pair_vectors[0], list) and isinstance(pair_vectors[1], list):
                if isinstance(pair_vectors[0][0], float) and isinstance(pair_vectors[1][0], float):
                    dense_context_vectors.append(
                        ContextPair(positive=pair_vectors[0], negative=pair_vectors[1])
                    )
                elif isinstance(pair_vectors[0][0], list) and isinstance(pair_vectors[1][0], list):
                    multi_context_vectors.append(
                        MultiContextPair(positive=pair_vectors[0], negative=pair_vectors[1])
                    )
                else:
                    raise ValueError(
                        "Context example pair must be of the same type: dense, sparse or multi vectors"
                    )
            else:
                raise ValueError(
                    "Context example pair must be of the same type: dense, sparse or multi vectors"
                )

        if (
            sum(
                [
                    bool(sparse_context_vectors),
                    bool(dense_context_vectors),
                    bool(multi_context_vectors),
                ]
            )
            > 1
        ):
            raise ValueError(
                "All context example pairs must be either dense or sparse or multi vectors"
            )

        return dense_context_vectors, sparse_context_vectors, multi_context_vectors, mentioned_ids

    def _preprocess_discover(
        self,
        target: Optional[models.VectorInput] = None,
        context: Optional[Sequence[models.ContextPair]] = None,
        query_filter: Optional[types.Filter] = None,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
    ) -> Tuple[
        Optional[models.Vector],
        List[ContextPair],
        List[SparseContextPair],
        List[MultiContextPair],
        types.Filter,
    ]:
        if target is None and not context:
            raise ValueError("No target or context given")

        collection = lookup_from_collection if lookup_from_collection is not None else self
        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME
        vector_name = (
            lookup_from_vector_name
            if lookup_from_vector_name is not None
            else search_in_vector_name
        )

        target_vector, target_id = self._preprocess_target(target, collection, vector_name)
        context = list(context) if context is not None else []

        dense_context_vectors, sparse_context_vectors, multi_context_vectors, mentioned_ids = (
            self._preprocess_context(context, collection, vector_name)
        )

        if target_id is not None and collection == self:
            mentioned_ids.append(target_id)

        # Edit query filter
        query_filter = ignore_mentioned_ids_filter(query_filter, mentioned_ids)

        return (
            target_vector,
            dense_context_vectors,
            sparse_context_vectors,
            multi_context_vectors,
            query_filter,
        )  # type: ignore

    def discover(
        self,
        target: Optional[models.VectorInput] = None,
        context: Optional[Sequence[models.ContextPair]] = None,
        query_filter: Optional[types.Filter] = None,
        limit: int = 10,
        offset: int = 0,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        using: Optional[str] = None,
        lookup_from_collection: Optional["LocalCollection"] = None,
        lookup_from_vector_name: Optional[str] = None,
        score_threshold: Optional[float] = None,
    ) -> List[models.ScoredPoint]:
        (
            target_vector,
            dense_context_vectors,
            sparse_context_vectors,
            multi_context_vectors,
            edited_query_filter,
        ) = self._preprocess_discover(
            target,
            context,
            query_filter,
            using,
            lookup_from_collection,
            lookup_from_vector_name,
        )

        query_vector: Union[DenseQueryVector, SparseQueryVector, MultiQueryVector]

        # Discovery search
        if target_vector is not None:
            if isinstance(target_vector, list):
                if isinstance(target_vector[0], float):
                    query_vector = DiscoveryQuery(target_vector, dense_context_vectors)
                else:
                    query_vector = MultiDiscoveryQuery(target_vector, multi_context_vectors)
            elif isinstance(target_vector, SparseVector):
                query_vector = SparseDiscoveryQuery(target_vector, sparse_context_vectors)
            else:
                raise ValueError("Unsupported target vector type")

        # Context search
        elif target_vector is None and dense_context_vectors:
            query_vector = ContextQuery(dense_context_vectors)
        elif target_vector is None and sparse_context_vectors:
            query_vector = SparseContextQuery(sparse_context_vectors)
        elif target_vector is None and multi_context_vectors:
            query_vector = MultiContextQuery(multi_context_vectors)
        else:
            raise ValueError("No target or context given")

        search_in_vector_name = using if using is not None else DEFAULT_VECTOR_NAME

        return self.search(
            query_vector=(search_in_vector_name, query_vector),
            query_filter=edited_query_filter,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
            score_threshold=score_threshold,
        )

    @classmethod
    def _universal_id(cls, point_id: models.ExtendedPointId) -> Tuple[str, int]:
        if isinstance(point_id, str):
            return point_id, 0
        elif isinstance(point_id, int):
            return "", point_id
        raise TypeError(f"Incompatible point id type: {type(point_id)}")

    def scroll(
        self,
        scroll_filter: Optional[types.Filter] = None,
        limit: int = 10,
        order_by: Optional[types.OrderBy] = None,
        offset: Optional[types.PointId] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> Tuple[List[types.Record], Optional[types.PointId]]:
        if len(self.ids) == 0:
            return [], None

        if order_by is None:
            # order by id (default)
            return self._scroll_by_id(
                scroll_filter=scroll_filter,
                limit=limit,
                offset=offset,
                with_payload=with_payload,
                with_vectors=with_vectors,
            )

        # order by value
        if offset is not None:
            raise ValueError(
                "Offset is not supported in conjunction with `order_by` scroll parameter"
            )

        return self._scroll_by_value(
            order_by=order_by,
            scroll_filter=scroll_filter,
            limit=limit,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    def count(self, count_filter: Optional[types.Filter] = None) -> models.CountResult:
        mask = self._payload_and_non_deleted_mask(count_filter)

        return models.CountResult(count=np.count_nonzero(mask))

    def _scroll_by_id(
        self,
        scroll_filter: Optional[types.Filter] = None,
        limit: int = 10,
        offset: Optional[types.PointId] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> Tuple[List[types.Record], Optional[types.PointId]]:
        sorted_ids = sorted(self.ids.items(), key=lambda x: self._universal_id(x[0]))

        result: List[types.Record] = []

        mask = self._payload_and_non_deleted_mask(scroll_filter)

        for point_id, idx in sorted_ids:
            if offset is not None and self._universal_id(point_id) < self._universal_id(offset):
                continue

            if len(result) >= limit + 1:
                break

            if not mask[idx]:
                continue

            result.append(
                models.Record(
                    id=point_id,
                    payload=self._get_payload(idx, with_payload),
                    vector=self._get_vectors(idx, with_vectors),
                )
            )

        if len(result) > limit:
            return result[:limit], result[limit].id
        else:
            return result, None

    def _scroll_by_value(
        self,
        order_by: types.OrderBy,
        scroll_filter: Optional[types.Filter] = None,
        limit: int = 10,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> Tuple[List[types.Record], Optional[types.PointId]]:
        if isinstance(order_by, grpc.OrderBy):
            order_by = GrpcToRest.convert_order_by(order_by)
        if isinstance(order_by, str):
            order_by = models.OrderBy(key=order_by)

        value_and_ids: List[Tuple[OrderValue, ExtendedPointId, int]] = []

        for external_id, internal_id in self.ids.items():
            # get order-by values for id
            payload_values = value_by_key(self.payload[internal_id], order_by.key)
            if payload_values is None:
                continue

            # replicate id for each value it has
            for value in payload_values:
                ordering_value = to_order_value(value)
                if ordering_value is not None:
                    value_and_ids.append((ordering_value, external_id, internal_id))

        direction = order_by.direction if order_by.direction is not None else models.Direction.ASC

        should_reverse = direction == models.Direction.DESC

        # sort by value only
        value_and_ids.sort(key=lambda x: x[0], reverse=should_reverse)

        mask = self._payload_and_non_deleted_mask(scroll_filter)

        result: List[types.Record] = []

        start_from = to_order_value(order_by.start_from)

        for value, external_id, internal_id in value_and_ids:
            if start_from is not None:
                if direction == models.Direction.ASC:
                    if value < start_from:
                        continue
                elif direction == models.Direction.DESC:
                    if value > start_from:
                        continue

            if len(result) >= limit:
                break

            if not mask[internal_id]:
                continue

            result.append(
                models.Record(
                    id=external_id,
                    payload=self._get_payload(internal_id, with_payload),
                    vector=self._get_vectors(internal_id, with_vectors),
                )
            )

        return result, None

    def _sample_randomly(
        self,
        limit: int,
        query_filter: Optional[types.Filter],
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
    ) -> List[types.ScoredPoint]:
        mask = self._payload_and_non_deleted_mask(query_filter)

        random_scores = np.random.rand(len(self.ids))
        random_order = np.argsort(random_scores)

        result: List[types.ScoredPoint] = []
        for idx in random_order:
            if len(result) >= limit:
                break

            if not mask[idx]:
                continue

            point_id = self.ids_inv[idx]

            scored_point = construct(
                models.ScoredPoint,
                id=point_id,
                score=float(0),
                version=0,
                payload=self._get_payload(idx, with_payload),
                vector=self._get_vectors(idx, with_vectors),
            )

            result.append(scored_point)

        return result

    def _update_point(self, point: models.PointStruct) -> None:
        idx = self.ids[point.id]
        self.payload[idx] = deepcopy(
            to_jsonable_python(point.payload) if point.payload is not None else {}
        )

        if isinstance(point.vector, list):
            vectors = {DEFAULT_VECTOR_NAME: point.vector}
        else:
            vectors = point.vector

        # dense vectors
        for vector_name, _named_vectors in self.vectors.items():
            vector = vectors.get(vector_name)
            if vector is not None:
                params = self.get_vector_params(vector_name)
                assert not np.isnan(vector).any(), "Vector contains NaN values"
                if params.distance == models.Distance.COSINE:
                    norm = np.linalg.norm(vector)
                    vector = np.array(vector) / norm if norm > EPSILON else vector
                self.vectors[vector_name][idx] = vector
                self.deleted_per_vector[vector_name][idx] = 0
            else:
                self.deleted_per_vector[vector_name][idx] = 1

        # sparse vectors
        for vector_name, _named_vectors in self.sparse_vectors.items():
            vector = vectors.get(vector_name)
            was_deleted = self.deleted_per_vector[vector_name][idx]
            if not was_deleted:
                previous_vector = self.sparse_vectors[vector_name][idx]
                self._update_idf_remove(previous_vector, vector_name)

            if vector is not None:
                self.sparse_vectors[vector_name][idx] = vector
                self.deleted_per_vector[vector_name][idx] = 0
                self._update_idf_append(vector, vector_name)
            else:
                self.deleted_per_vector[vector_name][idx] = 1

        # multivectors
        for vector_name, _named_vector in self.multivectors.items():
            vector = vectors.get(vector_name)
            if vector is not None:
                params = self.get_vector_params(vector_name)
                assert not np.isnan(vector).any(), "Vector contains NaN values"

                if params.distance == models.Distance.COSINE:
                    vector_norm = np.linalg.norm(vector, axis=-1)[:, np.newaxis]
                    vector /= np.where(vector_norm != 0.0, vector_norm, EPSILON)
                self.multivectors[vector_name][idx] = np.array(vector)
                self.deleted_per_vector[vector_name][idx] = 0
            else:
                self.deleted_per_vector[vector_name][idx] = 1

        self.deleted[idx] = 0

    def _add_point(self, point: models.PointStruct) -> None:
        idx = len(self.ids)
        self.ids[point.id] = idx
        self.ids_inv.append(point.id)

        self.payload.append(
            deepcopy(to_jsonable_python(point.payload) if point.payload is not None else {})
        )
        assert len(self.payload) == len(self.ids_inv), "Payload and ids_inv must be the same size"
        self.deleted = np.append(self.deleted, 0)

        if isinstance(point.vector, list):
            vectors = {DEFAULT_VECTOR_NAME: point.vector}
        else:
            vectors = point.vector

        # dense vectors
        for vector_name, named_vectors in self.vectors.items():
            vector = vectors.get(vector_name)
            if named_vectors.shape[0] <= idx:
                named_vectors = np.resize(named_vectors, (idx * 2 + 1, named_vectors.shape[1]))

            if vector is None:
                # Add fake vector and mark as removed
                fake_vector = np.ones(named_vectors.shape[1])
                named_vectors[idx] = fake_vector
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 1
                )
            else:
                vector_np = np.array(vector)
                assert not np.isnan(vector_np).any(), "Vector contains NaN values"
                params = self.get_vector_params(vector_name)
                if params.distance == models.Distance.COSINE:
                    norm = np.linalg.norm(vector_np)
                    vector_np = vector_np / norm if norm > EPSILON else vector_np
                named_vectors[idx] = vector_np
                self.vectors[vector_name] = named_vectors
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 0
                )

        # sparse vectors
        for vector_name, named_vectors in self.sparse_vectors.items():
            vector = vectors.get(vector_name)
            if len(named_vectors) <= idx:
                diff = idx - len(named_vectors) + 1
                for _ in range(diff):
                    named_vectors.append(empty_sparse_vector())

            if vector is None:
                # Add fake vector and mark as removed
                fake_vector = empty_sparse_vector()
                named_vectors[idx] = fake_vector
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 1
                )
            else:
                named_vectors[idx] = vector
                self._update_idf_append(vector, vector_name)
                self.sparse_vectors[vector_name] = named_vectors
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 0
                )

        # multi vectors
        for vector_name, named_vectors in self.multivectors.items():
            vector = vectors.get(vector_name)
            if len(named_vectors) <= idx:
                diff = idx - len(named_vectors) + 1
                for _ in range(diff):
                    named_vectors.append(np.array([]))

            if vector is None:
                # Add fake vector and mark as removed
                named_vectors[idx] = np.array([])
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 1
                )
            else:
                vector_np = np.array(vector)
                assert not np.isnan(vector_np).any(), "Vector contains NaN values"
                params = self.get_vector_params(vector_name)
                if params.distance == models.Distance.COSINE:
                    vector_norm = np.linalg.norm(vector_np, axis=-1)[:, np.newaxis]
                    vector_np /= np.where(vector_norm != 0.0, vector_norm, EPSILON)
                named_vectors[idx] = vector_np
                self.multivectors[vector_name] = named_vectors
                self.deleted_per_vector[vector_name] = np.append(
                    self.deleted_per_vector[vector_name], 0
                )

    def _upsert_point(self, point: models.PointStruct) -> None:
        if isinstance(point.id, str):
            # try to parse as UUID
            try:
                _uuid = uuid.UUID(point.id)
            except ValueError as e:
                raise ValueError(f"Point id {point.id} is not a valid UUID") from e

        if isinstance(point.vector, dict):
            updated_sparse_vectors = {}
            for vector_name, vector in point.vector.items():
                if vector_name not in self._all_vectors_keys:
                    raise ValueError(f"Wrong input: Not existing vector name error: {vector_name}")
                if isinstance(vector, SparseVector):
                    # validate sparse vector
                    validate_sparse_vector(vector)
                    # sort sparse vector by indices before persistence
                    updated_sparse_vectors[vector_name] = sort_sparse_vector(vector)
            # update point.vector with the modified values after iteration
            point.vector.update(updated_sparse_vectors)
        else:
            vector_names = list(self.vectors.keys())
            multivector_names = list(self.multivectors.keys())
            if (vector_names and vector_names != [""]) or (
                multivector_names and multivector_names != [""]
            ):
                raise ValueError(
                    "Wrong input: Unnamed vectors are not allowed when a collection has named vectors or multivectors: "
                    f"{vector_names}, {multivector_names}"
                )
            if not self.vectors and not self.multivectors:
                raise ValueError(f"Wrong input: Not existing vector name error")

        if point.id in self.ids:
            self._update_point(point)
        else:
            self._add_point(point)

        if self.storage is not None:
            self.storage.persist(point)

    def upsert(self, points: Union[Sequence[models.PointStruct], models.Batch]) -> None:
        if isinstance(points, list):
            for point in points:
                self._upsert_point(point)
        elif isinstance(points, models.Batch):
            batch = points
            if isinstance(batch.vectors, list):
                vectors = {DEFAULT_VECTOR_NAME: batch.vectors}
            else:
                vectors = batch.vectors

            for idx, point_id in enumerate(batch.ids):
                payload = None
                if batch.payloads is not None:
                    payload = batch.payloads[idx]

                vector = {name: v[idx] for name, v in vectors.items()}

                self._upsert_point(
                    models.PointStruct(
                        id=point_id,
                        payload=payload,
                        vector=vector,
                    )
                )
        else:
            raise ValueError(f"Unsupported type: {type(points)}")

    def _update_named_vectors(
        self, idx: int, vectors: Dict[str, Union[List[float], SparseVector]]
    ) -> None:
        for vector_name, vector in vectors.items():
            if isinstance(vector, SparseVector):
                validate_sparse_vector(vector)
                old_vector = self.sparse_vectors[vector_name][idx]
                self._update_idf_remove(old_vector, vector_name)
                new_vector = sort_sparse_vector(vector)
                self.sparse_vectors[vector_name][idx] = new_vector
                self._update_idf_append(new_vector, vector_name)
            elif vector_name in self.vectors:
                self.vectors[vector_name][idx] = np.array(vector)
            else:
                self.multivectors[vector_name][idx] = np.array(vector)
            self.deleted_per_vector[vector_name][idx] = 0

    def update_vectors(self, points: Sequence[types.PointVectors]) -> None:
        for point in points:
            point_id = point.id
            idx = self.ids[point_id]
            vector_struct = point.vector
            if isinstance(vector_struct, list):
                fixed_vectors = {DEFAULT_VECTOR_NAME: vector_struct}
            else:
                fixed_vectors = vector_struct
            self._update_named_vectors(idx, fixed_vectors)
            self._persist_by_id(point_id)

    def delete_vectors(
        self,
        vectors: Sequence[str],
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> None:
        ids = self._selector_to_ids(selector)
        for point_id in ids:
            idx = self.ids[point_id]
            for vector_name in vectors:
                self.deleted_per_vector[vector_name][idx] = 1
            self._persist_by_id(point_id)

    def _delete_ids(self, ids: List[types.PointId]) -> None:
        for point_id in ids:
            idx = self.ids[point_id]
            self.deleted[idx] = 1

        if self.storage is not None:
            for point_id in ids:
                self.storage.delete(point_id)

    def _filter_to_ids(self, delete_filter: types.Filter) -> List[models.ExtendedPointId]:
        mask = self._payload_and_non_deleted_mask(delete_filter)
        ids = [point_id for point_id, idx in self.ids.items() if mask[idx]]
        return ids

    def _selector_to_ids(
        self,
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> List[models.ExtendedPointId]:
        if isinstance(selector, list):
            return selector
        elif isinstance(selector, models.Filter):
            return self._filter_to_ids(selector)
        elif isinstance(selector, models.PointIdsList):
            return selector.points
        elif isinstance(selector, models.FilterSelector):
            return self._filter_to_ids(selector.filter)
        else:
            raise ValueError(f"Unsupported selector type: {type(selector)}")

    def delete(
        self,
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> None:
        ids = self._selector_to_ids(selector)
        self._delete_ids(ids)

    def _persist_by_id(self, point_id: models.ExtendedPointId) -> None:
        if self.storage is not None:
            idx = self.ids[point_id]
            point = models.PointStruct(
                id=point_id,
                payload=self._get_payload(idx, with_payload=True, return_copy=False),
                vector=self._get_vectors(idx, with_vectors=True),
            )
            self.storage.persist(point)

    def set_payload(
        self,
        payload: models.Payload,
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
        key: Optional[str] = None,
    ) -> None:
        ids = self._selector_to_ids(selector)
        jsonable_payload = deepcopy(to_jsonable_python(payload))

        keys: Optional[List[JsonPathItem]] = parse_json_path(key) if key is not None else None

        for point_id in ids:
            idx = self.ids[point_id]
            if keys is None:
                self.payload[idx] = {**self.payload[idx], **jsonable_payload}
            else:
                if self.payload[idx] is not None:
                    set_value_by_key(payload=self.payload[idx], value=jsonable_payload, keys=keys)

            self._persist_by_id(point_id)

    def overwrite_payload(
        self,
        payload: models.Payload,
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> None:
        ids = self._selector_to_ids(selector)
        for point_id in ids:
            idx = self.ids[point_id]
            self.payload[idx] = deepcopy(to_jsonable_python(payload)) or {}
            self._persist_by_id(point_id)

    def delete_payload(
        self,
        keys: Sequence[str],
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> None:
        ids = self._selector_to_ids(selector)
        for point_id in ids:
            idx = self.ids[point_id]
            for key in keys:
                if key in self.payload[idx]:
                    self.payload[idx].pop(key)
            self._persist_by_id(point_id)

    def clear_payload(
        self,
        selector: Union[
            models.Filter,
            List[models.ExtendedPointId],
            models.FilterSelector,
            models.PointIdsList,
        ],
    ) -> None:
        ids = self._selector_to_ids(selector)
        for point_id in ids:
            idx = self.ids[point_id]
            self.payload[idx] = {}
            self._persist_by_id(point_id)

    def batch_update_points(
        self,
        update_operations: Sequence[types.UpdateOperation],
    ) -> None:
        for update_op in update_operations:
            if isinstance(update_op, models.UpsertOperation):
                if isinstance(update_op.upsert, models.PointsBatch):
                    self.upsert(update_op.upsert.batch)
                elif isinstance(update_op.upsert, models.PointsList):
                    self.upsert(update_op.upsert.points)
                else:
                    raise ValueError(f"Unsupported upsert type: {type(update_op.upsert)}")
            elif isinstance(update_op, models.DeleteOperation):
                self.delete(update_op.delete)
            elif isinstance(update_op, models.SetPayloadOperation):
                points_selector = update_op.set_payload.points or update_op.set_payload.filter
                self.set_payload(update_op.set_payload.payload, points_selector)
            elif isinstance(update_op, models.OverwritePayloadOperation):
                points_selector = (
                    update_op.overwrite_payload.points or update_op.overwrite_payload.filter
                )
                self.overwrite_payload(update_op.overwrite_payload.payload, points_selector)
            elif isinstance(update_op, models.DeletePayloadOperation):
                points_selector = (
                    update_op.delete_payload.points or update_op.delete_payload.filter
                )
                self.delete_payload(update_op.delete_payload.keys, points_selector)
            elif isinstance(update_op, models.ClearPayloadOperation):
                self.clear_payload(update_op.clear_payload)
            elif isinstance(update_op, models.UpdateVectorsOperation):
                self.update_vectors(update_op.update_vectors.points)
            elif isinstance(update_op, models.DeleteVectorsOperation):
                points_selector = (
                    update_op.delete_vectors.points or update_op.delete_vectors.filter
                )
                self.delete_vectors(update_op.delete_vectors.vector, points_selector)
            else:
                raise ValueError(f"Unsupported update operation: {type(update_op)}")

    def update_sparse_vectors_config(
        self, vector_name: str, new_config: models.SparseVectorParams
    ) -> None:
        if vector_name not in self.sparse_vectors:
            raise ValueError(f"Vector {vector_name} does not exist in the collection")

        self.config.sparse_vectors[vector_name] = new_config

    def info(self) -> models.CollectionInfo:
        return models.CollectionInfo(
            status=models.CollectionStatus.GREEN,
            optimizer_status=models.OptimizersStatusOneOf.OK,
            vectors_count=None,
            indexed_vectors_count=0,  # LocalCollection does not do indexing
            points_count=self.count().count,
            segments_count=1,
            payload_schema={},
            config=models.CollectionConfig(
                params=models.CollectionParams(
                    vectors=self.config.vectors,
                    shard_number=self.config.shard_number,
                    replication_factor=self.config.replication_factor,
                    write_consistency_factor=self.config.write_consistency_factor,
                    on_disk_payload=self.config.on_disk_payload,
                    sparse_vectors=self.config.sparse_vectors,
                ),
                hnsw_config=models.HnswConfig(
                    m=16,
                    ef_construct=100,
                    full_scan_threshold=10000,
                ),
                wal_config=models.WalConfig(
                    wal_capacity_mb=32,
                    wal_segments_ahead=0,
                ),
                optimizer_config=models.OptimizersConfig(
                    deleted_threshold=0.2,
                    vacuum_min_vector_number=1000,
                    default_segment_number=0,
                    indexing_threshold=20000,
                    flush_interval_sec=5,
                    max_optimization_threads=1,
                ),
                quantization_config=None,
            ),
        )


def ignore_mentioned_ids_filter(
    query_filter: Optional[types.Filter], mentioned_ids: List[types.PointId]
) -> types.Filter:
    if len(mentioned_ids) == 0:
        return query_filter

    ignore_mentioned_ids = models.HasIdCondition(has_id=mentioned_ids)

    if query_filter is None:
        query_filter = models.Filter(must_not=[ignore_mentioned_ids])
    else:
        # as of mypy v1.11.0 mypy is complaining on deep-copied structures with None
        query_filter = deepcopy(query_filter)
        # as of mypy v1.11.0 mypy is complaining on deep-copied structures with None
        if query_filter.must_not is None:  # type: ignore[union-attr]
            query_filter.must_not = [ignore_mentioned_ids]  # type: ignore[union-attr]
        else:
            query_filter.must_not.append(ignore_mentioned_ids)  # type: ignore[union-attr]

    return query_filter


def _include_ids_in_filter(
    query_filter: Optional[types.Filter], ids: List[types.PointId]
) -> types.Filter:
    if len(ids) == 0:
        return query_filter

    include_ids = models.HasIdCondition(has_id=ids)

    if query_filter is None:
        query_filter = models.Filter(must=[include_ids])
    else:
        # as of mypy v1.11.0 mypy is complaining on deep-copied structures with None
        query_filter = deepcopy(query_filter)
        # as of mypy v1.11.0 mypy is complaining on deep-copied structures with None
        if query_filter.must is None:  # type: ignore[union-attr]
            query_filter.must = [include_ids]  # type: ignore[union-attr]
        else:
            query_filter.must.append(include_ids)  # type: ignore[union-attr]

    return query_filter


def record_to_scored_point(record: types.Record) -> types.ScoredPoint:
    return types.ScoredPoint(
        id=record.id,
        version=0,
        score=0,
        payload=record.payload,
        vector=record.vector,
        order_value=record.order_value,
    )


def set_prefetch_limit_recursively(prefetch: types.Prefetch, limit: int) -> types.Prefetch:
    if prefetch is not None:
        if isinstance(prefetch.prefetch, list):
            return types.Prefetch(
                limit=limit,
                prefetch=[set_prefetch_limit_recursively(p, limit) for p in prefetch.prefetch],
            )
        else:
            return types.Prefetch(limit=limit, prefetch=list())
