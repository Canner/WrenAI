from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union, get_args

from google.protobuf.json_format import MessageToDict
from google.protobuf.timestamp_pb2 import Timestamp

try:
    from google.protobuf.pyext._message import MessageMapContainer  # type: ignore
except ImportError:
    pass

from qdrant_client import grpc
from qdrant_client.grpc import ListValue, NullValue, Struct, Value
from qdrant_client.http.models import models as rest
from qdrant_client._pydantic_compat import construct, to_jsonable_python
from qdrant_client.conversions.common_types import get_args_subscribed


def has_field(message: Any, field: str) -> bool:
    """
    Same as protobuf HasField, but also works for primitive values
    (https://stackoverflow.com/questions/51918871/check-if-a-field-has-been-set-in-protocol-buffer-3)

    Args:
        message (Any): protobuf message
        field (str): name of the field
    """
    try:
        return message.HasField(field)
    except ValueError:
        all_fields = set([descriptor.name for descriptor, _value in message.ListFields()])
        return field in all_fields


def json_to_value(payload: Any) -> Value:
    if payload is None:
        return Value(null_value=NullValue.NULL_VALUE)
    if isinstance(payload, bool):
        return Value(bool_value=payload)
    if isinstance(payload, int):
        return Value(integer_value=payload)
    if isinstance(payload, float):
        return Value(double_value=payload)
    if isinstance(payload, str):
        return Value(string_value=payload)
    if isinstance(payload, (list, tuple)):
        return Value(list_value=ListValue(values=[json_to_value(v) for v in payload]))
    if isinstance(payload, dict):
        return Value(
            struct_value=Struct(fields=dict((k, json_to_value(v)) for k, v in payload.items()))
        )
    if isinstance(payload, datetime) or isinstance(payload, date):
        return Value(string_value=to_jsonable_python(payload))
    raise ValueError(f"Not supported json value: {payload}")  # pragma: no cover


def value_to_json(value: Value) -> Any:
    if isinstance(value, Value):
        value_ = MessageToDict(value, preserving_proto_field_name=False)
    else:
        value_ = value

    if "integerValue" in value_:
        # by default int are represented as string for precision
        # But in python it is OK to just use `int`
        return int(value_["integerValue"])
    if "doubleValue" in value_:
        return value_["doubleValue"]
    if "stringValue" in value_:
        return value_["stringValue"]
    if "boolValue" in value_:
        return value_["boolValue"]
    if "structValue" in value_:
        if "fields" not in value_["structValue"]:
            return {}
        return dict(
            (key, value_to_json(val)) for key, val in value_["structValue"]["fields"].items()
        )
    if "listValue" in value_:
        if "values" in value_["listValue"]:
            return list(value_to_json(val) for val in value_["listValue"]["values"])
        else:
            return []
    if "nullValue" in value_:
        return None
    raise ValueError(f"Not supported value: {value_}")  # pragma: no cover


def payload_to_grpc(payload: Dict[str, Any]) -> Dict[str, Value]:
    return dict((key, json_to_value(val)) for key, val in payload.items())


def grpc_to_payload(grpc_: Dict[str, Value]) -> Dict[str, Any]:
    return dict((key, value_to_json(val)) for key, val in grpc_.items())


def grpc_payload_schema_to_field_type(model: grpc.PayloadSchemaType) -> grpc.FieldType:
    if model == grpc.PayloadSchemaType.Keyword:
        return grpc.FieldType.FieldTypeKeyword
    if model == grpc.PayloadSchemaType.Integer:
        return grpc.FieldType.FieldTypeInteger
    if model == grpc.PayloadSchemaType.Float:
        return grpc.FieldType.FieldTypeFloat
    if model == grpc.PayloadSchemaType.Bool:
        return grpc.FieldType.FieldTypeBool
    if model == grpc.PayloadSchemaType.Geo:
        return grpc.FieldType.FieldTypeGeo
    if model == grpc.PayloadSchemaType.Text:
        return grpc.FieldType.FieldTypeText
    if model == grpc.PayloadSchemaType.Datetime:
        return grpc.FieldType.FieldTypeDatetime
    if model == grpc.PayloadSchemaType.Uuid:
        return grpc.FieldType.FieldTypeUuid

    raise ValueError(f"invalid PayloadSchemaType model: {model}")  # pragma: no cover


def grpc_field_type_to_payload_schema(model: grpc.FieldType) -> grpc.PayloadSchemaType:
    if model == grpc.FieldType.FieldTypeKeyword:
        return grpc.PayloadSchemaType.Keyword
    if model == grpc.FieldType.FieldTypeInteger:
        return grpc.PayloadSchemaType.Integer
    if model == grpc.FieldType.FieldTypeFloat:
        return grpc.PayloadSchemaType.Float
    if model == grpc.FieldType.FieldTypeBool:
        return grpc.PayloadSchemaType.Bool
    if model == grpc.FieldType.FieldTypeGeo:
        return grpc.PayloadSchemaType.Geo
    if model == grpc.FieldType.FieldTypeText:
        return grpc.PayloadSchemaType.Text
    if model == grpc.FieldType.FieldTypeDatetime:
        return grpc.PayloadSchemaType.Datetime
    if model == grpc.FieldType.FieldTypeUuid:
        return grpc.PayloadSchemaType.Uuid

    raise ValueError(f"invalid FieldType model: {model}")  # pragma: no cover


