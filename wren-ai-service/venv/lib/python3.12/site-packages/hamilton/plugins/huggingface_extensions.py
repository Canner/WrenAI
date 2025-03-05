import dataclasses
from os import PathLike
from typing import (
    Any,
    BinaryIO,
    Collection,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    Type,
    Union,
)

try:
    from datasets import (
        Dataset,
        DatasetDict,
        DownloadConfig,
        DownloadMode,
        Features,
        IterableDataset,
        IterableDatasetDict,
        VerificationMode,
        Version,
        load_dataset,
    )
    from datasets.formatting.formatting import LazyBatch
except ImportError as e:
    raise NotImplementedError("huggingface datasets library is not installed.") from e

try:
    import lancedb
    from lancedb import table  # noqa: F401
except ImportError:
    lancedb = None

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

COLUMN_FRIENDLY_DF_TYPE = False

HF_types = (DatasetDict, Dataset, IterableDatasetDict, IterableDataset)


@dataclasses.dataclass
class HuggingFaceDSLoader(DataLoader):
    """Data loader for hugging face datasets. Uses load_data method."""

    path: str
    dataset_name: Optional[str] = None  # this can't be `name` because it clashes with `.name()`
    data_dir: Optional[str] = None
    data_files: Optional[Union[str, Sequence[str], Mapping[str, Union[str, Sequence[str]]]]] = None
    split: Optional[str] = None
    cache_dir: Optional[str] = None
    features: Optional[Features] = None
    download_config: Optional[DownloadConfig] = None
    download_mode: Optional[Union[DownloadMode, str]] = None
    verification_mode: Optional[Union[VerificationMode, str]] = None
    ignore_verifications = "deprecated"
    keep_in_memory: Optional[bool] = None
    save_infos: bool = False
    revision: Optional[Union[str, Version]] = None
    token: Optional[Union[bool, str]] = None
    use_auth_token = "deprecated"
    task = "deprecated"
    streaming: bool = False
    num_proc: Optional[int] = None
    storage_options: Optional[Dict] = None
    config_kwargs: Optional[Dict] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return list(HF_types)

    def _get_loading_kwargs(self) -> dict:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)
        # we send path separately
        del kwargs["path"]
        config_kwargs: Optional[dict] = kwargs.pop("config_kwargs", None)
        if config_kwargs:
            # add config kwargs as needed.
            kwargs.update(config_kwargs)

        # need to pass in name
        kwargs["name"] = kwargs.pop("dataset_name", None)

        return kwargs

    def load_data(self, type_: Type) -> Tuple[Union[HF_types], Dict[str, Any]]:
        """Loads the data set given the path and class values."""
        ds = load_dataset(self.path, **self._get_loading_kwargs())
        is_dataset = isinstance(ds, Dataset)
        f_meta = {"path": self.path}
        ds_meta = {"rows": ds.num_rows, "columns": ds.column_names}
        if is_dataset:
            ds_meta["size_in_bytes"] = ds.size_in_bytes
            ds_meta["features"] = ds.features.to_dict()
        return ds, {"file_metadata": f_meta, "dataset_metadata": ds_meta}

    @classmethod
    def name(cls) -> str:
        return "hf_dataset"


@dataclasses.dataclass
class HuggingFaceDSParquetSaver(DataSaver):
    """Saves a Huggingface dataset to parquet."""

    path_or_buf: Union[PathLike, BinaryIO]
    batch_size: Optional[int] = None
    parquet_writer_kwargs: Optional[dict] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return list(HF_types)

    @classmethod
    def applies_to(cls, type_: Type[Type]) -> bool:
        return type_ in HF_types

    def _get_saving_kwargs(self) -> dict:
        # Puts kwargs in a dict
        kwargs = dataclasses.asdict(self)
        # we put path_or_buff as a positional argument
        del kwargs["path_or_buf"]
        parquet_writer_kwargs: Optional[dict] = kwargs.pop("parquet_writer_kwargs", None)
        if parquet_writer_kwargs:
            # add config kwargs as needed.
            kwargs.update(parquet_writer_kwargs)

        return kwargs

    def save_data(self, ds: Union[HF_types]) -> Dict[str, Any]:
        """Saves the data to parquet."""
        is_dataset = isinstance(ds, Dataset)
        ds.to_parquet(self.path_or_buf, **self._get_saving_kwargs())
        ds_meta = {
            "rows": ds.num_rows,
            "columns": ds.column_names,
        }
        if is_dataset:
            ds_meta.update({"size_in_bytes": ds.size_in_bytes, "features": ds.features.to_dict()})
        if isinstance(self.path_or_buf, BinaryIO):
            f_meta = {}
        else:
            f_meta = (utils.get_file_metadata(self.path_or_buf),)
        return {"file_metadata": f_meta, "dataset_metadata": ds_meta}

    @classmethod
    def name(cls) -> str:
        return "parquet"


# we do this here just in case lancedb is not installed.
if lancedb is not None:

    def _batch_write(
        dataset_batch: LazyBatch, db: lancedb.DBConnection, table_name: str, columns: str
    ) -> None:
        """Helper function to batch write to lancedb."""
        if columns is None:
            data = dataset_batch.pa_table
        else:
            data = dataset_batch.pa_table.select(columns)
        try:
            db.create_table(table_name, data)
        except (OSError, ValueError):
            tbl = db.open_table(table_name)
            tbl.add(data)
        return None

    @dataclasses.dataclass
    class HuggingFaceDSLanceDBSaver(DataSaver):
        """Data saver that saves Huggingface datasets to lancedb."""

        db_client: lancedb.DBConnection
        table_name: str
        columns_to_write: List[str] = None  # None means all.
        write_batch_size: int = 100

        @classmethod
        def applicable_types(cls) -> Collection[Type]:
            return list(HF_types)

        def save_data(self, ds: Union[HF_types]) -> Dict[str, Any]:
            """This batches writes to lancedb."""
            ds.map(
                _batch_write,
                batched=True,
                batch_size=self.write_batch_size,
                fn_kwargs={
                    "db": self.db_client,
                    "table_name": self.table_name,
                    "columns": self.columns_to_write,
                },
                desc=f"writing to lancedb table {self.table_name}",
            )
            is_dataset = isinstance(ds, Dataset)
            ds_meta = {
                "rows": ds.num_rows,
                "columns": ds.column_names,
            }
            if is_dataset:
                ds_meta.update(
                    {"size_in_bytes": ds.size_in_bytes, "features": ds.features.to_dict()}
                )
            return {"db_meta": {"table_name": self.table_name}, "dataset_metadata": ds_meta}

        @classmethod
        def name(cls) -> str:
            return "lancedb"


def register_data_loaders_savers():
    loaders = [HuggingFaceDSLoader, HuggingFaceDSParquetSaver]
    if lancedb:
        loaders.append(HuggingFaceDSLanceDBSaver)
    for loader in loaders:
        registry.register_adapter(loader)


register_data_loaders_savers()
