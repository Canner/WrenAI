from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field
from pydantic.types import StrictBool, StrictFloat, StrictInt, StrictStr

Payload = Dict[str, Any]
SparseVectorsConfig = Dict[str, "SparseVectorParams"]
VectorsConfigDiff = Dict[str, "VectorParamsDiff"]


class AbortShardTransfer(BaseModel, extra="forbid"):
    shard_id: int = Field(..., description="")
    to_peer_id: int = Field(..., description="")
    from_peer_id: int = Field(..., description="")


class AbortTransferOperation(BaseModel, extra="forbid"):
    abort_transfer: "AbortShardTransfer" = Field(..., description="")


class AliasDescription(BaseModel):
    alias_name: str = Field(..., description="")
    collection_name: str = Field(..., description="")


class AppBuildTelemetry(BaseModel):
    name: str = Field(..., description="")
    version: str = Field(..., description="")
    features: Optional["AppFeaturesTelemetry"] = Field(default=None, description="")
    system: Optional["RunningEnvironmentTelemetry"] = Field(default=None, description="")
    jwt_rbac: Optional[bool] = Field(default=None, description="")
    hide_jwt_dashboard: Optional[bool] = Field(default=None, description="")
    startup: Union[datetime, date] = Field(..., description="")


class AppFeaturesTelemetry(BaseModel):
    debug: bool = Field(..., description="")
    web_feature: bool = Field(..., description="")
    service_debug_feature: bool = Field(..., description="")
    recovery_mode: bool = Field(..., description="")


class Batch(BaseModel, extra="forbid"):
    ids: List["ExtendedPointId"] = Field(..., description="")
    vectors: "BatchVectorStruct" = Field(..., description="")
    payloads: Optional[List["Payload"]] = Field(default=None, description="")


class BinaryQuantization(BaseModel, extra="forbid"):
    binary: "BinaryQuantizationConfig" = Field(..., description="")


class BinaryQuantizationConfig(BaseModel, extra="forbid"):
    always_ram: Optional[bool] = Field(default=None, description="")


class BoolIndexParams(BaseModel, extra="forbid"):
    type: "BoolIndexType" = Field(..., description="")


class BoolIndexType(str, Enum):
    BOOL = "bool"


class ChangeAliasesOperation(BaseModel, extra="forbid"):
    """
    Operation for performing changes of collection aliases. Alias changes are atomic, meaning that no collection modifications can happen between alias operations.
    """

    actions: List["AliasOperations"] = Field(
        ...,
        description="Operation for performing changes of collection aliases. Alias changes are atomic, meaning that no collection modifications can happen between alias operations.",
    )


class ClearPayloadOperation(BaseModel, extra="forbid"):
    clear_payload: "PointsSelector" = Field(..., description="")


class ClusterConfigTelemetry(BaseModel):
    grpc_timeout_ms: int = Field(..., description="")
    p2p: "P2pConfigTelemetry" = Field(..., description="")
    consensus: "ConsensusConfigTelemetry" = Field(..., description="")


class ClusterStatusOneOf(BaseModel):
    status: Literal[
        "disabled",
    ] = Field(..., description="")


class ClusterStatusOneOf1(BaseModel):
    """
    Description of enabled cluster
    """

    status: Literal[
        "enabled",
    ] = Field(..., description="Description of enabled cluster")
    peer_id: int = Field(..., description="ID of this peer")
    peers: Dict[str, "PeerInfo"] = Field(..., description="Peers composition of the cluster with main information")
    raft_info: "RaftInfo" = Field(..., description="Description of enabled cluster")
    consensus_thread_status: "ConsensusThreadStatus" = Field(..., description="Description of enabled cluster")
    message_send_failures: Dict[str, "MessageSendErrors"] = Field(
        ...,
        description="Consequent failures of message send operations in consensus by peer address. On the first success to send to that peer - entry is removed from this hashmap.",
    )


class ClusterStatusTelemetry(BaseModel):
    number_of_peers: int = Field(..., description="")
    term: int = Field(..., description="")
    commit: int = Field(..., description="")
    pending_operations: int = Field(..., description="")
    role: Optional["StateRole"] = Field(default=None, description="")
    is_voter: bool = Field(..., description="")
    peer_id: Optional[int] = Field(default=None, description="")
    consensus_thread_status: "ConsensusThreadStatus" = Field(..., description="")


class ClusterTelemetry(BaseModel):
    enabled: bool = Field(..., description="")
    status: Optional["ClusterStatusTelemetry"] = Field(default=None, description="")
    config: Optional["ClusterConfigTelemetry"] = Field(default=None, description="")
    peers: Optional[Dict[str, "PeerInfo"]] = Field(default=None, description="")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="")


class CollectionClusterInfo(BaseModel):
    """
    Current clustering distribution for the collection
    """

    peer_id: int = Field(..., description="ID of this peer")
    shard_count: int = Field(..., description="Total number of shards")
    local_shards: List["LocalShardInfo"] = Field(..., description="Local shards")
    remote_shards: List["RemoteShardInfo"] = Field(..., description="Remote shards")
    shard_transfers: List["ShardTransferInfo"] = Field(..., description="Shard transfers")
    resharding_operations: Optional[List["ReshardingInfo"]] = Field(default=None, description="Resharding operations")


class CollectionConfig(BaseModel):
    params: "CollectionParams" = Field(..., description="")
    hnsw_config: "HnswConfig" = Field(..., description="")
    optimizer_config: "OptimizersConfig" = Field(..., description="")
    wal_config: "WalConfig" = Field(..., description="")
    quantization_config: Optional["QuantizationConfig"] = Field(default=None, description="")


class CollectionDescription(BaseModel):
    name: str = Field(..., description="")


class CollectionExistence(BaseModel):
    """
    State of existence of a collection, true = exists, false = does not exist
    """

    exists: bool = Field(..., description="State of existence of a collection, true = exists, false = does not exist")


class CollectionInfo(BaseModel):
    """
    Current statistics and configuration of the collection
    """

    status: "CollectionStatus" = Field(..., description="Current statistics and configuration of the collection")
    optimizer_status: "OptimizersStatus" = Field(
        ..., description="Current statistics and configuration of the collection"
    )
    vectors_count: Optional[int] = Field(
        default=None,
        description="DEPRECATED: Approximate number of vectors in collection. All vectors in collection are available for querying. Calculated as `points_count x vectors_per_point`. Where `vectors_per_point` is a number of named vectors in schema.",
    )
    indexed_vectors_count: Optional[int] = Field(
        default=None,
        description="Approximate number of indexed vectors in the collection. Indexed vectors in large segments are faster to query, as it is stored in a specialized vector index.",
    )
    points_count: Optional[int] = Field(
        default=None,
        description="Approximate number of points (vectors + payloads) in collection. Each point could be accessed by unique id.",
    )
    segments_count: int = Field(
        ..., description="Number of segments in collection. Each segment has independent vector as payload indexes"
    )
    config: "CollectionConfig" = Field(..., description="Current statistics and configuration of the collection")
    payload_schema: Dict[str, "PayloadIndexInfo"] = Field(..., description="Types of stored payload")


class CollectionParams(BaseModel):
    vectors: Optional["VectorsConfig"] = Field(default=None, description="")
    shard_number: Optional[int] = Field(default=1, description="Number of shards the collection has")
    sharding_method: Optional["ShardingMethod"] = Field(
        default=None,
        description="Sharding method Default is Auto - points are distributed across all available shards Custom - points are distributed across shards according to shard key",
    )
    replication_factor: Optional[int] = Field(default=1, description="Number of replicas for each shard")
    write_consistency_factor: Optional[int] = Field(
        default=1,
        description="Defines how many replicas should apply the operation for us to consider it successful. Increasing this number will make the collection more resilient to inconsistencies, but will also make it fail if not enough replicas are available. Does not have any performance impact.",
    )
    read_fan_out_factor: Optional[int] = Field(
        default=None,
        description="Defines how many additional replicas should be processing read request at the same time. Default value is Auto, which means that fan-out will be determined automatically based on the busyness of the local replica. Having more than 0 might be useful to smooth latency spikes of individual nodes.",
    )
    on_disk_payload: Optional[bool] = Field(
        default=False,
        description="If true - point&#x27;s payload will not be stored in memory. It will be read from the disk every time it is requested. This setting saves RAM by (slightly) increasing the response time. Note: those payload values that are involved in filtering and are indexed - remain in RAM.",
    )
    sparse_vectors: Optional[Dict[str, "SparseVectorParams"]] = Field(
        default=None, description="Configuration of the sparse vector storage"
    )


class CollectionParamsDiff(BaseModel, extra="forbid"):
    replication_factor: Optional[int] = Field(default=None, description="Number of replicas for each shard")
    write_consistency_factor: Optional[int] = Field(
        default=None, description="Minimal number successful responses from replicas to consider operation successful"
    )
    read_fan_out_factor: Optional[int] = Field(
        default=None,
        description="Fan-out every read request to these many additional remote nodes (and return first available response)",
    )
    on_disk_payload: Optional[bool] = Field(
        default=None,
        description="If true - point&#x27;s payload will not be stored in memory. It will be read from the disk every time it is requested. This setting saves RAM by (slightly) increasing the response time. Note: those payload values that are involved in filtering and are indexed - remain in RAM.",
    )


class CollectionStatus(str, Enum):
    """
    Current state of the collection. `Green` - all good. `Yellow` - optimization is running, &#x27;Grey&#x27; - optimizations are possible but not triggered, `Red` - some operations failed and was not recovered
    """

    def __str__(self) -> str:
        return str(self.value)

    GREEN = "green"
    YELLOW = "yellow"
    GREY = "grey"
    RED = "red"


class CollectionTelemetry(BaseModel):
    id: str = Field(..., description="")
    init_time_ms: int = Field(..., description="")
    config: "CollectionConfig" = Field(..., description="")
    shards: List["ReplicaSetTelemetry"] = Field(..., description="")
    transfers: List["ShardTransferInfo"] = Field(..., description="")
    resharding: List["ReshardingInfo"] = Field(..., description="")


class CollectionsAggregatedTelemetry(BaseModel):
    vectors: int = Field(..., description="")
    optimizers_status: "OptimizersStatus" = Field(..., description="")
    params: "CollectionParams" = Field(..., description="")


class CollectionsAliasesResponse(BaseModel):
    aliases: List["AliasDescription"] = Field(..., description="")


class CollectionsResponse(BaseModel):
    collections: List["CollectionDescription"] = Field(..., description="")


class CollectionsTelemetry(BaseModel):
    number_of_collections: int = Field(..., description="")
    collections: Optional[List["CollectionTelemetryEnum"]] = Field(default=None, description="")


class CompressionRatio(str, Enum):
    X4 = "x4"
    X8 = "x8"
    X16 = "x16"
    X32 = "x32"
    X64 = "x64"


class ConsensusConfigTelemetry(BaseModel):
    max_message_queue_size: int = Field(..., description="")
    tick_period_ms: int = Field(..., description="")
    bootstrap_timeout_sec: int = Field(..., description="")


class ConsensusThreadStatusOneOf(BaseModel):
    consensus_thread_status: Literal[
        "working",
    ] = Field(..., description="")
    last_update: Union[datetime, date] = Field(..., description="")


class ConsensusThreadStatusOneOf1(BaseModel):
    consensus_thread_status: Literal[
        "stopped",
    ] = Field(..., description="")


class ConsensusThreadStatusOneOf2(BaseModel):
    consensus_thread_status: Literal[
        "stopped_with_err",
    ] = Field(..., description="")
    err: str = Field(..., description="")


class ContextExamplePair(BaseModel, extra="forbid"):
    positive: "RecommendExample" = Field(..., description="")
    negative: "RecommendExample" = Field(..., description="")


class ContextPair(BaseModel, extra="forbid"):
    positive: "VectorInput" = Field(..., description="")
    negative: "VectorInput" = Field(..., description="")


class ContextQuery(BaseModel, extra="forbid"):
    context: "ContextInput" = Field(..., description="")


class CountRequest(BaseModel, extra="forbid"):
    """
    Count Request Counts the number of points which satisfy the given filter. If filter is not provided, the count of all points in the collection will be returned.
    """

    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    exact: Optional[bool] = Field(
        default=True,
        description="If true, count exact number of points. If false, count approximate number of points faster. Approximate count might be unreliable during the indexing process. Default: true",
    )