class GrpcToRest:
    @classmethod
    def convert_condition(cls, model: grpc.Condition) -> rest.Condition:
        name = model.WhichOneof("condition_one_of")
        if name is None:
            raise ValueError(f"invalid Condition model: {model}")
        val = getattr(model, name)

        if name == "field":
            return cls.convert_field_condition(val)
        if name == "filter":
            return cls.convert_filter(val)
        if name == "has_id":
            return cls.convert_has_id_condition(val)
        if name == "is_empty":
            return cls.convert_is_empty_condition(val)
        if name == "is_null":
            return cls.convert_is_null_condition(val)
        if name == "nested":
            return cls.convert_nested_condition(val)

        raise ValueError(f"invalid Condition model: {model}")  # pragma: no cover

    @classmethod
    def convert_filter(cls, model: grpc.Filter) -> rest.Filter:
        return rest.Filter(
            must=[cls.convert_condition(condition) for condition in model.must],
            should=[cls.convert_condition(condition) for condition in model.should],
            must_not=[cls.convert_condition(condition) for condition in model.must_not],
            min_should=(
                rest.MinShould(
                    conditions=[
                        cls.convert_condition(condition)
                        for condition in model.min_should.conditions
                    ],
                    min_count=model.min_should.min_count,
                )
                if model.HasField("min_should")
                else None
            ),
        )

    @classmethod
    def convert_range(cls, model: grpc.Range) -> rest.Range:
        return rest.Range(
            gt=model.gt if model.HasField("gt") else None,
            gte=model.gte if model.HasField("gte") else None,
            lt=model.lt if model.HasField("lt") else None,
            lte=model.lte if model.HasField("lte") else None,
        )

    @classmethod
    def convert_timestamp(cls, model: Timestamp) -> datetime:
        return model.ToDatetime(tzinfo=timezone.utc)

    @classmethod
    def convert_datetime_range(cls, model: grpc.DatetimeRange) -> rest.DatetimeRange:
        return rest.DatetimeRange(
            gt=cls.convert_timestamp(model.gt) if model.HasField("gt") else None,
            gte=cls.convert_timestamp(model.gte) if model.HasField("gte") else None,
            lt=cls.convert_timestamp(model.lt) if model.HasField("lt") else None,
            lte=cls.convert_timestamp(model.lte) if model.HasField("lte") else None,
        )

    @classmethod
    def convert_geo_radius(cls, model: grpc.GeoRadius) -> rest.GeoRadius:
        return rest.GeoRadius(center=cls.convert_geo_point(model.center), radius=model.radius)

    @classmethod
    def convert_collection_description(
        cls, model: grpc.CollectionDescription
    ) -> rest.CollectionDescription:
        return rest.CollectionDescription(name=model.name)

    @classmethod
    def convert_collection_info(cls, model: grpc.CollectionInfo) -> rest.CollectionInfo:
        return rest.CollectionInfo(
            config=cls.convert_collection_config(model.config),
            optimizer_status=cls.convert_optimizer_status(model.optimizer_status),
            payload_schema=cls.convert_payload_schema(model.payload_schema),
            segments_count=model.segments_count,
            status=cls.convert_collection_status(model.status),
            vectors_count=model.vectors_count if model.HasField("vectors_count") else None,
            points_count=model.points_count,
            indexed_vectors_count=model.indexed_vectors_count or 0,
        )

    @classmethod
    def convert_optimizer_status(cls, model: grpc.OptimizerStatus) -> rest.OptimizersStatus:
        if model.ok:
            return rest.OptimizersStatusOneOf.OK
        else:
            return rest.OptimizersStatusOneOf1(error=model.error)

    @classmethod
    def convert_collection_config(cls, model: grpc.CollectionConfig) -> rest.CollectionConfig:
        return rest.CollectionConfig(
            hnsw_config=cls.convert_hnsw_config(model.hnsw_config),
            optimizer_config=cls.convert_optimizer_config(model.optimizer_config),
            params=cls.convert_collection_params(model.params),
            wal_config=cls.convert_wal_config(model.wal_config),
            quantization_config=(
                cls.convert_quantization_config(model.quantization_config)
                if model.HasField("quantization_config")
                else None
            ),
        )

    @classmethod
    def convert_hnsw_config_diff(cls, model: grpc.HnswConfigDiff) -> rest.HnswConfigDiff:
        return rest.HnswConfigDiff(
            ef_construct=model.ef_construct if model.HasField("ef_construct") else None,
            m=model.m if model.HasField("m") else None,
            full_scan_threshold=(
                model.full_scan_threshold if model.HasField("full_scan_threshold") else None
            ),
            max_indexing_threads=(
                model.max_indexing_threads if model.HasField("max_indexing_threads") else None
            ),
            on_disk=model.on_disk if model.HasField("on_disk") else None,
            payload_m=model.payload_m if model.HasField("payload_m") else None,
        )

    @classmethod
    def convert_hnsw_config(cls, model: grpc.HnswConfigDiff) -> rest.HnswConfig:
        return rest.HnswConfig(
            ef_construct=model.ef_construct if model.HasField("ef_construct") else None,
            m=model.m if model.HasField("m") else None,
            full_scan_threshold=(
                model.full_scan_threshold if model.HasField("full_scan_threshold") else None
            ),
            max_indexing_threads=(
                model.max_indexing_threads if model.HasField("max_indexing_threads") else None
            ),
            on_disk=model.on_disk if model.HasField("on_disk") else None,
            payload_m=model.payload_m if model.HasField("payload_m") else None,
        )

    @classmethod
    def convert_optimizer_config(cls, model: grpc.OptimizersConfigDiff) -> rest.OptimizersConfig:
        return rest.OptimizersConfig(
            default_segment_number=(
                model.default_segment_number if model.HasField("default_segment_number") else None
            ),
            deleted_threshold=(
                model.deleted_threshold if model.HasField("deleted_threshold") else None
            ),
            flush_interval_sec=(
                model.flush_interval_sec if model.HasField("flush_interval_sec") else None
            ),
            indexing_threshold=(
                model.indexing_threshold if model.HasField("indexing_threshold") else None
            ),
            max_optimization_threads=(
                model.max_optimization_threads
                if model.HasField("max_optimization_threads")
                else None
            ),
            max_segment_size=(
                model.max_segment_size if model.HasField("max_segment_size") else None
            ),
            memmap_threshold=(
                model.memmap_threshold if model.HasField("memmap_threshold") else None
            ),
            vacuum_min_vector_number=(
                model.vacuum_min_vector_number
                if model.HasField("vacuum_min_vector_number")
                else None
            ),
        )

    @classmethod
    def convert_distance(cls, model: grpc.Distance) -> rest.Distance:
        if model == grpc.Distance.Cosine:
            return rest.Distance.COSINE
        elif model == grpc.Distance.Euclid:
            return rest.Distance.EUCLID
        elif model == grpc.Distance.Manhattan:
            return rest.Distance.MANHATTAN
        elif model == grpc.Distance.Dot:
            return rest.Distance.DOT
        else:
            raise ValueError(f"invalid Distance model: {model}")  # pragma: no cover

    @classmethod
    def convert_wal_config(cls, model: grpc.WalConfigDiff) -> rest.WalConfig:
        return rest.WalConfig(
            wal_capacity_mb=model.wal_capacity_mb if model.HasField("wal_capacity_mb") else None,
            wal_segments_ahead=(
                model.wal_segments_ahead if model.HasField("wal_segments_ahead") else None
            ),
        )

    @classmethod
    def convert_payload_schema(
        cls, model: Dict[str, grpc.PayloadSchemaInfo]
    ) -> Dict[str, rest.PayloadIndexInfo]:
        return {key: cls.convert_payload_schema_info(info) for key, info in model.items()}

    @classmethod
    def convert_payload_schema_info(cls, model: grpc.PayloadSchemaInfo) -> rest.PayloadIndexInfo:
        return rest.PayloadIndexInfo(
            data_type=cls.convert_payload_schema_type(model.data_type),
            params=(
                cls.convert_payload_schema_params(model.params)
                if model.HasField("params")
                else None
            ),
            points=model.points,
        )

    @classmethod
    def convert_payload_schema_params(
        cls, model: grpc.PayloadIndexParams
    ) -> rest.PayloadSchemaParams:
        if model.HasField("text_index_params"):
            text_index_params = model.text_index_params
            return cls.convert_text_index_params(text_index_params)
        if model.HasField("integer_index_params"):
            integer_index_params = model.integer_index_params
            return cls.convert_integer_index_params(integer_index_params)
        if model.HasField("keyword_index_params"):
            keyword_index_params = model.keyword_index_params
            return cls.convert_keyword_index_params(keyword_index_params)
        if model.HasField("float_index_params"):
            float_index_params = model.float_index_params
            return cls.convert_float_index_params(float_index_params)
        if model.HasField("geo_index_params"):
            geo_index_params = model.geo_index_params
            return cls.convert_geo_index_params(geo_index_params)
        if model.HasField("bool_index_params"):
            bool_index_params = model.bool_index_params
            return cls.convert_bool_index_params(bool_index_params)
        if model.HasField("datetime_index_params"):
            datetime_index_params = model.datetime_index_params
            return cls.convert_datetime_index_params(datetime_index_params)
        if model.HasField("uuid_index_params"):
            uuid_index_params = model.uuid_index_params
            return cls.convert_uuid_index_params(uuid_index_params)

        raise ValueError(f"invalid PayloadIndexParams model: {model}")  # pragma: no cover

    @classmethod
    def convert_payload_schema_type(cls, model: grpc.PayloadSchemaType) -> rest.PayloadSchemaType:
        if model == grpc.PayloadSchemaType.Float:
            return rest.PayloadSchemaType.FLOAT
        elif model == grpc.PayloadSchemaType.Geo:
            return rest.PayloadSchemaType.GEO
        elif model == grpc.PayloadSchemaType.Integer:
            return rest.PayloadSchemaType.INTEGER
        elif model == grpc.PayloadSchemaType.Keyword:
            return rest.PayloadSchemaType.KEYWORD
        elif model == grpc.PayloadSchemaType.Bool:
            return rest.PayloadSchemaType.BOOL
        elif model == grpc.PayloadSchemaType.Text:
            return rest.PayloadSchemaType.TEXT
        elif model == grpc.PayloadSchemaType.Datetime:
            return rest.PayloadSchemaType.DATETIME
        elif model == grpc.PayloadSchemaType.Uuid:
            return rest.PayloadSchemaType.UUID
        else:
            raise ValueError(f"invalid PayloadSchemaType model: {model}")  # pragma: no cover

    @classmethod
    def convert_collection_status(cls, model: grpc.CollectionStatus) -> rest.CollectionStatus:
        if model == grpc.CollectionStatus.Green:
            return rest.CollectionStatus.GREEN
        elif model == grpc.CollectionStatus.Yellow:
            return rest.CollectionStatus.YELLOW
        elif model == grpc.CollectionStatus.Red:
            return rest.CollectionStatus.RED
        elif model == grpc.CollectionStatus.Grey:
            return rest.CollectionStatus.GREY

        raise ValueError(f"invalid CollectionStatus model: {model}")  # pragma: no cover

    @classmethod
    def convert_update_result(cls, model: grpc.UpdateResult) -> rest.UpdateResult:
        return rest.UpdateResult(
            operation_id=model.operation_id,
            status=cls.convert_update_status(model.status),
        )

    @classmethod
    def convert_update_status(cls, model: grpc.UpdateStatus) -> rest.UpdateStatus:
        if model == grpc.UpdateStatus.Acknowledged:
            return rest.UpdateStatus.ACKNOWLEDGED
        elif model == grpc.UpdateStatus.Completed:
            return rest.UpdateStatus.COMPLETED
        else:
            raise ValueError(f"invalid UpdateStatus model: {model}")  # pragma: no cover

    @classmethod
    def convert_has_id_condition(cls, model: grpc.HasIdCondition) -> rest.HasIdCondition:
        return rest.HasIdCondition(has_id=[cls.convert_point_id(idx) for idx in model.has_id])

    @classmethod
    def convert_point_id(cls, model: grpc.PointId) -> rest.ExtendedPointId:
        name = model.WhichOneof("point_id_options")

        if name == "num":
            return model.num
        if name == "uuid":
            return model.uuid
        raise ValueError(f"invalid PointId model: {model}")  # pragma: no cover

    @classmethod
    def convert_delete_alias(cls, model: grpc.DeleteAlias) -> rest.DeleteAlias:
        return rest.DeleteAlias(alias_name=model.alias_name)

    @classmethod
    def convert_rename_alias(cls, model: grpc.RenameAlias) -> rest.RenameAlias:
        return rest.RenameAlias(
            old_alias_name=model.old_alias_name, new_alias_name=model.new_alias_name
        )

    @classmethod
    def convert_is_empty_condition(cls, model: grpc.IsEmptyCondition) -> rest.IsEmptyCondition:
        return rest.IsEmptyCondition(is_empty=rest.PayloadField(key=model.key))

    @classmethod
    def convert_is_null_condition(cls, model: grpc.IsNullCondition) -> rest.IsNullCondition:
        return rest.IsNullCondition(is_null=rest.PayloadField(key=model.key))

    @classmethod
    def convert_nested_condition(cls, model: grpc.NestedCondition) -> rest.NestedCondition:
        return rest.NestedCondition(
            nested=rest.Nested(
                key=model.key,
                filter=cls.convert_filter(model.filter),
            )
        )

    @classmethod
    def convert_search_params(cls, model: grpc.SearchParams) -> rest.SearchParams:
        return rest.SearchParams(
            hnsw_ef=model.hnsw_ef if model.HasField("hnsw_ef") else None,
            exact=model.exact if model.HasField("exact") else None,
            quantization=(
                cls.convert_quantization_search_params(model.quantization)
                if model.HasField("quantization")
                else None
            ),
            indexed_only=model.indexed_only if model.HasField("indexed_only") else None,
        )

    @classmethod
    def convert_create_alias(cls, model: grpc.CreateAlias) -> rest.CreateAlias:
        return rest.CreateAlias(collection_name=model.collection_name, alias_name=model.alias_name)

    @classmethod
    def convert_order_value(cls, model: grpc.OrderValue) -> rest.OrderValue:
        name = model.WhichOneof("variant")
        if name is None:
            raise ValueError(f"invalid OrderValue model: {model}")
        val = getattr(model, name)

        if name == "int":
            return val

        if name == "float":
            return val

        raise ValueError(f"invalid OrderValue model: {model}")  # pragma: no cover

    @classmethod
    def convert_scored_point(cls, model: grpc.ScoredPoint) -> rest.ScoredPoint:
        return construct(
            rest.ScoredPoint,
            id=cls.convert_point_id(model.id),
            payload=cls.convert_payload(model.payload) if has_field(model, "payload") else None,
            score=model.score,
            vector=cls.convert_vectors(model.vectors) if model.HasField("vectors") else None,
            version=model.version,
            shard_key=(
                cls.convert_shard_key(model.shard_key) if model.HasField("shard_key") else None
            ),
            order_value=(
                cls.convert_order_value(model.order_value)
                if model.HasField("order_value")
                else None
            ),
        )

    @classmethod
    def convert_payload(cls, model: "MessageMapContainer") -> rest.Payload:
        return dict((key, value_to_json(model[key])) for key in model)

    @classmethod
    def convert_values_count(cls, model: grpc.ValuesCount) -> rest.ValuesCount:
        return rest.ValuesCount(
            gt=model.gt if model.HasField("gt") else None,
            gte=model.gte if model.HasField("gte") else None,
            lt=model.lt if model.HasField("lt") else None,
            lte=model.lte if model.HasField("lte") else None,
        )

    @classmethod
    def convert_geo_bounding_box(cls, model: grpc.GeoBoundingBox) -> rest.GeoBoundingBox:
        return rest.GeoBoundingBox(
            bottom_right=cls.convert_geo_point(model.bottom_right),
            top_left=cls.convert_geo_point(model.top_left),
        )

    @classmethod
    def convert_point_struct(cls, model: grpc.PointStruct) -> rest.PointStruct:
        return rest.PointStruct(
            id=cls.convert_point_id(model.id),
            payload=cls.convert_payload(model.payload),
            vector=cls.convert_vectors(model.vectors) if model.HasField("vectors") else None,
        )

    @classmethod
    def convert_field_condition(cls, model: grpc.FieldCondition) -> rest.FieldCondition:
        geo_bounding_box = (
            cls.convert_geo_bounding_box(model.geo_bounding_box)
            if model.HasField("geo_bounding_box")
            else None
        )

        geo_radius = (
            cls.convert_geo_radius(model.geo_radius) if model.HasField("geo_radius") else None
        )

        match = cls.convert_match(model.match) if model.HasField("match") else None

        range_: Optional[rest.RangeInterface] = None
        if model.HasField("range"):
            range_ = cls.convert_range(model.range)
        elif model.HasField("datetime_range"):
            range_ = cls.convert_datetime_range(model.datetime_range)

        values_count = (
            cls.convert_values_count(model.values_count)
            if model.HasField("values_count")
            else None
        )

        return rest.FieldCondition(
            key=model.key,
            geo_bounding_box=geo_bounding_box,
            geo_radius=geo_radius,
            match=match,
            range=range_,
            values_count=values_count,
        )

    @classmethod
    def convert_match(cls, model: grpc.Match) -> rest.Match:
        name = model.WhichOneof("match_value")
        if name is None:
            raise ValueError(f"invalid Match model: {model}")
        val = getattr(model, name)

        if name == "integer":
            return rest.MatchValue(value=val)
        if name == "boolean":
            return rest.MatchValue(value=val)
        if name == "keyword":
            return rest.MatchValue(value=val)
        if name == "text":
            return rest.MatchText(text=val)
        if name == "keywords":
            return rest.MatchAny(any=list(val.strings))
        if name == "integers":
            return rest.MatchAny(any=list(val.integers))
        if name == "except_keywords":
            return rest.MatchExcept(**{"except": list(val.strings)})
        if name == "except_integers":
            return rest.MatchExcept(**{"except": list(val.integers)})
        raise ValueError(f"invalid Match model: {model}")  # pragma: no cover

    @classmethod
    def convert_wal_config_diff(cls, model: grpc.WalConfigDiff) -> rest.WalConfigDiff:
        return rest.WalConfigDiff(
            wal_capacity_mb=model.wal_capacity_mb if model.HasField("wal_capacity_mb") else None,
            wal_segments_ahead=(
                model.wal_segments_ahead if model.HasField("wal_segments_ahead") else None
            ),
        )

    @classmethod
    def convert_collection_params(cls, model: grpc.CollectionParams) -> rest.CollectionParams:
        return rest.CollectionParams(
            vectors=(
                cls.convert_vectors_config(model.vectors_config)
                if model.HasField("vectors_config")
                else None
            ),
            shard_number=model.shard_number,
            on_disk_payload=model.on_disk_payload,
            replication_factor=(
                model.replication_factor if model.HasField("replication_factor") else None
            ),
            read_fan_out_factor=(
                model.read_fan_out_factor if model.HasField("read_fan_out_factor") else None
            ),
            write_consistency_factor=(
                model.write_consistency_factor
                if model.HasField("write_consistency_factor")
                else None
            ),
            sparse_vectors=cls.convert_sparse_vector_config(model.sparse_vectors_config)
            if model.HasField("sparse_vectors_config")
            else None,
            sharding_method=cls.convert_sharding_method(model.sharding_method)
            if model.HasField("sharding_method")
            else None,
        )

    @classmethod
    def convert_optimizers_config_diff(
        cls, model: grpc.OptimizersConfigDiff
    ) -> rest.OptimizersConfigDiff:
        return rest.OptimizersConfigDiff(
            default_segment_number=(
                model.default_segment_number if model.HasField("default_segment_number") else None
            ),
            deleted_threshold=(
                model.deleted_threshold if model.HasField("deleted_threshold") else None
            ),
            flush_interval_sec=(
                model.flush_interval_sec if model.HasField("flush_interval_sec") else None
            ),
            indexing_threshold=(
                model.indexing_threshold if model.HasField("indexing_threshold") else None
            ),
            max_optimization_threads=(
                model.max_optimization_threads
                if model.HasField("max_optimization_threads")
                else None
            ),
            max_segment_size=(
                model.max_segment_size if model.HasField("max_segment_size") else None
            ),
            memmap_threshold=(
                model.memmap_threshold if model.HasField("memmap_threshold") else None
            ),
            vacuum_min_vector_number=(
                model.vacuum_min_vector_number
                if model.HasField("vacuum_min_vector_number")
                else None
            ),
        )

    @classmethod
    def convert_update_collection(cls, model: grpc.UpdateCollection) -> rest.UpdateCollection:
        return rest.UpdateCollection(
            vectors=(
                cls.convert_vectors_config_diff(model.vectors_config)
                if model.HasField("vectors_config")
                else None
            ),
            optimizers_config=(
                cls.convert_optimizers_config_diff(model.optimizers_config)
                if model.HasField("optimizers_config")
                else None
            ),
            params=(
                cls.convert_collection_params_diff(model.params)
                if model.HasField("params")
                else None
            ),
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.HasField("hnsw_config")
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config_diff(model.quantization_config)
                if model.HasField("quantization_config")
                else None
            ),
        )

    @classmethod
    def convert_geo_point(cls, model: grpc.GeoPoint) -> rest.GeoPoint:
        return rest.GeoPoint(
            lat=model.lat,
            lon=model.lon,
        )

    @classmethod
    def convert_alias_operations(cls, model: grpc.AliasOperations) -> rest.AliasOperations:
        name = model.WhichOneof("action")
        if name is None:
            raise ValueError(f"invalid AliasOperations model: {model}")
        val = getattr(model, name)

        if name == "rename_alias":
            return rest.RenameAliasOperation(rename_alias=cls.convert_rename_alias(val))
        if name == "create_alias":
            return rest.CreateAliasOperation(create_alias=cls.convert_create_alias(val))
        if name == "delete_alias":
            return rest.DeleteAliasOperation(delete_alias=cls.convert_delete_alias(val))

        raise ValueError(f"invalid AliasOperations model: {model}")  # pragma: no cover

    @classmethod
    def convert_alias_description(cls, model: grpc.AliasDescription) -> rest.AliasDescription:
        return rest.AliasDescription(
            alias_name=model.alias_name,
            collection_name=model.collection_name,
        )

    @classmethod
    def convert_points_selector(
        cls, model: grpc.PointsSelector, shard_key_selector: Optional[grpc.ShardKeySelector] = None
    ) -> rest.PointsSelector:
        name = model.WhichOneof("points_selector_one_of")
        if name is None:
            raise ValueError(f"invalid PointsSelector model: {model}")
        val = getattr(model, name)

        if name == "points":
            return rest.PointIdsList(
                points=[cls.convert_point_id(point) for point in val.ids],
                shard_key=shard_key_selector,
            )
        if name == "filter":
            return rest.FilterSelector(
                filter=cls.convert_filter(val),
                shard_key=shard_key_selector,
            )
        raise ValueError(f"invalid PointsSelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_with_payload_selector(
        cls, model: grpc.WithPayloadSelector
    ) -> rest.WithPayloadInterface:
        name = model.WhichOneof("selector_options")
        if name is None:
            raise ValueError(f"invalid WithPayloadSelector model: {model}")
        val = getattr(model, name)

        if name == "enable":
            return val
        if name == "include":
            return list(val.fields)
        if name == "exclude":
            return rest.PayloadSelectorExclude(exclude=list(val.fields))

        raise ValueError(f"invalid WithPayloadSelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_with_payload_interface(
        cls, model: grpc.WithPayloadSelector
    ) -> rest.WithPayloadInterface:
        return cls.convert_with_payload_selector(model)

    @classmethod
    def convert_retrieved_point(cls, model: grpc.RetrievedPoint) -> rest.Record:
        return rest.Record(
            id=cls.convert_point_id(model.id),
            payload=cls.convert_payload(model.payload),
            vector=cls.convert_vectors(model.vectors) if model.HasField("vectors") else None,
            shard_key=(
                cls.convert_shard_key(model.shard_key) if model.HasField("shard_key") else None
            ),
            order_value=(
                cls.convert_order_value(model.order_value)
                if model.HasField("order_value")
                else None
            ),
        )

    @classmethod
    def convert_record(cls, model: grpc.RetrievedPoint) -> rest.Record:
        return cls.convert_retrieved_point(model)

    @classmethod
    def convert_count_result(cls, model: grpc.CountResult) -> rest.CountResult:
        return rest.CountResult(count=model.count)

    @classmethod
    def convert_snapshot_description(
        cls, model: grpc.SnapshotDescription
    ) -> rest.SnapshotDescription:
        return rest.SnapshotDescription(
            name=model.name,
            creation_time=(
                model.creation_time.ToDatetime().isoformat()
                if model.HasField("creation_time")
                else None
            ),
            size=model.size,
        )

    @classmethod
    def convert_datatype(cls, model: grpc.Datatype) -> rest.Datatype:
        if model == grpc.Datatype.Float32:
            return rest.Datatype.FLOAT32
        elif model == grpc.Datatype.Uint8:
            return rest.Datatype.UINT8
        elif model == grpc.Datatype.Float16:
            return rest.Datatype.FLOAT16
        else:
            raise ValueError(f"invalid Datatype model: {model}")

    @classmethod
    def convert_vector_params(cls, model: grpc.VectorParams) -> rest.VectorParams:
        return rest.VectorParams(
            size=model.size,
            distance=cls.convert_distance(model.distance),
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.HasField("hnsw_config")
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config(model.quantization_config)
                if model.HasField("quantization_config")
                else None
            ),
            on_disk=model.on_disk if model.HasField("on_disk") else None,
            datatype=cls.convert_datatype(model.datatype) if model.HasField("datatype") else None,
            multivector_config=(
                cls.convert_multivector_config(model.multivector_config)
                if model.HasField("multivector_config")
                else None
            ),
        )

    @classmethod
    def convert_multivector_config(cls, model: grpc.MultiVectorConfig) -> rest.MultiVectorConfig:
        return rest.MultiVectorConfig(
            comparator=cls.convert_multivector_comparator(model.comparator)
        )

    @classmethod
    def convert_multivector_comparator(
        cls, model: grpc.MultiVectorComparator
    ) -> rest.MultiVectorComparator:
        if model == grpc.MultiVectorComparator.MaxSim:
            return rest.MultiVectorComparator.MAX_SIM

        raise ValueError(f"invalid MultiVectorComparator model: {model}")  # pragma: no cover

    @classmethod
    def convert_vectors_config(cls, model: grpc.VectorsConfig) -> rest.VectorsConfig:
        name = model.WhichOneof("config")
        if name is None:
            raise ValueError(f"invalid VectorsConfig model: {model}")
        val = getattr(model, name)

        if name == "params":
            return cls.convert_vector_params(val)
        if name == "params_map":
            return dict(
                (key, cls.convert_vector_params(vec_params)) for key, vec_params in val.map.items()
            )
        raise ValueError(f"invalid VectorsConfig model: {model}")  # pragma: no cover

    @classmethod
    def convert_vector(
        cls, model: grpc.Vector
    ) -> Union[List[float], List[List[float]], rest.SparseVector]:
        if model.HasField("indices"):
            return rest.SparseVector(indices=model.indices.data[:], values=model.data[:])
        if model.HasField("vectors_count"):
            vectors_count = model.vectors_count
            vectors = model.data
            step = len(vectors) // vectors_count
            return [vectors[i : i + step] for i in range(0, len(vectors), step)]
        return model.data[:]

    @classmethod
    def convert_named_vectors(cls, model: grpc.NamedVectors) -> Dict[str, rest.Vector]:
        vectors = {}
        for name, vector in model.vectors.items():
            vectors[name] = cls.convert_vector(vector)

        return vectors

    @classmethod
    def convert_vectors(cls, model: grpc.Vectors) -> rest.VectorStruct:
        name = model.WhichOneof("vectors_options")
        if name is None:
            raise ValueError(f"invalid Vectors model: {model}")
        val = getattr(model, name)

        if name == "vector":
            return cls.convert_vector(val)
        if name == "vectors":
            return cls.convert_named_vectors(val)
        raise ValueError(f"invalid Vectors model: {model}")  # pragma: no cover

    @classmethod
    def convert_dense_vector(cls, model: grpc.DenseVector) -> List[float]:
        return model.data[:]

    @classmethod
    def convert_sparse_vector(cls, model: grpc.SparseVector) -> rest.SparseVector:
        return rest.SparseVector(indices=model.indices[:], values=model.values[:])

    @classmethod
    def convert_multi_dense_vector(cls, model: grpc.MultiDenseVector) -> List[List[float]]:
        return [cls.convert_dense_vector(vector) for vector in model.vectors]

    @classmethod
    def convert_vector_input(cls, model: grpc.VectorInput) -> rest.VectorInput:
        name = model.WhichOneof("variant")
        if name is None:
            raise ValueError(f"invalid VectorInput model: {model}")
        val = getattr(model, name)

        if name == "id":
            return cls.convert_point_id(val)
        if name == "dense":
            return cls.convert_dense_vector(val)
        if name == "sparse":
            return cls.convert_sparse_vector(val)
        if name == "multi_dense":
            return cls.convert_multi_dense_vector(val)
        raise ValueError(f"invalid VectorInput model: {model}")

    @classmethod
    def convert_recommend_input(cls, model: grpc.RecommendInput) -> rest.RecommendInput:
        return rest.RecommendInput(
            positive=[cls.convert_vector_input(vector) for vector in model.positive],
            negative=[cls.convert_vector_input(vector) for vector in model.negative],
            strategy=cls.convert_recommend_strategy(model.strategy)
            if model.HasField("strategy")
            else None,
        )

    @classmethod
    def convert_context_input_pair(cls, model: grpc.ContextInputPair) -> rest.ContextPair:
        return rest.ContextPair(
            positive=cls.convert_vector_input(model.positive),
            negative=cls.convert_vector_input(model.negative),
        )

    @classmethod
    def convert_context_input(cls, model: grpc.ContextInput) -> rest.ContextInput:
        return [cls.convert_context_input_pair(pair) for pair in model.pairs]

    @classmethod
    def convert_discover_input(cls, model: grpc.DiscoverInput) -> rest.DiscoverInput:
        return rest.DiscoverInput(
            target=cls.convert_vector_input(model.target),
            context=cls.convert_context_input(model.context),
        )

    @classmethod
    def convert_fusion(cls, model: grpc.Fusion) -> rest.Fusion:
        if model == grpc.Fusion.RRF:
            return rest.Fusion.RRF

        if model == grpc.Fusion.DBSF:
            return rest.Fusion.DBSF

        raise ValueError(f"invalid Fusion model: {model}")  # pragma: no cover

    @classmethod
    def convert_sample(cls, model: grpc.Sample) -> rest.Sample:
        if model == grpc.Sample.Random:
            return rest.Sample.RANDOM

        raise ValueError(f"invalid Sample model: {model}")  # pragma: no cover

    @classmethod
    def convert_query(cls, model: grpc.Query) -> rest.Query:
        name = model.WhichOneof("variant")
        if name is None:
            raise ValueError(f"invalid Query model: {model}")
        val = getattr(model, name)

        if name == "nearest":
            return rest.NearestQuery(nearest=cls.convert_vector_input(val))

        if name == "recommend":
            return rest.RecommendQuery(recommend=cls.convert_recommend_input(val))

        if name == "discover":
            return rest.DiscoverQuery(discover=cls.convert_discover_input(val))

        if name == "context":
            return rest.ContextQuery(context=cls.convert_context_input(val))

        if name == "order_by":
            return rest.OrderByQuery(order_by=cls.convert_order_by(val))

        if name == "fusion":
            return rest.FusionQuery(fusion=cls.convert_fusion(val))

        if name == "sample":
            return rest.SampleQuery(sample=cls.convert_sample(val))

        raise ValueError(f"invalid Query model: {model}")

    @classmethod
    def convert_prefetch_query(cls, model: grpc.PrefetchQuery) -> rest.Prefetch:
        return rest.Prefetch(
            prefetch=[cls.convert_prefetch_query(prefetch) for prefetch in model.prefetch]
            if len(model.prefetch) != 0
            else None,
            query=cls.convert_query(model.query) if model.HasField("query") else None,
            using=model.using if model.HasField("using") else None,
            filter=cls.convert_filter(model.filter) if model.HasField("filter") else None,
            params=cls.convert_search_params(model.params) if model.HasField("params") else None,
            score_threshold=model.score_threshold if model.HasField("score_threshold") else None,
            limit=model.limit if model.HasField("limit") else None,
            lookup_from=cls.convert_lookup_location(model.lookup_from)
            if model.HasField("lookup_from")
            else None,
        )

    @classmethod
    def convert_vectors_selector(cls, model: grpc.VectorsSelector) -> List[str]:
        return model.names[:]

    @classmethod
    def convert_with_vectors_selector(cls, model: grpc.WithVectorsSelector) -> rest.WithVector:
        name = model.WhichOneof("selector_options")
        if name is None:
            raise ValueError(f"invalid WithVectorsSelector model: {model}")
        val = getattr(model, name)

        if name == "enable":
            return val
        if name == "include":
            return cls.convert_vectors_selector(val)
        raise ValueError(f"invalid WithVectorsSelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_search_points(cls, model: grpc.SearchPoints) -> rest.SearchRequest:
        return rest.SearchRequest(
            vector=rest.NamedVector(name=model.vector_name, vector=model.vector[:]),
            filter=cls.convert_filter(model.filter) if model.HasField("filter") else None,
            limit=model.limit,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.HasField("with_payload")
                else None
            ),
            params=cls.convert_search_params(model.params) if model.HasField("params") else None,
            score_threshold=model.score_threshold if model.HasField("score_threshold") else None,
            offset=model.offset if model.HasField("offset") else None,
            with_vector=(
                cls.convert_with_vectors_selector(model.with_vectors)
                if model.HasField("with_vectors")
                else None
            ),
            shard_key=(
                cls.convert_shard_key_selector(model.shard_key_selector)
                if model.HasField("shard_key_selector")
                else None
            ),
        )

    @classmethod
    def convert_query_points(cls, model: grpc.QueryPoints) -> rest.QueryRequest:
        return rest.QueryRequest(
            shard_key=(
                cls.convert_shard_key_selector(model.shard_key_selector)
                if model.HasField("shard_key_selector")
                else None
            ),
            prefetch=[cls.convert_prefetch_query(prefetch) for prefetch in model.prefetch]
            if len(model.prefetch) != 0
            else None,
            query=cls.convert_query(model.query) if model.HasField("query") else None,
            using=model.using if model.HasField("using") else None,
            filter=cls.convert_filter(model.filter) if model.HasField("filter") else None,
            params=cls.convert_search_params(model.params) if model.HasField("params") else None,
            score_threshold=model.score_threshold if model.HasField("score_threshold") else None,
            limit=model.limit if model.HasField("limit") else None,
            offset=model.offset if model.HasField("offset") else None,
            with_vector=(
                cls.convert_with_vectors_selector(model.with_vectors)
                if model.HasField("with_vectors")
                else None
            ),
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.HasField("with_payload")
                else None
            ),
            lookup_from=(
                cls.convert_lookup_location(model.lookup_from)
                if model.HasField("lookup_from")
                else None
            ),
        )

    @classmethod
    def convert_recommend_points(cls, model: grpc.RecommendPoints) -> rest.RecommendRequest:
        positive_ids = [cls.convert_point_id(point_id) for point_id in model.positive]
        negative_ids = [cls.convert_point_id(point_id) for point_id in model.negative]

        positive_vectors = [cls.convert_vector(vector) for vector in model.positive_vectors]
        negative_vectors = [cls.convert_vector(vector) for vector in model.negative_vectors]

        return rest.RecommendRequest(
            positive=positive_ids + positive_vectors,
            negative=negative_ids + negative_vectors,
            filter=cls.convert_filter(model.filter) if model.HasField("filter") else None,
            limit=model.limit,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.HasField("with_payload")
                else None
            ),
            params=cls.convert_search_params(model.params) if model.HasField("params") else None,
            score_threshold=model.score_threshold if model.HasField("score_threshold") else None,
            offset=model.offset if model.HasField("offset") else None,
            with_vector=(
                cls.convert_with_vectors_selector(model.with_vectors)
                if model.HasField("with_vectors")
                else None
            ),
            using=model.using,
            lookup_from=(
                cls.convert_lookup_location(model.lookup_from)
                if model.HasField("lookup_from")
                else None
            ),
            strategy=(
                cls.convert_recommend_strategy(model.strategy)
                if model.HasField("strategy")
                else None
            ),
            shard_key=(
                cls.convert_shard_key_selector(model.shard_key_selector)
                if model.HasField("shard_key_selector")
                else None
            ),
        )

    @classmethod
    def convert_discover_points(cls, model: grpc.DiscoverPoints) -> rest.DiscoverRequest:
        target = cls.convert_target_vector(model.target) if model.HasField("target") else None
        context = [cls.convert_context_example_pair(pair) for pair in model.context]
        return rest.DiscoverRequest(
            target=target,
            context=context,
            filter=cls.convert_filter(model.filter) if model.HasField("filter") else None,
            limit=model.limit,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.HasField("with_payload")
                else None
            ),
            params=cls.convert_search_params(model.params) if model.HasField("params") else None,
            offset=model.offset if model.HasField("offset") else None,
            with_vector=(
                cls.convert_with_vectors_selector(model.with_vectors)
                if model.HasField("with_vectors")
                else None
            ),
            using=model.using,
            lookup_from=(
                cls.convert_lookup_location(model.lookup_from)
                if model.HasField("lookup_from")
                else None
            ),
            shard_key=(
                cls.convert_shard_key_selector(model.shard_key_selector)
                if model.HasField("shard_key_selector")
                else None
            ),
        )

    @classmethod
    def convert_vector_example(cls, model: grpc.VectorExample) -> rest.RecommendExample:
        if model.HasField("vector"):
            return cls.convert_vector(model.vector)
        if model.HasField("id"):
            return cls.convert_point_id(model.id)

        raise ValueError(f"invalid VectorExample model: {model}")  # pragma: no cover

    @classmethod
    def convert_target_vector(cls, model: grpc.TargetVector) -> rest.RecommendExample:
        if model.HasField("single"):
            return cls.convert_vector_example(model.single)

        raise ValueError(f"invalid TargetVector model: {model}")  # pragma: no cover

    @classmethod
    def convert_context_example_pair(
        cls, model: grpc.ContextExamplePair
    ) -> rest.ContextExamplePair:
        return rest.ContextExamplePair(
            positive=cls.convert_vector_example(model.positive),
            negative=cls.convert_vector_example(model.negative),
        )

    @classmethod
    def convert_tokenizer_type(cls, model: grpc.TokenizerType) -> rest.TokenizerType:
        if model == grpc.Prefix:
            return rest.TokenizerType.PREFIX
        if model == grpc.Whitespace:
            return rest.TokenizerType.WHITESPACE
        if model == grpc.Word:
            return rest.TokenizerType.WORD
        if model == grpc.Multilingual:
            return rest.TokenizerType.MULTILINGUAL
        raise ValueError(f"invalid TokenizerType model: {model}")  # pragma: no cover

    @classmethod
    def convert_text_index_params(cls, model: grpc.TextIndexParams) -> rest.TextIndexParams:
        return rest.TextIndexParams(
            type="text",
            tokenizer=cls.convert_tokenizer_type(model.tokenizer),
            min_token_len=model.min_token_len if model.HasField("min_token_len") else None,
            max_token_len=model.max_token_len if model.HasField("max_token_len") else None,
            lowercase=model.lowercase if model.HasField("lowercase") else None,
        )

    @classmethod
    def convert_integer_index_params(
        cls, model: grpc.IntegerIndexParams
    ) -> rest.IntegerIndexParams:
        return rest.IntegerIndexParams(
            type=rest.IntegerIndexType.INTEGER,
            range=model.range,
            lookup=model.lookup,
            is_principal=model.is_principal if model.HasField("is_principal") else None,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_keyword_index_params(
        cls, model: grpc.KeywordIndexParams
    ) -> rest.KeywordIndexParams:
        return rest.KeywordIndexParams(
            type=rest.KeywordIndexType.KEYWORD,
            is_tenant=model.is_tenant if model.HasField("is_tenant") else None,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_float_index_params(cls, model: grpc.FloatIndexParams) -> rest.FloatIndexParams:
        return rest.FloatIndexParams(
            type=rest.FloatIndexType.FLOAT,
            is_principal=model.is_principal if model.HasField("is_principal") else None,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_geo_index_params(cls, model: grpc.GeoIndexParams) -> rest.GeoIndexParams:
        return rest.GeoIndexParams(
            type=rest.GeoIndexType.GEO,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_bool_index_params(cls, _: grpc.BoolIndexParams) -> rest.BoolIndexParams:
        return rest.BoolIndexParams(
            type=rest.BoolIndexType.BOOL,
        )

    @classmethod
    def convert_datetime_index_params(
        cls, model: grpc.DatetimeIndexParams
    ) -> rest.DatetimeIndexParams:
        return rest.DatetimeIndexParams(
            type=rest.DatetimeIndexType.DATETIME,
            is_principal=model.is_principal if model.HasField("is_principal") else None,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_uuid_index_params(cls, model: grpc.UuidIndexParams) -> rest.UuidIndexParams:
        return rest.UuidIndexParams(
            type=rest.UuidIndexType.UUID,
            is_tenant=model.is_tenant if model.HasField("is_tenant") else None,
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_collection_params_diff(
        cls, model: grpc.CollectionParamsDiff
    ) -> rest.CollectionParamsDiff:
        return rest.CollectionParamsDiff(
            replication_factor=(
                model.replication_factor if model.HasField("replication_factor") else None
            ),
            write_consistency_factor=(
                model.write_consistency_factor
                if model.HasField("write_consistency_factor")
                else None
            ),
            read_fan_out_factor=(
                model.read_fan_out_factor if model.HasField("read_fan_out_factor") else None
            ),
            on_disk_payload=model.on_disk_payload if model.HasField("on_disk_payload") else None,
        )

    @classmethod
    def convert_lookup_location(cls, model: grpc.LookupLocation) -> rest.LookupLocation:
        return rest.LookupLocation(
            collection=model.collection_name,
            vector=model.vector_name if model.HasField("vector_name") else None,
        )

    @classmethod
    def convert_write_ordering(cls, model: grpc.WriteOrdering) -> rest.WriteOrdering:
        if model.type == grpc.WriteOrderingType.Weak:
            return rest.WriteOrdering.WEAK
        if model.type == grpc.WriteOrderingType.Medium:
            return rest.WriteOrdering.MEDIUM
        if model.type == grpc.WriteOrderingType.Strong:
            return rest.WriteOrdering.STRONG
        raise ValueError(f"invalid WriteOrdering model: {model}")  # pragma: no cover

    @classmethod
    def convert_read_consistency(cls, model: grpc.ReadConsistency) -> rest.ReadConsistency:
        name = model.WhichOneof("value")
        if name is None:
            raise ValueError(f"invalid ReadConsistency model: {model}")
        val = getattr(model, name)
        if name == "factor":
            return val
        if name == "type":
            return cls.convert_read_consistency_type(val)
        raise ValueError(f"invalid ReadConsistency model: {model}")  # pragma: no cover

    @classmethod
    def convert_read_consistency_type(
        cls, model: grpc.ReadConsistencyType
    ) -> rest.ReadConsistencyType:
        if model == grpc.All:
            return rest.ReadConsistencyType.ALL
        if model == grpc.Majority:
            return rest.ReadConsistencyType.MAJORITY
        if model == grpc.Quorum:
            return rest.ReadConsistencyType.QUORUM
        raise ValueError(f"invalid ReadConsistencyType model: {model}")  # pragma: no cover

    @classmethod
    def convert_scalar_quantization_config(
        cls, model: grpc.ScalarQuantization
    ) -> rest.ScalarQuantizationConfig:
        return rest.ScalarQuantizationConfig(
            type=rest.ScalarType.INT8,
            quantile=model.quantile if model.HasField("quantile") else None,
            always_ram=model.always_ram if model.HasField("always_ram") else None,
        )

    @classmethod
    def convert_product_quantization_config(
        cls, model: grpc.ProductQuantization
    ) -> rest.ProductQuantizationConfig:
        return rest.ProductQuantizationConfig(
            compression=cls.convert_compression_ratio(model.compression),
            always_ram=model.always_ram if model.HasField("always_ram") else None,
        )

    @classmethod
    def convert_binary_quantization_config(
        cls, model: grpc.BinaryQuantization
    ) -> rest.BinaryQuantizationConfig:
        return rest.BinaryQuantizationConfig(
            always_ram=model.always_ram if model.HasField("always_ram") else None,
        )

    @classmethod
    def convert_compression_ratio(cls, model: grpc.CompressionRatio) -> rest.CompressionRatio:
        if model == grpc.x4:
            return rest.CompressionRatio.X4
        if model == grpc.x8:
            return rest.CompressionRatio.X8
        if model == grpc.x16:
            return rest.CompressionRatio.X16
        if model == grpc.x32:
            return rest.CompressionRatio.X32
        if model == grpc.x64:
            return rest.CompressionRatio.X64
        raise ValueError(f"invalid CompressionRatio model: {model}")  # pragma: no cover

    @classmethod
    def convert_quantization_config(
        cls, model: grpc.QuantizationConfig
    ) -> rest.QuantizationConfig:
        name = model.WhichOneof("quantization")
        if name is None:
            raise ValueError(f"invalid QuantizationConfig model: {model}")
        val = getattr(model, name)
        if name == "scalar":
            return rest.ScalarQuantization(scalar=cls.convert_scalar_quantization_config(val))
        if name == "product":
            return rest.ProductQuantization(product=cls.convert_product_quantization_config(val))
        if name == "binary":
            return rest.BinaryQuantization(binary=cls.convert_binary_quantization_config(val))
        raise ValueError(f"invalid QuantizationConfig model: {model}")  # pragma: no cover

    @classmethod
    def convert_quantization_search_params(
        cls, model: grpc.QuantizationSearchParams
    ) -> rest.QuantizationSearchParams:
        return rest.QuantizationSearchParams(
            ignore=model.ignore if model.HasField("ignore") else None,
            rescore=model.rescore if model.HasField("rescore") else None,
            oversampling=model.oversampling if model.HasField("oversampling") else None,
        )

    @classmethod
    def convert_point_vectors(cls, model: grpc.PointVectors) -> rest.PointVectors:
        return rest.PointVectors(
            id=cls.convert_point_id(model.id),
            vector=cls.convert_vectors(model.vectors),
        )

    @classmethod
    def convert_groups_result(cls, model: grpc.GroupsResult) -> rest.GroupsResult:
        return rest.GroupsResult(
            groups=[cls.convert_point_group(group) for group in model.groups],
        )

    @classmethod
    def convert_point_group(cls, model: grpc.PointGroup) -> rest.PointGroup:
        return rest.PointGroup(
            id=cls.convert_group_id(model.id),
            hits=[cls.convert_scored_point(hit) for hit in model.hits],
            lookup=cls.convert_record(model.lookup) if model.HasField("lookup") else None,
        )

    @classmethod
    def convert_group_id(cls, model: grpc.GroupId) -> rest.GroupId:
        name = model.WhichOneof("kind")
        if name is None:
            raise ValueError(f"invalid GroupId model: {model}")
        val = getattr(model, name)
        return val

    @classmethod
    def convert_with_lookup(cls, model: grpc.WithLookup) -> rest.WithLookup:
        return rest.WithLookup(
            collection=model.collection,
            with_payload=(
                cls.convert_with_payload_selector(model.with_payload)
                if model.HasField("with_payload")
                else None
            ),
            with_vectors=(
                cls.convert_with_vectors_selector(model.with_vectors)
                if model.HasField("with_vectors")
                else None
            ),
        )

    @classmethod
    def convert_quantization_config_diff(
        cls, model: grpc.QuantizationConfigDiff
    ) -> rest.QuantizationConfigDiff:
        name = model.WhichOneof("quantization")
        if name is None:
            raise ValueError(f"invalid QuantizationConfigDiff model: {model}")
        val = getattr(model, name)
        if name == "scalar":
            return rest.ScalarQuantization(scalar=cls.convert_scalar_quantization_config(val))
        if name == "product":
            return rest.ProductQuantization(product=cls.convert_product_quantization_config(val))
        if name == "binary":
            return rest.BinaryQuantization(binary=cls.convert_binary_quantization_config(val))
        if name == "disabled":
            return rest.Disabled.DISABLED
        raise ValueError(f"invalid QuantizationConfigDiff model: {model}")  # pragma: no cover

    @classmethod
    def convert_vector_params_diff(cls, model: grpc.VectorParamsDiff) -> rest.VectorParamsDiff:
        return rest.VectorParamsDiff(
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.HasField("hnsw_config")
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config_diff(model.quantization_config)
                if model.HasField("quantization_config")
                else None
            ),
            on_disk=model.on_disk if model.HasField("on_disk") else None,
        )

    @classmethod
    def convert_vectors_config_diff(cls, model: grpc.VectorsConfigDiff) -> rest.VectorsConfigDiff:
        name = model.WhichOneof("config")
        if name is None:
            raise ValueError(f"invalid VectorsConfigDiff model: {model}")
        val = getattr(model, name)

        if name == "params":
            return {"": cls.convert_vector_params_diff(val)}
        if name == "params_map":
            return dict(
                (key, cls.convert_vector_params_diff(vec_params))
                for key, vec_params in val.map.items()
            )
        raise ValueError(f"invalid VectorsConfigDiff model: {model}")  # pragma: no cover

    @classmethod
    def convert_points_update_operation(
        cls, model: grpc.PointsUpdateOperation
    ) -> rest.UpdateOperation:
        name = model.WhichOneof("operation")
        if name is None:
            raise ValueError(f"invalid PointsUpdateOperation model: {model}")
        val = getattr(model, name)

        if name == "upsert":
            shard_key_selector = (
                cls.convert_shard_key(val.shard_key_selector)
                if val.HasField("shard_key_selector")
                else None
            )
            return rest.UpsertOperation(
                upsert=rest.PointsList(
                    points=[cls.convert_point_struct(point) for point in val.points],
                    shard_key=shard_key_selector,
                )
            )
        elif name == "delete_points":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points, shard_key_selector=shard_key_selector
            )
            return rest.DeleteOperation(delete=points_selector)
        elif name == "set_payload":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points_selector, shard_key_selector=shard_key_selector
            )
            points = None
            filter_ = None
            if isinstance(points_selector, rest.PointIdsList):
                points = points_selector.points
            elif isinstance(points_selector, rest.FilterSelector):
                filter_ = points_selector.filter
            else:
                raise ValueError(
                    f"invalid PointsSelector model: {points_selector}"
                )  # pragma: no cover

            return rest.SetPayloadOperation(
                set_payload=rest.SetPayload(
                    payload=cls.convert_payload(val.payload),
                    points=points,
                    filter=filter_,
                )
            )
        elif name == "overwrite_payload":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points_selector, shard_key_selector=shard_key_selector
            )
            points = None
            filter_ = None
            if isinstance(points_selector, rest.PointIdsList):
                points = points_selector.points
            elif isinstance(points_selector, rest.FilterSelector):
                filter_ = points_selector.filter
            else:
                raise ValueError(
                    f"invalid PointsSelector model: {points_selector}"
                )  # pragma: no cover

            return rest.OverwritePayloadOperation(
                overwrite_payload=rest.SetPayload(
                    payload=cls.convert_payload(val.payload),
                    points=points,
                    filter=filter_,
                )
            )
        elif name == "delete_payload":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points_selector, shard_key_selector=shard_key_selector
            )
            points = None
            filter_ = None
            if isinstance(points_selector, rest.PointIdsList):
                points = points_selector.points
            elif isinstance(points_selector, rest.FilterSelector):
                filter_ = points_selector.filter
            else:
                raise ValueError(
                    f"invalid PointsSelector model: {points_selector}"
                )  # pragma: no cover

            return rest.DeletePayloadOperation(
                delete_payload=rest.DeletePayload(
                    keys=[key for key in val.keys],
                    points=points,
                    filter=filter_,
                )
            )
        elif name == "clear_payload":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points, shard_key_selector=shard_key_selector
            )
            return rest.ClearPayloadOperation(clear_payload=points_selector)
        elif name == "update_vectors":
            shard_key_selector = (
                cls.convert_shard_key(val.shard_key_selector)
                if val.HasField("shard_key_selector")
                else None
            )
            return rest.UpdateVectorsOperation(
                update_vectors=rest.UpdateVectors(
                    points=[cls.convert_point_vectors(point) for point in val.points],
                    shard_key=shard_key_selector,
                )
            )
        elif name == "delete_vectors":
            shard_key_selector = (
                val.shard_key_selector if val.HasField("shard_key_selector") else None
            )
            points_selector = cls.convert_points_selector(
                val.points_selector, shard_key_selector=shard_key_selector
            )
            points = None
            filter_ = None
            if isinstance(points_selector, rest.PointIdsList):
                points = points_selector.points
            elif isinstance(points_selector, rest.FilterSelector):
                filter_ = points_selector.filter
            else:
                raise ValueError(
                    f"invalid PointsSelector model: {points_selector}"
                )  # pragma: no cover

            return rest.DeleteVectorsOperation(
                delete_vectors=rest.DeleteVectors(
                    vector=[name for name in val.vectors.names],
                    points=points,
                    filter=filter_,
                )
            )
        else:
            raise ValueError(f"invalid UpdateOperation model: {model}")  # pragma: no cover

    @classmethod
    def convert_init_from(cls, model: str) -> rest.InitFrom:
        if isinstance(model, str):
            return rest.InitFrom(collection=model)
        raise ValueError(f"Invalid InitFrom model: {model}")  # pragma: no cover

    @classmethod
    def convert_recommend_strategy(cls, model: grpc.RecommendStrategy) -> rest.RecommendStrategy:
        if model == grpc.RecommendStrategy.AverageVector:
            return rest.RecommendStrategy.AVERAGE_VECTOR
        if model == grpc.RecommendStrategy.BestScore:
            return rest.RecommendStrategy.BEST_SCORE
        raise ValueError(f"invalid RecommendStrategy model: {model}")  # pragma: no cover

    @classmethod
    def convert_sparse_index_config(cls, model: grpc.SparseIndexConfig) -> rest.SparseIndexParams:
        return rest.SparseIndexParams(
            full_scan_threshold=(
                model.full_scan_threshold if model.HasField("full_scan_threshold") else None
            ),
            on_disk=model.on_disk if model.HasField("on_disk") else None,
            datatype=cls.convert_datatype(model.datatype) if model.HasField("datatype") else None,
        )

    @classmethod
    def convert_modifier(cls, model: grpc.Modifier) -> rest.Modifier:
        if model == grpc.Modifier.Idf:
            return rest.Modifier.IDF
        if model == getattr(grpc.Modifier, "None"):
            return rest.Modifier.NONE
        raise ValueError(f"invalid Modifier model: {model}")

    @classmethod
    def convert_sparse_vector_params(
        cls, model: grpc.SparseVectorParams
    ) -> rest.SparseVectorParams:
        return rest.SparseVectorParams(
            index=(
                cls.convert_sparse_index_config(model.index)
                if model.HasField("index") is not None
                else None
            ),
            modifier=(
                cls.convert_modifier(model.modifier) if model.HasField("modifier") else None
            ),
        )

    @classmethod
    def convert_sparse_vector_config(
        cls, model: grpc.SparseVectorConfig
    ) -> Dict[str, rest.SparseVectorParams]:
        return dict((key, cls.convert_sparse_vector_params(val)) for key, val in model.map.items())

    @classmethod
    def convert_shard_key(cls, model: grpc.ShardKey) -> rest.ShardKey:
        name = model.WhichOneof("key")
        if name is None:
            raise ValueError(f"invalid ShardKey model: {model}")
        val = getattr(model, name)
        return val

    @classmethod
    def convert_shard_key_selector(cls, model: grpc.ShardKeySelector) -> rest.ShardKeySelector:
        if len(model.shard_keys) == 1:
            return cls.convert_shard_key(model.shard_keys[0])
        return [cls.convert_shard_key(shard_key) for shard_key in model.shard_keys]

    @classmethod
    def convert_sharding_method(cls, model: grpc.ShardingMethod) -> rest.ShardingMethod:
        if model == grpc.Auto:
            return rest.ShardingMethod.AUTO
        if model == grpc.Custom:
            return rest.ShardingMethod.CUSTOM
        raise ValueError(f"invalid ShardingMethod model: {model}")  # pragma: no cover

    @classmethod
    def convert_direction(cls, model: grpc.Direction) -> rest.Direction:
        if model == grpc.Asc:
            return rest.Direction.ASC
        if model == grpc.Desc:
            return rest.Direction.DESC
        raise ValueError(f"invalid Direction model: {model}")  # pragma: no cover

    @classmethod
    def convert_start_from(cls, model: grpc.StartFrom) -> rest.StartFrom:
        if model.HasField("integer"):
            return model.integer
        if model.HasField("float"):
            return model.float
        if model.HasField("timestamp"):
            dt = cls.convert_timestamp(model.timestamp)
            return dt
        if model.HasField("datetime"):
            return model.datetime

    @classmethod
    def convert_order_by(cls, model: grpc.OrderBy) -> rest.OrderBy:
        return rest.OrderBy(
            key=model.key,
            direction=(
                cls.convert_direction(model.direction) if model.HasField("direction") else None
            ),
            start_from=(
                cls.convert_start_from(model.start_from) if model.HasField("start_from") else None
            ),
        )

    @classmethod
    def convert_facet_value(cls, model: grpc.FacetValue) -> rest.FacetValue:
        name = model.WhichOneof("variant")
        if name is None:
            raise ValueError(f"invalid FacetValue model: {model}")

        val = getattr(model, name)
        return val

    @classmethod
    def convert_facet_value_hit(cls, model: grpc.FacetHit) -> rest.FacetValueHit:
        return rest.FacetValueHit(
            value=cls.convert_facet_value(model.value),
            count=model.count,
        )

    @classmethod
    def convert_health_check_reply(cls, model: grpc.HealthCheckReply) -> rest.VersionInfo:
        return rest.VersionInfo(
            title=model.title,
            version=model.version,
            commit=model.commit if model.HasField("commit") else None,
        )

    @classmethod
    def convert_search_matrix_pair(cls, model: grpc.SearchMatrixPair) -> rest.SearchMatrixPair:
        return rest.SearchMatrixPair(
            a=cls.convert_point_id(model.a),
            b=cls.convert_point_id(model.b),
            score=model.score,
        )

    @classmethod
    def convert_search_matrix_pairs(
        cls, model: grpc.SearchMatrixPairs
    ) -> rest.SearchMatrixPairsResponse:
        return rest.SearchMatrixPairsResponse(
            pairs=[cls.convert_search_matrix_pair(pair) for pair in model.pairs],
        )

    @classmethod
    def convert_search_matrix_offsets(
        cls, model: grpc.SearchMatrixOffsets
    ) -> rest.SearchMatrixOffsetsResponse:
        return rest.SearchMatrixOffsetsResponse(
            offsets_row=list(model.offsets_row),
            offsets_col=list(model.offsets_col),
            scores=list(model.scores),
            ids=[cls.convert_point_id(p_id) for p_id in model.ids],
        )


