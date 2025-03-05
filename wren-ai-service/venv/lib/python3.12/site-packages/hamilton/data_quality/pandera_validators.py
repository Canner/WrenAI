from typing import Any, Type

import pandera as pa

from hamilton import registry
from hamilton.data_quality import base
from hamilton.htypes import custom_subclass_check

pandera_supported_extensions = frozenset(["pandas", "dask", "pyspark_pandas", "polars"])


class PanderaDataFrameValidator(base.BaseDefaultValidator):
    """Pandera schema validator for dataframes"""

    def __init__(self, schema: pa.DataFrameSchema, importance: str):
        super(PanderaDataFrameValidator, self).__init__(importance)
        self.schema = schema

    @classmethod
    def applies_to(cls, datatype: Type[Type]) -> bool:
        for extension_name in pandera_supported_extensions:
            if extension_name in registry.DF_TYPE_AND_COLUMN_TYPES:
                df_type = registry.DF_TYPE_AND_COLUMN_TYPES[extension_name][registry.DATAFRAME_TYPE]
                result = custom_subclass_check(datatype, df_type)
                if result:
                    return True
        return False

    def description(self) -> str:
        return "Validates that the returned dataframe matches the pander"

    def validate(self, data: Any) -> base.ValidationResult:
        try:
            result = self.schema.validate(data, lazy=True, inplace=True)
            if hasattr(result, "dask"):
                result.compute()
        except pa.errors.SchemaErrors as e:
            return base.ValidationResult(
                passes=False,
                message=str(e),
                diagnostics={"schema_errors": e.schema_errors},
            )
        return base.ValidationResult(
            passes=True,
            message=f"Data passes pandera check for schema {str(self.schema)}",
            # TDOO -- add diagnostics data with serialized the schema
        )

    @classmethod
    def arg(cls) -> str:
        return "schema"  # TODO -- determine whether we want to allow other schemas

    @classmethod
    def name(cls) -> str:
        return "pandera_schema_validator"


class PanderaSeriesSchemaValidator(base.BaseDefaultValidator):
    """Pandera schema validator for series"""

    def __init__(self, schema: pa.SeriesSchema, importance: str):
        super(PanderaSeriesSchemaValidator, self).__init__(importance)
        self.schema = schema

    @classmethod
    def applies_to(cls, datatype: Type[Type]) -> bool:
        for extension_name in pandera_supported_extensions:
            if extension_name in registry.DF_TYPE_AND_COLUMN_TYPES:
                df_type = registry.DF_TYPE_AND_COLUMN_TYPES[extension_name][registry.COLUMN_TYPE]
                result = custom_subclass_check(datatype, df_type)
                if result:
                    return True
        return False

    def description(self) -> str:
        pass

    def validate(self, data: Any) -> base.ValidationResult:
        try:
            result = self.schema.validate(data, lazy=True, inplace=True)
            if hasattr(result, "dask"):
                result.compute()
        except pa.errors.SchemaErrors as e:
            return base.ValidationResult(
                passes=False,
                message=str(e),
                diagnostics={"schema_errors": e.schema_errors},
            )
        return base.ValidationResult(
            passes=True,
            message=f"Data passes pandera check for schema {str(self.schema)}",
            # TDOO -- add diagnostics data with serialized the schema
        )

    @classmethod
    def arg(cls) -> str:
        return "schema"  # TODO -- determine whether we want to allow other schemas

    @classmethod
    def name(cls) -> str:
        return "pandera_schema_validator"


PANDERA_VALIDATORS = [PanderaDataFrameValidator, PanderaSeriesSchemaValidator]
