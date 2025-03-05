import abc
import csv
import dataclasses
from collections.abc import Hashable
from datetime import datetime
from io import BufferedReader, BytesIO, StringIO
from pathlib import Path
from typing import Any, Callable, Collection, Dict, Iterator, List, Optional, Tuple, Type, Union

try:
    import pandas as pd
except ImportError as e:
    raise NotImplementedError("Pandas is not installed.") from e

from typing import Literal

try:
    from collections.abc import Iterable, Mapping, Sequence
except ImportError:
    from collections import Iterable, Mapping, Sequence

try:
    import fsspec
    import pyarrow.fs

    FILESYSTEM_TYPE = Optional[Union[pyarrow.fs.FileSystem, fsspec.spec.AbstractFileSystem]]
except ImportError:
    FILESYSTEM_TYPE = Optional[Type]

from sqlite3 import Connection

from pandas._typing import NpDtype
from pandas.core.dtypes.dtypes import ExtensionDtype

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

DATAFRAME_TYPE = pd.DataFrame
COLUMN_TYPE = pd.Series

JSONSerializable = Optional[Union[str, float, bool, List, Dict]]
IndexLabel = Optional[Union[Hashable, Iterator[Hashable]]]
Dtype = Union[ExtensionDtype, NpDtype]


@registry.get_column.register(pd.DataFrame)
def get_column_pandas(df: pd.DataFrame, column_name: str) -> pd.Series:
    return df[column_name]


@registry.fill_with_scalar.register(pd.DataFrame)
def fill_with_scalar_pandas(df: pd.DataFrame, column_name: str, value: Any) -> pd.DataFrame:
    df[column_name] = value
    return df


def register_types():
    """Function to register the types for this extension."""
    registry.register_types("pandas", DATAFRAME_TYPE, COLUMN_TYPE)


register_types()


class DataFrameDataLoader(DataLoader, DataSaver, abc.ABC):
    """Base class for data loaders that saves/loads pandas dataframes.
    Note that these are currently grouped together, but this could change!
    We can change this as these are not part of the publicly exposed APIs.
    Rather, the fixed component is the keys (E.G. csv, feather, etc...) , which,
    when combined with types, correspond to a group of specific parameter. As such,
    the backwards-compatible invariance enables us to change the implementation
    (which classes), and so long as the set of parameters/load targets are compatible,
    we are good to go."""

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    @abc.abstractmethod
    def load_data(self, type_: Type[DATAFRAME_TYPE]) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        pass

    @abc.abstractmethod
    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        pass


