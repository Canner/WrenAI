import enum
import functools
import json
import logging
from pathlib import Path
from typing import Any, Dict, Literal, Mapping, NamedTuple, Union

import pyarrow
import pyarrow.ipc
from pyarrow.interchange import from_dataframe

from hamilton.experimental import h_databackends
from hamilton.graph_types import HamiltonGraph, HamiltonNode
from hamilton.lifecycle import GraphExecutionHook, NodeExecutionHook

logger = logging.getLogger(__name__)


class Diff(enum.Enum):
    """Result of a diff operation: ADDED, REMOVED, EQUAL, or UNEQUAL. They are mutually exclusive."""

    ADDED = "+"
    REMOVED = "-"
    EQUAL = "=="
    UNEQUAL = "!="


class DiffResult(NamedTuple):
    diff: Diff
    value: Any


def _diff_mappings(
    current: Mapping[str, Any], reference: Mapping[str, Any]
) -> Dict[str, DiffResult]:
    """Generate the diff for all fields of two mappings.

    example:
        {
            "foo": {DiffResult.ADDED: "foo_value"},
            "bar": {DiffResult.REMOVED: "bar_value"},
            "baz": {DiffResult.EQUAL: "baz_value"},
            "oof": {DiffResult.UNEQUAL: {"cur": "oof_value", "ref": "old_value"}}
        }
    """
    current_key_set = set(current.keys())
    reference_key_set = set(reference.keys())

    current_only = current_key_set.difference(reference_key_set)
    reference_only = reference_key_set.difference(current_key_set)
    shared = current_key_set.intersection(reference_key_set)

    diff = {}
    for key in current_only:
        diff[key] = DiffResult(Diff.ADDED, current[key])

    for key in reference_only:
        diff[key] = DiffResult(Diff.REMOVED, reference[key])

    for key in shared:
        current_value = current[key]
        reference_value = reference[key]

        if current_value == reference_value:
            diff[key] = DiffResult(Diff.EQUAL, current_value)
        else:
            diff[key] = DiffResult(Diff.UNEQUAL, {"cur": current_value, "ref": reference_value})

    return diff


SCHEMA_METADATA_FIELD = "__metadata"


# TODO add check for field metadata
def diff_schemas(
    current_schema: pyarrow.Schema,
    reference_schema: pyarrow.Schema,
    check_schema_metadata: bool = False,
    check_field_metadata: bool = False,
):
    """Diff two Pyarrow schema field-by-field. Options to diff schema and field metadata key-by-key.
    Returning an empty dict means equality / no diff

    example:
        {
            '__metadata': DiffResult(diff=<Diff.UNEQUAL: '!='>, value={
                'key': DiffResult(diff=<Diff.UNEQUAL: '!='>, value={
                    'cur': 'value1', 'ref': 'value2'
                })
            }),
            'bar': DiffResult(diff=<Diff.EQUAL: '=='>, value={
                'name': 'bar', 'type': 'int64', 'nullable': True, 'metadata': {}
            }),
            'foo': DiffResult(diff=<Diff.UNEQUAL: '!='>, value={
                'name': DiffResult(diff=<Diff.EQUAL: '=='>, value='foo')
                'type': DiffResult(diff=<Diff.EQUAL: '=='>, value='string'),
                'nullable': DiffResult(diff=<Diff.EQUAL: '=='>, value=True),
                'metadata': DiffResult(diff=<Diff.UNEQUAL: '!='>, value={
                    'key': DiffResult(diff=<Diff.UNEQUAL: '!='>, value={
                        'cur': 'value1', 'ref': 'value2'
                    })
                }),
            })
        }

    """
    # if schemas are equal, return an empty diff
    if current_schema.equals(
        reference_schema, check_metadata=(check_schema_metadata or check_field_metadata)
    ):
        return {}

    current_schema = pyarrow_schema_to_json(current_schema)
    reference_schema = pyarrow_schema_to_json(reference_schema)

    schema_diff = _diff_mappings(current=current_schema, reference=reference_schema)

    # compare fields shared by both schemas
    for field_name, diff_result in schema_diff.items():
        if diff_result.diff == Diff.UNEQUAL:
            current_field = current_schema.get(field_name, {})
            reference_field = reference_schema.get(field_name, {})

            field_diff = DiffResult(
                diff=Diff.UNEQUAL,
                value=_diff_mappings(current=current_field, reference=reference_field),
            )

            if check_field_metadata and (field_diff.value["metadata"].diff != Diff.EQUAL):
                current_field_metadata = current_field.get("metadata", {})
                reference_field_metadata = reference_field.get("metadata", {})

                field_diff.value["metadata"] = DiffResult(
                    diff=Diff.UNEQUAL,
                    value=_diff_mappings(
                        current=current_field_metadata,
                        reference=reference_field_metadata,
                    ),
                )

            schema_diff[field_name] = field_diff

    # compare schema metadata
    if check_schema_metadata:
        current_schema_metadata = current_schema.get(SCHEMA_METADATA_FIELD, {})
        reference_schema_metadata = reference_schema.get(SCHEMA_METADATA_FIELD, {})

        schema_diff[SCHEMA_METADATA_FIELD] = DiffResult(
            Diff.UNEQUAL,
            _diff_mappings(current=current_schema_metadata, reference=reference_schema_metadata),
        )

    return schema_diff