class CountResult(BaseModel):
    count: int = Field(..., description="Number of points which satisfy the conditions")


class CreateAlias(BaseModel, extra="forbid"):
    """
    Create alternative name for a collection. Collection will be available under both names for search, retrieve,
    """

    collection_name: str = Field(
        ...,
        description="Create alternative name for a collection. Collection will be available under both names for search, retrieve,",
    )
    alias_name: str = Field(
        ...,
        description="Create alternative name for a collection. Collection will be available under both names for search, retrieve,",
    )


class CreateAliasOperation(BaseModel, extra="forbid"):
    create_alias: "CreateAlias" = Field(..., description="")


class CreateCollection(BaseModel, extra="forbid"):
    """
    Operation for creating new collection and (optionally) specify index params
    """

    vectors: Optional["VectorsConfig"] = Field(
        default=None, description="Operation for creating new collection and (optionally) specify index params"
    )
    shard_number: Optional[int] = Field(
        default=None,
        description="For auto sharding: Number of shards in collection. - Default is 1 for standalone, otherwise equal to the number of nodes - Minimum is 1  For custom sharding: Number of shards in collection per shard group. - Default is 1, meaning that each shard key will be mapped to a single shard - Minimum is 1",
    )
    sharding_method: Optional["ShardingMethod"] = Field(
        default=None,
        description="Sharding method Default is Auto - points are distributed across all available shards Custom - points are distributed across shards according to shard key",
    )
    replication_factor: Optional[int] = Field(
        default=None, description="Number of shards replicas. Default is 1 Minimum is 1"
    )
    write_consistency_factor: Optional[int] = Field(
        default=None,
        description="Defines how many replicas should apply the operation for us to consider it successful. Increasing this number will make the collection more resilient to inconsistencies, but will also make it fail if not enough replicas are available. Does not have any performance impact.",
    )
    on_disk_payload: Optional[bool] = Field(
        default=None,
        description="If true - point&#x27;s payload will not be stored in memory. It will be read from the disk every time it is requested. This setting saves RAM by (slightly) increasing the response time. Note: those payload values that are involved in filtering and are indexed - remain in RAM.",
    )
    hnsw_config: Optional["HnswConfigDiff"] = Field(
        default=None,
        description="Custom params for HNSW index. If none - values from service configuration file are used.",
    )
    wal_config: Optional["WalConfigDiff"] = Field(
        default=None, description="Custom params for WAL. If none - values from service configuration file are used."
    )
    optimizers_config: Optional["OptimizersConfigDiff"] = Field(
        default=None,
        description="Custom params for Optimizers.  If none - values from service configuration file are used.",
    )
    init_from: Optional["InitFrom"] = Field(default=None, description="Specify other collection to copy data from.")
    quantization_config: Optional["QuantizationConfig"] = Field(
        default=None, description="Quantization parameters. If none - quantization is disabled."
    )
    sparse_vectors: Optional[Dict[str, "SparseVectorParams"]] = Field(
        default=None, description="Sparse vector data config."
    )


class CreateFieldIndex(BaseModel, extra="forbid"):
    field_name: str = Field(..., description="")
    field_schema: Optional["PayloadFieldSchema"] = Field(default=None, description="")


class CreateShardingKey(BaseModel, extra="forbid"):
    shard_key: "ShardKey" = Field(..., description="")
    shards_number: Optional[int] = Field(
        default=None,
        description="How many shards to create for this key If not specified, will use the default value from config",
    )
    replication_factor: Optional[int] = Field(
        default=None,
        description="How many replicas to create for each shard If not specified, will use the default value from config",
    )
    placement: Optional[List[int]] = Field(
        default=None,
        description="Placement of shards for this key List of peer ids, that can be used to place shards for this key If not specified, will be randomly placed among all peers",
    )


class CreateShardingKeyOperation(BaseModel, extra="forbid"):
    create_sharding_key: "CreateShardingKey" = Field(..., description="")


class Datatype(str, Enum):
    FLOAT32 = "float32"
    UINT8 = "uint8"
    FLOAT16 = "float16"


class DatetimeIndexParams(BaseModel, extra="forbid"):
    type: "DatetimeIndexType" = Field(..., description="")
    is_principal: Optional[bool] = Field(
        default=None,
        description="If true - use this key to organize storage of the collection data. This option assumes that this key will be used in majority of filtered requests.",
    )
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class DatetimeIndexType(str, Enum):
    DATETIME = "datetime"


class DatetimeRange(BaseModel, extra="forbid"):
    """
    Range filter request
    """

    lt: Optional[Union[datetime, date]] = Field(default=None, description="point.key &lt; range.lt")
    gt: Optional[Union[datetime, date]] = Field(default=None, description="point.key &gt; range.gt")
    gte: Optional[Union[datetime, date]] = Field(default=None, description="point.key &gt;= range.gte")
    lte: Optional[Union[datetime, date]] = Field(default=None, description="point.key &lt;= range.lte")


class DeleteAlias(BaseModel, extra="forbid"):
    """
    Delete alias if exists
    """

    alias_name: str = Field(..., description="Delete alias if exists")


class DeleteAliasOperation(BaseModel, extra="forbid"):
    """
    Delete alias if exists
    """

    delete_alias: "DeleteAlias" = Field(..., description="Delete alias if exists")


class DeleteOperation(BaseModel, extra="forbid"):
    delete: "PointsSelector" = Field(..., description="")


class DeletePayload(BaseModel, extra="forbid"):
    """
    This data structure is used in API interface and applied across multiple shards
    """

    keys: List[str] = Field(..., description="List of payload keys to remove from payload")
    points: Optional[List["ExtendedPointId"]] = Field(
        default=None, description="Deletes values from each point in this list"
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Deletes values from points that satisfy this filter condition"
    )
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None, description="This data structure is used in API interface and applied across multiple shards"
    )


class DeletePayloadOperation(BaseModel, extra="forbid"):
    delete_payload: "DeletePayload" = Field(..., description="")


class DeleteVectors(BaseModel, extra="forbid"):
    points: Optional[List["ExtendedPointId"]] = Field(
        default=None, description="Deletes values from each point in this list"
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Deletes values from points that satisfy this filter condition"
    )
    vector: List[str] = Field(..., description="Vector names")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class DeleteVectorsOperation(BaseModel, extra="forbid"):
    delete_vectors: "DeleteVectors" = Field(..., description="")


class Direction(str, Enum):
    ASC = "asc"
    DESC = "desc"


class Disabled(str, Enum):
    DISABLED = "Disabled"


class DiscoverInput(BaseModel, extra="forbid"):
    target: "VectorInput" = Field(..., description="")
    context: Union[List["ContextPair"], "ContextPair"] = Field(
        ..., description="Search space will be constrained by these pairs of vectors"
    )


class DiscoverQuery(BaseModel, extra="forbid"):
    discover: "DiscoverInput" = Field(..., description="")


class DiscoverRequest(BaseModel, extra="forbid"):
    """
    Use context and a target to find the most similar points, constrained by the context.
    """

    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    target: Optional["RecommendExample"] = Field(
        default=None,
        description="Look for vectors closest to this.  When using the target (with or without context), the integer part of the score represents the rank with respect to the context, while the decimal part of the score relates to the distance to the target.",
    )
    context: Optional[List["ContextExamplePair"]] = Field(
        default=None,
        description="Pairs of { positive, negative } examples to constrain the search.  When using only the context (without a target), a special search - called context search - is performed where pairs of points are used to generate a loss that guides the search towards the zone where most positive examples overlap. This means that the score minimizes the scenario of finding a point closer to a negative than to a positive part of a pair.  Since the score of a context relates to loss, the maximum score a point can get is 0.0, and it becomes normal that many points can have a score of 0.0.  For discovery search (when including a target), the context part of the score for each pair is calculated +1 if the point is closer to a positive than to a negative part of a pair, and -1 otherwise.",
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    params: Optional["SearchParams"] = Field(default=None, description="Additional search params")
    limit: int = Field(..., description="Max number of result to return")
    offset: Optional[int] = Field(
        default=None,
        description="Offset of the first result to return. May be used to paginate results. Note: large offset values may cause performance issues.",
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is false."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into response. Default is false."
    )
    using: Optional["UsingVector"] = Field(
        default=None,
        description="Define which vector to use for recommendation, if not specified - try to use default vector",
    )
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location used to lookup vectors. If not specified - use current collection. Note: the other collection should have the same vector size as the current collection",
    )


class DiscoverRequestBatch(BaseModel, extra="forbid"):
    searches: List["DiscoverRequest"] = Field(..., description="")


class Distance(str, Enum):
    """
    Type of internal tags, build from payload Distance function types used to compare vectors
    """

    def __str__(self) -> str:
        return str(self.value)

    COSINE = "Cosine"
    EUCLID = "Euclid"
    DOT = "Dot"
    MANHATTAN = "Manhattan"


class Document(BaseModel, extra="forbid"):
    """
    WARN: Work-in-progress, unimplemented  Text document for embedding. Requires inference infrastructure, unimplemented.
    """

    text: str = Field(..., description="Text document to be embedded by FastEmbed or Cloud inference server")
    model: Optional[str] = Field(default=None, description="Model name to be used for embedding computation")


class DropReplicaOperation(BaseModel, extra="forbid"):
    drop_replica: "Replica" = Field(..., description="")


class DropShardingKey(BaseModel, extra="forbid"):
    shard_key: "ShardKey" = Field(..., description="")


class DropShardingKeyOperation(BaseModel, extra="forbid"):
    drop_sharding_key: "DropShardingKey" = Field(..., description="")