# ----------------------------------------
#
# ----------- REST TO gRPC ---------------
#
# ----------------------------------------


class RestToGrpc:
    @classmethod
    def convert_filter(cls, model: rest.Filter) -> grpc.Filter:
        def convert_conditions(
            conditions: Union[List[rest.Condition], rest.Condition],
        ) -> List[grpc.Condition]:
            if not isinstance(conditions, List):
                conditions = [conditions]
            return [cls.convert_condition(condition) for condition in conditions]

        return grpc.Filter(
            must=(convert_conditions(model.must) if model.must is not None else None),
            must_not=(convert_conditions(model.must_not) if model.must_not is not None else None),
            should=(convert_conditions(model.should) if model.should is not None else None),
            min_should=(
                grpc.MinShould(
                    conditions=convert_conditions(model.min_should.conditions),
                    min_count=model.min_should.min_count,
                )
                if model.min_should is not None
                else None
            ),
        )

    @classmethod
    def convert_range(cls, model: rest.Range) -> grpc.Range:
        return grpc.Range(
            lt=model.lt,
            gt=model.gt,
            gte=model.gte,
            lte=model.lte,
        )

    @classmethod
    def convert_datetime(cls, model: Union[datetime, date]) -> Timestamp:
        if isinstance(model, date) and not isinstance(model, datetime):
            model = datetime.combine(model, datetime.min.time())
        ts = Timestamp()
        ts.FromDatetime(model)
        return ts

    @classmethod
    def convert_datetime_range(cls, model: rest.DatetimeRange) -> grpc.DatetimeRange:
        return grpc.DatetimeRange(
            lt=cls.convert_datetime(model.lt) if model.lt is not None else None,
            gt=cls.convert_datetime(model.gt) if model.gt is not None else None,
            gte=cls.convert_datetime(model.gte) if model.gte is not None else None,
            lte=cls.convert_datetime(model.lte) if model.lte is not None else None,
        )

    @classmethod
    def convert_geo_radius(cls, model: rest.GeoRadius) -> grpc.GeoRadius:
        return grpc.GeoRadius(center=cls.convert_geo_point(model.center), radius=model.radius)

    @classmethod
    def convert_collection_description(
        cls, model: rest.CollectionDescription
    ) -> grpc.CollectionDescription:
        return grpc.CollectionDescription(name=model.name)

    @classmethod
    def convert_collection_info(cls, model: rest.CollectionInfo) -> grpc.CollectionInfo:
        return grpc.CollectionInfo(
            config=cls.convert_collection_config(model.config) if model.config else None,
            optimizer_status=cls.convert_optimizer_status(model.optimizer_status),
            payload_schema=(
                cls.convert_payload_schema(model.payload_schema)
                if model.payload_schema is not None
                else None
            ),
            segments_count=model.segments_count,
            status=cls.convert_collection_status(model.status),
            vectors_count=model.vectors_count if model.vectors_count is not None else None,
            points_count=model.points_count,
        )

    @classmethod
    def convert_collection_status(cls, model: rest.CollectionStatus) -> grpc.CollectionStatus:
        if model == rest.CollectionStatus.RED:
            return grpc.CollectionStatus.Red
        if model == rest.CollectionStatus.YELLOW:
            return grpc.CollectionStatus.Yellow
        if model == rest.CollectionStatus.GREEN:
            return grpc.CollectionStatus.Green
        if model == rest.CollectionStatus.GREY:
            return grpc.CollectionStatus.Grey

        raise ValueError(f"invalid CollectionStatus model: {model}")  # pragma: no cover

    @classmethod
    def convert_optimizer_status(cls, model: rest.OptimizersStatus) -> grpc.OptimizerStatus:
        if isinstance(model, rest.OptimizersStatusOneOf):
            return grpc.OptimizerStatus(
                ok=True,
            )
        if isinstance(model, rest.OptimizersStatusOneOf1):
            return grpc.OptimizerStatus(ok=False, error=model.error)
        raise ValueError(f"invalid OptimizersStatus model: {model}")  # pragma: no cover

    @classmethod
    def convert_payload_schema(
        cls, model: Dict[str, rest.PayloadIndexInfo]
    ) -> Dict[str, grpc.PayloadSchemaInfo]:
        return dict((key, cls.convert_payload_index_info(val)) for key, val in model.items())

    @classmethod
    def convert_payload_index_info(cls, model: rest.PayloadIndexInfo) -> grpc.PayloadSchemaInfo:
        params = model.params
        return grpc.PayloadSchemaInfo(
            data_type=cls.convert_payload_schema_type(model.data_type),
            params=cls.convert_payload_schema_params(params) if params is not None else None,
            points=model.points,
        )

    @classmethod
    def convert_payload_schema_params(
        cls, model: rest.PayloadSchemaParams
    ) -> grpc.PayloadIndexParams:
        if isinstance(model, rest.TextIndexParams):
            return grpc.PayloadIndexParams(text_index_params=cls.convert_text_index_params(model))

        if isinstance(model, rest.IntegerIndexParams):
            return grpc.PayloadIndexParams(
                integer_index_params=cls.convert_integer_index_params(model)
            )

        if isinstance(model, rest.KeywordIndexParams):
            return grpc.PayloadIndexParams(
                keyword_index_params=cls.convert_keyword_index_params(model)
            )

        if isinstance(model, rest.FloatIndexParams):
            return grpc.PayloadIndexParams(
                float_index_params=cls.convert_float_index_params(model)
            )

        if isinstance(model, rest.GeoIndexParams):
            return grpc.PayloadIndexParams(geo_index_params=cls.convert_geo_index_params(model))

        if isinstance(model, rest.BoolIndexParams):
            return grpc.PayloadIndexParams(bool_index_params=cls.convert_bool_index_params(model))

        if isinstance(model, rest.DatetimeIndexParams):
            return grpc.PayloadIndexParams(
                datetime_index_params=cls.convert_datetime_index_params(model)
            )

        if isinstance(model, rest.UuidIndexParams):
            return grpc.PayloadIndexParams(uuid_index_params=cls.convert_uuid_index_params(model))

        raise ValueError(f"invalid PayloadSchemaParams model: {model}")  # pragma: no cover

    @classmethod
    def convert_payload_schema_type(cls, model: rest.PayloadSchemaType) -> grpc.PayloadSchemaType:
        if model == rest.PayloadSchemaType.KEYWORD:
            return grpc.PayloadSchemaType.Keyword
        if model == rest.PayloadSchemaType.INTEGER:
            return grpc.PayloadSchemaType.Integer
        if model == rest.PayloadSchemaType.FLOAT:
            return grpc.PayloadSchemaType.Float
        if model == rest.PayloadSchemaType.BOOL:
            return grpc.PayloadSchemaType.Bool
        if model == rest.PayloadSchemaType.GEO:
            return grpc.PayloadSchemaType.Geo
        if model == rest.PayloadSchemaType.TEXT:
            return grpc.PayloadSchemaType.Text
        if model == rest.PayloadSchemaType.DATETIME:
            return grpc.PayloadSchemaType.Datetime
        if model == rest.PayloadSchemaType.UUID:
            return grpc.PayloadSchemaType.Uuid

        raise ValueError(f"invalid PayloadSchemaType model: {model}")  # pragma: no cover

    @classmethod
    def convert_update_result(cls, model: rest.UpdateResult) -> grpc.UpdateResult:
        return grpc.UpdateResult(
            operation_id=model.operation_id,
            status=cls.convert_update_stats(model.status),
        )

    @classmethod
    def convert_update_stats(cls, model: rest.UpdateStatus) -> grpc.UpdateStatus:
        if model == rest.UpdateStatus.COMPLETED:
            return grpc.UpdateStatus.Completed
        if model == rest.UpdateStatus.ACKNOWLEDGED:
            return grpc.UpdateStatus.Acknowledged

        raise ValueError(f"invalid UpdateStatus model: {model}")  # pragma: no cover

    @classmethod
    def convert_has_id_condition(cls, model: rest.HasIdCondition) -> grpc.HasIdCondition:
        return grpc.HasIdCondition(
            has_id=[cls.convert_extended_point_id(idx) for idx in model.has_id]
        )

    @classmethod
    def convert_delete_alias(cls, model: rest.DeleteAlias) -> grpc.DeleteAlias:
        return grpc.DeleteAlias(alias_name=model.alias_name)

    @classmethod
    def convert_rename_alias(cls, model: rest.RenameAlias) -> grpc.RenameAlias:
        return grpc.RenameAlias(
            old_alias_name=model.old_alias_name, new_alias_name=model.new_alias_name
        )

    @classmethod
    def convert_is_empty_condition(cls, model: rest.IsEmptyCondition) -> grpc.IsEmptyCondition:
        return grpc.IsEmptyCondition(key=model.is_empty.key)

    @classmethod
    def convert_is_null_condition(cls, model: rest.IsNullCondition) -> grpc.IsNullCondition:
        return grpc.IsNullCondition(key=model.is_null.key)

    @classmethod
    def convert_nested_condition(cls, model: rest.NestedCondition) -> grpc.NestedCondition:
        return grpc.NestedCondition(
            key=model.nested.key,
            filter=cls.convert_filter(model.nested.filter),
        )

    @classmethod
    def convert_search_params(cls, model: rest.SearchParams) -> grpc.SearchParams:
        return grpc.SearchParams(
            hnsw_ef=model.hnsw_ef,
            exact=model.exact,
            quantization=(
                cls.convert_quantization_search_params(model.quantization)
                if model.quantization is not None
                else None
            ),
            indexed_only=model.indexed_only,
        )

    @classmethod
    def convert_create_alias(cls, model: rest.CreateAlias) -> grpc.CreateAlias:
        return grpc.CreateAlias(collection_name=model.collection_name, alias_name=model.alias_name)

    @classmethod
    def convert_order_value(cls, model: rest.OrderValue) -> grpc.OrderValue:
        if isinstance(model, int):
            return grpc.OrderValue(int=model)
        if isinstance(model, float):
            return grpc.OrderValue(float=model)
        raise ValueError(f"invalid OrderValue model: {model}")  # pragma: no cover

    @classmethod
    def convert_scored_point(cls, model: rest.ScoredPoint) -> grpc.ScoredPoint:
        return grpc.ScoredPoint(
            id=cls.convert_extended_point_id(model.id),
            payload=cls.convert_payload(model.payload) if model.payload is not None else None,
            score=model.score,
            vectors=cls.convert_vector_struct(model.vector) if model.vector is not None else None,
            version=model.version,
            shard_key=cls.convert_shard_key(model.shard_key) if model.shard_key else None,
            order_value=cls.convert_order_value(model.order_value) if model.order_value else None,
        )

    @classmethod
    def convert_values_count(cls, model: rest.ValuesCount) -> grpc.ValuesCount:
        return grpc.ValuesCount(
            lt=model.lt,
            gt=model.gt,
            gte=model.gte,
            lte=model.lte,
        )

    @classmethod
    def convert_geo_bounding_box(cls, model: rest.GeoBoundingBox) -> grpc.GeoBoundingBox:
        return grpc.GeoBoundingBox(
            top_left=cls.convert_geo_point(model.top_left),
            bottom_right=cls.convert_geo_point(model.bottom_right),
        )

    @classmethod
    def convert_point_struct(cls, model: rest.PointStruct) -> grpc.PointStruct:
        return grpc.PointStruct(
            id=cls.convert_extended_point_id(model.id),
            vectors=cls.convert_vector_struct(model.vector),
            payload=cls.convert_payload(model.payload) if model.payload is not None else None,
        )

    @classmethod
    def convert_payload(cls, model: rest.Payload) -> Dict[str, grpc.Value]:
        return dict((key, json_to_value(val)) for key, val in model.items())

    @classmethod
    def convert_hnsw_config_diff(cls, model: rest.HnswConfigDiff) -> grpc.HnswConfigDiff:
        return grpc.HnswConfigDiff(
            ef_construct=model.ef_construct,
            full_scan_threshold=model.full_scan_threshold,
            m=model.m,
            max_indexing_threads=model.max_indexing_threads,
            on_disk=model.on_disk,
            payload_m=model.payload_m,
        )

    @classmethod
    def convert_field_condition(cls, model: rest.FieldCondition) -> grpc.FieldCondition:
        if model.match:
            return grpc.FieldCondition(key=model.key, match=cls.convert_match(model.match))
        if model.range:
            if isinstance(model.range, rest.Range):
                return grpc.FieldCondition(key=model.key, range=cls.convert_range(model.range))
            if isinstance(model.range, rest.DatetimeRange):
                return grpc.FieldCondition(
                    key=model.key, datetime_range=cls.convert_datetime_range(model.range)
                )
        if model.geo_bounding_box:
            return grpc.FieldCondition(
                key=model.key,
                geo_bounding_box=cls.convert_geo_bounding_box(model.geo_bounding_box),
            )
        if model.geo_radius:
            return grpc.FieldCondition(
                key=model.key, geo_radius=cls.convert_geo_radius(model.geo_radius)
            )
        if model.values_count:
            return grpc.FieldCondition(
                key=model.key, values_count=cls.convert_values_count(model.values_count)
            )
        raise ValueError(f"invalid FieldCondition model: {model}")  # pragma: no cover

    @classmethod
    def convert_wal_config_diff(cls, model: rest.WalConfigDiff) -> grpc.WalConfigDiff:
        return grpc.WalConfigDiff(
            wal_capacity_mb=model.wal_capacity_mb,
            wal_segments_ahead=model.wal_segments_ahead,
        )

    @classmethod
    def convert_collection_config(cls, model: rest.CollectionConfig) -> grpc.CollectionConfig:
        return grpc.CollectionConfig(
            params=cls.convert_collection_params(model.params),
            hnsw_config=cls.convert_hnsw_config(model.hnsw_config),
            optimizer_config=cls.convert_optimizers_config(model.optimizer_config),
            wal_config=cls.convert_wal_config(model.wal_config),
            quantization_config=(
                cls.convert_quantization_config(model.quantization_config)
                if model.quantization_config is not None
                else None
            ),
        )

    @classmethod
    def convert_hnsw_config(cls, model: rest.HnswConfig) -> grpc.HnswConfigDiff:
        return grpc.HnswConfigDiff(
            ef_construct=model.ef_construct,
            full_scan_threshold=model.full_scan_threshold,
            m=model.m,
            max_indexing_threads=model.max_indexing_threads,
            on_disk=model.on_disk,
            payload_m=model.payload_m,
        )

    @classmethod
    def convert_wal_config(cls, model: rest.WalConfig) -> grpc.WalConfigDiff:
        return grpc.WalConfigDiff(
            wal_capacity_mb=model.wal_capacity_mb,
            wal_segments_ahead=model.wal_segments_ahead,
        )

    @classmethod
    def convert_distance(cls, model: rest.Distance) -> grpc.Distance:
        if model == rest.Distance.DOT:
            return grpc.Distance.Dot
        if model == rest.Distance.COSINE:
            return grpc.Distance.Cosine
        if model == rest.Distance.EUCLID:
            return grpc.Distance.Euclid
        if model == rest.Distance.MANHATTAN:
            return grpc.Distance.Manhattan

        raise ValueError(f"invalid Distance model: {model}")  # pragma: no cover

    @classmethod
    def convert_collection_params(cls, model: rest.CollectionParams) -> grpc.CollectionParams:
        return grpc.CollectionParams(
            vectors_config=(
                cls.convert_vectors_config(model.vectors) if model.vectors is not None else None
            ),
            shard_number=model.shard_number,
            on_disk_payload=model.on_disk_payload or False,
            write_consistency_factor=model.write_consistency_factor,
            replication_factor=model.replication_factor,
            read_fan_out_factor=model.read_fan_out_factor,
            sparse_vectors_config=(
                cls.convert_sparse_vector_config(model.sparse_vectors)
                if model.sparse_vectors is not None
                else None
            ),
            sharding_method=(
                cls.convert_sharding_method(model.sharding_method)
                if model.sharding_method is not None
                else None
            ),
        )

    @classmethod
    def convert_optimizers_config(cls, model: rest.OptimizersConfig) -> grpc.OptimizersConfigDiff:
        return grpc.OptimizersConfigDiff(
            default_segment_number=model.default_segment_number,
            deleted_threshold=model.deleted_threshold,
            flush_interval_sec=model.flush_interval_sec,
            indexing_threshold=model.indexing_threshold,
            max_optimization_threads=model.max_optimization_threads,
            max_segment_size=model.max_segment_size,
            memmap_threshold=model.memmap_threshold,
            vacuum_min_vector_number=model.vacuum_min_vector_number,
        )

    @classmethod
    def convert_optimizers_config_diff(
        cls, model: rest.OptimizersConfigDiff
    ) -> grpc.OptimizersConfigDiff:
        return grpc.OptimizersConfigDiff(
            default_segment_number=model.default_segment_number,
            deleted_threshold=model.deleted_threshold,
            flush_interval_sec=model.flush_interval_sec,
            indexing_threshold=model.indexing_threshold,
            max_optimization_threads=model.max_optimization_threads,
            max_segment_size=model.max_segment_size,
            memmap_threshold=model.memmap_threshold,
            vacuum_min_vector_number=model.vacuum_min_vector_number,
        )

    @classmethod
    def convert_update_collection(
        cls, model: rest.UpdateCollection, collection_name: str
    ) -> grpc.UpdateCollection:
        return grpc.UpdateCollection(
            collection_name=collection_name,
            optimizers_config=(
                cls.convert_optimizers_config_diff(model.optimizers_config)
                if model.optimizers_config is not None
                else None
            ),
            vectors_config=(
                cls.convert_vectors_config_diff(model.vectors)
                if model.vectors is not None
                else None
            ),
            params=(
                cls.convert_collection_params_diff(model.params)
                if model.params is not None
                else None
            ),
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.hnsw_config is not None
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config_diff(model.quantization_config)
                if model.quantization_config is not None
                else None
            ),
        )

    @classmethod
    def convert_geo_point(cls, model: rest.GeoPoint) -> grpc.GeoPoint:
        return grpc.GeoPoint(lon=model.lon, lat=model.lat)

    @classmethod
    def convert_match(cls, model: rest.Match) -> grpc.Match:
        if isinstance(model, rest.MatchValue):
            if isinstance(model.value, bool):
                return grpc.Match(boolean=model.value)
            if isinstance(model.value, int):
                return grpc.Match(integer=model.value)
            if isinstance(model.value, str):
                return grpc.Match(keyword=model.value)
        if isinstance(model, rest.MatchText):
            return grpc.Match(text=model.text)
        if isinstance(model, rest.MatchAny):
            if len(model.any) == 0:
                return grpc.Match(keywords=grpc.RepeatedStrings(strings=[]))
            if isinstance(model.any[0], str):
                return grpc.Match(keywords=grpc.RepeatedStrings(strings=model.any))
            if isinstance(model.any[0], int):
                return grpc.Match(integers=grpc.RepeatedIntegers(integers=model.any))
            raise ValueError(f"invalid MatchAny model: {model}")  # pragma: no cover
        if isinstance(model, rest.MatchExcept):
            if len(model.except_) == 0:
                return grpc.Match(except_keywords=grpc.RepeatedStrings(strings=[]))
            if isinstance(model.except_[0], str):
                return grpc.Match(except_keywords=grpc.RepeatedStrings(strings=model.except_))
            if isinstance(model.except_[0], int):
                return grpc.Match(except_integers=grpc.RepeatedIntegers(integers=model.except_))
            raise ValueError(f"invalid MatchExcept model: {model}")  # pragma: no cover

        raise ValueError(f"invalid Match model: {model}")  # pragma: no cover

    @classmethod
    def convert_alias_operations(cls, model: rest.AliasOperations) -> grpc.AliasOperations:
        if isinstance(model, rest.CreateAliasOperation):
            return grpc.AliasOperations(create_alias=cls.convert_create_alias(model.create_alias))
        if isinstance(model, rest.DeleteAliasOperation):
            return grpc.AliasOperations(delete_alias=cls.convert_delete_alias(model.delete_alias))
        if isinstance(model, rest.RenameAliasOperation):
            return grpc.AliasOperations(rename_alias=cls.convert_rename_alias(model.rename_alias))

        raise ValueError(f"invalid AliasOperations model: {model}")  # pragma: no cover

    @classmethod
    def convert_alias_description(cls, model: rest.AliasDescription) -> grpc.AliasDescription:
        return grpc.AliasDescription(
            alias_name=model.alias_name,
            collection_name=model.collection_name,
        )

    @classmethod
    def convert_recommend_examples_to_ids(
        cls, examples: Sequence[rest.RecommendExample]
    ) -> List[grpc.PointId]:
        ids: List[grpc.PointId] = []
        for example in examples:
            if isinstance(example, get_args_subscribed(rest.ExtendedPointId)):
                id_ = cls.convert_extended_point_id(example)
            elif isinstance(example, grpc.PointId):
                id_ = example
            else:
                continue

            ids.append(id_)

        return ids

    @classmethod
    def convert_recommend_examples_to_vectors(
        cls, examples: Sequence[rest.RecommendExample]
    ) -> List[grpc.Vector]:
        vectors: List[grpc.Vector] = []
        for example in examples:
            if isinstance(example, grpc.Vector):
                vector = example
            elif isinstance(example, list):
                vector = grpc.Vector(data=example)
            elif isinstance(example, rest.SparseVector):
                vector = cls.convert_sparse_vector_to_vector(example)
            else:
                continue

            vectors.append(vector)

        return vectors

    @classmethod
    def convert_vector_example(cls, model: rest.RecommendExample) -> grpc.VectorExample:
        return cls.convert_recommend_example(model)

    @classmethod
    def convert_recommend_example(cls, model: rest.RecommendExample) -> grpc.VectorExample:
        if isinstance(model, get_args_subscribed(rest.ExtendedPointId)):
            return grpc.VectorExample(id=cls.convert_extended_point_id(model))
        if isinstance(model, rest.SparseVector):
            return grpc.VectorExample(vector=cls.convert_sparse_vector_to_vector(model))
        if isinstance(model, list):
            return grpc.VectorExample(vector=grpc.Vector(data=model))

        raise ValueError(f"Invalid RecommendExample model: {model}")  # pragma: no cover

    @classmethod
    def convert_sparse_vector_to_vector(cls, model: rest.SparseVector) -> grpc.Vector:
        return grpc.Vector(
            data=model.values,
            indices=grpc.SparseIndices(data=model.indices),
        )

    @classmethod
    def convert_target_vector(cls, model: rest.RecommendExample) -> grpc.TargetVector:
        return grpc.TargetVector(single=cls.convert_recommend_example(model))

    @classmethod
    def convert_context_example_pair(
        cls,
        model: rest.ContextExamplePair,
    ) -> grpc.ContextExamplePair:
        return grpc.ContextExamplePair(
            positive=cls.convert_recommend_example(model.positive),
            negative=cls.convert_recommend_example(model.negative),
        )

    @classmethod
    def convert_extended_point_id(cls, model: rest.ExtendedPointId) -> grpc.PointId:
        if isinstance(model, int):
            return grpc.PointId(num=model)
        if isinstance(model, str):
            return grpc.PointId(uuid=model)
        raise ValueError(f"invalid ExtendedPointId model: {model}")  # pragma: no cover

    @classmethod
    def convert_points_selector(cls, model: rest.PointsSelector) -> grpc.PointsSelector:
        if isinstance(model, rest.PointIdsList):
            return grpc.PointsSelector(
                points=grpc.PointsIdsList(
                    ids=[cls.convert_extended_point_id(point) for point in model.points]
                )
            )
        if isinstance(model, rest.FilterSelector):
            return grpc.PointsSelector(filter=cls.convert_filter(model.filter))
        raise ValueError(f"invalid PointsSelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_condition(cls, model: rest.Condition) -> grpc.Condition:
        if isinstance(model, rest.FieldCondition):
            return grpc.Condition(field=cls.convert_field_condition(model))
        if isinstance(model, rest.IsEmptyCondition):
            return grpc.Condition(is_empty=cls.convert_is_empty_condition(model))
        if isinstance(model, rest.IsNullCondition):
            return grpc.Condition(is_null=cls.convert_is_null_condition(model))
        if isinstance(model, rest.HasIdCondition):
            return grpc.Condition(has_id=cls.convert_has_id_condition(model))
        if isinstance(model, rest.Filter):
            return grpc.Condition(filter=cls.convert_filter(model))
        if isinstance(model, rest.NestedCondition):
            return grpc.Condition(nested=cls.convert_nested_condition(model))

        raise ValueError(f"invalid Condition model: {model}")  # pragma: no cover

    @classmethod
    def convert_payload_selector(cls, model: rest.PayloadSelector) -> grpc.WithPayloadSelector:
        if isinstance(model, rest.PayloadSelectorInclude):
            return grpc.WithPayloadSelector(
                include=grpc.PayloadIncludeSelector(fields=model.include)
            )
        if isinstance(model, rest.PayloadSelectorExclude):
            return grpc.WithPayloadSelector(
                exclude=grpc.PayloadExcludeSelector(fields=model.exclude)
            )
        raise ValueError(f"invalid PayloadSelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_with_payload_selector(
        cls, model: rest.PayloadSelector
    ) -> grpc.WithPayloadSelector:
        return cls.convert_with_payload_interface(model)

    @classmethod
    def convert_with_payload_interface(
        cls, model: rest.WithPayloadInterface
    ) -> grpc.WithPayloadSelector:
        if isinstance(model, bool):
            return grpc.WithPayloadSelector(enable=model)
        elif isinstance(model, list):
            return grpc.WithPayloadSelector(include=grpc.PayloadIncludeSelector(fields=model))
        elif isinstance(model, get_args(rest.PayloadSelector)):
            return cls.convert_payload_selector(model)

        raise ValueError(f"invalid WithPayloadInterface model: {model}")  # pragma: no cover

    @classmethod
    def convert_start_from(cls, model: rest.StartFrom) -> grpc.StartFrom:
        if isinstance(model, int):
            return grpc.StartFrom(integer=model)
        if isinstance(model, float):
            return grpc.StartFrom(float=model)
        if isinstance(model, datetime):
            ts = cls.convert_datetime(model)
            return grpc.StartFrom(timestamp=ts)
        if isinstance(model, str):
            # Pydantic also accepts strings as datetime if they are correctly formatted
            return grpc.StartFrom(datetime=model)

        raise ValueError(f"invalid StartFrom model: {model}")  # pragma: no cover

    @classmethod
    def convert_direction(cls, model: rest.Direction) -> grpc.Direction:
        if model == rest.Direction.ASC:
            return grpc.Direction.Asc
        if model == rest.Direction.DESC:
            return grpc.Direction.Desc
        raise ValueError(f"invalid Direction model: {model}")

    @classmethod
    def convert_order_by(cls, model: rest.OrderBy) -> grpc.OrderBy:
        return grpc.OrderBy(
            key=model.key,
            direction=(
                cls.convert_direction(model.direction) if model.direction is not None else None
            ),
            start_from=(
                cls.convert_start_from(model.start_from) if model.start_from is not None else None
            ),
        )

    @classmethod
    def convert_order_by_interface(
        cls, model: rest.OrderByInterface
    ) -> grpc.OrderBy:  # pragma: no cover
        # using no cover because there is no OrderByInterface in grpc
        if isinstance(model, str):
            return grpc.OrderBy(key=model)
        if isinstance(model, rest.OrderBy):
            return cls.convert_order_by(model)
        raise ValueError(f"invalid OrderByInterface model: {model}")

    @classmethod
    def convert_facet_value(cls, model: rest.FacetValue) -> grpc.FacetValue:
        if isinstance(model, str):
            return grpc.FacetValue(string_value=model)
        if isinstance(model, int):
            return grpc.FacetValue(integer_value=model)

        raise ValueError(f"invalid FacetValue model: {model}")

    @classmethod
    def convert_facet_value_hit(cls, model: rest.FacetValueHit) -> grpc.FacetHit:
        return grpc.FacetHit(
            value=cls.convert_facet_value(model.value),
            count=model.count,
        )

    @classmethod
    def convert_record(cls, model: rest.Record) -> grpc.RetrievedPoint:
        return grpc.RetrievedPoint(
            id=cls.convert_extended_point_id(model.id),
            payload=cls.convert_payload(model.payload),
            vectors=cls.convert_vector_struct(model.vector) if model.vector is not None else None,
            shard_key=cls.convert_shard_key(model.shard_key) if model.shard_key else None,
            order_value=cls.convert_order_value(model.order_value) if model.order_value else None,
        )

    @classmethod
    def convert_retrieved_point(cls, model: rest.Record) -> grpc.RetrievedPoint:
        return cls.convert_record(model)

    @classmethod
    def convert_count_result(cls, model: rest.CountResult) -> grpc.CountResult:
        return grpc.CountResult(count=model.count)

    @classmethod
    def convert_snapshot_description(
        cls, model: rest.SnapshotDescription
    ) -> grpc.SnapshotDescription:
        timestamp = Timestamp()
        timestamp.FromDatetime(datetime.fromisoformat(model.creation_time))
        return grpc.SnapshotDescription(
            name=model.name,
            creation_time=timestamp,
            size=model.size,
        )

    @classmethod
    def convert_datatype(cls, model: rest.Datatype) -> grpc.Datatype:
        if model == rest.Datatype.FLOAT32:
            return grpc.Datatype.Float32
        if model == rest.Datatype.UINT8:
            return grpc.Datatype.Uint8
        if model == rest.Datatype.FLOAT16:
            return grpc.Datatype.Float16

        raise ValueError(f"invalid Datatype model: {model}")  # pragma: no cover

    @classmethod
    def convert_vector_params(cls, model: rest.VectorParams) -> grpc.VectorParams:
        return grpc.VectorParams(
            size=model.size,
            distance=cls.convert_distance(model.distance),
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.hnsw_config is not None
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config(model.quantization_config)
                if model.quantization_config is not None
                else None
            ),
            on_disk=model.on_disk,
            datatype=cls.convert_datatype(model.datatype) if model.datatype is not None else None,
            multivector_config=(
                cls.convert_multivector_config(model.multivector_config)
                if model.multivector_config is not None
                else None
            ),
        )

    @classmethod
    def convert_multivector_config(cls, model: rest.MultiVectorConfig) -> grpc.MultiVectorConfig:
        return grpc.MultiVectorConfig(
            comparator=cls.convert_multivector_comparator(model.comparator)
        )

    @classmethod
    def convert_multivector_comparator(
        cls, model: rest.MultiVectorComparator
    ) -> grpc.MultiVectorComparator:
        if model == rest.MultiVectorComparator.MAX_SIM:
            return grpc.MultiVectorComparator.MaxSim

        raise ValueError(f"invalid MultiVectorComparator model: {model}")  # pragma: no cover

    @classmethod
    def convert_vectors_config(cls, model: rest.VectorsConfig) -> grpc.VectorsConfig:
        if isinstance(model, rest.VectorParams):
            return grpc.VectorsConfig(params=cls.convert_vector_params(model))
        elif isinstance(model, dict):
            return grpc.VectorsConfig(
                params_map=grpc.VectorParamsMap(
                    map=dict((key, cls.convert_vector_params(val)) for key, val in model.items())
                )
            )
        else:
            raise ValueError(f"invalid VectorsConfig model: {model}")  # pragma: no cover

    @classmethod
    def convert_vector_struct(cls, model: rest.VectorStruct) -> grpc.Vectors:
        def convert_vector(vector: Union[List[float], List[List[float]]]) -> grpc.Vector:
            if len(vector) != 0 and isinstance(
                vector[0], list
            ):  # we can't say whether it is an empty dense or multi-dense vector
                return grpc.Vector(
                    data=[
                        inner_vector
                        for multi_vector in vector
                        for inner_vector in multi_vector  # type: ignore
                    ],
                    vectors_count=len(vector),
                )
            return grpc.Vector(data=vector)

        if isinstance(model, list):
            return grpc.Vectors(vector=convert_vector(model))
        elif isinstance(model, dict):
            vectors: Dict = {}
            for key, val in model.items():
                if isinstance(val, list):
                    vectors.update({key: convert_vector(val)})
                elif isinstance(val, rest.SparseVector):
                    vectors.update({key: cls.convert_sparse_vector_to_vector(val)})
            return grpc.Vectors(vectors=grpc.NamedVectors(vectors=vectors))
        else:
            raise ValueError(f"invalid VectorStruct model: {model}")  # pragma: no cover

    @classmethod
    def convert_with_vectors(cls, model: rest.WithVector) -> grpc.WithVectorsSelector:
        if isinstance(model, bool):
            return grpc.WithVectorsSelector(enable=model)
        elif isinstance(model, list):
            return grpc.WithVectorsSelector(include=grpc.VectorsSelector(names=model))
        else:
            raise ValueError(f"invalid WithVectors model: {model}")  # pragma: no cover

    @classmethod
    def convert_batch_vector_struct(
        cls, model: rest.BatchVectorStruct, num_records: int
    ) -> List[grpc.Vectors]:
        if isinstance(model, list):
            return [cls.convert_vector_struct(item) for item in model]
        elif isinstance(model, dict):
            result: List[Dict] = [{} for _ in range(num_records)]
            for key, val in model.items():
                for i, item in enumerate(val):
                    result[i][key] = item
            return [cls.convert_vector_struct(item) for item in result]
        else:
            raise ValueError(f"invalid BatchVectorStruct model: {model}")  # pragma: no cover

    @classmethod
    def convert_named_vector_struct(
        cls, model: rest.NamedVectorStruct
    ) -> Tuple[List[float], Optional[grpc.SparseIndices], Optional[str]]:
        if isinstance(model, list):
            return model, None, None
        elif isinstance(model, rest.NamedVector):
            return model.vector, None, model.name
        elif isinstance(model, rest.NamedSparseVector):
            return model.vector.values, grpc.SparseIndices(data=model.vector.indices), model.name
        else:
            raise ValueError(f"invalid NamedVectorStruct model: {model}")  # pragma: no cover

    @classmethod
    def convert_dense_vector(cls, model: List[float]) -> grpc.DenseVector:
        return grpc.DenseVector(data=model)

    @classmethod
    def convert_sparse_vector(cls, model: rest.SparseVector) -> grpc.SparseVector:
        return grpc.SparseVector(values=model.values, indices=model.indices)

    @classmethod
    def convert_multi_dense_vector(cls, model: List[List[float]]) -> grpc.MultiDenseVector:
        return grpc.MultiDenseVector(
            vectors=[cls.convert_dense_vector(vector) for vector in model]
        )

    @classmethod
    def convert_vector_input(cls, model: rest.VectorInput) -> grpc.VectorInput:
        if isinstance(model, list):
            if len(model) != 0 and isinstance(
                model[0], list
            ):  # we can't say whether it is an empty dense or multi-dense vector
                return grpc.VectorInput(multi_dense=cls.convert_multi_dense_vector(model))
            return grpc.VectorInput(dense=cls.convert_dense_vector(model))
        if isinstance(model, rest.SparseVector):
            return grpc.VectorInput(sparse=cls.convert_sparse_vector(model))
        if isinstance(model, get_args_subscribed(rest.ExtendedPointId)):
            return grpc.VectorInput(id=cls.convert_extended_point_id(model))

        raise ValueError(f"invalid VectorInput model: {model}")  # pragma: no cover

    @classmethod
    def convert_recommend_input(cls, model: rest.RecommendInput) -> grpc.RecommendInput:
        return grpc.RecommendInput(
            positive=[cls.convert_vector_input(vector) for vector in model.positive]
            if model.positive is not None
            else None,
            negative=[cls.convert_vector_input(vector) for vector in model.negative]
            if model.negative is not None
            else None,
            strategy=cls.convert_recommend_strategy(model.strategy)
            if model.strategy is not None
            else None,
        )

    @classmethod
    def convert_context_input_pair(cls, model: rest.ContextPair) -> grpc.ContextInputPair:
        return grpc.ContextInputPair(
            positive=cls.convert_vector_input(model.positive),
            negative=cls.convert_vector_input(model.negative),
        )

    @classmethod
    def convert_context_input(cls, model: rest.ContextInput) -> grpc.ContextInput:
        if isinstance(model, list):
            return grpc.ContextInput(
                pairs=[cls.convert_context_input_pair(pair) for pair in model]
            )
        if isinstance(model, rest.ContextPair):
            return grpc.ContextInput(pairs=[cls.convert_context_input_pair(model)])

        raise ValueError(f"invalid ContextInput model: {model}")  # pragma: no cover

    @classmethod
    def convert_discover_input(cls, model: rest.DiscoverInput) -> grpc.DiscoverInput:
        return grpc.DiscoverInput(
            target=cls.convert_vector_input(model.target),
            context=cls.convert_context_input(model.context),
        )

    @classmethod
    def convert_fusion(cls, model: rest.Fusion) -> grpc.Fusion:
        if model == rest.Fusion.RRF:
            return grpc.Fusion.RRF

        if model == rest.Fusion.DBSF:
            return grpc.Fusion.DBSF

        raise ValueError(f"invalid Fusion model: {model}")

    @classmethod
    def convert_sample(cls, model: rest.Sample) -> grpc.Sample:
        if model == rest.Sample.RANDOM:
            return grpc.Sample.Random

        raise ValueError(f"invalid Sample model: {model}")

    @classmethod
    def convert_query(cls, model: rest.Query) -> grpc.Query:
        if isinstance(model, rest.NearestQuery):
            return grpc.Query(nearest=cls.convert_vector_input(model.nearest))

        if isinstance(model, rest.RecommendQuery):
            return grpc.Query(recommend=cls.convert_recommend_input(model.recommend))

        if isinstance(model, rest.DiscoverQuery):
            return grpc.Query(discover=cls.convert_discover_input(model.discover))

        if isinstance(model, rest.ContextQuery):
            return grpc.Query(context=cls.convert_context_input(model.context))

        if isinstance(model, rest.OrderByQuery):
            return grpc.Query(order_by=cls.convert_order_by_interface(model.order_by))

        if isinstance(model, rest.FusionQuery):
            return grpc.Query(fusion=cls.convert_fusion(model.fusion))

        if isinstance(model, rest.SampleQuery):
            return grpc.Query(sample=cls.convert_sample(model.sample))

        raise ValueError(f"invalid Query model: {model}")  # pragma: no cover

    @classmethod
    def convert_query_interface(cls, model: rest.QueryInterface) -> grpc.Query:
        if isinstance(model, get_args_subscribed(rest.VectorInput)):
            return grpc.Query(nearest=cls.convert_vector_input(model))

        if isinstance(model, get_args(rest.Query)):
            return cls.convert_query(model)

        raise ValueError(f"invalid QueryInterface: {model}")  # pragma: no cover

    @classmethod
    def convert_prefetch_query(cls, model: rest.Prefetch) -> grpc.PrefetchQuery:
        prefetch = None
        if isinstance(model.prefetch, rest.Prefetch):
            prefetch = [cls.convert_prefetch_query(model.prefetch)]
        elif isinstance(model.prefetch, List):
            prefetch = [cls.convert_prefetch_query(prefetch) for prefetch in model.prefetch]

        return grpc.PrefetchQuery(
            prefetch=prefetch,
            query=cls.convert_query_interface(model.query) if model.query is not None else None,
            using=model.using if model.using is not None else None,
            filter=cls.convert_filter(model.filter) if model.filter is not None else None,
            params=cls.convert_search_params(model.params) if model.params is not None else None,
            score_threshold=model.score_threshold,
            limit=model.limit if model.limit is not None else None,
            lookup_from=cls.convert_lookup_location(model.lookup_from)
            if model.lookup_from is not None
            else None,
        )

    @classmethod
    def convert_search_request(
        cls, model: rest.SearchRequest, collection_name: str
    ) -> grpc.SearchPoints:
        vector, sparse_indices, name = cls.convert_named_vector_struct(model.vector)

        return grpc.SearchPoints(
            collection_name=collection_name,
            vector=vector,
            sparse_indices=sparse_indices,
            filter=cls.convert_filter(model.filter) if model.filter is not None else None,
            limit=model.limit,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.with_payload is not None
                else None
            ),
            params=cls.convert_search_params(model.params) if model.params is not None else None,
            score_threshold=model.score_threshold,
            offset=model.offset,
            vector_name=name,
            with_vectors=(
                cls.convert_with_vectors(model.with_vector)
                if model.with_vector is not None
                else None
            ),
            shard_key_selector=(
                cls.convert_shard_key_selector(model.shard_key) if model.shard_key else None
            ),
        )

    @classmethod
    def convert_search_points(
        cls, model: rest.SearchRequest, collection_name: str
    ) -> grpc.SearchPoints:
        return cls.convert_search_request(model, collection_name)

    @classmethod
    def convert_query_request(
        cls, model: rest.QueryRequest, collection_name: str
    ) -> grpc.QueryPoints:
        prefetch = (
            [model.prefetch] if isinstance(model.prefetch, rest.Prefetch) else model.prefetch
        )
        return grpc.QueryPoints(
            collection_name=collection_name,
            prefetch=[cls.convert_prefetch_query(p) for p in prefetch]
            if model.prefetch is not None
            else None,
            query=cls.convert_query_interface(model.query) if model.query is not None else None,
            using=model.using,
            filter=cls.convert_filter(model.filter) if model.filter is not None else None,
            params=cls.convert_search_params(model.params) if model.params is not None else None,
            score_threshold=model.score_threshold,
            limit=model.limit,
            offset=model.offset,
            with_vectors=cls.convert_with_vectors(model.with_vector)
            if model.with_vector is not None
            else None,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.with_payload is not None
                else None
            ),
            shard_key_selector=(
                cls.convert_shard_key_selector(model.shard_key)
                if model.shard_key is not None
                else None
            ),
            lookup_from=cls.convert_lookup_location(model.lookup_from)
            if model.lookup_from is not None
            else None,
        )

    @classmethod
    def convert_query_points(
        cls, model: rest.QueryRequest, collection_name: str
    ) -> grpc.QueryPoints:
        return cls.convert_query_request(model, collection_name)

    @classmethod
    def convert_recommend_request(
        cls, model: rest.RecommendRequest, collection_name: str
    ) -> grpc.RecommendPoints:
        positive_ids = cls.convert_recommend_examples_to_ids(model.positive)
        negative_ids = cls.convert_recommend_examples_to_ids(model.negative)

        positive_vectors = cls.convert_recommend_examples_to_vectors(model.positive)
        negative_vectors = cls.convert_recommend_examples_to_vectors(model.negative)

        return grpc.RecommendPoints(
            collection_name=collection_name,
            positive=positive_ids,
            negative=negative_ids,
            filter=cls.convert_filter(model.filter) if model.filter is not None else None,
            limit=model.limit,
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.with_payload is not None
                else None
            ),
            params=cls.convert_search_params(model.params) if model.params is not None else None,
            score_threshold=model.score_threshold,
            offset=model.offset,
            with_vectors=(
                cls.convert_with_vectors(model.with_vector)
                if model.with_vector is not None
                else None
            ),
            using=model.using,
            lookup_from=(
                cls.convert_lookup_location(model.lookup_from)
                if model.lookup_from is not None
                else None
            ),
            strategy=(
                cls.convert_recommend_strategy(model.strategy)
                if model.strategy is not None
                else None
            ),
            positive_vectors=positive_vectors,
            negative_vectors=negative_vectors,
            shard_key_selector=(
                cls.convert_shard_key_selector(model.shard_key) if model.shard_key else None
            ),
        )

    @classmethod
    def convert_discover_points(
        cls, model: rest.DiscoverRequest, collection_name: str
    ) -> grpc.DiscoverPoints:
        return cls.convert_discover_request(model, collection_name)

    @classmethod
    def convert_discover_request(
        cls, model: rest.DiscoverRequest, collection_name: str
    ) -> grpc.DiscoverPoints:
        target = cls.convert_target_vector(model.target) if model.target is not None else None

        context = (
            [cls.convert_context_example_pair(pair) for pair in model.context]
            if model.context is not None
            else None
        )

        query_filter = None if model.filter is None else cls.convert_filter(model=model.filter)

        search_params = None if model.params is None else cls.convert_search_params(model.params)

        with_payload = (
            None
            if model.with_payload is None
            else cls.convert_with_payload_interface(model.with_payload)
        )

        with_vectors = (
            None if model.with_vector is None else cls.convert_with_vectors(model.with_vector)
        )

        lookup_from = (
            None if model.lookup_from is None else cls.convert_lookup_location(model.lookup_from)
        )

        shard_key_selector = (
            None if model.shard_key is None else cls.convert_shard_key_selector(model.shard_key)
        )

        return grpc.DiscoverPoints(
            collection_name=collection_name,
            target=target,
            context=context,
            filter=query_filter,
            limit=model.limit,
            offset=model.offset,
            with_vectors=with_vectors,
            with_payload=with_payload,
            params=search_params,
            using=model.using,
            lookup_from=lookup_from,
            shard_key_selector=shard_key_selector,
        )

    @classmethod
    def convert_recommend_points(
        cls, model: rest.RecommendRequest, collection_name: str
    ) -> grpc.RecommendPoints:
        return cls.convert_recommend_request(model, collection_name)

    @classmethod
    def convert_tokenizer_type(cls, model: rest.TokenizerType) -> grpc.TokenizerType:
        if model == rest.TokenizerType.WORD:
            return grpc.TokenizerType.Word
        elif model == rest.TokenizerType.WHITESPACE:
            return grpc.TokenizerType.Whitespace
        elif model == rest.TokenizerType.PREFIX:
            return grpc.TokenizerType.Prefix
        elif model == rest.TokenizerType.MULTILINGUAL:
            return grpc.TokenizerType.Multilingual
        else:
            raise ValueError(f"invalid TokenizerType model: {model}")  # pragma: no cover

    @classmethod
    def convert_text_index_params(cls, model: rest.TextIndexParams) -> grpc.TextIndexParams:
        return grpc.TextIndexParams(
            tokenizer=(
                cls.convert_tokenizer_type(model.tokenizer)
                if model.tokenizer is not None
                else None
            ),
            lowercase=model.lowercase,
            min_token_len=model.min_token_len,
            max_token_len=model.max_token_len,
        )

    @classmethod
    def convert_integer_index_params(
        cls, model: rest.IntegerIndexParams
    ) -> grpc.IntegerIndexParams:
        return grpc.IntegerIndexParams(
            lookup=model.lookup,
            range=model.range,
            is_principal=model.is_principal,
            on_disk=model.on_disk,
        )

    @classmethod
    def convert_keyword_index_params(
        cls, model: rest.KeywordIndexParams
    ) -> grpc.KeywordIndexParams:
        return grpc.KeywordIndexParams(is_tenant=model.is_tenant, on_disk=model.on_disk)

    @classmethod
    def convert_float_index_params(cls, model: rest.FloatIndexParams) -> grpc.FloatIndexParams:
        return grpc.FloatIndexParams(is_principal=model.is_principal, on_disk=model.on_disk)

    @classmethod
    def convert_geo_index_params(cls, model: rest.GeoIndexParams) -> grpc.GeoIndexParams:
        return grpc.GeoIndexParams(on_disk=model.on_disk)

    @classmethod
    def convert_bool_index_params(cls, _: rest.BoolIndexParams) -> grpc.BoolIndexParams:
        return grpc.BoolIndexParams()

    @classmethod
    def convert_datetime_index_params(
        cls, model: rest.DatetimeIndexParams
    ) -> grpc.DatetimeIndexParams:
        return grpc.DatetimeIndexParams(is_principal=model.is_principal, on_disk=model.on_disk)

    @classmethod
    def convert_uuid_index_params(cls, model: rest.UuidIndexParams) -> grpc.UuidIndexParams:
        return grpc.UuidIndexParams(is_tenant=model.is_tenant, on_disk=model.on_disk)

    @classmethod
    def convert_collection_params_diff(
        cls, model: rest.CollectionParamsDiff
    ) -> grpc.CollectionParamsDiff:
        return grpc.CollectionParamsDiff(
            replication_factor=model.replication_factor,
            write_consistency_factor=model.write_consistency_factor,
            on_disk_payload=model.on_disk_payload,
            read_fan_out_factor=model.read_fan_out_factor,
        )

    @classmethod
    def convert_lookup_location(cls, model: rest.LookupLocation) -> grpc.LookupLocation:
        return grpc.LookupLocation(
            collection_name=model.collection,
            vector_name=model.vector,
        )

    @classmethod
    def convert_read_consistency(cls, model: rest.ReadConsistency) -> grpc.ReadConsistency:
        if isinstance(model, int):
            return grpc.ReadConsistency(
                factor=model,
            )
        elif isinstance(model, rest.ReadConsistencyType):
            return grpc.ReadConsistency(
                type=cls.convert_read_consistency_type(model),
            )
        else:
            raise ValueError(f"invalid ReadConsistency model: {model}")  # pragma: no cover

    @classmethod
    def convert_read_consistency_type(
        cls, model: rest.ReadConsistencyType
    ) -> grpc.ReadConsistencyType:
        if model == rest.ReadConsistencyType.MAJORITY:
            return grpc.ReadConsistencyType.Majority
        elif model == rest.ReadConsistencyType.ALL:
            return grpc.ReadConsistencyType.All
        elif model == rest.ReadConsistencyType.QUORUM:
            return grpc.ReadConsistencyType.Quorum
        else:
            raise ValueError(f"invalid ReadConsistencyType model: {model}")  # pragma: no cover

    @classmethod
    def convert_write_ordering(cls, model: rest.WriteOrdering) -> grpc.WriteOrdering:
        if model == rest.WriteOrdering.WEAK:
            return grpc.WriteOrdering(type=grpc.WriteOrderingType.Weak)
        elif model == rest.WriteOrdering.MEDIUM:
            return grpc.WriteOrdering(type=grpc.WriteOrderingType.Medium)
        elif model == rest.WriteOrdering.STRONG:
            return grpc.WriteOrdering(type=grpc.WriteOrderingType.Strong)
        else:
            raise ValueError(f"invalid WriteOrdering model: {model}")  # pragma: no cover

    @classmethod
    def convert_scalar_quantization_config(
        cls, model: rest.ScalarQuantizationConfig
    ) -> grpc.ScalarQuantization:
        return grpc.ScalarQuantization(
            type=grpc.QuantizationType.Int8,
            quantile=model.quantile,
            always_ram=model.always_ram,
        )

    @classmethod
    def convert_product_quantization_config(
        cls, model: rest.ProductQuantizationConfig
    ) -> grpc.ProductQuantization:
        return grpc.ProductQuantization(
            compression=cls.convert_compression_ratio(model.compression),
            always_ram=model.always_ram,
        )

    @classmethod
    def convert_binary_quantization_config(
        cls, model: rest.BinaryQuantizationConfig
    ) -> grpc.BinaryQuantization:
        return grpc.BinaryQuantization(
            always_ram=model.always_ram,
        )

    @classmethod
    def convert_compression_ratio(cls, model: rest.CompressionRatio) -> grpc.CompressionRatio:
        if model == rest.CompressionRatio.X4:
            return grpc.CompressionRatio.x4
        elif model == rest.CompressionRatio.X8:
            return grpc.CompressionRatio.x8
        elif model == rest.CompressionRatio.X16:
            return grpc.CompressionRatio.x16
        elif model == rest.CompressionRatio.X32:
            return grpc.CompressionRatio.x32
        elif model == rest.CompressionRatio.X64:
            return grpc.CompressionRatio.x64
        else:
            raise ValueError(f"invalid CompressionRatio model: {model}")  # pragma: no cover

    @classmethod
    def convert_quantization_config(
        cls, model: rest.QuantizationConfig
    ) -> grpc.QuantizationConfig:
        if isinstance(model, rest.ScalarQuantization):
            return grpc.QuantizationConfig(
                scalar=cls.convert_scalar_quantization_config(model.scalar)
            )
        if isinstance(model, rest.ProductQuantization):
            return grpc.QuantizationConfig(
                product=cls.convert_product_quantization_config(model.product)
            )
        if isinstance(model, rest.BinaryQuantization):
            return grpc.QuantizationConfig(
                binary=cls.convert_binary_quantization_config(model.binary)
            )
        else:
            raise ValueError(f"invalid QuantizationConfig model: {model}")  # pragma: no cover

    @classmethod
    def convert_quantization_search_params(
        cls, model: rest.QuantizationSearchParams
    ) -> grpc.QuantizationSearchParams:
        return grpc.QuantizationSearchParams(
            ignore=model.ignore,
            rescore=model.rescore,
            oversampling=model.oversampling,
        )

    @classmethod
    def convert_point_vectors(cls, model: rest.PointVectors) -> grpc.PointVectors:
        return grpc.PointVectors(
            id=cls.convert_extended_point_id(model.id),
            vectors=cls.convert_vector_struct(model.vector),
        )

    @classmethod
    def convert_groups_result(cls, model: rest.GroupsResult) -> grpc.GroupsResult:
        return grpc.GroupsResult(
            groups=[cls.convert_point_group(group) for group in model.groups],
        )

    @classmethod
    def convert_point_group(cls, model: rest.PointGroup) -> grpc.PointGroup:
        return grpc.PointGroup(
            id=cls.convert_group_id(model.id),
            hits=[cls.convert_scored_point(point) for point in model.hits],
            lookup=cls.convert_record(model.lookup) if model.lookup is not None else None,
        )

    @classmethod
    def convert_group_id(cls, model: rest.GroupId) -> grpc.GroupId:
        if isinstance(model, str):
            return grpc.GroupId(
                string_value=model,
            )
        elif isinstance(model, int):
            if model >= 0:
                return grpc.GroupId(
                    unsigned_value=model,
                )
            else:
                return grpc.GroupId(
                    integer_value=model,
                )
        else:
            raise ValueError(f"invalid GroupId model: {model}")  # pragma: no cover

    @classmethod
    def convert_with_lookup(cls, model: rest.WithLookup) -> grpc.WithLookup:
        return grpc.WithLookup(
            collection=model.collection,
            with_vectors=(
                cls.convert_with_vectors(model.with_vectors)
                if model.with_vectors is not None
                else None
            ),
            with_payload=(
                cls.convert_with_payload_interface(model.with_payload)
                if model.with_payload is not None
                else None
            ),
        )

    @classmethod
    def convert_quantization_config_diff(
        cls, model: rest.QuantizationConfigDiff
    ) -> grpc.QuantizationConfigDiff:
        if isinstance(model, rest.ScalarQuantization):
            return grpc.QuantizationConfigDiff(
                scalar=cls.convert_scalar_quantization_config(model.scalar)
            )
        if isinstance(model, rest.ProductQuantization):
            return grpc.QuantizationConfigDiff(
                product=cls.convert_product_quantization_config(model.product)
            )
        if isinstance(model, rest.BinaryQuantization):
            return grpc.QuantizationConfigDiff(
                binary=cls.convert_binary_quantization_config(model.binary)
            )
        if model == rest.Disabled.DISABLED:
            return grpc.QuantizationConfigDiff(
                disabled=grpc.Disabled(),
            )
        else:
            raise ValueError(f"invalid QuantizationConfigDiff model: {model}")  # pragma: no cover

    @classmethod
    def convert_vector_params_diff(cls, model: rest.VectorParamsDiff) -> grpc.VectorParamsDiff:
        return grpc.VectorParamsDiff(
            hnsw_config=(
                cls.convert_hnsw_config_diff(model.hnsw_config)
                if model.hnsw_config is not None
                else None
            ),
            quantization_config=(
                cls.convert_quantization_config_diff(model.quantization_config)
                if model.quantization_config is not None
                else None
            ),
            on_disk=model.on_disk,
        )

    @classmethod
    def convert_vectors_config_diff(cls, model: rest.VectorsConfigDiff) -> grpc.VectorsConfigDiff:
        if isinstance(model, dict) and len(model) == 1 and "" in model:
            return grpc.VectorsConfigDiff(params=cls.convert_vector_params_diff(model[""]))
        elif isinstance(model, dict):
            return grpc.VectorsConfigDiff(
                params_map=grpc.VectorParamsDiffMap(
                    map=dict(
                        (key, cls.convert_vector_params_diff(val)) for key, val in model.items()
                    )
                )
            )
        else:
            raise ValueError(f"invalid VectorsConfigDiff model: {model}")  # pragma: no cover

    @classmethod
    def convert_point_insert_operation(
        cls, model: rest.PointInsertOperations
    ) -> List[grpc.PointStruct]:
        if isinstance(model, rest.PointsBatch):
            vectors_batch: List[grpc.Vectors] = cls.convert_batch_vector_struct(
                model.batch.vectors, len(model.batch.ids)
            )
            return [
                grpc.PointStruct(
                    id=RestToGrpc.convert_extended_point_id(model.batch.ids[idx]),
                    vectors=vectors_batch[idx],
                    payload=(
                        RestToGrpc.convert_payload(model.batch.payloads[idx])
                        if model.batch.payloads is not None
                        else None
                    ),
                )
                for idx in range(len(model.batch.ids))
            ]
        elif isinstance(model, rest.PointsList):
            return [cls.convert_point_struct(point) for point in model.points]
        else:
            raise ValueError(f"invalid PointInsertOperations model: {model}")  # pragma: no cover

    @classmethod
    def convert_update_operation(cls, model: rest.UpdateOperation) -> grpc.PointsUpdateOperation:
        return cls.convert_points_update_operation(model)

    @classmethod
    def convert_points_update_operation(
        cls, model: rest.UpdateOperation
    ) -> grpc.PointsUpdateOperation:
        if isinstance(model, rest.UpsertOperation):
            shard_key_selector = (
                cls.convert_shard_key_selector(model.upsert.shard_key)
                if model.upsert.shard_key
                else None
            )
            return grpc.PointsUpdateOperation(
                upsert=grpc.PointsUpdateOperation.PointStructList(
                    points=cls.convert_point_insert_operation(model.upsert),
                    shard_key_selector=shard_key_selector,
                )
            )
        elif isinstance(model, rest.DeleteOperation):
            shard_key_selector = (
                cls.convert_shard_key_selector(model.delete.shard_key)
                if model.delete.shard_key
                else None
            )
            points_selector = cls.convert_points_selector(model.delete)
            delete_points = grpc.PointsUpdateOperation.DeletePoints(
                points=points_selector,
                shard_key_selector=shard_key_selector,
            )
            return grpc.PointsUpdateOperation(
                delete_points=delete_points,
            )
        elif isinstance(model, rest.SetPayloadOperation):
            if model.set_payload.points:
                points_selector = rest.PointIdsList(points=model.set_payload.points)
            elif model.set_payload.filter:
                points_selector = rest.FilterSelector(filter=model.set_payload.filter)
            else:
                raise ValueError(f"invalid SetPayloadOperation model: {model}")  # pragma: no cover

            shard_key_selector = (
                cls.convert_shard_key_selector(model.set_payload.shard_key)
                if model.set_payload.shard_key
                else None
            )

            return grpc.PointsUpdateOperation(
                set_payload=grpc.PointsUpdateOperation.SetPayload(
                    payload=cls.convert_payload(model.set_payload.payload),
                    points_selector=cls.convert_points_selector(points_selector),
                    shard_key_selector=shard_key_selector,
                )
            )
        elif isinstance(model, rest.OverwritePayloadOperation):
            if model.overwrite_payload.points:
                points_selector = rest.PointIdsList(points=model.overwrite_payload.points)
            elif model.overwrite_payload.filter:
                points_selector = rest.FilterSelector(filter=model.overwrite_payload.filter)
            else:
                raise ValueError(
                    f"invalid OverwritePayloadOperation model: {model}"
                )  # pragma: no cover

            shard_key_selector = (
                cls.convert_shard_key_selector(model.overwrite_payload.shard_key)
                if model.overwrite_payload.shard_key
                else None
            )

            return grpc.PointsUpdateOperation(
                overwrite_payload=grpc.PointsUpdateOperation.OverwritePayload(
                    payload=cls.convert_payload(model.overwrite_payload.payload),
                    points_selector=cls.convert_points_selector(points_selector),
                    shard_key_selector=shard_key_selector,
                )
            )
        elif isinstance(model, rest.DeletePayloadOperation):
            if model.delete_payload.points:
                points_selector = rest.PointIdsList(points=model.delete_payload.points)
            elif model.delete_payload.filter:
                points_selector = rest.FilterSelector(filter=model.delete_payload.filter)
            else:
                raise ValueError(
                    f"invalid DeletePayloadOperation model: {model}"
                )  # pragma: no cover

            shard_key_selector = (
                cls.convert_shard_key_selector(model.delete_payload.shard_key)
                if model.delete_payload.shard_key
                else None
            )

            return grpc.PointsUpdateOperation(
                delete_payload=grpc.PointsUpdateOperation.DeletePayload(
                    keys=model.delete_payload.keys,
                    points_selector=cls.convert_points_selector(points_selector),
                    shard_key_selector=shard_key_selector,
                )
            )
        elif isinstance(model, rest.ClearPayloadOperation):
            shard_key_selector = (
                cls.convert_shard_key_selector(model.clear_payload.shard_key)
                if model.clear_payload.shard_key
                else None
            )
            points_selector = cls.convert_points_selector(model.clear_payload)
            clear_payload = grpc.PointsUpdateOperation.ClearPayload(
                points=points_selector,
                shard_key_selector=shard_key_selector,
            )
            return grpc.PointsUpdateOperation(
                clear_payload=clear_payload,
            )
        elif isinstance(model, rest.UpdateVectorsOperation):
            shard_key_selector = (
                cls.convert_shard_key_selector(model.update_vectors.shard_key)
                if model.update_vectors.shard_key
                else None
            )

            return grpc.PointsUpdateOperation(
                update_vectors=grpc.PointsUpdateOperation.UpdateVectors(
                    points=[
                        cls.convert_point_vectors(point) for point in model.update_vectors.points
                    ],
                    shard_key_selector=shard_key_selector,
                )
            )
        elif isinstance(model, rest.DeleteVectorsOperation):
            if model.delete_vectors.points:
                points_selector = rest.PointIdsList(points=model.delete_vectors.points)
            elif model.delete_vectors.filter:
                points_selector = rest.FilterSelector(filter=model.delete_vectors.filter)
            else:
                raise ValueError(
                    f"invalid DeletePayloadOperation model: {model}"
                )  # pragma: no cover

            shard_key_selector = (
                cls.convert_shard_key_selector(model.delete_vectors.shard_key)
                if model.delete_vectors.shard_key
                else None
            )

            return grpc.PointsUpdateOperation(
                delete_vectors=grpc.PointsUpdateOperation.DeleteVectors(
                    points_selector=cls.convert_points_selector(points_selector),
                    vectors=grpc.VectorsSelector(names=model.delete_vectors.vector),
                    shard_key_selector=shard_key_selector,
                )
            )
        else:
            raise ValueError(f"invalid UpdateOperation model: {model}")  # pragma: no cover

    @classmethod
    def convert_init_from(cls, model: rest.InitFrom) -> str:
        if isinstance(model, rest.InitFrom):
            return model.collection
        else:
            raise ValueError(f"invalid InitFrom model: {model}")  # pragma: no cover

    @classmethod
    def convert_recommend_strategy(cls, model: rest.RecommendStrategy) -> grpc.RecommendStrategy:
        if model == rest.RecommendStrategy.AVERAGE_VECTOR:
            return grpc.RecommendStrategy.AverageVector
        elif model == rest.RecommendStrategy.BEST_SCORE:
            return grpc.RecommendStrategy.BestScore
        else:
            raise ValueError(f"invalid RecommendStrategy model: {model}")  # pragma: no cover

    @classmethod
    def convert_sparse_index_params(cls, model: rest.SparseIndexParams) -> grpc.SparseIndexConfig:
        return grpc.SparseIndexConfig(
            full_scan_threshold=(
                model.full_scan_threshold if model.full_scan_threshold is not None else None
            ),
            on_disk=model.on_disk if model.on_disk is not None else None,
            datatype=cls.convert_datatype(model.datatype) if model.datatype is not None else None,
        )

    @classmethod
    def convert_modifier(cls, model: rest.Modifier) -> grpc.Modifier:
        if model == rest.Modifier.IDF:
            return grpc.Modifier.Idf
        elif model == rest.Modifier.NONE:
            return getattr(grpc.Modifier, "None")
        else:
            raise ValueError(f"invalid Modifier model: {model}")

    @classmethod
    def convert_sparse_vector_params(
        cls, model: rest.SparseVectorParams
    ) -> grpc.SparseVectorParams:
        return grpc.SparseVectorParams(
            index=(
                cls.convert_sparse_index_params(model.index) if model.index is not None else None
            ),
            modifier=(
                cls.convert_modifier(model.modifier) if model.modifier is not None else None
            ),
        )

    @classmethod
    def convert_sparse_vector_config(
        cls, model: Mapping[str, rest.SparseVectorParams]
    ) -> grpc.SparseVectorConfig:
        return grpc.SparseVectorConfig(
            map=dict((key, cls.convert_sparse_vector_params(val)) for key, val in model.items())
        )

    @classmethod
    def convert_shard_key(cls, model: rest.ShardKey) -> grpc.ShardKey:
        if isinstance(model, int):
            return grpc.ShardKey(number=model)
        if isinstance(model, str):
            return grpc.ShardKey(keyword=model)

        raise ValueError(f"invalid ShardKey model: {model}")  # pragma: no cover

    @classmethod
    def convert_shard_key_selector(cls, model: rest.ShardKeySelector) -> grpc.ShardKeySelector:
        if isinstance(model, get_args_subscribed(rest.ShardKey)):
            return grpc.ShardKeySelector(shard_keys=[cls.convert_shard_key(model)])

        if isinstance(model, list):
            return grpc.ShardKeySelector(shard_keys=[cls.convert_shard_key(key) for key in model])

        raise ValueError(f"invalid ShardKeySelector model: {model}")  # pragma: no cover

    @classmethod
    def convert_sharding_method(cls, model: rest.ShardingMethod) -> grpc.ShardingMethod:
        if model == rest.ShardingMethod.AUTO:
            return grpc.Auto
        elif model == rest.ShardingMethod.CUSTOM:
            return grpc.Custom
        else:
            raise ValueError(f"invalid ShardingMethod model: {model}")  # pragma: no cover

    @classmethod
    def convert_health_check_reply(cls, model: rest.VersionInfo) -> grpc.HealthCheckReply:
        return grpc.HealthCheckReply(
            title=model.title,
            version=model.version,
            commit=model.commit,
        )

    @classmethod
    def convert_search_matrix_pair(cls, model: rest.SearchMatrixPair) -> grpc.SearchMatrixPair:
        return grpc.SearchMatrixPair(
            a=cls.convert_extended_point_id(model.a),
            b=cls.convert_extended_point_id(model.b),
            score=model.score,
        )

    @classmethod
    def convert_search_matrix_pairs(
        cls, model: rest.SearchMatrixPairsResponse
    ) -> grpc.SearchMatrixPairs:
        return grpc.SearchMatrixPairs(
            pairs=[cls.convert_search_matrix_pair(pair) for pair in model.pairs],
        )

    @classmethod
    def convert_search_matrix_offsets(
        cls, model: rest.SearchMatrixOffsetsResponse
    ) -> grpc.SearchMatrixOffsets:
        return grpc.SearchMatrixOffsets(
            offsets_row=list(model.offsets_row),
            offsets_col=list(model.offsets_col),
            scores=list(model.scores),
            ids=[cls.convert_extended_point_id(p_id) for p_id in model.ids],
        )