def human_readable_diff(diff: dict) -> dict:
    """Format a diff to exclude EQUAL fields and make it easier to read.

    example:
        {
            '__metadata': {
                'key': {'cur': 'value1', 'ref': 'value2'}
            },
            "foo": {
                "metadata": {
                    'key': {"cur": "value1", "ref": "value2"}
                },
            },
            "baz": "-",
            "bar": {
                "type": {"cur": "int64", "ref": "double"}
            },
        }
    """

    readable_diff = {}

    for field_name, diff_result in diff.items():
        # special case for the schema metadata field
        if field_name == SCHEMA_METADATA_FIELD:
            schema_metadata_diff = human_readable_diff(diff_result.value)
            if schema_metadata_diff != {}:
                readable_diff[SCHEMA_METADATA_FIELD] = schema_metadata_diff
            continue

        if diff_result.diff == Diff.EQUAL:
            continue

        elif diff_result.diff == Diff.ADDED:
            readable_diff[field_name] = diff_result.diff.value

        elif diff_result.diff == Diff.REMOVED:
            readable_diff[field_name] = diff_result.diff.value

        elif diff_result.diff == Diff.UNEQUAL:
            if diff_result.value.get("cur"):
                readable_diff[field_name] = diff_result.value
            else:
                readable_diff[field_name] = human_readable_diff(diff_result.value)

    return dict(sorted(readable_diff.items()))


def pyarrow_schema_to_json(schema: pyarrow.Schema) -> dict:
    """Convert a pyarrow.Schema to a JSON-serializable dictionary

    Pyarrow provides a schema-to-string, but not schema-to-json.
    """

    schema_dict = dict()

    if schema.metadata:
        schema_dict[SCHEMA_METADATA_FIELD] = {
            k.decode(): v.decode() for k, v in schema.metadata.items()
        }

    for name in schema.names:
        field = schema.field(name)
        field_metadata = {}
        if field.metadata:
            field_metadata = {k.decode(): v.decode() for k, v in field.metadata.items()}

        schema_dict[str(name)] = dict(
            name=field.name,
            type=field.type.__str__(),  # __str__() and __repr__() of pyarrow.Field are different
            nullable=field.nullable,
            metadata=field_metadata,
        )

    return schema_dict


@functools.singledispatch
def _get_arrow_schema(df, allow_copy: bool = True) -> pyarrow.Schema:
    """Base case for getting a pyarrow schema from a dataframe.

    :param allow_copy: If True, allow to convert the object to Pyarrow
        even if zero-copy is unavailable

    It looks for the `__dataframe__` attribute associated with the dataframe interchange protocol
    ref: https://data-apis.org/dataframe-protocol/latest/API.html
    """
    if not hasattr(df, "__dataframe__"):
        # if hitting this condition, we can register a new function
        # to conver the dataframe to pyarrow
        raise NotImplementedError(f"Type {type(df)} is currently unsupported.")

    # try to convert to Pyarrow using zero-copy
    try:
        df = from_dataframe(df, allow_copy=False)
    # if unable to zero-copy, convert the object to Pyarrow
    # this may be undesirable if the object is large because of memory overhead
    except RuntimeError as e:
        if allow_copy is False:
            raise e
        df = from_dataframe(df, allow_copy=True)
    return df.schema