class ErrorResponse(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional["ErrorResponseStatus"] = Field(default=None, description="")
    result: Optional[Any] = Field(default=None, description="")


class ErrorResponseStatus(BaseModel):
    error: Optional[str] = Field(default=None, description="Description of the occurred error.")


class FacetRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")
    key: str = Field(..., description="Payload key to use for faceting.")
    limit: Optional[int] = Field(default=None, description="Max number of hits to return. Default is 10.")
    filter: Optional["Filter"] = Field(
        default=None, description="Filter conditions - only consider points that satisfy these conditions."
    )
    exact: Optional[bool] = Field(
        default=None,
        description="Whether to do a more expensive exact count for each of the values in the facet. Default is false.",
    )


class FacetResponse(BaseModel):
    hits: List["FacetValueHit"] = Field(..., description="")


class FacetValueHit(BaseModel):
    value: "FacetValue" = Field(..., description="")
    count: int = Field(..., description="")


class FieldCondition(BaseModel, extra="forbid"):
    """
    All possible payload filtering conditions
    """

    key: str = Field(..., description="Payload key")
    match: Optional["Match"] = Field(default=None, description="Check if point has field with a given value")
    range: Optional["RangeInterface"] = Field(default=None, description="Check if points value lies in a given range")
    geo_bounding_box: Optional["GeoBoundingBox"] = Field(
        default=None, description="Check if points geo location lies in a given area"
    )
    geo_radius: Optional["GeoRadius"] = Field(default=None, description="Check if geo point is within a given radius")
    geo_polygon: Optional["GeoPolygon"] = Field(
        default=None, description="Check if geo point is within a given polygon"
    )
    values_count: Optional["ValuesCount"] = Field(default=None, description="Check number of values of the field")


class Filter(BaseModel, extra="forbid"):
    should: Optional[Union[List["Condition"], "Condition"]] = Field(
        default=None, description="At least one of those conditions should match"
    )
    min_should: Optional["MinShould"] = Field(
        default=None, description="At least minimum amount of given conditions should match"
    )
    must: Optional[Union[List["Condition"], "Condition"]] = Field(default=None, description="All conditions must match")
    must_not: Optional[Union[List["Condition"], "Condition"]] = Field(
        default=None, description="All conditions must NOT match"
    )


class FilterSelector(BaseModel, extra="forbid"):
    filter: "Filter" = Field(..., description="")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class FloatIndexParams(BaseModel, extra="forbid"):
    type: "FloatIndexType" = Field(..., description="")
    is_principal: Optional[bool] = Field(
        default=None,
        description="If true - use this key to organize storage of the collection data. This option assumes that this key will be used in majority of filtered requests.",
    )
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class FloatIndexType(str, Enum):
    FLOAT = "float"


class Fusion(str, Enum):
    """
    Fusion algorithm allows to combine results of multiple prefetches.  Available fusion algorithms:  * `rrf` - Reciprocal Rank Fusion * `dbsf` - Distribution-Based Score Fusion
    """

    def __str__(self) -> str:
        return str(self.value)

    RRF = "rrf"
    DBSF = "dbsf"


class FusionQuery(BaseModel, extra="forbid"):
    fusion: "Fusion" = Field(..., description="")


class GeoBoundingBox(BaseModel, extra="forbid"):
    """
    Geo filter request  Matches coordinates inside the rectangle, described by coordinates of lop-left and bottom-right edges
    """

    top_left: "GeoPoint" = Field(
        ...,
        description="Geo filter request  Matches coordinates inside the rectangle, described by coordinates of lop-left and bottom-right edges",
    )
    bottom_right: "GeoPoint" = Field(
        ...,
        description="Geo filter request  Matches coordinates inside the rectangle, described by coordinates of lop-left and bottom-right edges",
    )


class GeoIndexParams(BaseModel, extra="forbid"):
    type: "GeoIndexType" = Field(..., description="")
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class GeoIndexType(str, Enum):
    GEO = "geo"


class GeoLineString(BaseModel, extra="forbid"):
    """
    Ordered sequence of GeoPoints representing the line
    """

    points: List["GeoPoint"] = Field(..., description="Ordered sequence of GeoPoints representing the line")


class GeoPoint(BaseModel, extra="forbid"):
    """
    Geo point payload schema
    """

    lon: float = Field(..., description="Geo point payload schema")
    lat: float = Field(..., description="Geo point payload schema")


class GeoPolygon(BaseModel, extra="forbid"):
    """
    Geo filter request  Matches coordinates inside the polygon, defined by `exterior` and `interiors`
    """

    exterior: "GeoLineString" = Field(
        ...,
        description="Geo filter request  Matches coordinates inside the polygon, defined by `exterior` and `interiors`",
    )
    interiors: Optional[List["GeoLineString"]] = Field(
        default=None,
        description="Interior lines (if present) bound holes within the surface each GeoLineString must consist of a minimum of 4 points, and the first and last points must be the same.",
    )


class GeoRadius(BaseModel, extra="forbid"):
    """
    Geo filter request  Matches coordinates inside the circle of `radius` and center with coordinates `center`
    """

    center: "GeoPoint" = Field(
        ...,
        description="Geo filter request  Matches coordinates inside the circle of `radius` and center with coordinates `center`",
    )
    radius: float = Field(..., description="Radius of the area in meters")


class GroupsResult(BaseModel):
    groups: List["PointGroup"] = Field(..., description="")


class GrpcTelemetry(BaseModel):
    responses: Dict[str, "OperationDurationStatistics"] = Field(..., description="")


class HasIdCondition(BaseModel, extra="forbid"):
    """
    ID-based filtering condition
    """

    has_id: List["ExtendedPointId"] = Field(..., description="ID-based filtering condition")


class HnswConfig(BaseModel):
    """
    Config of HNSW index
    """

    m: int = Field(
        ...,
        description="Number of edges per node in the index graph. Larger the value - more accurate the search, more space required.",
    )
    ef_construct: int = Field(
        ...,
        description="Number of neighbours to consider during the index building. Larger the value - more accurate the search, more time required to build index.",
    )
    full_scan_threshold: int = Field(
        ...,
        description="Minimal size (in KiloBytes) of vectors for additional payload-based indexing. If payload chunk is smaller than `full_scan_threshold_kb` additional indexing won&#x27;t be used - in this case full-scan search should be preferred by query planner and additional indexing is not required. Note: 1Kb = 1 vector of size 256",
    )
    max_indexing_threads: Optional[int] = Field(
        default=0,
        description="Number of parallel threads used for background index building. If 0 - automatically select from 8 to 16. Best to keep between 8 and 16 to prevent likelihood of slow building or broken/inefficient HNSW graphs. On small CPUs, less threads are used.",
    )
    on_disk: Optional[bool] = Field(
        default=None,
        description="Store HNSW index on disk. If set to false, index will be stored in RAM. Default: false",
    )
    payload_m: Optional[int] = Field(
        default=None,
        description="Custom M param for hnsw graph built for payload index. If not set, default M will be used.",
    )


class HnswConfigDiff(BaseModel, extra="forbid"):
    m: Optional[int] = Field(
        default=None,
        description="Number of edges per node in the index graph. Larger the value - more accurate the search, more space required.",
    )
    ef_construct: Optional[int] = Field(
        default=None,
        description="Number of neighbours to consider during the index building. Larger the value - more accurate the search, more time required to build the index.",
    )
    full_scan_threshold: Optional[int] = Field(
        default=None,
        description="Minimal size (in kilobytes) of vectors for additional payload-based indexing. If payload chunk is smaller than `full_scan_threshold_kb` additional indexing won&#x27;t be used - in this case full-scan search should be preferred by query planner and additional indexing is not required. Note: 1Kb = 1 vector of size 256",
    )
    max_indexing_threads: Optional[int] = Field(
        default=None,
        description="Number of parallel threads used for background index building. If 0 - automatically select from 8 to 16. Best to keep between 8 and 16 to prevent likelihood of building broken/inefficient HNSW graphs. On small CPUs, less threads are used.",
    )
    on_disk: Optional[bool] = Field(
        default=None,
        description="Store HNSW index on disk. If set to false, the index will be stored in RAM. Default: false",
    )
    payload_m: Optional[int] = Field(
        default=None,
        description="Custom M param for additional payload-aware HNSW links. If not set, default M will be used.",
    )


class IndexesOneOf(BaseModel):
    """
    Do not use any index, scan whole vector collection during search. Guarantee 100% precision, but may be time consuming on large collections.
    """

    type: Literal["plain",] = Field(
        ...,
        description="Do not use any index, scan whole vector collection during search. Guarantee 100% precision, but may be time consuming on large collections.",
    )
    options: Any = Field(
        ...,
        description="Do not use any index, scan whole vector collection during search. Guarantee 100% precision, but may be time consuming on large collections.",
    )


class IndexesOneOf1(BaseModel):
    """
    Use filterable HNSW index for approximate search. Is very fast even on a very huge collections, but require additional space to store index and additional time to build it.
    """

    type: Literal["hnsw",] = Field(
        ...,
        description="Use filterable HNSW index for approximate search. Is very fast even on a very huge collections, but require additional space to store index and additional time to build it.",
    )
    options: "HnswConfig" = Field(
        ...,
        description="Use filterable HNSW index for approximate search. Is very fast even on a very huge collections, but require additional space to store index and additional time to build it.",
    )


class InitFrom(BaseModel, extra="forbid"):
    """
    Operation for creating new collection and (optionally) specify index params
    """

    collection: str = Field(
        ..., description="Operation for creating new collection and (optionally) specify index params"
    )


class InlineResponse200(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[bool] = Field(default=None, description="")


class InlineResponse2001(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["TelemetryData"] = Field(default=None, description="")


class InlineResponse20010(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List["SnapshotDescription"]] = Field(default=None, description="")


class InlineResponse20011(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["SnapshotDescription"] = Field(default=None, description="")


class InlineResponse20012(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["Record"] = Field(default=None, description="")


class InlineResponse20013(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List["Record"]] = Field(default=None, description="")


class InlineResponse20014(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List["UpdateResult"]] = Field(default=None, description="")


class InlineResponse20015(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["ScrollResult"] = Field(default=None, description="")


class InlineResponse20016(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List["ScoredPoint"]] = Field(default=None, description="")


class InlineResponse20017(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List[List["ScoredPoint"]]] = Field(default=None, description="")


class InlineResponse20018(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["GroupsResult"] = Field(default=None, description="")


class InlineResponse20019(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CountResult"] = Field(default=None, description="")


class InlineResponse2002(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["LocksOption"] = Field(default=None, description="")


class InlineResponse20020(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["FacetResponse"] = Field(default=None, description="")


class InlineResponse20021(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["QueryResponse"] = Field(default=None, description="")


class InlineResponse20022(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional[List["QueryResponse"]] = Field(default=None, description="")


class InlineResponse20023(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["SearchMatrixPairsResponse"] = Field(default=None, description="")


class InlineResponse20024(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["SearchMatrixOffsetsResponse"] = Field(default=None, description="")


class InlineResponse2003(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["ClusterStatus"] = Field(default=None, description="")


class InlineResponse2004(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CollectionsResponse"] = Field(default=None, description="")


class InlineResponse2005(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CollectionInfo"] = Field(default=None, description="")


class InlineResponse2006(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["UpdateResult"] = Field(default=None, description="")


class InlineResponse2007(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CollectionExistence"] = Field(default=None, description="")


class InlineResponse2008(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CollectionClusterInfo"] = Field(default=None, description="")


class InlineResponse2009(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")
    result: Optional["CollectionsAliasesResponse"] = Field(default=None, description="")


class InlineResponse202(BaseModel):
    time: Optional[float] = Field(default=None, description="Time spent to process this request")
    status: Optional[str] = Field(default=None, description="")


class IntegerIndexParams(BaseModel, extra="forbid"):
    type: "IntegerIndexType" = Field(..., description="")
    lookup: Optional[bool] = Field(default=None, description="If true - support direct lookups.")
    range: Optional[bool] = Field(default=None, description="If true - support ranges filters.")
    is_principal: Optional[bool] = Field(
        default=None,
        description="If true - use this key to organize storage of the collection data. This option assumes that this key will be used in majority of filtered requests.",
    )
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class IntegerIndexType(str, Enum):
    INTEGER = "integer"


class IsEmptyCondition(BaseModel, extra="forbid"):
    """
    Select points with empty payload for a specified field
    """

    is_empty: "PayloadField" = Field(..., description="Select points with empty payload for a specified field")


class IsNullCondition(BaseModel, extra="forbid"):
    """
    Select points with null payload for a specified field
    """

    is_null: "PayloadField" = Field(..., description="Select points with null payload for a specified field")


class KeywordIndexParams(BaseModel, extra="forbid"):
    type: "KeywordIndexType" = Field(..., description="")
    is_tenant: Optional[bool] = Field(
        default=None, description="If true - used for tenant optimization. Default: false."
    )
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class KeywordIndexType(str, Enum):
    KEYWORD = "keyword"


class LocalShardInfo(BaseModel):
    shard_id: int = Field(..., description="Local shard id")
    shard_key: Optional["ShardKey"] = Field(default=None, description="User-defined sharding key")
    points_count: int = Field(..., description="Number of points in the shard")
    state: "ReplicaState" = Field(..., description="")


class LocalShardTelemetry(BaseModel):
    variant_name: Optional[str] = Field(default=None, description="")
    status: Optional["ShardStatus"] = Field(default=None, description="")
    total_optimized_points: int = Field(..., description="Total number of optimized points since the last start.")
    segments: List["SegmentTelemetry"] = Field(..., description="")
    optimizations: "OptimizerTelemetry" = Field(..., description="")


class LocksOption(BaseModel, extra="forbid"):
    error_message: Optional[str] = Field(default=None, description="")
    write: bool = Field(..., description="")


class LookupLocation(BaseModel, extra="forbid"):
    """
    Defines a location to use for looking up the vector. Specifies collection and vector field name.
    """

    collection: str = Field(..., description="Name of the collection used for lookup")
    vector: Optional[str] = Field(
        default=None,
        description="Optional name of the vector field within the collection. If not provided, the default vector field will be used.",
    )
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )


class MatchAny(BaseModel, extra="forbid"):
    """
    Exact match on any of the given values
    """

    any: "AnyVariants" = Field(..., description="Exact match on any of the given values")


class MatchExcept(BaseModel, extra="forbid"):
    """
    Should have at least one value not matching the any given values
    """

    except_: "AnyVariants" = Field(
        ..., description="Should have at least one value not matching the any given values", alias="except"
    )


class MatchText(BaseModel, extra="forbid"):
    """
    Full-text match of the strings.
    """

    text: str = Field(..., description="Full-text match of the strings.")


class MatchValue(BaseModel, extra="forbid"):
    """
    Exact match of the given value
    """

    value: "ValueVariants" = Field(..., description="Exact match of the given value")


class MessageSendErrors(BaseModel):
    """
    Message send failures for a particular peer
    """

    count: int = Field(..., description="Message send failures for a particular peer")
    latest_error: Optional[str] = Field(default=None, description="Message send failures for a particular peer")
    latest_error_timestamp: Optional[Union[datetime, date]] = Field(
        default=None, description="Timestamp of the latest error"
    )


class MinShould(BaseModel, extra="forbid"):
    conditions: List["Condition"] = Field(..., description="")
    min_count: int = Field(..., description="")


class Modifier(str, Enum):
    """
    If used, include weight modification, which will be applied to sparse vectors at query time: None - no modification (default) Idf - inverse document frequency, based on statistics of the collection
    """

    def __str__(self) -> str:
        return str(self.value)

    NONE = "none"
    IDF = "idf"


class MoveShard(BaseModel, extra="forbid"):
    shard_id: int = Field(..., description="")
    to_peer_id: int = Field(..., description="")
    from_peer_id: int = Field(..., description="")
    method: Optional["ShardTransferMethod"] = Field(
        default=None, description="Method for transferring the shard from one node to another"
    )


class MoveShardOperation(BaseModel, extra="forbid"):
    move_shard: "MoveShard" = Field(..., description="")


class MultiVectorComparator(str, Enum):
    MAX_SIM = "max_sim"


class MultiVectorConfig(BaseModel, extra="forbid"):
    comparator: "MultiVectorComparator" = Field(..., description="")


class NamedSparseVector(BaseModel, extra="forbid"):
    """
    Sparse vector data with name
    """

    name: str = Field(..., description="Name of vector data")
    vector: "SparseVector" = Field(..., description="Sparse vector data with name")


class NamedVector(BaseModel, extra="forbid"):
    """
    Dense vector data with name
    """

    name: str = Field(..., description="Name of vector data")
    vector: List[float] = Field(..., description="Vector data")


class NearestQuery(BaseModel, extra="forbid"):
    nearest: "VectorInput" = Field(..., description="")


class Nested(BaseModel, extra="forbid"):
    """
    Select points with payload for a specified nested field
    """

    key: str = Field(..., description="Select points with payload for a specified nested field")
    filter: "Filter" = Field(..., description="Select points with payload for a specified nested field")


class NestedCondition(BaseModel, extra="forbid"):
    nested: "Nested" = Field(..., description="")


class OperationDurationStatistics(BaseModel):
    count: int = Field(..., description="")
    fail_count: Optional[int] = Field(default=None, description="")
    avg_duration_micros: Optional[float] = Field(
        default=None, description="The average time taken by 128 latest operations, calculated as a weighted mean."
    )
    min_duration_micros: Optional[float] = Field(
        default=None, description="The minimum duration of the operations across all the measurements."
    )
    max_duration_micros: Optional[float] = Field(
        default=None, description="The maximum duration of the operations across all the measurements."
    )
    total_duration_micros: int = Field(..., description="The total duration of all operations in microseconds.")
    last_responded: Optional[Union[datetime, date]] = Field(default=None, description="")


class OptimizerTelemetry(BaseModel):
    status: "OptimizersStatus" = Field(..., description="")
    optimizations: "OperationDurationStatistics" = Field(..., description="")
    log: List["TrackerTelemetry"] = Field(..., description="")


class OptimizersConfig(BaseModel):
    deleted_threshold: float = Field(
        ...,
        description="The minimal fraction of deleted vectors in a segment, required to perform segment optimization",
    )
    vacuum_min_vector_number: int = Field(
        ..., description="The minimal number of vectors in a segment, required to perform segment optimization"
    )
    default_segment_number: int = Field(
        ...,
        description="Target amount of segments optimizer will try to keep. Real amount of segments may vary depending on multiple parameters: - Amount of stored points - Current write RPS  It is recommended to select default number of segments as a factor of the number of search threads, so that each segment would be handled evenly by one of the threads. If `default_segment_number = 0`, will be automatically selected by the number of available CPUs.",
    )
    max_segment_size: Optional[int] = Field(
        default=None,
        description="Do not create segments larger this size (in kilobytes). Large segments might require disproportionately long indexation times, therefore it makes sense to limit the size of segments.  If indexing speed is more important - make this parameter lower. If search speed is more important - make this parameter higher. Note: 1Kb = 1 vector of size 256 If not set, will be automatically selected considering the number of available CPUs.",
    )
    memmap_threshold: Optional[int] = Field(
        default=None,
        description="Maximum size (in kilobytes) of vectors to store in-memory per segment. Segments larger than this threshold will be stored as read-only memmaped file.  Memmap storage is disabled by default, to enable it, set this threshold to a reasonable value.  To disable memmap storage, set this to `0`. Internally it will use the largest threshold possible.  Note: 1Kb = 1 vector of size 256",
    )
    indexing_threshold: Optional[int] = Field(
        default=None,
        description="Maximum size (in kilobytes) of vectors allowed for plain index, exceeding this threshold will enable vector indexing  Default value is 20,000, based on &lt;https://github.com/google-research/google-research/blob/master/scann/docs/algorithms.md&gt;.  To disable vector indexing, set to `0`.  Note: 1kB = 1 vector of size 256.",
    )
    flush_interval_sec: int = Field(..., description="Minimum interval between forced flushes.")
    max_optimization_threads: Optional[int] = Field(
        default=None,
        description="Max number of threads (jobs) for running optimizations per shard. Note: each optimization job will also use `max_indexing_threads` threads by itself for index building. If null - have no limit and choose dynamically to saturate CPU. If 0 - no optimization threads, optimizations will be disabled.",
    )


class OptimizersConfigDiff(BaseModel, extra="forbid"):
    deleted_threshold: Optional[float] = Field(
        default=None,
        description="The minimal fraction of deleted vectors in a segment, required to perform segment optimization",
    )
    vacuum_min_vector_number: Optional[int] = Field(
        default=None, description="The minimal number of vectors in a segment, required to perform segment optimization"
    )
    default_segment_number: Optional[int] = Field(
        default=None,
        description="Target amount of segments optimizer will try to keep. Real amount of segments may vary depending on multiple parameters: - Amount of stored points - Current write RPS  It is recommended to select default number of segments as a factor of the number of search threads, so that each segment would be handled evenly by one of the threads If `default_segment_number = 0`, will be automatically selected by the number of available CPUs",
    )
    max_segment_size: Optional[int] = Field(
        default=None,
        description="Do not create segments larger this size (in kilobytes). Large segments might require disproportionately long indexation times, therefore it makes sense to limit the size of segments.  If indexation speed have more priority for your - make this parameter lower. If search speed is more important - make this parameter higher. Note: 1Kb = 1 vector of size 256",
    )
    memmap_threshold: Optional[int] = Field(
        default=None,
        description="Maximum size (in kilobytes) of vectors to store in-memory per segment. Segments larger than this threshold will be stored as read-only memmaped file.  Memmap storage is disabled by default, to enable it, set this threshold to a reasonable value.  To disable memmap storage, set this to `0`.  Note: 1Kb = 1 vector of size 256",
    )
    indexing_threshold: Optional[int] = Field(
        default=None,
        description="Maximum size (in kilobytes) of vectors allowed for plain index, exceeding this threshold will enable vector indexing  Default value is 20,000, based on &lt;https://github.com/google-research/google-research/blob/master/scann/docs/algorithms.md&gt;.  To disable vector indexing, set to `0`.  Note: 1kB = 1 vector of size 256.",
    )
    flush_interval_sec: Optional[int] = Field(default=None, description="Minimum interval between forced flushes.")
    max_optimization_threads: Optional[int] = Field(
        default=None,
        description="Max number of threads (jobs) for running optimizations per shard. Note: each optimization job will also use `max_indexing_threads` threads by itself for index building. If null - have no limit and choose dynamically to saturate CPU. If 0 - no optimization threads, optimizations will be disabled.",
    )


class OptimizersStatusOneOf(str, Enum):
    """
    Optimizers are reporting as expected
    """

    def __str__(self) -> str:
        return str(self.value)

    OK = "ok"


class OptimizersStatusOneOf1(BaseModel):
    """
    Something wrong happened with optimizers
    """

    error: str = Field(..., description="Something wrong happened with optimizers")


class OrderBy(BaseModel, extra="forbid"):
    key: str = Field(..., description="Payload key to order by")
    direction: Optional["Direction"] = Field(
        default=None, description="Direction of ordering: `asc` or `desc`. Default is ascending."
    )
    start_from: Optional["StartFrom"] = Field(
        default=None,
        description="Which payload value to start scrolling from. Default is the lowest value for `asc` and the highest for `desc`",
    )


class OrderByQuery(BaseModel, extra="forbid"):
    order_by: "OrderByInterface" = Field(..., description="")


class OverwritePayloadOperation(BaseModel, extra="forbid"):
    overwrite_payload: "SetPayload" = Field(..., description="")


class P2pConfigTelemetry(BaseModel):
    connection_pool_size: int = Field(..., description="")


class PayloadField(BaseModel, extra="forbid"):
    """
    Payload field
    """

    key: str = Field(..., description="Payload field name")


class PayloadIndexInfo(BaseModel):
    """
    Display payload field type &amp; index information
    """

    data_type: "PayloadSchemaType" = Field(..., description="Display payload field type &amp; index information")
    params: Optional["PayloadSchemaParams"] = Field(
        default=None, description="Display payload field type &amp; index information"
    )
    points: int = Field(..., description="Number of points indexed with this index")


class PayloadIndexTelemetry(BaseModel):
    field_name: Optional[str] = Field(default=None, description="")
    points_values_count: int = Field(..., description="")
    points_count: int = Field(..., description="")
    histogram_bucket_size: Optional[int] = Field(default=None, description="")


class PayloadSchemaType(str, Enum):
    """
    All possible names of payload types
    """

    def __str__(self) -> str:
        return str(self.value)

    KEYWORD = "keyword"
    INTEGER = "integer"
    FLOAT = "float"
    GEO = "geo"
    TEXT = "text"
    BOOL = "bool"
    DATETIME = "datetime"
    UUID = "uuid"


class PayloadSelectorExclude(BaseModel, extra="forbid"):
    exclude: List[str] = Field(..., description="Exclude this fields from returning payload")


class PayloadSelectorInclude(BaseModel, extra="forbid"):
    include: List[str] = Field(..., description="Only include this payload keys")


class PayloadStorageTypeOneOf(BaseModel):
    type: Literal[
        "in_memory",
    ] = Field(..., description="")


class PayloadStorageTypeOneOf1(BaseModel):
    type: Literal[
        "on_disk",
    ] = Field(..., description="")


class PeerInfo(BaseModel):
    """
    Information of a peer in the cluster
    """

    uri: str = Field(..., description="Information of a peer in the cluster")


class PointGroup(BaseModel):
    hits: List["ScoredPoint"] = Field(..., description="Scored points that have the same value of the group_by key")
    id: "GroupId" = Field(..., description="")
    lookup: Optional["Record"] = Field(default=None, description="Record that has been looked up using the group id")


class PointIdsList(BaseModel, extra="forbid"):
    points: List["ExtendedPointId"] = Field(..., description="")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class PointRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    ids: List["ExtendedPointId"] = Field(..., description="Look for points with ids")
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is true."
    )
    with_vector: Optional["WithVector"] = Field(default=None, description="")


class PointStruct(BaseModel, extra="forbid"):
    id: "ExtendedPointId" = Field(..., description="")
    vector: "VectorStruct" = Field(..., description="")
    payload: Optional["Payload"] = Field(default=None, description="Payload values (optional)")


class PointVectors(BaseModel, extra="forbid"):
    id: "ExtendedPointId" = Field(..., description="")
    vector: "VectorStruct" = Field(..., description="")


class PointsBatch(BaseModel, extra="forbid"):
    batch: "Batch" = Field(..., description="")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class PointsList(BaseModel, extra="forbid"):
    points: List["PointStruct"] = Field(..., description="")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class Prefetch(BaseModel, extra="forbid"):
    prefetch: Optional[Union[List["Prefetch"], "Prefetch"]] = Field(
        default=None,
        description="Sub-requests to perform first. If present, the query will be performed on the results of the prefetches.",
    )
    query: Optional["QueryInterface"] = Field(
        default=None,
        description="Query to perform. If missing without prefetches, returns points ordered by their IDs.",
    )
    using: Optional[str] = Field(
        default=None,
        description="Define which vector name to use for querying. If missing, the default vector is used.",
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Filter conditions - return only those points that satisfy the specified conditions."
    )
    params: Optional["SearchParams"] = Field(default=None, description="Search params for when there is no prefetch")
    score_threshold: Optional[float] = Field(
        default=None, description="Return points with scores better than this threshold."
    )
    limit: Optional[int] = Field(default=None, description="Max number of points to return. Default is 10.")
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location to use for IDs lookup, if not specified - use the current collection and the &#x27;using&#x27; vector Note: the other collection vectors should have the same vector size as the &#x27;using&#x27; vector in the current collection",
    )


class ProductQuantization(BaseModel, extra="forbid"):
    product: "ProductQuantizationConfig" = Field(..., description="")


class ProductQuantizationConfig(BaseModel, extra="forbid"):
    compression: "CompressionRatio" = Field(..., description="")
    always_ram: Optional[bool] = Field(default=None, description="")


class QuantizationSearchParams(BaseModel, extra="forbid"):
    """
    Additional parameters of the search
    """

    ignore: Optional[bool] = Field(
        default=False, description="If true, quantized vectors are ignored. Default is false."
    )
    rescore: Optional[bool] = Field(
        default=None,
        description="If true, use original vectors to re-score top-k results. Might require more time in case if original vectors are stored on disk. If not set, qdrant decides automatically apply rescoring or not.",
    )
    oversampling: Optional[float] = Field(
        default=None,
        description="Oversampling factor for quantization. Default is 1.0.  Defines how many extra vectors should be pre-selected using quantized index, and then re-scored using original vectors.  For example, if `oversampling` is 2.4 and `limit` is 100, then 240 vectors will be pre-selected using quantized index, and then top-100 will be returned after re-scoring.",
    )


class QueryGroupsRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")
    prefetch: Optional[Union[List["Prefetch"], "Prefetch"]] = Field(
        default=None,
        description="Sub-requests to perform first. If present, the query will be performed on the results of the prefetch(es).",
    )
    query: Optional["QueryInterface"] = Field(
        default=None,
        description="Query to perform. If missing without prefetches, returns points ordered by their IDs.",
    )
    using: Optional[str] = Field(
        default=None,
        description="Define which vector name to use for querying. If missing, the default vector is used.",
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Filter conditions - return only those points that satisfy the specified conditions."
    )
    params: Optional["SearchParams"] = Field(default=None, description="Search params for when there is no prefetch")
    score_threshold: Optional[float] = Field(
        default=None, description="Return points with scores better than this threshold."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into the response. Default is false."
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Options for specifying which payload to include or not. Default is false."
    )
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location to use for IDs lookup, if not specified - use the current collection and the &#x27;using&#x27; vector Note: the other collection vectors should have the same vector size as the &#x27;using&#x27; vector in the current collection",
    )
    group_by: str = Field(
        ...,
        description="Payload field to group by, must be a string or number field. If the field contains more than 1 value, all values will be used for grouping. One point can be in multiple groups.",
    )
    group_size: Optional[int] = Field(
        default=None, description="Maximum amount of points to return per group. Default is 3."
    )
    limit: Optional[int] = Field(default=None, description="Maximum amount of groups to return. Default is 10.")
    with_lookup: Optional["WithLookupInterface"] = Field(
        default=None, description="Look for points in another collection using the group ids"
    )


class QueryRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")
    prefetch: Optional[Union[List["Prefetch"], "Prefetch"]] = Field(
        default=None,
        description="Sub-requests to perform first. If present, the query will be performed on the results of the prefetch(es).",
    )
    query: Optional["QueryInterface"] = Field(
        default=None,
        description="Query to perform. If missing without prefetches, returns points ordered by their IDs.",
    )
    using: Optional[str] = Field(
        default=None,
        description="Define which vector name to use for querying. If missing, the default vector is used.",
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Filter conditions - return only those points that satisfy the specified conditions."
    )
    params: Optional["SearchParams"] = Field(default=None, description="Search params for when there is no prefetch")
    score_threshold: Optional[float] = Field(
        default=None, description="Return points with scores better than this threshold."
    )
    limit: Optional[int] = Field(default=None, description="Max number of points to return. Default is 10.")
    offset: Optional[int] = Field(default=None, description="Offset of the result. Skip this many points. Default is 0")
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into the response. Default is false."
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Options for specifying which payload to include or not. Default is false."
    )
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location to use for IDs lookup, if not specified - use the current collection and the &#x27;using&#x27; vector Note: the other collection vectors should have the same vector size as the &#x27;using&#x27; vector in the current collection",
    )


class QueryRequestBatch(BaseModel, extra="forbid"):
    searches: List["QueryRequest"] = Field(..., description="")


class QueryResponse(BaseModel):
    points: List["ScoredPoint"] = Field(..., description="")


class RaftInfo(BaseModel):
    """
    Summary information about the current raft state
    """

    term: int = Field(
        ...,
        description="Raft divides time into terms of arbitrary length, each beginning with an election. If a candidate wins the election, it remains the leader for the rest of the term. The term number increases monotonically. Each server stores the current term number which is also exchanged in every communication.",
    )
    commit: int = Field(
        ..., description="The index of the latest committed (finalized) operation that this peer is aware of."
    )
    pending_operations: int = Field(
        ..., description="Number of consensus operations pending to be applied on this peer"
    )
    leader: Optional[int] = Field(default=None, description="Leader of the current term")
    role: Optional["StateRole"] = Field(default=None, description="Role of this peer in the current term")
    is_voter: bool = Field(..., description="Is this peer a voter or a learner")


class Range(BaseModel, extra="forbid"):
    """
    Range filter request
    """

    lt: Optional[float] = Field(default=None, description="point.key &lt; range.lt")
    gt: Optional[float] = Field(default=None, description="point.key &gt; range.gt")
    gte: Optional[float] = Field(default=None, description="point.key &gt;= range.gte")
    lte: Optional[float] = Field(default=None, description="point.key &lt;= range.lte")


class ReadConsistencyType(str, Enum):
    """
    * `majority` - send N/2+1 random request and return points, which present on all of them  * `quorum` - send requests to all nodes and return points which present on majority of nodes  * `all` - send requests to all nodes and return points which present on all nodes
    """

    def __str__(self) -> str:
        return str(self.value)

    MAJORITY = "majority"
    QUORUM = "quorum"
    ALL = "all"


class RecommendGroupsRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    positive: Optional[List["RecommendExample"]] = Field(default=[], description="Look for vectors closest to those")
    negative: Optional[List["RecommendExample"]] = Field(default=[], description="Try to avoid vectors like this")
    strategy: Optional["RecommendStrategy"] = Field(
        default=None, description="How to use positive and negative examples to find the results"
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    params: Optional["SearchParams"] = Field(default=None, description="Additional search params")
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is false."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into response. Default is false."
    )
    score_threshold: Optional[float] = Field(
        default=None,
        description="Define a minimal score threshold for the result. If defined, less similar results will not be returned. Score of the returned result might be higher or smaller than the threshold depending on the Distance function used. E.g. for cosine similarity only higher scores will be returned.",
    )
    using: Optional["UsingVector"] = Field(
        default=None,
        description="Define which vector to use for recommendation, if not specified - try to use default vector",
    )
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location used to lookup vectors. If not specified - use current collection. Note: the other collection should have the same vector size as the current collection",
    )
    group_by: str = Field(
        ...,
        description="Payload field to group by, must be a string or number field. If the field contains more than 1 value, all values will be used for grouping. One point can be in multiple groups.",
    )
    group_size: int = Field(..., description="Maximum amount of points to return per group")
    limit: int = Field(..., description="Maximum amount of groups to return")
    with_lookup: Optional["WithLookupInterface"] = Field(
        default=None, description="Look for points in another collection using the group ids"
    )


class RecommendInput(BaseModel, extra="forbid"):
    positive: Optional[List["VectorInput"]] = Field(
        default=None, description="Look for vectors closest to the vectors from these points"
    )
    negative: Optional[List["VectorInput"]] = Field(
        default=None, description="Try to avoid vectors like the vector from these points"
    )
    strategy: Optional["RecommendStrategy"] = Field(
        default=None, description="How to use the provided vectors to find the results"
    )


class RecommendQuery(BaseModel, extra="forbid"):
    recommend: "RecommendInput" = Field(..., description="")


class RecommendRequest(BaseModel, extra="forbid"):
    """
    Recommendation request. Provides positive and negative examples of the vectors, which can be ids of points that are already stored in the collection, raw vectors, or even ids and vectors combined.  Service should look for the points which are closer to positive examples and at the same time further to negative examples. The concrete way of how to compare negative and positive distances is up to the `strategy` chosen.
    """

    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    positive: Optional[List["RecommendExample"]] = Field(default=[], description="Look for vectors closest to those")
    negative: Optional[List["RecommendExample"]] = Field(default=[], description="Try to avoid vectors like this")
    strategy: Optional["RecommendStrategy"] = Field(
        default=None, description="How to use positive and negative examples to find the results"
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    params: Optional["SearchParams"] = Field(default=None, description="Additional search params")
    limit: int = Field(..., description="Max number of result to return")
    offset: Optional[int] = Field(
        default=None,
        description="Offset of the first result to return. May be used to paginate results. Note: large offset values may cause performance issues.",
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is false."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into response. Default is false."
    )
    score_threshold: Optional[float] = Field(
        default=None,
        description="Define a minimal score threshold for the result. If defined, less similar results will not be returned. Score of the returned result might be higher or smaller than the threshold depending on the Distance function used. E.g. for cosine similarity only higher scores will be returned.",
    )
    using: Optional["UsingVector"] = Field(
        default=None,
        description="Define which vector to use for recommendation, if not specified - try to use default vector",
    )
    lookup_from: Optional["LookupLocation"] = Field(
        default=None,
        description="The location used to lookup vectors. If not specified - use current collection. Note: the other collection should have the same vector size as the current collection",
    )


class RecommendRequestBatch(BaseModel, extra="forbid"):
    searches: List["RecommendRequest"] = Field(..., description="")


class RecommendStrategy(str, Enum):
    """
    How to use positive and negative examples to find the results, default is `average_vector`:  * `average_vector` - Average positive and negative vectors and create a single query with the formula `query = avg_pos + avg_pos - avg_neg`. Then performs normal search.  * `best_score` - Uses custom search objective. Each candidate is compared against all examples, its score is then chosen from the `max(max_pos_score, max_neg_score)`. If the `max_neg_score` is chosen then it is squared and negated, otherwise it is just the `max_pos_score`.
    """

    def __str__(self) -> str:
        return str(self.value)

    AVERAGE_VECTOR = "average_vector"
    BEST_SCORE = "best_score"


class Record(BaseModel):
    """
    Point data
    """

    id: "ExtendedPointId" = Field(..., description="Point data")
    payload: Optional["Payload"] = Field(default=None, description="Payload - values assigned to the point")
    vector: Optional["VectorStruct"] = Field(default=None, description="Vector of the point")
    shard_key: Optional["ShardKey"] = Field(default=None, description="Shard Key")
    order_value: Optional["OrderValue"] = Field(default=None, description="Point data")


class RemoteShardInfo(BaseModel):
    shard_id: int = Field(..., description="Remote shard id")
    shard_key: Optional["ShardKey"] = Field(default=None, description="User-defined sharding key")
    peer_id: int = Field(..., description="Remote peer id")
    state: "ReplicaState" = Field(..., description="")


class RemoteShardTelemetry(BaseModel):
    shard_id: int = Field(..., description="")
    peer_id: Optional[int] = Field(default=None, description="")
    searches: "OperationDurationStatistics" = Field(..., description="")
    updates: "OperationDurationStatistics" = Field(..., description="")


class RenameAlias(BaseModel, extra="forbid"):
    """
    Change alias to a new one
    """

    old_alias_name: str = Field(..., description="Change alias to a new one")
    new_alias_name: str = Field(..., description="Change alias to a new one")


class RenameAliasOperation(BaseModel, extra="forbid"):
    """
    Change alias to a new one
    """

    rename_alias: "RenameAlias" = Field(..., description="Change alias to a new one")


class Replica(BaseModel, extra="forbid"):
    shard_id: int = Field(..., description="")
    peer_id: int = Field(..., description="")


class ReplicaSetTelemetry(BaseModel):
    id: int = Field(..., description="")
    local: Optional["LocalShardTelemetry"] = Field(default=None, description="")
    remote: List["RemoteShardTelemetry"] = Field(..., description="")
    replicate_states: Dict[str, "ReplicaState"] = Field(..., description="")


class ReplicaState(str, Enum):
    """
    State of the single shard within a replica set.
    """

    def __str__(self) -> str:
        return str(self.value)

    ACTIVE = "Active"
    DEAD = "Dead"
    PARTIAL = "Partial"
    INITIALIZING = "Initializing"
    LISTENER = "Listener"
    PARTIALSNAPSHOT = "PartialSnapshot"
    RECOVERY = "Recovery"


class ReplicateShard(BaseModel, extra="forbid"):
    shard_id: int = Field(..., description="")
    to_peer_id: int = Field(..., description="")
    from_peer_id: int = Field(..., description="")
    method: Optional["ShardTransferMethod"] = Field(
        default=None, description="Method for transferring the shard from one node to another"
    )


class ReplicateShardOperation(BaseModel, extra="forbid"):
    replicate_shard: "ReplicateShard" = Field(..., description="")


class RequestsTelemetry(BaseModel):
    rest: "WebApiTelemetry" = Field(..., description="")
    grpc: "GrpcTelemetry" = Field(..., description="")


class ReshardingDirectionOneOf(str, Enum):
    """
    Scale up, add a new shard
    """

    def __str__(self) -> str:
        return str(self.value)

    UP = "up"


class ReshardingDirectionOneOf1(str, Enum):
    """
    Scale down, remove a shard
    """

    def __str__(self) -> str:
        return str(self.value)

    DOWN = "down"


class ReshardingInfo(BaseModel):
    direction: "ReshardingDirection" = Field(..., description="")
    shard_id: int = Field(..., description="")
    peer_id: int = Field(..., description="")
    shard_key: Optional["ShardKey"] = Field(default=None, description="")
    comment: Optional[str] = Field(
        default=None,
        description="A human-readable report of the operation progress. Available only on the source peer.",
    )


class RestartTransfer(BaseModel, extra="forbid"):
    shard_id: int = Field(..., description="")
    from_peer_id: int = Field(..., description="")
    to_peer_id: int = Field(..., description="")
    method: "ShardTransferMethod" = Field(..., description="")


class RestartTransferOperation(BaseModel, extra="forbid"):
    restart_transfer: "RestartTransfer" = Field(..., description="")


class RunningEnvironmentTelemetry(BaseModel):
    distribution: Optional[str] = Field(default=None, description="")
    distribution_version: Optional[str] = Field(default=None, description="")
    is_docker: bool = Field(..., description="")
    cores: Optional[int] = Field(default=None, description="")
    ram_size: Optional[int] = Field(default=None, description="")
    disk_size: Optional[int] = Field(default=None, description="")
    cpu_flags: str = Field(..., description="")


class Sample(str, Enum):
    RANDOM = "random"


class SampleQuery(BaseModel, extra="forbid"):
    sample: "Sample" = Field(..., description="")


class ScalarQuantization(BaseModel, extra="forbid"):
    scalar: "ScalarQuantizationConfig" = Field(..., description="")


class ScalarQuantizationConfig(BaseModel, extra="forbid"):
    type: "ScalarType" = Field(..., description="")
    quantile: Optional[float] = Field(
        default=None,
        description="Quantile for quantization. Expected value range in [0.5, 1.0]. If not set - use the whole range of values",
    )
    always_ram: Optional[bool] = Field(
        default=None,
        description="If true - quantized vectors always will be stored in RAM, ignoring the config of main storage",
    )


class ScalarType(str, Enum):
    INT8 = "int8"


class ScoredPoint(BaseModel):
    """
    Search result
    """

    id: "ExtendedPointId" = Field(..., description="Search result")
    version: int = Field(..., description="Point version")
    score: float = Field(..., description="Points vector distance to the query vector")
    payload: Optional["Payload"] = Field(default=None, description="Payload - values assigned to the point")
    vector: Optional["VectorStruct"] = Field(default=None, description="Vector of the point")
    shard_key: Optional["ShardKey"] = Field(default=None, description="Shard Key")
    order_value: Optional["OrderValue"] = Field(default=None, description="Order-by value")


class ScrollRequest(BaseModel, extra="forbid"):
    """
    Scroll request - paginate over all points which matches given condition
    """

    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    offset: Optional["ExtendedPointId"] = Field(default=None, description="Start ID to read points from.")
    limit: Optional[int] = Field(default=None, description="Page size. Default: 10")
    filter: Optional["Filter"] = Field(
        default=None, description="Look only for points which satisfies this conditions. If not provided - all points."
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is true."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Scroll request - paginate over all points which matches given condition"
    )
    order_by: Optional["OrderByInterface"] = Field(default=None, description="Order the records by a payload field.")


class ScrollResult(BaseModel):
    """
    Result of the points read request
    """

    points: List["Record"] = Field(..., description="List of retrieved points")
    next_page_offset: Optional["ExtendedPointId"] = Field(
        default=None, description="Offset which should be used to retrieve a next page result"
    )


class SearchGroupsRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    vector: "NamedVectorStruct" = Field(..., description="")
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    params: Optional["SearchParams"] = Field(default=None, description="Additional search params")
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is false."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into response. Default is false."
    )
    score_threshold: Optional[float] = Field(
        default=None,
        description="Define a minimal score threshold for the result. If defined, less similar results will not be returned. Score of the returned result might be higher or smaller than the threshold depending on the Distance function used. E.g. for cosine similarity only higher scores will be returned.",
    )
    group_by: str = Field(
        ...,
        description="Payload field to group by, must be a string or number field. If the field contains more than 1 value, all values will be used for grouping. One point can be in multiple groups.",
    )
    group_size: int = Field(..., description="Maximum amount of points to return per group")
    limit: int = Field(..., description="Maximum amount of groups to return")
    with_lookup: Optional["WithLookupInterface"] = Field(
        default=None, description="Look for points in another collection using the group ids"
    )


class SearchMatrixOffsetsResponse(BaseModel):
    offsets_row: List[int] = Field(..., description="Row indices of the matrix")
    offsets_col: List[int] = Field(..., description="Column indices of the matrix")
    scores: List[float] = Field(..., description="Scores associated with matrix coordinates")
    ids: List["ExtendedPointId"] = Field(..., description="Ids of the points in order")


class SearchMatrixPair(BaseModel):
    """
    Pair of points (a, b) with score
    """

    a: "ExtendedPointId" = Field(..., description="Pair of points (a, b) with score")
    b: "ExtendedPointId" = Field(..., description="Pair of points (a, b) with score")
    score: float = Field(..., description="Pair of points (a, b) with score")


class SearchMatrixPairsResponse(BaseModel):
    pairs: List["SearchMatrixPair"] = Field(..., description="List of pairs of points with scores")


class SearchMatrixRequest(BaseModel, extra="forbid"):
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    sample: Optional[int] = Field(
        default=None, description="How many points to select and search within. Default is 10."
    )
    limit: Optional[int] = Field(default=None, description="How many neighbours per sample to find. Default is 3.")
    using: Optional[str] = Field(
        default=None,
        description="Define which vector name to use for querying. If missing, the default vector is used.",
    )


class SearchParams(BaseModel, extra="forbid"):
    """
    Additional parameters of the search
    """

    hnsw_ef: Optional[int] = Field(
        default=None,
        description="Params relevant to HNSW index Size of the beam in a beam-search. Larger the value - more accurate the result, more time required for search.",
    )
    exact: Optional[bool] = Field(
        default=False,
        description="Search without approximation. If set to true, search may run long but with exact results.",
    )
    quantization: Optional["QuantizationSearchParams"] = Field(default=None, description="Quantization params")
    indexed_only: Optional[bool] = Field(
        default=False,
        description="If enabled, the engine will only perform search among indexed or small segments. Using this option prevents slow searches in case of delayed index, but does not guarantee that all uploaded vectors will be included in search results",
    )


class SearchRequest(BaseModel, extra="forbid"):
    """
    Search request. Holds all conditions and parameters for the search of most similar points by vector similarity given the filtering restrictions.
    """

    shard_key: Optional["ShardKeySelector"] = Field(
        default=None,
        description="Specify in which shards to look for the points, if not specified - look in all shards",
    )
    vector: "NamedVectorStruct" = Field(
        ...,
        description="Search request. Holds all conditions and parameters for the search of most similar points by vector similarity given the filtering restrictions.",
    )
    filter: Optional["Filter"] = Field(default=None, description="Look only for points which satisfies this conditions")
    params: Optional["SearchParams"] = Field(default=None, description="Additional search params")
    limit: int = Field(..., description="Max number of result to return")
    offset: Optional[int] = Field(
        default=None,
        description="Offset of the first result to return. May be used to paginate results. Note: large offset values may cause performance issues.",
    )
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Select which payload to return with the response. Default is false."
    )
    with_vector: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include into response. Default is false."
    )
    score_threshold: Optional[float] = Field(
        default=None,
        description="Define a minimal score threshold for the result. If defined, less similar results will not be returned. Score of the returned result might be higher or smaller than the threshold depending on the Distance function used. E.g. for cosine similarity only higher scores will be returned.",
    )


class SearchRequestBatch(BaseModel, extra="forbid"):
    searches: List["SearchRequest"] = Field(..., description="")


class SegmentConfig(BaseModel):
    vector_data: Optional[Dict[str, "VectorDataConfig"]] = Field(default={}, description="")
    sparse_vector_data: Optional[Dict[str, "SparseVectorDataConfig"]] = Field(default=None, description="")
    payload_storage_type: "PayloadStorageType" = Field(..., description="")


class SegmentInfo(BaseModel):
    """
    Aggregated information about segment
    """

    segment_type: "SegmentType" = Field(..., description="Aggregated information about segment")
    num_vectors: int = Field(..., description="Aggregated information about segment")
    num_points: int = Field(..., description="Aggregated information about segment")
    num_indexed_vectors: int = Field(..., description="Aggregated information about segment")
    num_deleted_vectors: int = Field(..., description="Aggregated information about segment")
    ram_usage_bytes: int = Field(..., description="Aggregated information about segment")
    disk_usage_bytes: int = Field(..., description="Aggregated information about segment")
    is_appendable: bool = Field(..., description="Aggregated information about segment")
    index_schema: Dict[str, "PayloadIndexInfo"] = Field(..., description="Aggregated information about segment")
    vector_data: Dict[str, "VectorDataInfo"] = Field(..., description="Aggregated information about segment")


class SegmentTelemetry(BaseModel):
    info: "SegmentInfo" = Field(..., description="")
    config: "SegmentConfig" = Field(..., description="")
    vector_index_searches: List["VectorIndexSearchesTelemetry"] = Field(..., description="")
    payload_field_indices: List["PayloadIndexTelemetry"] = Field(..., description="")


class SegmentType(str, Enum):
    """
    Type of segment
    """

    def __str__(self) -> str:
        return str(self.value)

    PLAIN = "plain"
    INDEXED = "indexed"
    SPECIAL = "special"


class SetPayload(BaseModel, extra="forbid"):
    """
    This data structure is used in API interface and applied across multiple shards
    """

    payload: "Payload" = Field(
        ..., description="This data structure is used in API interface and applied across multiple shards"
    )
    points: Optional[List["ExtendedPointId"]] = Field(
        default=None, description="Assigns payload to each point in this list"
    )
    filter: Optional["Filter"] = Field(
        default=None, description="Assigns payload to each point that satisfy this filter condition"
    )
    shard_key: Optional["ShardKeySelector"] = Field(
        default=None, description="This data structure is used in API interface and applied across multiple shards"
    )
    key: Optional[str] = Field(
        default=None, description="Assigns payload to each point that satisfy this path of property"
    )


class SetPayloadOperation(BaseModel, extra="forbid"):
    set_payload: "SetPayload" = Field(..., description="")


class ShardSnapshotRecover(BaseModel, extra="forbid"):
    location: "ShardSnapshotLocation" = Field(..., description="")
    priority: Optional["SnapshotPriority"] = Field(default=None, description="")
    checksum: Optional[str] = Field(
        default=None, description="Optional SHA256 checksum to verify snapshot integrity before recovery."
    )
    api_key: Optional[str] = Field(
        default=None, description="Optional API key used when fetching the snapshot from a remote URL."
    )


class ShardStatus(str, Enum):
    """
    Current state of the shard (supports same states as the collection) `Green` - all good. `Yellow` - optimization is running, &#x27;Grey&#x27; - optimizations are possible but not triggered, `Red` - some operations failed and was not recovered
    """

    def __str__(self) -> str:
        return str(self.value)

    GREEN = "green"
    YELLOW = "yellow"
    GREY = "grey"
    RED = "red"


class ShardTransferInfo(BaseModel):
    shard_id: int = Field(..., description="")
    from_: int = Field(..., description="Source peer id", alias="from")
    to: int = Field(..., description="Destination peer id")
    sync: bool = Field(
        ...,
        description="If `true` transfer is a synchronization of a replicas If `false` transfer is a moving of a shard from one peer to another",
    )
    method: Optional["ShardTransferMethod"] = Field(default=None, description="")
    comment: Optional[str] = Field(
        default=None, description="A human-readable report of the transfer progress. Available only on the source peer."
    )


class ShardTransferMethodOneOf(str, Enum):
    """
    Stream all shard records in batches until the whole shard is transferred.
    """

    def __str__(self) -> str:
        return str(self.value)

    STREAM_RECORDS = "stream_records"


class ShardTransferMethodOneOf1(str, Enum):
    """
    Snapshot the shard, transfer and restore it on the receiver.
    """

    def __str__(self) -> str:
        return str(self.value)

    SNAPSHOT = "snapshot"


class ShardTransferMethodOneOf2(str, Enum):
    """
    Attempt to transfer shard difference by WAL delta.
    """

    def __str__(self) -> str:
        return str(self.value)

    WAL_DELTA = "wal_delta"


class ShardingMethod(str, Enum):
    AUTO = "auto"
    CUSTOM = "custom"


class SnapshotDescription(BaseModel):
    name: str = Field(..., description="")
    creation_time: Optional[str] = Field(default=None, description="")
    size: int = Field(..., description="")
    checksum: Optional[str] = Field(default=None, description="")


class SnapshotPriority(str, Enum):
    """
    Defines source of truth for snapshot recovery: `NoSync` means - restore snapshot without *any* additional synchronization. `Snapshot` means - prefer snapshot data over the current state. `Replica` means - prefer existing data over the snapshot.
    """

    def __str__(self) -> str:
        return str(self.value)

    NO_SYNC = "no_sync"
    SNAPSHOT = "snapshot"
    REPLICA = "replica"


class SnapshotRecover(BaseModel, extra="forbid"):
    location: str = Field(
        ...,
        description="Examples: - URL `http://localhost:8080/collections/my_collection/snapshots/my_snapshot` - Local path `file:///qdrant/snapshots/test_collection-2022-08-04-10-49-10.snapshot`",
    )
    priority: Optional["SnapshotPriority"] = Field(
        default=None,
        description="Defines which data should be used as a source of truth if there are other replicas in the cluster. If set to `Snapshot`, the snapshot will be used as a source of truth, and the current state will be overwritten. If set to `Replica`, the current state will be used as a source of truth, and after recovery if will be synchronized with the snapshot.",
    )
    checksum: Optional[str] = Field(
        default=None, description="Optional SHA256 checksum to verify snapshot integrity before recovery."
    )
    api_key: Optional[str] = Field(
        default=None, description="Optional API key used when fetching the snapshot from a remote URL."
    )


class SparseIndexConfig(BaseModel):
    """
    Configuration for sparse inverted index.
    """

    full_scan_threshold: Optional[int] = Field(
        default=None,
        description="We prefer a full scan search upto (excluding) this number of vectors.  Note: this is number of vectors, not KiloBytes.",
    )
    index_type: "SparseIndexType" = Field(..., description="Configuration for sparse inverted index.")
    datatype: Optional["VectorStorageDatatype"] = Field(
        default=None, description="Datatype used to store weights in the index."
    )


class SparseIndexParams(BaseModel, extra="forbid"):
    """
    Configuration for sparse inverted index.
    """

    full_scan_threshold: Optional[int] = Field(
        default=None,
        description="We prefer a full scan search upto (excluding) this number of vectors.  Note: this is number of vectors, not KiloBytes.",
    )
    on_disk: Optional[bool] = Field(
        default=None,
        description="Store index on disk. If set to false, the index will be stored in RAM. Default: false",
    )
    datatype: Optional["Datatype"] = Field(
        default=None,
        description="Defines which datatype should be used for the index. Choosing different datatypes allows to optimize memory usage and performance vs accuracy.  - For `float32` datatype - vectors are stored as single-precision floating point numbers, 4 bytes. - For `float16` datatype - vectors are stored as half-precision floating point numbers, 2 bytes. - For `uint8` datatype - vectors are quantized to unsigned 8-bit integers, 1 byte. Quantization to fit byte range `[0, 255]` happens during indexing automatically, so the actual vector data does not need to conform to this range.",
    )


class SparseIndexTypeOneOf(str, Enum):
    """
    Mutable RAM sparse index
    """

    def __str__(self) -> str:
        return str(self.value)

    MUTABLERAM = "MutableRam"


class SparseIndexTypeOneOf1(str, Enum):
    """
    Immutable RAM sparse index
    """

    def __str__(self) -> str:
        return str(self.value)

    IMMUTABLERAM = "ImmutableRam"


class SparseIndexTypeOneOf2(str, Enum):
    """
    Mmap sparse index
    """

    def __str__(self) -> str:
        return str(self.value)

    MMAP = "Mmap"


class SparseVector(BaseModel, extra="forbid"):
    """
    Sparse vector structure
    """

    indices: List[int] = Field(..., description="Indices must be unique")
    values: List[float] = Field(..., description="Values and indices must be the same length")


class SparseVectorDataConfig(BaseModel):
    """
    Config of single sparse vector data storage
    """

    index: "SparseIndexConfig" = Field(..., description="Config of single sparse vector data storage")


class SparseVectorParams(BaseModel, extra="forbid"):
    """
    Params of single sparse vector data storage
    """

    index: Optional["SparseIndexParams"] = Field(
        default=None, description="Custom params for index. If none - values from collection configuration are used."
    )
    modifier: Optional["Modifier"] = Field(
        default=None, description="Configures addition value modifications for sparse vectors. Default: none"
    )


class StateRole(str, Enum):
    """
    Role of the peer in the consensus
    """

    def __str__(self) -> str:
        return str(self.value)

    FOLLOWER = "Follower"
    CANDIDATE = "Candidate"
    LEADER = "Leader"
    PRECANDIDATE = "PreCandidate"


class TelemetryData(BaseModel):
    id: str = Field(..., description="")
    app: "AppBuildTelemetry" = Field(..., description="")
    collections: "CollectionsTelemetry" = Field(..., description="")
    cluster: "ClusterTelemetry" = Field(..., description="")
    requests: "RequestsTelemetry" = Field(..., description="")


class TextIndexParams(BaseModel, extra="forbid"):
    type: "TextIndexType" = Field(..., description="")
    tokenizer: Optional["TokenizerType"] = Field(default=None, description="")
    min_token_len: Optional[int] = Field(default=None, description="Minimum characters to be tokenized.")
    max_token_len: Optional[int] = Field(default=None, description="Maximum characters to be tokenized.")
    lowercase: Optional[bool] = Field(default=None, description="If true, lowercase all tokens. Default: true.")
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class TextIndexType(str, Enum):
    TEXT = "text"


class TokenizerType(str, Enum):
    PREFIX = "prefix"
    WHITESPACE = "whitespace"
    WORD = "word"
    MULTILINGUAL = "multilingual"


class TrackerStatusOneOf(str, Enum):
    OPTIMIZING = "optimizing"
    DONE = "done"


class TrackerStatusOneOf1(BaseModel):
    cancelled: str = Field(..., description="")


class TrackerStatusOneOf2(BaseModel):
    error: str = Field(..., description="")


class TrackerTelemetry(BaseModel):
    """
    Tracker object used in telemetry
    """

    name: str = Field(..., description="Name of the optimizer")
    segment_ids: List[int] = Field(..., description="Segment IDs being optimized")
    status: "TrackerStatus" = Field(..., description="Tracker object used in telemetry")
    start_at: Union[datetime, date] = Field(..., description="Start time of the optimizer")
    end_at: Optional[Union[datetime, date]] = Field(default=None, description="End time of the optimizer")


class UpdateCollection(BaseModel, extra="forbid"):
    """
    Operation for updating parameters of the existing collection
    """

    vectors: Optional["VectorsConfigDiff"] = Field(
        default=None,
        description="Map of vector data parameters to update for each named vector. To update parameters in a collection having a single unnamed vector, use an empty string as name.",
    )
    optimizers_config: Optional["OptimizersConfigDiff"] = Field(
        default=None,
        description="Custom params for Optimizers.  If none - it is left unchanged. This operation is blocking, it will only proceed once all current optimizations are complete",
    )
    params: Optional["CollectionParamsDiff"] = Field(
        default=None, description="Collection base params. If none - it is left unchanged."
    )
    hnsw_config: Optional["HnswConfigDiff"] = Field(
        default=None, description="HNSW parameters to update for the collection index. If none - it is left unchanged."
    )
    quantization_config: Optional["QuantizationConfigDiff"] = Field(
        default=None, description="Quantization parameters to update. If none - it is left unchanged."
    )
    sparse_vectors: Optional["SparseVectorsConfig"] = Field(
        default=None, description="Map of sparse vector data parameters to update for each sparse vector."
    )


class UpdateOperations(BaseModel, extra="forbid"):
    operations: List["UpdateOperation"] = Field(..., description="")


class UpdateResult(BaseModel):
    operation_id: Optional[int] = Field(default=None, description="Sequential number of the operation")
    status: "UpdateStatus" = Field(..., description="")


class UpdateStatus(str, Enum):
    """
    `Acknowledged` - Request is saved to WAL and will be process in a queue. `Completed` - Request is completed, changes are actual.
    """

    def __str__(self) -> str:
        return str(self.value)

    ACKNOWLEDGED = "acknowledged"
    COMPLETED = "completed"


class UpdateVectors(BaseModel, extra="forbid"):
    points: List["PointVectors"] = Field(..., description="Points with named vectors")
    shard_key: Optional["ShardKeySelector"] = Field(default=None, description="")


class UpdateVectorsOperation(BaseModel, extra="forbid"):
    update_vectors: "UpdateVectors" = Field(..., description="")


class UpsertOperation(BaseModel, extra="forbid"):
    upsert: "PointInsertOperations" = Field(..., description="")


class UuidIndexParams(BaseModel, extra="forbid"):
    type: "UuidIndexType" = Field(..., description="")
    is_tenant: Optional[bool] = Field(default=None, description="If true - used for tenant optimization.")
    on_disk: Optional[bool] = Field(default=None, description="If true, store the index on disk. Default: false.")


class UuidIndexType(str, Enum):
    UUID = "uuid"


class ValuesCount(BaseModel, extra="forbid"):
    """
    Values count filter request
    """

    lt: Optional[int] = Field(default=None, description="point.key.length() &lt; values_count.lt")
    gt: Optional[int] = Field(default=None, description="point.key.length() &gt; values_count.gt")
    gte: Optional[int] = Field(default=None, description="point.key.length() &gt;= values_count.gte")
    lte: Optional[int] = Field(default=None, description="point.key.length() &lt;= values_count.lte")


class VectorDataConfig(BaseModel):
    """
    Config of single vector data storage
    """

    size: int = Field(..., description="Size/dimensionality of the vectors used")
    distance: "Distance" = Field(..., description="Config of single vector data storage")
    storage_type: "VectorStorageType" = Field(..., description="Config of single vector data storage")
    index: "Indexes" = Field(..., description="Config of single vector data storage")
    quantization_config: Optional["QuantizationConfig"] = Field(
        default=None, description="Vector specific quantization config that overrides collection config"
    )
    multivector_config: Optional["MultiVectorConfig"] = Field(
        default=None, description="Vector specific configuration to enable multiple vectors per point"
    )
    datatype: Optional["VectorStorageDatatype"] = Field(
        default=None, description="Vector specific configuration to set specific storage element type"
    )


class VectorDataInfo(BaseModel):
    num_vectors: int = Field(..., description="")
    num_indexed_vectors: int = Field(..., description="")
    num_deleted_vectors: int = Field(..., description="")


class VectorIndexSearchesTelemetry(BaseModel):
    index_name: Optional[str] = Field(default=None, description="")
    unfiltered_plain: "OperationDurationStatistics" = Field(..., description="")
    unfiltered_hnsw: "OperationDurationStatistics" = Field(..., description="")
    unfiltered_sparse: "OperationDurationStatistics" = Field(..., description="")
    filtered_plain: "OperationDurationStatistics" = Field(..., description="")
    filtered_small_cardinality: "OperationDurationStatistics" = Field(..., description="")
    filtered_large_cardinality: "OperationDurationStatistics" = Field(..., description="")
    filtered_exact: "OperationDurationStatistics" = Field(..., description="")
    filtered_sparse: "OperationDurationStatistics" = Field(..., description="")
    unfiltered_exact: "OperationDurationStatistics" = Field(..., description="")


class VectorParams(BaseModel, extra="forbid"):
    """
    Params of single vector data storage
    """

    size: int = Field(..., description="Size of a vectors used")
    distance: "Distance" = Field(..., description="Params of single vector data storage")
    hnsw_config: Optional["HnswConfigDiff"] = Field(
        default=None,
        description="Custom params for HNSW index. If none - values from collection configuration are used.",
    )
    quantization_config: Optional["QuantizationConfig"] = Field(
        default=None,
        description="Custom params for quantization. If none - values from collection configuration are used.",
    )
    on_disk: Optional[bool] = Field(
        default=None,
        description="If true, vectors are served from disk, improving RAM usage at the cost of latency Default: false",
    )
    datatype: Optional["Datatype"] = Field(
        default=None,
        description="Defines which datatype should be used to represent vectors in the storage. Choosing different datatypes allows to optimize memory usage and performance vs accuracy.  - For `float32` datatype - vectors are stored as single-precision floating point numbers, 4 bytes. - For `float16` datatype - vectors are stored as half-precision floating point numbers, 2 bytes. - For `uint8` datatype - vectors are stored as unsigned 8-bit integers, 1 byte. It expects vector elements to be in range `[0, 255]`.",
    )
    multivector_config: Optional["MultiVectorConfig"] = Field(
        default=None, description="Params of single vector data storage"
    )


class VectorParamsDiff(BaseModel, extra="forbid"):
    hnsw_config: Optional["HnswConfigDiff"] = Field(
        default=None, description="Update params for HNSW index. If empty object - it will be unset."
    )
    quantization_config: Optional["QuantizationConfigDiff"] = Field(
        default=None, description="Update params for quantization. If none - it is left unchanged."
    )
    on_disk: Optional[bool] = Field(
        default=None, description="If true, vectors are served from disk, improving RAM usage at the cost of latency"
    )


class VectorStorageDatatype(str, Enum):
    """
    Storage types for vectors
    """

    def __str__(self) -> str:
        return str(self.value)

    FLOAT32 = "float32"
    FLOAT16 = "float16"
    UINT8 = "uint8"


class VectorStorageTypeOneOf(str, Enum):
    """
    Storage in memory (RAM)  Will be very fast at the cost of consuming a lot of memory.
    """

    def __str__(self) -> str:
        return str(self.value)

    MEMORY = "Memory"


class VectorStorageTypeOneOf1(str, Enum):
    """
    Storage in mmap file, not appendable  Search performance is defined by disk speed and the fraction of vectors that fit in memory.
    """

    def __str__(self) -> str:
        return str(self.value)

    MMAP = "Mmap"


class VectorStorageTypeOneOf2(str, Enum):
    """
    Storage in chunked mmap files, appendable  Search performance is defined by disk speed and the fraction of vectors that fit in memory.
    """

    def __str__(self) -> str:
        return str(self.value)

    CHUNKEDMMAP = "ChunkedMmap"


class VectorStorageTypeOneOf3(str, Enum):
    """
    Same as `ChunkedMmap`, but vectors are forced to be locked in RAM In this way we avoid cold requests to disk, but risk to run out of memory  Designed as a replacement for `Memory`, which doesn&#x27;t depend on RocksDB
    """

    def __str__(self) -> str:
        return str(self.value)

    INRAMCHUNKEDMMAP = "InRamChunkedMmap"


class VersionInfo(BaseModel):
    title: str = Field(..., description="")
    version: str = Field(..., description="")
    commit: Optional[str] = Field(default=None, description="")


class WalConfig(BaseModel):
    wal_capacity_mb: int = Field(..., description="Size of a single WAL segment in MB")
    wal_segments_ahead: int = Field(..., description="Number of WAL segments to create ahead of actually used ones")


class WalConfigDiff(BaseModel, extra="forbid"):
    wal_capacity_mb: Optional[int] = Field(default=None, description="Size of a single WAL segment in MB")
    wal_segments_ahead: Optional[int] = Field(
        default=None, description="Number of WAL segments to create ahead of actually used ones"
    )


class WebApiTelemetry(BaseModel):
    responses: Dict[str, Dict[str, "OperationDurationStatistics"]] = Field(..., description="")


class WithLookup(BaseModel, extra="forbid"):
    collection: str = Field(..., description="Name of the collection to use for points lookup")
    with_payload: Optional["WithPayloadInterface"] = Field(
        default=None, description="Options for specifying which payload to include (or not)"
    )
    with_vectors: Optional["WithVector"] = Field(
        default=None, description="Options for specifying which vectors to include (or not)"
    )


class WriteOrdering(str, Enum):
    """
    Defines write ordering guarantees for collection operations  * `weak` - write operations may be reordered, works faster, default  * `medium` - write operations go through dynamically selected leader, may be inconsistent for a short period of time in case of leader change  * `strong` - Write operations go through the permanent leader, consistent, but may be unavailable if leader is down
    """

    def __str__(self) -> str:
        return str(self.value)

    WEAK = "weak"
    MEDIUM = "medium"
    STRONG = "strong"


AliasOperations = Union[
    CreateAliasOperation,
    DeleteAliasOperation,
    RenameAliasOperation,
]
AnyVariants = Union[
    List[StrictStr],
    List[StrictInt],
]
ClusterOperations = Union[
    MoveShardOperation,
    ReplicateShardOperation,
    AbortTransferOperation,
    DropReplicaOperation,
    CreateShardingKeyOperation,
    DropShardingKeyOperation,
    RestartTransferOperation,
]
ClusterStatus = Union[
    ClusterStatusOneOf,
    ClusterStatusOneOf1,
]
CollectionTelemetryEnum = Union[
    CollectionTelemetry,
    CollectionsAggregatedTelemetry,
]
Condition = Union[
    FieldCondition,
    IsEmptyCondition,
    IsNullCondition,
    HasIdCondition,
    NestedCondition,
    Filter,
]
ConsensusThreadStatus = Union[
    ConsensusThreadStatusOneOf,
    ConsensusThreadStatusOneOf1,
    ConsensusThreadStatusOneOf2,
]
ContextInput = Union[
    ContextPair,
    List[ContextPair],
]
ExtendedPointId = Union[
    StrictInt,
    StrictStr,
]
FacetValue = Union[
    StrictBool,
    StrictInt,
    StrictStr,
]
GroupId = Union[
    StrictInt,
    StrictStr,
]
Indexes = Union[
    IndexesOneOf,
    IndexesOneOf1,
]
Match = Union[
    MatchValue,
    MatchText,
    MatchAny,
    MatchExcept,
]
NamedVectorStruct = Union[
    List[StrictFloat],
    NamedVector,
    NamedSparseVector,
]
OptimizersStatus = Union[
    OptimizersStatusOneOf,
    OptimizersStatusOneOf1,
]
OrderByInterface = Union[
    StrictStr,
    OrderBy,
]
OrderValue = Union[
    StrictInt,
    StrictFloat,
]
PayloadSchemaParams = Union[
    KeywordIndexParams,
    IntegerIndexParams,
    FloatIndexParams,
    GeoIndexParams,
    TextIndexParams,
    BoolIndexParams,
    DatetimeIndexParams,
    UuidIndexParams,
]
PayloadSelector = Union[
    PayloadSelectorInclude,
    PayloadSelectorExclude,
]
PayloadStorageType = Union[
    PayloadStorageTypeOneOf,
    PayloadStorageTypeOneOf1,
]
PointInsertOperations = Union[
    PointsBatch,
    PointsList,
]
PointsSelector = Union[
    PointIdsList,
    FilterSelector,
]
QuantizationConfig = Union[
    ScalarQuantization,
    ProductQuantization,
    BinaryQuantization,
]
QuantizationConfigDiff = Union[
    ScalarQuantization,
    ProductQuantization,
    BinaryQuantization,
    Disabled,
]
Query = Union[
    NearestQuery,
    RecommendQuery,
    DiscoverQuery,
    ContextQuery,
    OrderByQuery,
    FusionQuery,
    SampleQuery,
]
RangeInterface = Union[
    Range,
    DatetimeRange,
]
ReadConsistency = Union[
    StrictInt,
    ReadConsistencyType,
]
ReshardingDirection = Union[
    ReshardingDirectionOneOf,
    ReshardingDirectionOneOf1,
]
ShardKey = Union[
    StrictInt,
    StrictStr,
]
ShardSnapshotLocation = Union[
    StrictStr,
]
ShardTransferMethod = Union[
    ShardTransferMethodOneOf,
    ShardTransferMethodOneOf1,
    ShardTransferMethodOneOf2,
]
SparseIndexType = Union[
    SparseIndexTypeOneOf,
    SparseIndexTypeOneOf1,
    SparseIndexTypeOneOf2,
]
StartFrom = Union[
    StrictInt,
    StrictFloat,
    datetime,
    date,
]
TrackerStatus = Union[
    TrackerStatusOneOf,
    TrackerStatusOneOf1,
    TrackerStatusOneOf2,
]
UpdateOperation = Union[
    UpsertOperation,
    DeleteOperation,
    SetPayloadOperation,
    OverwritePayloadOperation,
    DeletePayloadOperation,
    ClearPayloadOperation,
    UpdateVectorsOperation,
    DeleteVectorsOperation,
]
UsingVector = Union[
    StrictStr,
]
ValueVariants = Union[
    StrictBool,
    StrictInt,
    StrictStr,
]
Vector = Union[
    List[StrictFloat],
    SparseVector,
    List[List[StrictFloat]],
    Document,
]
VectorStorageType = Union[
    VectorStorageTypeOneOf,
    VectorStorageTypeOneOf1,
    VectorStorageTypeOneOf2,
    VectorStorageTypeOneOf3,
]
VectorsConfig = Union[
    VectorParams,
    Dict[StrictStr, VectorParams],
]
WithLookupInterface = Union[
    StrictStr,
    WithLookup,
]
WithVector = Union[
    StrictBool,
    List[StrictStr],
]
BatchVectorStruct = Union[
    List[List[StrictFloat]],
    List[List[List[StrictFloat]]],
    Dict[StrictStr, List[Vector]],
    List[Document],
]
PayloadFieldSchema = Union[
    PayloadSchemaType,
    PayloadSchemaParams,
]
RecommendExample = Union[
    ExtendedPointId,
    List[StrictFloat],
    SparseVector,
]
ShardKeySelector = Union[
    ShardKey,
    List[ShardKey],
]
VectorInput = Union[
    List[StrictFloat],
    SparseVector,
    List[List[StrictFloat]],
    ExtendedPointId,
    Document,
]
VectorStruct = Union[
    List[StrictFloat],
    List[List[StrictFloat]],
    Dict[StrictStr, Vector],
    Document,
]
WithPayloadInterface = Union[
    StrictBool,
    List[StrictStr],
    PayloadSelector,
]
QueryInterface = Union[
    VectorInput,
    Query,
]
