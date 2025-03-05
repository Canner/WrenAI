import typing
from typing import List

import pandera
from pandera import typing as pa_typing

from hamilton import node
from hamilton.data_quality import base as dq_base
from hamilton.function_modifiers import InvalidDecoratorException
from hamilton.function_modifiers import base as fm_base
from hamilton.function_modifiers import check_output as base_check_output
from hamilton.function_modifiers.validation import BaseDataValidationDecorator
from hamilton.htypes import custom_subclass_check


class check_output(BaseDataValidationDecorator):
    def __init__(
        self,
        importance: str = dq_base.DataValidationLevel.WARN.value,
        target: fm_base.TargetType = None,
    ):
        """Specific output-checker for pandera schemas. This decorator utilizes the output type of the function, which has
        to be of type pandera.typing.pandas.DataFrame or pandera.typing.pandas.Series, with an annotation argument.

        :param schema: The schema to use for validation. If this is not provided, then the output type of the function is used.
        :param importance: Importance level (either "warn" or "fail") -- see documentation for check_output for more details.
        :param target: The target of the decorator -- see documentation for check_output for more details.

        Let's look at equivalent examples to demonstrate:

        .. code-block:: python
            :name: "@check_output using output type"

            import pandera as pa
            import pandas as pd
            from hamilton.plugins import h_pandera
            from pandera.typing.pandas import DataFrame


            class MySchema(pa.DataFrameModel):
                a: int
                b: float
                c: str = pa.Field(nullable=True)  # For example, allow None values
                d: float  # US dollars


            @h_pandera.check_output()
            def foo() -> DataFrame[MySchema]:
                return pd.DataFrame()  # will fail

        .. code-block:: python
            :name: "@check_output with passed in type"

            from hamilton import function_modifiers

            schema = pa.DataFrameSchema({
                "a": pa.Column(pa.Int),
                "b": pa.Column(pa.Float),
                "c": pa.Column(pa.String, nullable=True),
                "d": pa.Column(pa.Float),
            })


            @function_modifiers.check_output(schema=schema)
            def foo() -> pd.DataFrame:
                return pd.DataFrame()  # will fail

        These two are functionally equivalent. Note that we do not (yet) support modification of the output.
        """
        super(check_output, self).__init__(target)
        self.importance = importance
        self.target = target

    def get_validators(self, node_to_validate: node.Node) -> List[dq_base.DataValidator]:
        """Gets validators for the node. Delegates to the standard check_output(schema=...) decorator.

        :param node_to_validate: Node to validate
        :return: List of validators
        """
        output_type = node_to_validate.type
        schema = None
        origin = typing.get_origin(output_type)
        args = typing.get_args(output_type)
        if custom_subclass_check(origin, pa_typing.DataFrame) and len(args) == 1:
            schema = output_type.__args__[0]  # TODO -- determine if it can ever have multiple...
            if not issubclass(schema, pandera.DataFrameModel):
                schema = None

        if schema is None:
            raise InvalidDecoratorException(
                f"Output type {output_type} is not a valid pandera schema. "
                f"Note that we currently only support pandera dataframes annotated with "
                f"subclasses of pandera.DataFrameModel. Please reach out/open an issue "
                f"if you want more complete integration."
            )

        # We can just delegate to teh standard check_output, which has pandera associated with schema...
        # This is a clever way of reusing as much code as possible
        return base_check_output(
            importance=self.importance, schema=schema, target_=self.target
        ).get_validators(node_to_validate)