@_get_arrow_schema.register
def _(df: h_databackends.AbstractPandasDataFrame, **kwargs) -> pyarrow.Schema:
    """pandas to pyarrow using pyarrow-native method.
    Removes the pandas metadata added by Pyarrow for cleaner schema diffs
    """
    table = pyarrow.Table.from_pandas(df, preserve_index=False)
    return table.schema.remove_metadata()


@_get_arrow_schema.register
def _(df: h_databackends.AbstractIbisDataFrame, **kwargs) -> pyarrow.Schema:
    """Convert the Ibis schema to pyarrow Schema. The operation is lazy
    and doesn't require Ibis execution"""
    return df.schema().to_pyarrow()


def _spark_to_arrow(type_):
    import pyspark.sql.types as pt

    _from_pyspark_dtypes = {
        pt.NullType: pyarrow.null(),
        pt.BooleanType: pyarrow.bool_(),
        pt.BinaryType: pyarrow.binary(),
        pt.ByteType: pyarrow.int8(),
        pt.ShortType: pyarrow.int16(),
        pt.IntegerType: pyarrow.int32(),
        pt.LongType: pyarrow.int64(),
        pt.DateType: pyarrow.date64(),
        pt.FloatType: pyarrow.float32(),
        pt.DoubleType: pyarrow.float64(),
        pt.TimestampType: pyarrow.timestamp(unit="ms", tz=None),
        pt.TimestampNTZType: pyarrow.timestamp(unit="ms", tz=None),
        pt.StringType: pyarrow.string(),
        pt.VarcharType: pyarrow.string(),  # TODO specify length
        pt.CharType: pyarrow.string(),  # TODO specify length
        pt.DayTimeIntervalType: pyarrow.month_day_nano_interval(),  # TODO specify unit
        pt.YearMonthIntervalType: pyarrow.month_day_nano_interval(),  # TODO specify unit
    }

    if isinstance(type_, pt.DecimalType):
        arrow_type = pyarrow.decimal128(type_.precision, type_.scale)
    elif isinstance(type_, pt.ArrayType):
        arrow_type = pyarrow.array([], type=_spark_to_arrow(type_.elementType))
    elif isinstance(type_, pt.MapType):
        arrow_type = pyarrow.map_(
            _spark_to_arrow(type_.keyType),
            _spark_to_arrow(type_.valueType),
        )
    elif isinstance(type_, pt.StructType):
        arrow_type = pyarrow.struct(
            {field.name: _spark_to_arrow(field.dataType) for field in type_.fields}
        )
    else:
        try:
            arrow_type = _from_pyspark_dtypes[type(type_)]
        except KeyError as e:
            raise NotImplementedError(f"Can't convert {type_} to pyarrow type.") from e

    return arrow_type


@_get_arrow_schema.register(h_databackends.AbstractSparkSQLDataFrame)
def _get_spark_schema(df, **kwargs) -> pyarrow.Schema:
    """Convert the PySpark schema to pyarrow Schema. The operation is lazy
    and doesn't require PySpark execution"""
    return pyarrow.schema(
        pyarrow.field(
            name=field.name,
            type=_spark_to_arrow(field.dataType),
            nullable=field.nullable,
            metadata=field.metadata,
        )
        for field in df.schema
    )


# TODO lazy polars schema conversion
# ongoing polars discussion: https://github.com/pola-rs/polars/issues/15600


def get_dataframe_schema(
    df: Union[h_databackends.DATAFRAME_TYPES], node: HamiltonNode
) -> pyarrow.Schema:
    """Get pyarrow schema of a node result and store node metadata on the pyarrow schema."""
    schema = _get_arrow_schema(df)
    metadata = dict(
        name=str(node.name),
        documentation=str(node.documentation),
        version=str(node.version),
    )
    return schema.with_metadata(metadata)


def load_schema(path: Union[str, Path]) -> pyarrow.Schema:
    """Load pyarrow schema from disk using IPC deserialization"""
    return pyarrow.ipc.read_schema(path)


def save_schema(path: Union[str, Path], schema: pyarrow.Schema) -> None:
    """Save pyarrow schema to disk using IPC serialization"""
    Path(path).write_bytes(schema.serialize())


