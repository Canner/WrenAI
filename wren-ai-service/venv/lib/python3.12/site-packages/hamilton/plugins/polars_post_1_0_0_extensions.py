import dataclasses
from io import BytesIO, IOBase, TextIOWrapper
from pathlib import Path
from typing import (
    Any,
    BinaryIO,
    Collection,
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
    TextIO,
    Tuple,
    Type,
    Union,
)

try:
    from xlsxwriter.workbook import Workbook
except ImportError:
    Workbook = Type

import polars as pl
from polars._typing import ConnectionOrCursor

# for polars <0.16.0 we need to determine whether type_aliases exist.
has_alias = False
if hasattr(pl, "type_aliases"):
    has_alias = True


import polars.selectors

# for polars 1.3.0 we need to import selectors
if hasattr(polars.selectors, "_selector_proxy_"):
    from polars.selectors import _selector_proxy_  # noqa

# for polars 0.18.0 we need to check what to do.
from polars._typing import CsvEncoding, SchemaDefinition

CsvQuoteStyle = Type

IpcCompression = Type

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

DATAFRAME_TYPE = pl.DataFrame
COLUMN_TYPE = pl.Series


@dataclasses.dataclass
class PolarsCSVReader(DataLoader):
    """Class specifically to handle loading CSV files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_csv.html
    """

    file: Union[str, TextIO, BytesIO, Path, BinaryIO, bytes]
    # kwargs:
    has_header: bool = True
    include_header: bool = True
    columns: Union[Sequence[int], Sequence[str]] = None
    new_columns: Sequence[str] = None
    separator: str = ","
    comment_char: str = None
    quote_char: str = '"'
    skip_rows: int = 0
    dtypes: Union[Mapping[str, Any], Sequence[Any]] = None
    null_values: Union[str, Sequence[str], Dict[str, str]] = None
    missing_utf8_is_empty_string: bool = False
    ignore_errors: bool = False
    try_parse_dates: bool = False
    n_threads: int = None
    infer_schema_length: int = 100
    batch_size: int = 8192
    n_rows: int = None
    encoding: Union[CsvEncoding, str] = "utf8"
    low_memory: bool = False
    rechunk: bool = True
    use_pyarrow: bool = False
    storage_options: Dict[str, Any] = None
    skip_rows_after_header: int = 0
    row_count_name: str = None
    row_count_offset: int = 0
    sample_size: int = 1024
    eol_char: str = "\n"
    raise_if_empty: bool = True

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.has_header is not None:
            kwargs["has_header"] = self.has_header
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.new_columns is not None:
            kwargs["new_columns"] = self.new_columns
        if self.separator is not None:
            kwargs["separator"] = self.separator
        if self.comment_char is not None:
            kwargs["comment_char"] = self.comment_char
        if self.quote_char is not None:
            kwargs["quote_char"] = self.quote_char
        if self.skip_rows is not None:
            kwargs["skip_rows"] = self.skip_rows
        if self.dtypes is not None:
            kwargs["dtypes"] = self.dtypes
        if self.null_values is not None:
            kwargs["null_values"] = self.null_values
        if self.missing_utf8_is_empty_string is not None:
            kwargs["missing_utf8_is_empty_string"] = self.missing_utf8_is_empty_string
        if self.ignore_errors is not None:
            kwargs["ignore_errors"] = self.ignore_errors
        if self.try_parse_dates is not None:
            kwargs["try_parse_dates"] = self.try_parse_dates
        if self.n_threads is not None:
            kwargs["n_threads"] = self.n_threads
        if self.infer_schema_length is not None:
            kwargs["infer_schema_length"] = self.infer_schema_length
        if self.batch_size is not None:
            kwargs["batch_size"] = self.batch_size
        if self.n_rows is not None:
            kwargs["n_rows"] = self.n_rows
        if self.encoding is not None:
            kwargs["encoding"] = self.encoding
        if self.low_memory is not None:
            kwargs["low_memory"] = self.low_memory
        if self.rechunk is not None:
            kwargs["rechunk"] = self.rechunk
        if self.use_pyarrow is not None:
            kwargs["use_pyarrow"] = self.use_pyarrow
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.skip_rows_after_header is not None:
            kwargs["skip_rows_after_header"] = self.skip_rows_after_header
        if self.row_count_name is not None:
            kwargs["row_count_name"] = self.row_count_name
        if self.row_count_offset is not None:
            kwargs["row_count_offset"] = self.row_count_offset
        if self.eol_char is not None:
            kwargs["eol_char"] = self.eol_char
        if self.raise_if_empty is not None:
            kwargs["raise_if_empty"] = self.raise_if_empty
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_csv(self.file, **self._get_loading_kwargs())

        metadata = utils.get_file_and_dataframe_metadata(self.file, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "csv"


@dataclasses.dataclass
class PolarsCSVWriter(DataSaver):
    """Class specifically to handle saving CSV files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_csv.html
    """

    file: Union[BytesIO, TextIOWrapper, str, Path]
    # kwargs:
    include_header: bool = True
    separator: str = ","
    line_terminator: str = "\n"
    quote_char: str = '"'
    batch_size: int = 1024
    datetime_format: str = None
    date_format: str = None
    time_format: str = None
    float_precision: int = None
    null_value: str = None
    quote_style: CsvQuoteStyle = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.separator is not None:
            kwargs["separator"] = self.separator
        if self.include_header is not None:
            kwargs["include_header"] = self.include_header
        if self.separator is not None:
            kwargs["separator"] = self.separator
        if self.line_terminator is not None:
            kwargs["line_terminator"] = self.line_terminator
        if self.quote_char is not None:
            kwargs["quote_char"] = self.quote_char
        if self.batch_size is not None:
            kwargs["batch_size"] = self.batch_size
        if self.datetime_format is not None:
            kwargs["datetime_format"] = self.datetime_format
        if self.date_format is not None:
            kwargs["date_format"] = self.date_format
        if self.time_format is not None:
            kwargs["time_format"] = self.time_format
        if self.float_precision is not None:
            kwargs["float_precision"] = self.float_precision
        if self.null_value is not None:
            kwargs["null_value"] = self.null_value
        if self.quote_style is not None:
            kwargs["quote_style"] = self.quote_style
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()
        data.write_csv(self.file, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.file, data)

    @classmethod
    def name(cls) -> str:
        return "csv"


@dataclasses.dataclass
class PolarsParquetReader(DataLoader):
    """Class specifically to handle loading parquet files with polars
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_parquet.html
    """

    file: Union[str, TextIO, BytesIO, Path, BinaryIO, bytes]
    # kwargs:
    columns: Union[List[int], List[str]] = None
    n_rows: int = None
    use_pyarrow: bool = False
    memory_map: bool = True
    storage_options: Dict[str, Any] = None
    parallel: Any = "auto"
    row_count_name: str = None
    row_count_offset: int = 0
    low_memory: bool = False
    pyarrow_options: Dict[str, Any] = None
    use_statistics: bool = True
    rechunk: bool = True

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.n_rows is not None:
            kwargs["n_rows"] = self.n_rows
        if self.use_pyarrow is not None:
            kwargs["use_pyarrow"] = self.use_pyarrow
        if self.memory_map is not None:
            kwargs["memory_map"] = self.memory_map
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.parallel is not None:
            kwargs["parallel"] = self.parallel
        if self.row_count_name is not None:
            kwargs["row_count_name"] = self.row_count_name
        if self.row_count_offset is not None:
            kwargs["row_count_offset"] = self.row_count_offset
        if self.low_memory is not None:
            kwargs["low_memory"] = self.low_memory
        if self.pyarrow_options is not None:
            kwargs["pyarrow_options"] = self.pyarrow_options
        if self.use_statistics is not None:
            kwargs["use_statistics"] = self.use_statistics
        if self.rechunk is not None:
            kwargs["rechunk"] = self.rechunk
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_parquet(self.file, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.file, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "parquet"


@dataclasses.dataclass
class PolarsParquetWriter(DataSaver):
    """Class specifically to handle saving CSV files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_parquet.html
    """

    file: Union[BytesIO, TextIOWrapper, str, Path]
    # kwargs:
    compression: Any = "zstd"
    compression_level: int = None
    statistics: bool = False
    row_group_size: int = None
    use_pyarrow: bool = False
    pyarrow_options: Dict[str, Any] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        if self.compression is not None:
            kwargs["compression_level"] = self.compression_level
        if self.compression is not None:
            kwargs["statistics"] = self.statistics
        if self.compression is not None:
            kwargs["row_group_size"] = self.row_group_size
        if self.compression is not None:
            kwargs["use_pyarrow"] = self.use_pyarrow
        if self.compression is not None:
            kwargs["pyarrow_options"] = self.pyarrow_options
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()

        data.write_parquet(self.file, **self._get_saving_kwargs())

        return utils.get_file_and_dataframe_metadata(self.file, data)

    @classmethod
    def name(cls) -> str:
        return "parquet"


@dataclasses.dataclass
class PolarsFeatherReader(DataLoader):
    """
    Class specifically to handle loading Feather/Arrow IPC files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_ipc.html
    """

    source: Union[str, BinaryIO, BytesIO, Path, bytes]
    # kwargs:
    columns: Optional[Union[List[str], List[int]]] = None
    n_rows: Optional[int] = None
    use_pyarrow: bool = False
    memory_map: bool = True
    storage_options: Optional[Dict[str, Any]] = None
    row_count_name: Optional[str] = None
    row_count_offset: int = 0
    rechunk: bool = True

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.n_rows is not None:
            kwargs["n_rows"] = self.n_rows
        if self.use_pyarrow is not None:
            kwargs["use_pyarrow"] = self.use_pyarrow
        if self.memory_map is not None:
            kwargs["memory_map"] = self.memory_map
        if self.storage_options is not None:
            kwargs["storage_options"] = self.storage_options
        if self.row_count_name is not None:
            kwargs["row_count_name"] = self.row_count_name
        if self.row_count_offset is not None:
            kwargs["row_count_offset"] = self.row_count_offset
        if self.rechunk is not None:
            kwargs["rechunk"] = self.rechunk
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_ipc(self.source, **self._get_loading_kwargs())
        metadata = utils.get_file_metadata(self.source)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "feather"


@dataclasses.dataclass
class PolarsFeatherWriter(DataSaver):
    """
    Class specifically to handle saving Feather/Arrow IPC files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_ipc.html
    """

    file: Optional[Union[BinaryIO, BytesIO, str, Path]] = None
    # kwargs:
    compression: IpcCompression = "uncompressed"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()
        data.write_ipc(self.file, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.file, data)

    @classmethod
    def name(cls) -> str:
        return "feather"


@dataclasses.dataclass
class PolarsAvroReader(DataLoader):
    """Class specifically to handle loading Avro files with polars
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_avro.html
    """

    file: Union[str, TextIO, BytesIO, Path, BinaryIO, bytes]
    # kwargs:
    columns: Union[List[int], List[str], None] = None
    n_rows: Union[int, None] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.columns is not None:
            kwargs["columns"] = self.columns
        if self.n_rows is not None:
            kwargs["n_rows"] = self.n_rows
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_avro(self.file, **self._get_loading_kwargs())
        metadata = utils.get_file_and_dataframe_metadata(self.file, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "avro"


@dataclasses.dataclass
class PolarsAvroWriter(DataSaver):
    """Class specifically to handle saving Avro files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_avro.html
    """

    file: Union[BytesIO, TextIOWrapper, str, Path]
    # kwargs:
    compression: Any = "uncompressed"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.compression is not None:
            kwargs["compression"] = self.compression
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()

        data.write_avro(self.file, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.file, data)

    @classmethod
    def name(cls) -> str:
        return "avro"


@dataclasses.dataclass
class PolarsJSONReader(DataLoader):
    """
    Class specifically to handle loading JSON files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_json.html
    """

    source: Union[str, Path, IOBase, bytes]
    schema: SchemaDefinition = None
    schema_overrides: SchemaDefinition = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.schema is not None:
            kwargs["schema"] = self.schema
        if self.schema_overrides is not None:
            kwargs["schema_overrides"] = self.schema_overrides
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_json(self.source, **self._get_loading_kwargs())
        metadata = utils.get_file_metadata(self.source)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class PolarsJSONWriter(DataSaver):
    """
    Class specifically to handle saving JSON files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_json.html
    """

    file: Union[IOBase, str, Path]

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()

        data.write_json(self.file)
        return utils.get_file_and_dataframe_metadata(self.file, data)

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class PolarsSpreadsheetReader(DataLoader):
    """
    Class specifically to handle loading Spreadsheet files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.read_excel.html
    """

    source: Union[str, Path, IOBase, bytes]
    # kwargs:
    sheet_id: Union[int, Sequence[int], None] = None
    sheet_name: Union[str, List[str], Tuple[str], None] = None
    engine: Literal["xlsx2csv", "openpyxl", "pyxlsb", "odf", "xlrd", "xlsxwriter"] = "xlsx2csv"
    engine_options: Union[Dict[str, Any], None] = None
    read_options: Union[Dict[str, Any], None] = None
    schema_overrides: Union[Dict[str, Any], None] = None
    raise_if_empty: bool = True

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.sheet_id is not None:
            kwargs["sheet_id"] = self.sheet_id
        if self.sheet_name is not None:
            kwargs["sheet_name"] = self.sheet_name
        if self.engine is not None:
            kwargs["engine"] = self.engine
        if self.engine_options is not None:
            kwargs["engine_options"] = self.engine_options
        if self.read_options is not None:
            kwargs["read_options"] = self.read_options
        if self.schema_overrides is not None:
            kwargs["schema_overrides"] = self.schema_overrides
        if self.raise_if_empty is not None:
            kwargs["raise_if_empty"] = self.raise_if_empty
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_excel(self.source, **self._get_loading_kwargs())
        metadata = utils.get_file_metadata(self.source)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "spreadsheet"


@dataclasses.dataclass
class PolarsSpreadsheetWriter(DataSaver):
    """
    Class specifically to handle saving Spreadsheet files with Polars.
    Should map to https://pola-rs.github.io/polars/py-polars/html/reference/api/polars.DataFrame.write_excel.html
    """

    # importing here because this is where it's used. Can move later.
    # but yeah the polars type aliases weren't resolving well in python 3.9
    # so stripped/reduced them appropriately.
    from polars._typing import ColumnTotalsDefinition, RowTotalsDefinition
    from polars.datatypes import DataType, DataTypeClass

    workbook: Union[Workbook, BytesIO, Path, str]
    worksheet: Union[str, None] = None
    # kwargs:
    position: Union[Tuple[int, int], str] = "A1"
    table_style: Union[str, Dict[str, Any], None] = None
    table_name: Union[str, None] = None
    column_formats: Union[
        Mapping[Union[str, Tuple[str, ...]], Union[str, Mapping[str, str]]], None
    ] = None
    dtype_formats: Union[Dict[Union[DataType, DataTypeClass], str], None] = None
    conditional_formats: Union[
        Mapping[
            Union[str, Collection[str]],
            Union[str, Union[Mapping[str, Any], Sequence[Union[str, Mapping[str, Any]]]]],
        ],
        None,
    ] = None
    header_format: Union[Dict[str, Any], None] = None
    column_totals: Union[ColumnTotalsDefinition, None] = None
    column_widths: Union[Mapping[str, Union[Tuple[str, ...], int]], int, None] = None
    row_totals: Union[RowTotalsDefinition, None] = None
    row_heights: Union[Dict[Union[int, Tuple[int, ...]], int], int, None] = None
    sparklines: Union[Dict[str, Union[Sequence[str], Dict[str, Any]]], None] = None
    formulas: Union[Dict[str, Union[str, Dict[str, str]]], None] = None
    float_precision: int = 3
    include_header: bool = True
    autofilter: bool = True
    autofit: bool = False
    hidden_columns: Union[Sequence[str], str, None] = None
    hide_gridlines: bool = None
    sheet_zoom: Union[int, None] = None
    freeze_panes: Union[
        str, Tuple[int, int], Tuple[str, int, int], Tuple[int, int, int, int], None
    ] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.position is not None:
            kwargs["position"] = self.position
        if self.table_style is not None:
            kwargs["table_style"] = self.table_style
        if self.table_name is not None:
            kwargs["table_name"] = self.table_name
        if self.column_formats is not None:
            kwargs["column_formats"] = self.column_formats
        if self.dtype_formats is not None:
            kwargs["dtype_formats"] = self.dtype_formats
        if self.conditional_formats is not None:
            kwargs["conditional_formats"] = self.conditional_formats
        if self.header_format is not None:
            kwargs["header_format"] = self.header_format
        if self.column_totals is not None:
            kwargs["column_totals"] = self.column_totals
        if self.column_widths is not None:
            kwargs["column_widths"] = self.column_widths
        if self.row_totals is not None:
            kwargs["row_totals"] = self.row_totals
        if self.row_heights is not None:
            kwargs["row_heights"] = self.row_heights
        if self.sparklines is not None:
            kwargs["sparklines"] = self.sparklines
        if self.formulas is not None:
            kwargs["formulas"] = self.formulas
        if self.float_precision is not None:
            kwargs["float_precision"] = self.float_precision
        if self.include_header is not None:
            kwargs["include_header"] = self.include_header
        if self.autofilter is not None:
            kwargs["autofilter"] = self.autofilter
        if self.autofit is not None:
            kwargs["autofit"] = self.autofit
        if self.hidden_columns is not None:
            kwargs["hidden_columns"] = self.hidden_columns
        if self.hide_gridlines is not None:
            kwargs["hide_gridlines"] = self.hide_gridlines
        if self.sheet_zoom is not None:
            kwargs["sheet_zoom"] = self.sheet_zoom
        if self.freeze_panes is not None:
            kwargs["freeze_panes"] = self.freeze_panes
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()

        data.write_excel(self.workbook, self.worksheet, **self._get_saving_kwargs())
        return utils.get_file_and_dataframe_metadata(self.workbook, data)

    @classmethod
    def name(cls) -> str:
        return "spreadsheet"


@dataclasses.dataclass
class PolarsDatabaseReader(DataLoader):
    """
    Class specifically to handle loading DataFrame from a database.
    """

    query: str
    connection: Union[ConnectionOrCursor, str]
    # kwargs:
    iter_batches: bool = False
    batch_size: Union[int, None] = None
    schema_overrides: Union[Dict[str, Any], None] = None
    infer_schema_length: Union[int, None] = None
    execute_options: Union[Dict[str, Any], None] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE]

    def _get_loading_kwargs(self):
        kwargs = {}
        if self.iter_batches is not None:
            kwargs["iter_batches"] = self.iter_batches
        if self.batch_size is not None:
            kwargs["batch_size"] = self.batch_size
        if self.schema_overrides is not None:
            kwargs["schema_overrides"] = self.schema_overrides
        if self.infer_schema_length is not None:
            kwargs["infer_schema_length"] = self.infer_schema_length
        if self.execute_options is not None:
            kwargs["execute_options"] = self.execute_options
        return kwargs

    def load_data(self, type_: Type) -> Tuple[DATAFRAME_TYPE, Dict[str, Any]]:
        df = pl.read_database(
            query=self.query,
            connection=self.connection,
            **self._get_loading_kwargs(),
        )
        metadata = utils.get_file_and_dataframe_metadata(self.query, df)
        return df, metadata

    @classmethod
    def name(cls) -> str:
        return "database"


@dataclasses.dataclass
class PolarsDatabaseWriter(DataSaver):
    """
    Class specifically to handle saving DataFrame to a database.
    """

    table_name: str
    connection: Union[ConnectionOrCursor, str]
    if_table_exists: Literal["fail", "replace", "append"] = "fail"
    engine: Literal["auto", "sqlalchemy", "adbc"] = "sqlalchemy"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [DATAFRAME_TYPE, pl.LazyFrame]

    def _get_saving_kwargs(self):
        kwargs = {}
        if self.if_table_exists is not None:
            kwargs["if_table_exists"] = self.if_table_exists
        if self.engine is not None:
            kwargs["engine"] = self.engine
        return kwargs

    def save_data(self, data: Union[DATAFRAME_TYPE, pl.LazyFrame]) -> Dict[str, Any]:
        if isinstance(data, pl.LazyFrame):
            data = data.collect()

        data.write_database(
            table_name=self.table_name,
            connection=self.connection,
            **self._get_saving_kwargs(),
        )
        return utils.get_file_and_dataframe_metadata(self.table_name, data)

    @classmethod
    def name(cls) -> str:
        return "database"


def register_data_loaders():
    """Function to register the data loaders for this extension."""
    for loader in [
        PolarsCSVReader,
        PolarsCSVWriter,
        PolarsParquetReader,
        PolarsParquetWriter,
        PolarsFeatherReader,
        PolarsFeatherWriter,
        PolarsAvroReader,
        PolarsAvroWriter,
        PolarsJSONReader,
        PolarsJSONWriter,
        PolarsDatabaseReader,
        PolarsDatabaseWriter,
        PolarsSpreadsheetReader,
        PolarsSpreadsheetWriter,
    ]:
        registry.register_adapter(loader)