@dataclasses.dataclass
class PandasCSVReader(DataLoader):
    """
    Class that handles saving CSV files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_csv.html
    """

    # the filepath_or_buffer param will be changed to path for backwards compatibility
    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    sep: Union[str, None] = ","
    delimiter: Optional[str] = None
    header: Union[Sequence, int, Literal["infer"], None] = "infer"
    names: Optional[Sequence] = None
    index_col: Optional[Union[Hashable, Sequence, Literal[False]]] = None
    usecols: Optional[Union[List[Hashable], Callable, tuple]] = None
    dtype: Optional[Union[Dtype, Dict[Hashable, Dtype]]] = None
    engine: Optional[Literal["c", "python", "pyarrow", "python-fwf"]] = None
    converters: Optional[Mapping] = None
    true_values: Optional[List] = None
    false_values: Optional[List] = None
    skipinitialspace: Optional[bool] = False
    skiprows: Optional[Union[List[int], int, Callable[[Hashable], bool]]] = None
    skipfooter: int = 0
    nrows: Optional[int] = None
    na_values: Optional[Union[Hashable, Iterable, Mapping]] = None
    keep_default_na: bool = True
    na_filter: bool = True
    verbose: bool = False
    skip_blank_lines: bool = True
    parse_dates: Optional[Union[bool, Sequence, None]] = False
    keep_date_col: bool = False
    date_format: Optional[str] = None
    dayfirst: bool = False
    cache_dates: bool = True
    iterator: bool = False
    chunksize: Optional[int] = None
    compression: Optional[
        Union[Literal["infer", "gzip", "bz2", "zip", "xz", "zstd", "tar"], Dict[str, Any]]
    ] = "infer"
    thousands: Optional[str] = None
    decimal: str = "."
    lineterminator: Optional[str] = None
    quotechar: Optional[str] = None
    quoting: int = 0
    doublequote: bool = True
    escapechar: Optional[str] = None
    comment: Optional[str] = None
    encoding: str = "utf-8"
    encoding_errors: Union[
        Literal["strict", "ignore", "replace", "backslashreplace", "surrogateescape"],
        str,
    ] = "strict"
    dialect: Optional[Union[str, csv.Dialect]] = None
    on_bad_lines: Union[Literal["error", "warn", "skip"], Callable] = "error"
    delim_whitespace: bool = False
    low_memory: bool = True
    memory_map: bool = False
    float_precision: Optional[Literal["high", "legacy", "round_trip"]] = None
    storage_options: Optional[Dict[str, Any]] = None
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.sep is not None:
            kwargs["sep"] = self.sep
        if self.delimiter is not None:
            kwargs["delimiter"] = self.delimiter
        if self.header is not None:
            kwargs["header"] = self.header
        if self.names is not None:
            kwargs["names"] = self.names
        if self.index_col is not None:
            kwargs["index_col"] = self.index_col
        if self.usecols is not None:
            kwargs["usecols"] = self.usecols
        if self.dtype is not None:
            kwargs["dtype"] = self.dtype
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.converters is not None:
            kwargs["converters"] = self.converters
        if self.true_values is not None:
            kwargs["true_values"] = self.true_values
        if self.false_values is not None:
            kwargs["false_values"] = self.false_values
        if self.skipinitialspace is not None:
            kwargs["skipinitialspace"] = self.skipinitialspace
        if self.skiprows is not None:
            kwargs["skiprows"] = self.skiprows
        if self.nrows is not None:
            kwargs["nrows"] = self.nrows
        if self.na_values is not None:
            kwargs["na_values"] = self.na_values
        if self.keep_default_na is not None:
            kwargs["keep_default_na"] = self.keep_default_na
        if self.na_filter is not None:
            kwargs["na_filter"] = self.na_filter
        if self.verbose is not None:
            kwargs["verbose"] = self.verbose
        if self.skip_blank_lines is not None:
            kwargs["skip_blank_lines"] = self.skip_blank_lines
        if self.parse_dates is not None:
            kwargs["parse_dates"] = self.parse_dates
        if self.keep_date_col is not None:
            kwargs["keep_date_col"] = self.keep_date_col
        if self.date_format is not None:
            kwargs["date_format"] = self.date_format
        if self.dayfirst is not None:
            kwargs["dayfirst"] = self.dayfirst
        if self.cache_dates is not None:
            kwargs["cache_dates"] = self.cache_dates
        if self.iterator is not None:
            kwargs["iterator"] = self.iterator
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.thousands is not None:
            kwargs["thousands"] = self.thousands
        if self.lineterminator is not None:
            kwargs["lineterminator"] = self.lineterminator
        if self.quotechar is not None:
            kwargs["quotechar"] = self.quotechar
        if self.quoting is not None:
            kwargs["quoting"] = self.quoting
        if self.doublequote is not None:
            kwargs["doublequote"] = self.doublequote
        if self.escapechar is not None:
            kwargs["escapechar"] = self.escapechar
        if self.comment is not None:
            kwargs["comment"] = self.comment
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.encoding_errors is not None:
            kwargs["encoding_errors"] = self.encoding_errors
        if self.dialect is not None:
            kwargs["dialect"] = self.dialect
        if self.on_bad_lines is not None:
            kwargs["on_bad_lines"] = self.on_bad_lines
        if self.delim_whitespace is not None:
            kwargs["delim_whitespace"] = self.delim_whitespace
        if self.low_memory is not None:
            kwargs["low_memory"] = self.low_memory
        if self.memory_map is not None:
            kwargs["memory_map"] = self.memory_map
        if self.float_precision is not None:
            kwargs["float_precision"] = self.float_precision
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pd.read_csv(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "csv"


@dataclasses.dataclass
class PandasCSVWriter(DataSaver):
    """Class that handles saving CSV files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_csv.html
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    sep: Union[str, None] = ","
    na_rep: str = ""
    float_format: Optional[Union[str, Callable]] = None
    columns: Optional[Sequence] = None
    header: Optional[Union[bool, List[str]]] = True
    index: Optional[bool] = False
    index_label: Optional[IndexLabel] = None
    mode: str = "w"
    encoding: Optional[str] = None
    compression: Optional[
        Union[Literal["infer", "gzip", "bz2", "zip", "xz", "zstd", "tar"], Dict[str, Any]]
    ] = "infer"
    quoting: Optional[int] = None
    quotechar: Optional[str] = '"'
    lineterminator: Optional[str] = None
    chunksize: Optional[int] = None
    date_format: Optional[str] = None
    doublequote: bool = True
    escapechar: Optional[str] = None
    decimal: str = "."
    errors: str = "strict"
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = {}
        if self.sep is not None:
            kwargs["sep"] = self.sep
        if self.na_rep is not None:
            kwargs["na_rep"] = self.na_rep
        if self.float_format is not None:
            kwargs["float_format"] = self.float_format
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.header is not None:
            kwargs["header"] = self.header
        if self.index is not None:
            kwargs["index"] = self.index
        if self.index_label is not None:
            kwargs["index_label"] = self.index_label
        if self.mode is not None:
            kwargs["mode"] = self.mode
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.quoting is not None:
            kwargs["quoting"] = self.quoting
        if self.quotechar is not None:
            kwargs["quotechar"] = self.quotechar
        if self.lineterminator is not None:
            kwargs["lineterminator"] = self.lineterminator
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.date_format is not None:
            kwargs["date_format"] = self.date_format
        if self.doublequote is not None:
            kwargs["doublequote"] = self.doublequote
        if self.escapechar is not None:
            kwargs["escapechar"] = self.escapechar
        if self.decimal is not None:
            kwargs["decimal"] = self.decimal
        if self.errors is not None:
            kwargs["errors"] = self.errors
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options

        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_csv(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "csv"


@dataclasses.dataclass
class PandasParquetReader(DataLoader):
    """Class that handles saving parquet files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_parquet.html#pandas.read_parquet
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    engine: Literal["auto", "pyarrow", "fastparquet"] = "auto"
    columns: Optional[List[str]] = None
    storage_options: Optional[Dict[str, Any]] = None
    use_nullable_dtypes: bool = False
    dtype_backend: Literal["numpy_nullable", "pyarrow"] = "numpy_nullable"
    filesystem: Optional[str] = None
    filters: Optional[Union[List[Tuple], List[List[Tuple]]]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if pd.__version__ < "2.0" and self.use_nullable_dtypes is not None:
            kwargs["use_nullable_dtypes"] = self.use_nullable_dtypes
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        if self.filesystem is not None:
            kwargs["filesystem"] = self.filesystem
        if self.filters is not None:
            kwargs["filters"] = self.filters

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the pickle
        df = pd.read_parquet(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "parquet"


@dataclasses.dataclass
class PandasParquetWriter(DataSaver):
    """Class that handles saving parquet files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_parquet.html#pandas.DataFrame.to_parquet
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    engine: Literal["auto", "pyarrow", "fastparquet"] = "auto"
    compression: Optional[str] = "snappy"
    index: Optional[bool] = None
    partition_cols: Optional[List[str]] = None
    storage_options: Optional[Dict[str, Any]] = None
    extra_kwargs: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = {}
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.index is not None:
            kwargs["index"] = self.index
        if self.partition_cols is not None:
            kwargs["partition_cols"] = self.partition_cols
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.extra_kwargs is not None:
            kwargs.update(self.extra_kwargs)
        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_parquet(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "parquet"


@dataclasses.dataclass
class PandasPickleReader(DataLoader):
    """Class for loading/reading pickle files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_pickle.html#pandas.read_pickle
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader] = None
    path: Union[str, Path, BytesIO, BufferedReader] = (
        None  # alias for `filepath_or_buffer` to keep reading/writing args symmetric.
    )
    # kwargs:
    compression: Union[str, Dict[str, Any], None] = "infer"
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        # Returns type for which data loader is available
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the pickle
        df = pd.read_pickle(self.filepath_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "pickle"

    def __post_init__(self):
        """As we're adding in a path alias for filepath_or_buffer, we need to ensure that
        we have backwards compatibility with the old parameter. That means that:
        1. Either filepath_or_buffer or path must be specified, not both
        2. If path is specified, filepath_or_buffer is set to path
        """
        if self.filepath_or_buffer is None and self.path is None:
            raise ValueError("Either filepath_or_buffer or path must be specified")
        elif self.filepath_or_buffer is not None and self.path is not None:
            raise ValueError("Only one of filepath_or_buffer or path must be specified")
        elif self.filepath_or_buffer is None:
            self.filepath_or_buffer = self.path


pickle_protocol_default = 5


@dataclasses.dataclass
class PandasPickleWriter(DataSaver):
    """Class that handles saving pickle files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_pickle.html#pandas.DataFrame.to_pickle
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs:
    compression: Union[str, Dict[str, Any], None] = "infer"
    protocol: int = pickle_protocol_default
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.protocol is not None:
            kwargs["protocol"] = self.protocol
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_pickle(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "pickle"


@dataclasses.dataclass
class PandasJsonReader(DataLoader):
    """Class specifically to handle loading JSON files/buffers with Pandas.

    Disclaimer: We're exposing all the *current* params from the Pandas read_json method.
    Some of these params may get deprecated or new params may be introduced. In the event that
    the params/kwargs below become outdated, please raise an issue or submit a pull request.

    Should map to https://pandas.pydata.org/docs/reference/api/pandas.read_json.html
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    chunksize: Optional[int] = None
    compression: Optional[Union[str, Dict[str, Any]]] = "infer"
    convert_axes: Optional[bool] = None
    convert_dates: Union[bool, List[str]] = True
    date_unit: Optional[str] = None
    dtype: Optional[Union[Dtype, Dict[Hashable, Dtype]]] = None
    dtype_backend: Optional[str] = None
    encoding: Optional[str] = None
    encoding_errors: Optional[str] = "strict"
    engine: str = "ujson"
    keep_default_dates: bool = True
    lines: bool = False
    nrows: Optional[int] = None
    orient: Optional[str] = None
    precise_float: bool = False
    storage_options: Optional[Dict[str, Any]] = None
    typ: str = "frame"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.convert_axes is not None:
            kwargs["convert_axes"] = self.convert_axes
        if self.convert_dates is not None:
            kwargs["convert_dates"] = self.convert_dates
        if self.date_unit is not None:
            kwargs["date_unit"] = self.date_unit
        if self.dtype is not None:
            kwargs["dtype"] = self.dtype
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.encoding_errors is not None:
            kwargs["encoding_errors"] = self.encoding_errors
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.keep_default_dates is not None:
            kwargs["keep_default_dates"] = self.keep_default_dates
        if self.lines is not None:
            kwargs["lines"] = self.lines
        if self.nrows is not None:
            kwargs["nrows"] = self.nrows
        if self.orient is not None:
            kwargs["orient"] = self.orient
        if self.precise_float is not None:
            kwargs["precise_float"] = self.precise_float
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.typ is not None:
            kwargs["typ"] = self.typ
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pd.read_json(self.filepath_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class PandasJsonWriter(DataSaver):
    """Class specifically to handle saving JSON files/buffers with Pandas.

    Disclaimer: We're exposing all the *current* params from the Pandas DataFrame.to_json method.
    Some of these params may get deprecated or new params may be introduced. In the event that
    the params/kwargs below become outdated, please raise an issue or submit a pull request.

    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_json.html
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    compression: str = "infer"
    date_format: str = "epoch"
    date_unit: str = "ms"
    default_handler: Optional[Callable[[Any], JSONSerializable]] = None
    double_precision: int = 10
    force_ascii: bool = True
    index: Optional[bool] = None
    indent: int = 0
    lines: bool = False
    mode: str = "w"
    orient: Optional[str] = None
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.date_format is not None:
            kwargs["date_format"] = self.date_format
        if self.date_unit is not None:
            kwargs["date_unit"] = self.date_unit
        if self.default_handler is not None:
            kwargs["default_handler"] = self.default_handler
        if self.double_precision is not None:
            kwargs["double_precision"] = self.double_precision
        if self.force_ascii is not None:
            kwargs["force_ascii"] = self.force_ascii
        if self.index is not None:
            kwargs["index"] = self.index
        if self.indent is not None:
            kwargs["indent"] = self.indent
        if self.lines is not False:
            kwargs["lines"] = self.lines
        if self.mode is not None:
            kwargs["mode"] = self.mode
        if self.orient is not None:
            kwargs["orient"] = self.orient
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_json(self.filepath_or_buffer, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, data)

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class PandasSqlReader(DataLoader):
    """Class specifically to handle loading SQL data using Pandas.

    Disclaimer: We're exposing all the *current* params from the Pandas read_sql method.
    Some of these params may get deprecated or new params may be introduced. In the event that
    the params/kwargs below become outdated, please raise an issue or submit a pull request.

    Should map to https://pandas.pydata.org/docs/reference/api/pandas.read_sql.html
    Requires optional Pandas dependencies. See https://pandas.pydata.org/docs/getting_started/install.html#sql-databases.
    """

    query_or_table: str
    db_connection: Union[str, Connection]  # can pass in SQLAlchemy engine/connection
    # kwarg
    chunksize: Optional[int] = None
    coerce_float: bool = True
    columns: Optional[List[str]] = None
    dtype: Optional[Union[Dtype, Dict[Hashable, Dtype]]] = None
    dtype_backend: Optional[str] = None
    index_col: Optional[Union[str, List[str]]] = None
    params: Optional[Union[List, Tuple, Dict]] = None
    parse_dates: Optional[Union[List, Dict]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.coerce_float is not None:
            kwargs["coerce_float"] = self.coerce_float
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.dtype is not None:
            kwargs["dtype"] = self.dtype
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        if self.index_col is not None:
            kwargs["index_col"] = self.index_col
        if self.params is not None:
            kwargs["params"] = self.params
        if self.parse_dates is not None:
            kwargs["parse_dates"] = self.parse_dates
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pd.read_sql(self.query_or_table, self.db_connection, **self._get_loading_kwargs())
        sql_metadata = utils.get_sql_metadata(self.query_or_table, df)
        df_metadata = utils.get_dataframe_metadata(df)
        return df, {**sql_metadata, **df_metadata}

    @classmethod
    def name(cls) -> str:
        return "sql"


@dataclasses.dataclass
class PandasSqlWriter(DataSaver):
    """Class specifically to handle saving DataFrames to SQL databases using Pandas.

    Disclaimer: We're exposing all the *current* params from the Pandas DataFrame.to_sql method.
    Some of these params may get deprecated or new params may be introduced. In the event that
    the params/kwargs below become outdated, please raise an issue or submit a pull request.

    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_sql.html
    Requires optional Pandas dependencies. See https://pandas.pydata.org/docs/getting_started/install.html#sql-databases.
    """

    table_name: str
    db_connection: Any  # can pass in SQLAlchemy engine/connection
    # kwargs
    chunksize: Optional[int] = None
    dtype: Optional[Union[Dtype, Dict[Hashable, Dtype]]] = None
    if_exists: str = "fail"
    index: bool = True
    index_label: Optional[IndexLabel] = None
    method: Optional[Union[str, Callable]] = None
    schema: Optional[str] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.dtype is not None:
            kwargs["dtype"] = self.dtype
        if self.if_exists is not None:
            kwargs["if_exists"] = self.if_exists
        if self.index is not None:
            kwargs["index"] = self.index
        if self.index_label is not None:
            kwargs["index_label"] = self.index_label
        if self.method is not None:
            kwargs["method"] = self.method
        if self.schema is not None:
            kwargs["schema"] = self.schema
        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        results = data.to_sql(self.table_name, self.db_connection, **self._get_saving_kwargs())
        sql_metadata = utils.get_sql_metadata(self.table_name, results)
        df_metadata = utils.get_dataframe_metadata(data)
        return {**sql_metadata, **df_metadata}

    @classmethod
    def name(cls) -> str:
        return "sql"


@dataclasses.dataclass
class PandasXmlReader(DataLoader):
    """Class for loading/reading xml files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_xml.html

    Requires `lxml`. See https://pandas.pydata.org/docs/getting_started/install.html#xml
    """

    path_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    xpath: Optional[str] = "./*"
    namespace: Optional[Dict[str, str]] = None
    elems_only: Optional[bool] = False
    attrs_only: Optional[bool] = False
    names: Optional[List[str]] = None
    dtype: Optional[Dict[str, Any]] = None
    converters: Optional[Dict[Union[int, str], Any]] = None
    parse_dates: Union[bool, List[Union[int, str, List[List], Dict[str, List[int]]]]] = False
    encoding: Optional[str] = "utf-8"
    parser: str = "lxml"
    stylesheet: Union[str, Path, BytesIO, BufferedReader] = None
    iterparse: Optional[Dict[str, List[str]]] = None
    compression: Union[str, Dict[str, Any], None] = "infer"
    storage_options: Optional[Dict[str, Any]] = None
    dtype_backend: str = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.xpath is not None:
            kwargs["xpath"] = self.xpath
        if self.namespace is not None:
            kwargs["namespace"] = self.namespace
        if self.elems_only is not None:
            kwargs["elems_only"] = self.elems_only
        if self.attrs_only is not None:
            kwargs["attrs_only"] = self.attrs_only
        if self.names is not None:
            kwargs["names"] = self.names
        if self.dtype is not None:
            kwargs["dtype"] = self.dtype
        if self.converters is not None:
            kwargs["converters"] = self.converters
        if self.parse_dates is not None:
            kwargs["parse_dates"] = self.parse_dates
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.parser is not None:
            kwargs["parser"] = self.parser
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.parser is not None:
            kwargs["parser"] = self.parser
        if self.stylesheet is not None:
            kwargs["stylesheet"] = self.stylesheet
        if self.iterparse is not None:
            kwargs["iterparse"] = self.iterparse
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        return kwargs

    def load_data(self, type: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the xml
        df = pd.read_xml(self.path_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "xml"


@dataclasses.dataclass
class PandasXmlWriter(DataSaver):
    """Class specifically to handle saving xml files/buffers with Pandas.
    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_xml.html

    Requires `lxml`. See https://pandas.pydata.org/docs/getting_started/install.html#xml.
    """

    path_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    index: bool = True
    root_name: str = "data"
    row_name: str = "row"
    na_rep: Optional[str] = None
    attr_cols: Optional[List[str]] = None
    elems_cols: Optional[List[str]] = None
    namespaces: Optional[Dict[str, str]] = None
    prefix: Optional[str] = None
    encoding: str = "utf-8"
    xml_declaration: bool = True
    pretty_print: bool = True
    parser: str = "lxml"
    stylesheet: Optional[Union[str, Path, BytesIO, BufferedReader]] = None
    compression: Union[str, Dict[str, Any], None] = "infer"
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.index is not None:
            kwargs["index"] = self.index
        if self.root_name is not None:
            kwargs["root_name"] = self.root_name
        if self.row_name is not None:
            kwargs["row_name"] = self.row_name
        if self.na_rep is not None:
            kwargs["na_rep"] = self.na_rep
        if self.attr_cols is not None:
            kwargs["attr_cols"] = self.attr_cols
        if self.elems_cols is not None:
            kwargs["elems_cols"] = self.elems_cols
        if self.namespaces is not None:
            kwargs["namespaces"] = self.namespaces
        if self.prefix is not None:
            kwargs["prefix"] = self.prefix
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.xml_declaration is not None:
            kwargs["xml_declaration"] = self.xml_declaration
        if self.pretty_print is not None:
            kwargs["pretty_print"] = self.pretty_print
        if self.parser is not None:
            kwargs["parser"] = self.parser
        if self.stylesheet is not None:
            kwargs["stylesheet"] = self.stylesheet
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_xml(self.path_or_buffer, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path_or_buffer, data)

    @classmethod
    def name(cls) -> str:
        return "xml"


@dataclasses.dataclass
class PandasHtmlReader(DataLoader):
    """Class for loading/reading xml files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_html.html
    """

    io: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    match: Optional[str] = ".+"
    flavor: Optional[Union[str, Sequence]] = None
    header: Optional[Union[int, Sequence]] = None
    index_col: Optional[Union[int, Sequence]] = None
    skiprows: Optional[Union[int, Sequence, slice]] = None
    attrs: Optional[Dict[str, str]] = None
    parse_dates: Optional[bool] = None
    thousands: Optional[str] = ","
    encoding: Optional[str] = None
    decimal: str = "."
    converters: Optional[Dict[Any, Any]] = None
    na_values: Iterable = None
    keep_default_na: bool = True
    displayed_only: bool = True
    extract_links: Optional[Literal["header", "footer", "body", "all"]] = None
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.match is not None:
            kwargs["match"] = self.match
        if self.flavor is not None:
            kwargs["flavor"] = self.flavor
        if self.header is not None:
            kwargs["header"] = self.header
        if self.index_col is not None:
            kwargs["index_col"] = self.index_col
        if self.skiprows is not None:
            kwargs["skiprows"] = self.skiprows
        if self.attrs is not None:
            kwargs["attrs"] = self.attrs
        if self.parse_dates is not None:
            kwargs["parse_dates"] = self.parse_dates
        if self.thousands is not None:
            kwargs["thousands"] = self.thousands
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.decimal is not None:
            kwargs["decimal"] = self.decimal
        if self.converters is not None:
            kwargs["converters"] = self.converters
        if self.na_values is not None:
            kwargs["na_values"] = self.na_values
        if self.keep_default_na is not None:
            kwargs["keep_default_na"] = self.keep_default_na
        if self.displayed_only is not None:
            kwargs["displayed_only"] = self.displayed_only
        if self.extract_links is not None:
            kwargs["extract_links"] = self.extract_links
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options

        return kwargs

    def load_data(self, type: Type) -> Tuple[List[DATAFRAME_TYPE], Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the xml
        df = pd.read_html(self.io, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.io, df[0])
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "html"


@dataclasses.dataclass
class PandasHtmlWriter(DataSaver):
    """Class specifically to handle saving xml files/buffers with Pandas.
    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_html.html#pandas.DataFrame.to_html
    """

    buf: Union[str, Path, StringIO, None] = None
    # kwargs
    columns: Optional[List[str]] = None
    col_space: Optional[Union[str, int, List, Dict]] = None
    header: Optional[bool] = True
    index: Optional[bool] = True
    na_rep: Optional[str] = "NaN"
    formatters: Optional[Union[List, Tuple, Dict]] = None
    float_format: Optional[str] = None
    sparsify: Optional[bool] = True
    index_names: Optional[bool] = True
    justify: str = None
    max_rows: Optional[int] = None
    max_cols: Optional[int] = None
    show_dimensions: bool = False
    decimal: str = "."
    bold_rows: bool = True
    classes: Union[str, List[str], Tuple, None] = None
    escape: Optional[bool] = True
    notebook: Literal[True, False] = False
    border: int = None
    table_id: Optional[str] = None
    render_links: bool = False
    encoding: Optional[str] = "utf-8"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.col_space is not None:
            kwargs["col_space"] = self.col_space
        if self.header is not None:
            kwargs["header"] = self.header
        if self.index is not None:
            kwargs["index"] = self.index
        if self.na_rep is not None:
            kwargs["na_rep"] = self.na_rep
        if self.formatters is not None:
            kwargs["formatters"] = self.formatters
        if self.float_format is not None:
            kwargs["float_format"] = self.float_format
        if self.sparsify is not None:
            kwargs["sparsify"] = self.sparsify
        if self.index_names is not None:
            kwargs["index_names"] = self.index_names
        if self.justify is not None:
            kwargs["justify"] = self.justify
        if self.max_rows is not None:
            kwargs["max_rows"] = self.max_rows
        if self.max_cols is not None:
            kwargs["max_cols"] = self.max_cols
        if self.show_dimensions is not None:
            kwargs["show_dimensions"] = self.show_dimensions
        if self.decimal is not None:
            kwargs["decimal"] = self.decimal
        if self.bold_rows is not None:
            kwargs["bold_rows"] = self.bold_rows
        if self.classes is not None:
            kwargs["classes"] = self.classes
        if self.escape is not None:
            kwargs["escape"] = self.escape
        if self.notebook is not None:
            kwargs["notebook"] = self.notebook
        if self.border is not None:
            kwargs["border"] = self.border
        if self.table_id is not None:
            kwargs["table_id"] = self.table_id
        if self.render_links is not None:
            kwargs["render_links"] = self.render_links
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding

        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_html(self.buf, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.buf, data)

    @classmethod
    def name(cls) -> str:
        return "html"


@dataclasses.dataclass
class PandasStataReader(DataLoader):
    """Class for loading/reading xml files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_stata.html#pandas.read_stata
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    convert_dates: bool = True
    convert_categoricals: bool = True
    index_col: Optional[str] = None
    convert_missing: bool = False
    preserve_dtypes: bool = True
    columns: Optional[Sequence] = None
    order_categoricals: bool = True
    chunksize: Optional[int] = None
    iterator: bool = False
    compression: Union[
        Dict[str, Any], Literal["infer", "gzip", "bz2", "zip", "xz", "zstd", "tar"]
    ] = "infer"
    storage_options: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.convert_dates is not None:
            kwargs["convert_dates"] = self.convert_dates
        if self.convert_categoricals is not None:
            kwargs["convert_categoricals"] = self.convert_categoricals
        if self.index_col is not None:
            kwargs["index_col"] = self.index_col
        if self.convert_missing is not None:
            kwargs["convert_missing"] = self.convert_missing
        if self.preserve_dtypes is not None:
            kwargs["preserve_dtypes"] = self.preserve_dtypes
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.order_categoricals is not None:
            kwargs["order_categoricals"] = self.order_categoricals
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.iterator is not None:
            kwargs["iterator"] = self.iterator
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options

        return kwargs

    def load_data(self, type: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the xml
        df = pd.read_stata(self.filepath_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "stata"


@dataclasses.dataclass
class PandasStataWriter(DataSaver):
    """Class specifically to handle saving xml files/buffers with Pandas.
    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_stata.html
    """

    path: Union[str, Path, BufferedReader] = None
    # kwargs
    convert_dates: Optional[Dict[Hashable, str]] = None
    write_index: bool = True
    byteorder: Optional[str] = None
    time_stamp: Optional[datetime] = None
    data_label: Optional[str] = None
    variable_labels: Optional[Dict[Hashable, str]] = None
    version: Literal[114, 117, 118, 119] = 114
    convert_strl: Optional[str] = None
    compression: Union[
        Dict[str, Any], Literal["infer", "gzip", "bz2", "zip", "xz", "zstd", "tar"]
    ] = "infer"
    storage_options: Optional[Dict[str, Any]] = None
    value_labels: Optional[Dict[Hashable, str]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.convert_dates is not None:
            kwargs["convert_dates"] = self.convert_dates
        if self.write_index is not None:
            kwargs["write_index"] = self.write_index
        if self.byteorder is not None:
            kwargs["byteorder"] = self.byteorder
        if self.time_stamp is not None:
            kwargs["time_stamp"] = self.time_stamp
        if self.data_label is not None:
            kwargs["data_label"] = self.data_label
        if self.variable_labels is not None:
            kwargs["variable_labels"] = self.variable_labels
        if self.version is not None:
            kwargs["version"] = self.version
        if self.convert_strl is not None and self.version == 117:
            kwargs["convert_strl"] = self.convert_strl
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.value_labels is not None:
            kwargs["value_labels"] = self.value_labels

        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_stata(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "stata"


@dataclasses.dataclass
class PandasFeatherReader(DataLoader):
    """Class for loading/reading feather files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_feather.html
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    columns: Optional[Sequence] = None
    use_threads: bool = True
    storage_options: Optional[Dict[str, Any]] = None
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.use_threads is not None:
            kwargs["use_threads"] = self.use_threads
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if pd.__version__ >= "2.0" and self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend

        return kwargs

    def load_data(self, type: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the xml
        df = pd.read_feather(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "feather"


@dataclasses.dataclass
class PandasFeatherWriter(DataSaver):
    """Class specifically to handle saving xml files/buffers with Pandas.
    Should map to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_feather.html
    Additional Parameters passed to: https://arrow.apache.org/docs/python/generated/pyarrow.feather.write_feather.html#pyarrow.feather.write_feather

    Requires `lz4` https://pypi.org/project/lz4/
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    dest: Optional[str] = None
    compression: Literal["zstd", "lz4", "uncompressed"] = None
    compression_level: Optional[int] = None
    chunksize: Optional[int] = None
    version: Optional[int] = 2

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.dest is not None:
            kwargs["dest"] = self.dest
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.compression_level is not None:
            kwargs["compression_level"] = self.compression_level
        if self.chunksize is not None:
            kwargs["chunksize"] = self.chunksize
        if self.version is not None:
            kwargs["version"] = self.version

        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_feather(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "feather"


@dataclasses.dataclass
class PandasORCReader(DataLoader):
    """
    Class that handles reading ORC files and output a pandas DataFrame
    Maps to: https://pandas.pydata.org/docs/reference/api/pandas.read_orc.html#pandas.read_orc
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    columns: Optional[List[str]] = None
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"
    filesystem: Optional[FILESYSTEM_TYPE] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.dtype_backend is not None:
            kwargs["dtype_backend"] = self.dtype_backend
        if self.filesystem is not None:
            kwargs["filesystem"] = self.filesystem

        return kwargs

    def load_data(self, type: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the orc
        df = pd.read_orc(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "orc"


@dataclasses.dataclass
class PandasORCWriter(DataSaver):
    """
    Class that handles writing DataFrames to ORC files.
    Maps to: https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_orc.html
    """

    path: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    engine: Literal["pyarrow"] = "pyarrow"
    index: Optional[bool] = None
    engine_kwargs: Optional[Union[Dict[str, Any], None]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.index is not None:
            kwargs["index"] = self.index
        if self.engine_kwargs is not None:
            kwargs["engine_kwargs"] = self.engine_kwargs

        return kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        data.to_orc(self.path, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "orc"


@dataclasses.dataclass
class PandasExcelReader(DataLoader):
    """Class for reading Excel files and output a pandas DataFrame.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_excel.html
    """

    path: Union[str, Path, BytesIO, BufferedReader] = None
    # kwargs:
    # inspect.get_type_hints doesn't work with type aliases,
    # which are used in pandas.read_excel.
    # So we have to list all the arguments in plain code.
    sheet_name: Union[str, int, List[Union[int, str]], None] = 0
    header: Union[int, Sequence, None] = 0
    names: Optional[Sequence] = None
    index_col: Union[int, str, Sequence, None] = None
    usecols: Union[int, str, Sequence, Sequence, Callable[[str], bool], None] = None
    dtype: Union[Dtype, Dict[Hashable, Dtype], None] = None
    engine: Optional[Literal["xlrd", "openpyxl", "odf", "pyxlsb", "calamine"]] = None
    converters: Union[Dict[str, Callable], Dict[int, Callable], None] = None
    true_values: Optional[Iterable] = None
    false_values: Optional[Iterable] = None
    skiprows: Union[Sequence, int, Callable[[int], object], None] = None
    nrows: Optional[int] = None
    na_values = None  # in pandas.read_excel there are not type hints for na_values
    keep_default_na: bool = True
    na_filter: bool = True
    verbose: bool = False
    parse_dates: Union[List[Union[int, str]], Dict[str, List[Union[int, str]]], bool] = False
    # date_parser: Optional[Callable]  # date_parser is deprecated since pandas=2.0.0
    date_format: Union[Dict[Hashable, str], str, None] = None
    thousands: Optional[str] = None
    decimal: str = "."
    comment: Optional[str] = None
    skipfooter: int = 0
    storage_options: Optional[Dict[str, Any]] = None
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"
    engine_kwargs: Optional[Dict[str, Any]] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        # Returns type for which data loader is available
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)

        # path corresponds to 'io' argument of pandas.read_excel,
        # but we send it separately
        del kwargs["path"]

        # engine_kwargs appeared only in pandas >= 2.1
        # For compatibility with pandas 2.0 we remove engine_kwargs from kwargs if it's empty.
        if kwargs["engine_kwargs"] is None:
            del kwargs["engine_kwargs"]

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the excel file
        df = pd.read_excel(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "excel"


@dataclasses.dataclass
class PandasExcelWriter(DataSaver):
    """Class that handles saving Excel files with pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.ExcelWriter.html
    Additional parameters passed to https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.to_excel.html
    """

    path: Union[str, Path, BytesIO]
    # kwargs:
    # inspect.get_type_hints doesn't work with type aliases,
    # which are used in pandas.DataFrame.to_excel.
    # So we have to list all the arguments in plain code
    sheet_name: str = "Sheet1"
    na_rep: str = ""
    float_format: Optional[str] = None
    columns: Optional[Sequence] = None
    header: Union[Sequence, bool] = True
    index: bool = True
    index_label: Optional[IndexLabel] = None
    startrow: int = 0
    startcol: int = 0
    engine: Optional[Literal["openpyxl", "xlsxwriter"]] = None
    merge_cells: bool = True
    inf_rep: str = "inf"
    freeze_panes: Optional[Tuple[int, int]] = None
    storage_options: Optional[Dict[str, Any]] = None
    engine_kwargs: Optional[Dict[str, Any]] = None
    mode: Optional[Literal["w", "a"]] = "w"
    if_sheet_exists: Optional[Literal["error", "new", "replace", "overlay"]] = None
    datetime_format: str = None
    date_format: str = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)

        # Pass kwargs to ExcelWriter ONLY for kwargs which appear in both ExcelWriter and .to_excel()
        writer_kwarg_names = [
            "date_format",
            "datetime_format",
            "if_sheet_exists",
            "mode",
            "engine_kwargs",
            "engine",
            "storage_options",
        ]

        # path corresponds to 'excel_writer' argument of pandas.DataFrame.to_excel,
        # but we send it separately
        del kwargs["path"]

        # engine_kwargs appeared only in pandas >= 2.1
        # For compatibility with pandas 2.0 we remove engine_kwargs from kwargs if it's empty.
        if kwargs["engine_kwargs"] is None:
            del kwargs["engine_kwargs"]
            writer_kwarg_names.remove("engine_kwargs")

        # seperate kwargs for ExcelWriter and to_excel() invocation
        writer_kwargs = {k: kwargs[k] for k in writer_kwarg_names}
        to_excel_kwargs = {k: kwargs[k] for k in (kwargs.keys() - set(writer_kwarg_names))}

        return writer_kwargs, to_excel_kwargs

    def save_data(self, data: DATAFRAME_TYPE) -> Dict[str, Any]:
        writer_kwargs, to_excel_kwargs = self._get_saving_kwargs()

        with pd.ExcelWriter(self.path, **writer_kwargs) as writer:
            data.to_excel(writer, **to_excel_kwargs)
        return utils.get_file_and_dataframe_metadata(self.path, data)

    @classmethod
    def name(cls) -> str:
        return "excel"


@dataclasses.dataclass
class PandasTableReader(DataLoader):
    """Class for loading/reading table files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_table.html
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    sep: Union[str, None] = None
    delimiter: Optional[str] = None
    header: Union[int, Sequence, str, None] = "infer"
    names: Optional[Sequence] = None
    index_col: Union[int, str, Sequence, None] = None
    usecols: Union[Sequence, None] = None
    dtype: Union[Dtype, Dict[Hashable, Dtype], None] = None
    engine: Optional[Literal["c", "python", "pyarrow"]] = None
    converters: Optional[Dict[Hashable, Callable]] = None
    true_values: Optional[Iterable] = None
    false_values: Optional[Iterable] = None
    skipinitialspace: bool = False
    skiprows: Optional[Union[List[int], int, List[Callable]]] = None
    skipfooter: int = 0
    nrows: Optional[int] = None
    na_values: Optional[Union[Hashable, Iterable, Dict[Hashable, Iterable]]] = None
    keep_default_na: bool = True
    na_filter: bool = True
    verbose: bool = False
    skip_blank_lines: bool = True
    parse_dates: Union[List[Union[int, str]], Dict[str, List[Union[int, str]]], bool] = False
    infer_datetime_format: bool = False
    keep_date_col: bool = False
    date_parser: Optional[Callable] = None
    date_format: Optional[Union[str, str]] = None
    dayfirst: bool = False
    cache_dates: bool = True
    iterator: bool = False
    chunksize: Optional[int] = None
    compression: Union[str, Dict] = "infer"
    thousands: Optional[str] = None
    decimal: str = "."
    lineterminator: Optional[str] = None
    quotechar: Optional[str] = '"'
    quoting: int = 0
    doublequote: bool = True
    escapechar: Optional[str] = None
    comment: Optional[str] = None
    encoding: Optional[str] = None
    encoding_errors: Optional[str] = "strict"
    dialect: Optional[str] = None
    on_bad_lines: Union[Literal["error", "warn", "skip"], Callable] = "error"
    delim_whitespace: bool = False
    low_memory: bool = True
    memory_map: bool = False
    float_precision: Optional[Literal["high", "legacy", "round_trip"]] = None
    storage_options: Optional[Dict] = None
    dtype_backend: Literal["numpy_nullable", "pyarrow"] = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)

        # filepath_or_buffer corresponds to 'filepath_or_buffer' argument of pandas.read_table,
        # but we send it separately
        del kwargs["filepath_or_buffer"]

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the table
        df = pd.read_table(self.filepath_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "table"


@dataclasses.dataclass
class PandasFWFReader(DataLoader):
    """Class for loading/reading fixed-width formatted files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_fwf.html
    """

    filepath_or_buffer: Union[str, Path, BytesIO, BufferedReader]
    # kwargs
    colspecs: Union[str, List[Tuple[int, int]], Tuple[int, int]] = "infer"
    widths: Optional[List[int]] = None
    infer_nrows: int = 100
    dtype_backend: Literal["numpy_nullable", "pyarrow"] = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)

        # filepath_or_buffer corresponds to 'filepath_or_buffer' argument of pandas.read_fwf,
        # but we send it separately
        del kwargs["filepath_or_buffer"]

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the fwf file
        df = pd.read_fwf(self.filepath_or_buffer, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.filepath_or_buffer, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "fwf"


@dataclasses.dataclass
class PandasSPSSReader(DataLoader):
    """Class for loading/reading spss files with Pandas.
    Maps to https://pandas.pydata.org/docs/reference/api/pandas.read_spss.html
    """

    path: Union[str, Path]
    # kwargs
    usecols: Optional[Union[List[Hashable], Callable[[str], bool]]] = None
    convert_categoricals: bool = True
    dtype_backend: Literal["pyarrow", "numpy_nullable"] = "numpy_nullable"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self) -> Dict[str, Any]:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)

        # path corresponds to 'io' argument of pandas.read_spss,
        # but we send it separately
        del kwargs["path"]

        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        # Loads the data and returns the df and metadata of the spss file
        df = pd.read_spss(self.path, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.path, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "spss"


def register_data_loaders():
    """Function to register the data loaders for this extension."""
    for loader in [
        PandasCSVReader,
        PandasCSVWriter,
        PandasParquetReader,
        PandasParquetWriter,
        PandasPickleReader,
        PandasPickleWriter,
        PandasJsonReader,
        PandasJsonWriter,
        PandasSqlReader,
        PandasSqlWriter,
        PandasXmlReader,
        PandasXmlWriter,
        PandasHtmlReader,
        PandasHtmlWriter,
        PandasStataReader,
        PandasStataWriter,
        PandasFeatherReader,
        PandasFeatherWriter,
        PandasORCWriter,
        PandasORCReader,
        PandasExcelWriter,
        PandasExcelReader,
        PandasTableReader,
        PandasFWFReader,
        PandasSPSSReader,
    ]:
        registry.register_adapter(loader)


register_data_loaders()
