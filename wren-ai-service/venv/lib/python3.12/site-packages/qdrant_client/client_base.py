from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

from qdrant_client.conversions import common_types as types
from qdrant_client.http import models


class QdrantBase:
    def __init__(self, **kwargs: Any):
        pass

    def search_batch(
        self,
        collection_name: str,
        requests: Sequence[types.SearchRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        raise NotImplementedError()

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
        query_filter: Optional[models.Filter] = None,
        search_params: Optional[models.SearchParams] = None,
        limit: int = 10,
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        **kwargs: Any,
    ) -> List[types.ScoredPoint]:
        raise NotImplementedError()

    def search_groups(
        self,
        collection_name: str,
        query_vector: Union[
            types.NumpyArray,
            Sequence[float],
            Tuple[str, List[float]],
            types.NamedVector,
            types.NamedSparseVector,
        ],
        group_by: str,
        query_filter: Optional[models.Filter] = None,
        search_params: Optional[models.SearchParams] = None,
        limit: int = 10,
        group_size: int = 1,
        with_payload: Union[bool, Sequence[str], models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        **kwargs: Any,
    ) -> types.GroupsResult:
        raise NotImplementedError()

    def search_matrix_offsets(
        self,
        collection_name: str,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
        **kwargs: Any,
    ) -> types.SearchMatrixOffsetsResponse:
        raise NotImplementedError()

    def search_matrix_pairs(
        self,
        collection_name: str,
        query_filter: Optional[types.Filter] = None,
        limit: int = 3,
        sample: int = 10,
        using: Optional[str] = None,
        **kwargs: Any,
    ) -> types.SearchMatrixPairsResponse:
        raise NotImplementedError()

    def query_batch_points(
        self,
        collection_name: str,
        requests: Sequence[types.QueryRequest],
        **kwargs: Any,
    ) -> List[types.QueryResponse]:
        raise NotImplementedError()

    def query_points(
        self,
        collection_name: str,
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
        offset: Optional[int] = None,
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        score_threshold: Optional[float] = None,
        lookup_from: Optional[types.LookupLocation] = None,
        **kwargs: Any,
    ) -> types.QueryResponse:
        raise NotImplementedError()

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
        raise NotImplementedError()

    def recommend_batch(
        self,
        collection_name: str,
        requests: Sequence[types.RecommendRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        raise NotImplementedError()

    def recommend(
        self,
        collection_name: str,
        positive: Optional[Sequence[types.RecommendExample]] = None,
        negative: Optional[Sequence[types.RecommendExample]] = None,
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
        raise NotImplementedError()

    def recommend_groups(
        self,
        collection_name: str,
        group_by: str,
        positive: Optional[Sequence[types.RecommendExample]] = None,
        negative: Optional[Sequence[types.RecommendExample]] = None,
        query_filter: Optional[models.Filter] = None,
        search_params: Optional[models.SearchParams] = None,
        limit: int = 10,
        group_size: int = 1,
        score_threshold: Optional[float] = None,
        with_payload: Union[bool, Sequence[str], models.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        using: Optional[str] = None,
        lookup_from: Optional[models.LookupLocation] = None,
        with_lookup: Optional[types.WithLookupInterface] = None,
        strategy: Optional[types.RecommendStrategy] = None,
        **kwargs: Any,
    ) -> types.GroupsResult:
        raise NotImplementedError()

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
        **kwargs: Any,
    ) -> List[types.ScoredPoint]:
        raise NotImplementedError()

    def discover_batch(
        self,
        collection_name: str,
        requests: Sequence[types.DiscoverRequest],
        **kwargs: Any,
    ) -> List[List[types.ScoredPoint]]:
        raise NotImplementedError()

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
        raise NotImplementedError()

    def count(
        self,
        collection_name: str,
        count_filter: Optional[types.Filter] = None,
        exact: bool = True,
        **kwargs: Any,
    ) -> types.CountResult:
        raise NotImplementedError()

    def facet(
        self,
        collection_name: str,
        key: str,
        facet_filter: Optional[types.Filter] = None,
        limit: int = 10,
        exact: bool = False,
        **kwargs: Any,
    ) -> types.FacetResponse:
        raise NotImplementedError()

    def upsert(
        self,
        collection_name: str,
        points: types.Points,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def update_vectors(
        self,
        collection_name: str,
        points: Sequence[types.PointVectors],
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def delete_vectors(
        self,
        collection_name: str,
        vectors: Sequence[str],
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def retrieve(
        self,
        collection_name: str,
        ids: Sequence[types.PointId],
        with_payload: Union[bool, Sequence[str], types.PayloadSelector] = True,
        with_vectors: Union[bool, Sequence[str]] = False,
        **kwargs: Any,
    ) -> List[types.Record]:
        raise NotImplementedError()

    def delete(
        self,
        collection_name: str,
        points_selector: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def set_payload(
        self,
        collection_name: str,
        payload: types.Payload,
        points: types.PointsSelector,
        key: Optional[str] = None,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def overwrite_payload(
        self,
        collection_name: str,
        payload: types.Payload,
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def delete_payload(
        self,
        collection_name: str,
        keys: Sequence[str],
        points: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def clear_payload(
        self,
        collection_name: str,
        points_selector: types.PointsSelector,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def batch_update_points(
        self,
        collection_name: str,
        update_operations: Sequence[types.UpdateOperation],
        **kwargs: Any,
    ) -> List[types.UpdateResult]:
        raise NotImplementedError()

    def update_collection_aliases(
        self,
        change_aliases_operations: Sequence[types.AliasOperations],
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def get_collection_aliases(
        self, collection_name: str, **kwargs: Any
    ) -> types.CollectionsAliasesResponse:
        raise NotImplementedError()

    def get_aliases(self, **kwargs: Any) -> types.CollectionsAliasesResponse:
        raise NotImplementedError()

    def get_collections(self, **kwargs: Any) -> types.CollectionsResponse:
        raise NotImplementedError()

    def get_collection(self, collection_name: str, **kwargs: Any) -> types.CollectionInfo:
        raise NotImplementedError()

    def collection_exists(self, collection_name: str, **kwargs: Any) -> bool:
        raise NotImplementedError()

    def update_collection(
        self,
        collection_name: str,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def delete_collection(self, collection_name: str, **kwargs: Any) -> bool:
        raise NotImplementedError()

    def create_collection(
        self,
        collection_name: str,
        vectors_config: Union[types.VectorParams, Mapping[str, types.VectorParams]],
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def recreate_collection(
        self,
        collection_name: str,
        vectors_config: Union[types.VectorParams, Mapping[str, types.VectorParams]],
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def upload_records(
        self,
        collection_name: str,
        records: Iterable[types.Record],
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError()

    def upload_points(
        self,
        collection_name: str,
        points: Iterable[types.PointStruct],
        **kwargs: Any,
    ) -> None:
        raise NotImplementedError()

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
        raise NotImplementedError()

    def create_payload_index(
        self,
        collection_name: str,
        field_name: str,
        field_schema: Optional[types.PayloadSchemaType] = None,
        field_type: Optional[types.PayloadSchemaType] = None,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def delete_payload_index(
        self,
        collection_name: str,
        field_name: str,
        **kwargs: Any,
    ) -> types.UpdateResult:
        raise NotImplementedError()

    def list_snapshots(
        self, collection_name: str, **kwargs: Any
    ) -> List[types.SnapshotDescription]:
        raise NotImplementedError()

    def create_snapshot(
        self, collection_name: str, **kwargs: Any
    ) -> Optional[types.SnapshotDescription]:
        raise NotImplementedError()

    def delete_snapshot(
        self, collection_name: str, snapshot_name: str, **kwargs: Any
    ) -> Optional[bool]:
        raise NotImplementedError()

    def list_full_snapshots(self, **kwargs: Any) -> List[types.SnapshotDescription]:
        raise NotImplementedError()

    def create_full_snapshot(self, **kwargs: Any) -> Optional[types.SnapshotDescription]:
        raise NotImplementedError()

    def delete_full_snapshot(self, snapshot_name: str, **kwargs: Any) -> Optional[bool]:
        raise NotImplementedError()

    def recover_snapshot(
        self,
        collection_name: str,
        location: str,
        **kwargs: Any,
    ) -> Optional[bool]:
        raise NotImplementedError()

    def list_shard_snapshots(
        self, collection_name: str, shard_id: int, **kwargs: Any
    ) -> List[types.SnapshotDescription]:
        raise NotImplementedError()

    def create_shard_snapshot(
        self, collection_name: str, shard_id: int, **kwargs: Any
    ) -> Optional[types.SnapshotDescription]:
        raise NotImplementedError()

    def delete_shard_snapshot(
        self, collection_name: str, shard_id: int, snapshot_name: str, **kwargs: Any
    ) -> Optional[bool]:
        raise NotImplementedError()

    def recover_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        location: str,
        **kwargs: Any,
    ) -> Optional[bool]:
        raise NotImplementedError()

    def lock_storage(self, reason: str, **kwargs: Any) -> types.LocksOption:
        raise NotImplementedError()

    def unlock_storage(self, **kwargs: Any) -> types.LocksOption:
        raise NotImplementedError()

    def get_locks(self, **kwargs: Any) -> types.LocksOption:
        raise NotImplementedError()

    def close(self, **kwargs: Any) -> None:
        pass

    def migrate(
        self,
        dest_client: "QdrantBase",
        collection_names: Optional[List[str]] = None,
        batch_size: int = 100,
        recreate_on_collision: bool = False,
    ) -> None:
        raise NotImplementedError()

    def create_shard_key(
        self,
        collection_name: str,
        shard_key: types.ShardKey,
        shards_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        placement: Optional[List[int]] = None,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def delete_shard_key(
        self,
        collection_name: str,
        shard_key: types.ShardKey,
        **kwargs: Any,
    ) -> bool:
        raise NotImplementedError()

    def info(self) -> types.VersionInfo:
        raise NotImplementedError()
