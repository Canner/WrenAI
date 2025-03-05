import dataclasses
from typing import Any, Collection, Dict, Iterable, Literal, Optional, Sequence, Tuple, Type

try:
    import dlt
    from dlt.common.destination.capabilities import TLoaderFileFormat
    from dlt.common.schema import Schema, TColumnSchema

    # importing TDestinationReferenceArg fails if Destination isn't imported
    from dlt.extract.resource import DltResource

except ImportError as e:
    # raise import error first
    raise ImportError(f"Failed to import the DLT library. {e}") from e
except Exception as e:
    # raise import error with custom message
    raise ImportError("Failed to import the DLT library.") from e

import pandas as pd

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

DATAFRAME_TYPES = [Iterable, pd.DataFrame]

# TODO add types for other Dataframe libraries
try:
    import pyarrow as pa

    DATAFRAME_TYPES.extend([pa.Table, pa.RecordBatch])
except ModuleNotFoundError:
    pass

# convert to tuple to dynamically define type `Union[DATAFRAME_TYPES]`
DATAFRAME_TYPES = tuple(DATAFRAME_TYPES)
COLUMN_FRIENDLY_DF_TYPE = False


@dataclasses.dataclass
class DltResourceLoader(DataLoader):
    resource: DltResource

    @classmethod
    def name(cls) -> str:
        return "dlt"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [pd.DataFrame]

    def load_data(self, type_: Type) -> Tuple[pd.DataFrame, Dict[str, Any]]:
        """Creates a pipeline and conduct `extract` and `normalize` steps.
        Then, "load packages" are read with pandas
        """
        pipeline = dlt.pipeline(
            pipeline_name="Hamilton-DltResourceLoader", destination="filesystem"
        )
        pipeline.extract(self.resource)
        normalize_info = pipeline.normalize(loader_file_format="parquet")

        partition_file_paths = []
        package = normalize_info.load_packages[0]
        for job in package.jobs["new_jobs"]:
            if job.job_file_info.table_name == self.resource.name:
                partition_file_paths.append(job.file_path)

        # TODO use pyarrow directly to support different dataframe libraries
        # ref: https://github.com/dlt-hub/verified-sources/blob/master/sources/filesystem/readers.py
        # ref: https://arrow.apache.org/docs/python/generated/pyarrow.parquet.ParquetDataset.html#pyarrow.parquet.ParquetDataset
        df = pd.concat([pd.read_parquet(f) for f in partition_file_paths], ignore_index=True)

        # delete the pipeline
        pipeline.drop()

        metadata = utils.get_dataframe_metadata(df)
        return df, metadata


# TODO handle behavior with `combine=`, currently only supports materializing a single node
@dataclasses.dataclass
class DltDestinationSaver(DataSaver):
    """Materialize results using a dlt pipeline with the specified destination.

    In reference to an Extract, Transform, Load (ETL) pipeline, here, the Hamilton
    dataflow is responsible for Transform, and `DltDestination` for Load.
    """

    pipeline: dlt.Pipeline
    table_name: str
    primary_key: Optional[str] = None
    write_disposition: Optional[Literal["skip", "append", "replace", "merge"]] = None
    columns: Optional[Sequence[TColumnSchema]] = None
    schema: Optional[Schema] = None
    loader_file_format: Optional[TLoaderFileFormat] = None

    @classmethod
    def name(cls) -> str:
        return "dlt"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return DATAFRAME_TYPES

    def _get_kwargs(self) -> dict:
        kwargs = {}
        fields_to_skip = ["pipeline"]
        for field in dataclasses.fields(self):
            field_value = getattr(self, field.name)
            if field.name in fields_to_skip:
                continue

            if field_value != field.default:
                kwargs[field.name] = field_value

        return kwargs

    # TODO get pyarrow table from polars, dask, etc.
    def save_data(self, data) -> Dict[str, Any]:
        """
        ref: https://dlthub.com/docs/dlt-ecosystem/verified-sources/arrow-pandas
        """
        if isinstance(data, dict):
            raise NotImplementedError(
                "DltDestinationSaver received data of type `dict`."
                "Currently, it doesn't support specifying `combine=base.DictResult()`"
            )

        load_info = self.pipeline.run(data, **self._get_kwargs())
        # follows the pattern of metadata output found in hamilton.io.utils
        return {"dlt_metadata": load_info.asdict()}


def register_data_loaders():
    """Function to register the data loaders for this extension."""
    for loader in [
        DltDestinationSaver,
        DltResourceLoader,
    ]:
        registry.register_adapter(loader)


register_data_loaders()
