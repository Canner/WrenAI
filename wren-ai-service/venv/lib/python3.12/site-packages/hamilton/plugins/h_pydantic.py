from typing import List

from pydantic import BaseModel

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
        """Specific output-checker for pydantic models (requires ``pydantic>=2.0``).
        This decorator utilizes the output type of the function, which can be any subclass of pydantic.BaseModel.
        The function output must be declared with a type hint.

        :param model: The pydantic model to use for validation. If this is not provided, then the output type of the function is used.
        :param importance: Importance level (either "warn" or "fail") -- see documentation for check_output for more details.
        :param target: The target of the decorator -- see documentation for check_output for more details.

        Here is an example of how to use this decorator with a function that returns a pydantic model:

        .. code-block:: python

            from hamilton.plugins import h_pydantic
            from pydantic import BaseModel

            class MyModel(BaseModel):
                a: int
                b: float
                c: str

            @h_pydantic.check_output()
            def foo() -> MyModel:
                return MyModel(a=1, b=2.0, c="hello")

        Alternatively, you can return a dictionary from the function (type checkers will probably
        complain about this):

        .. code-block:: python

            from hamilton.plugins import h_pydantic
            from pydantic import BaseModel

            class MyModel(BaseModel):
                a: int
                b: float
                c: str

            @h_pydantic.check_output()
            def foo() -> MyModel:
                return {"a": 1, "b": 2.0, "c": "hello"}

        You can also use pydantic validation through ``function_modifiers.check_output`` by
        providing the model as an argument:

        .. code-block:: python

            from typing import Any

            from hamilton import function_modifiers
            from pydantic import BaseModel

            class MyModel(BaseModel):
                a: int
                b: float
                c: str

            @function_modifiers.check_output(model=MyModel)
            def foo() -> dict[str, Any]:
                return {"a": 1, "b": 2.0, "c": "hello"}

        Note, that because we do not (yet) support modification of the output, the validation is
        performed in strict mode, meaning that no data coercion is performed. For example, the
        following function will *fail* validation:

        .. code-block:: python

            from hamilton.plugins import h_pydantic
            from pydantic import BaseModel

            class MyModel(BaseModel):
                a: int  # Defined as an int

            @h_pydantic.check_output()  # This will fail validation!
            def foo() -> MyModel:
                return MyModel(a="1")  # Assigned as a string

        For more information about strict mode see the pydantic docs: https://docs.pydantic.dev/latest/concepts/strict_mode/

        """
        super(check_output, self).__init__(target)
        self.importance = importance
        self.target = target

    def get_validators(self, node_to_validate: node.Node) -> List[dq_base.DataValidator]:
        output_type = node_to_validate.type
        if not custom_subclass_check(output_type, BaseModel):
            raise InvalidDecoratorException(
                f"Output of function {node_to_validate.name} must be a Pydantic model"
            )
        return base_check_output(
            importance=self.importance, model=output_type, target_=self.target
        ).get_validators(node_to_validate)