class SchemaValidator(NodeExecutionHook, GraphExecutionHook):
    """Collect dataframe and columns schemas at runtime. Can also conduct runtime checks against schemas"""

    def __init__(
        self,
        schema_dir: str = "./schemas",
        check: bool = True,
        must_exist: bool = False,
        importance: Literal["warn", "fail"] = "warn",
        check_schema_metadata: bool = False,
        check_field_metadata: bool = False,
    ):
        """
        :param schema_dir: Directory where schema files will be stored.
        :param check: If True, conduct schema validation
            Else generate schema files, potentially overwriting stored schemas.
        :param must_exist: If True when check=True, raise FileNotFoundError for missing schema files
            Else generate the missing schema files.
        :param importance: How to handle unequal schemas when check=True
            "warn": log a warning with the schema diff
            "fail": raise an exception with the schema diff
        """
        self.schemas: Dict[str, pyarrow.Schema] = {}
        self.reference_schemas: Dict[str, pyarrow.Schema] = {}
        self.schema_diffs: dict = {}
        self.schema_dir = schema_dir
        self.check = check
        self.must_exist = must_exist
        self.importance = importance
        self.check_schema_metadata = check_schema_metadata
        self.check_field_metadata = check_field_metadata
        self.h_graph: HamiltonGraph = None

        # create the directory where schemas will be stored
        Path(schema_dir).mkdir(parents=True, exist_ok=True)

    @property
    def json_schemas(self) -> Dict[str, dict]:
        """Return schemas collected during the run"""
        return {
            node_name: pyarrow_schema_to_json(schema) for node_name, schema in self.schemas.items()
        }

    # TODO support nodes returning columns by writing them as single column dataframe
    def get_schema_path(self, node_name: str) -> Path:
        """Generate schema filepath based on node name.

        The `.schema` extension is arbitrary. Another common choice is `.arrow`
        but it wouldn't communicate that the file contains only schema metadata.
        The serialization format is IPC by default (see `.save_schema()`).
        """
        return Path(self.schema_dir, node_name).with_suffix(".schema")

    def run_before_graph_execution(
        self, *, graph: HamiltonGraph, inputs: Dict[str, Any], overrides: Dict[str, Any], **kwargs
    ):
        """Store schemas of inputs and overrides nodes that are tables or columns."""
        self.h_graph = graph
        for node_sets in [inputs, overrides]:
            if node_sets is None:
                continue

            for node_name, node_value in node_sets.items():
                self.run_after_node_execution(node_name=node_name, result=node_value)

    def run_after_node_execution(self, *, node_name: str, result: Any, **kwargs):
        """Store schema of executed node if table or column type."""
        if not isinstance(result, h_databackends.DATAFRAME_TYPES):
            return

        # generate the schema from the HamiltonNode and node value
        node = self.h_graph[node_name]
        schema = get_dataframe_schema(df=result, node=node)
        self.schemas[node_name] = schema

        schema_path = self.get_schema_path(node_name)

        # behavior 1: only save schema
        if self.check is False:
            save_schema(self.get_schema_path(node_name), schema)
            return

        # behavior 2: handle missing reference schema while validating
        if not schema_path.exists():
            if self.must_exist:
                raise FileNotFoundError(
                    f"{schema_path} not found. Set `check=False` or `must_exist=False` to create it."
                )
            else:
                save_schema(self.get_schema_path(node_name), schema)
                return

        # behavior 3: validate current schema with reference schema
        reference_schema = load_schema(self.get_schema_path(node_name))
        schema_diff = diff_schemas(
            current_schema=schema,
            reference_schema=reference_schema,
            check_schema_metadata=self.check_schema_metadata,
            check_field_metadata=self.check_field_metadata,
        )
        if schema_diff != {}:
            self.schema_diffs[node_name] = schema_diff
            readable_diff = json.dumps({node_name: human_readable_diff(schema_diff)}, indent=2)
            if self.importance == "warn":
                logger.warning(f"Schema diff:\n{readable_diff}\n")
            elif self.importance == "fail":
                raise RuntimeError(readable_diff)

    def run_after_graph_execution(self, *args, **kwargs):
        """Store a human-readable JSON of all current schemas."""
        Path(f"{self.schema_dir}/schemas.json").write_text(json.dumps(self.json_schemas))

    def run_before_node_execution(self, *args, **kwargs):
        """Required by subclassing NodeExecutionHook"""
