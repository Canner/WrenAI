from typing import Any, Type

from hamilton.data_quality import base, default_validators
from hamilton.htypes import custom_subclass_check

try:
    import pydantic  # noqa: F401
except ModuleNotFoundError as e:
    raise NotImplementedError(
        "Cannot import `pydantic` from `pydantic_validators`. Run pip install 'sf-hamilton[pydantic]' if needed."
    ) from e

try:
    from pydantic import BaseModel, TypeAdapter, ValidationError
except ImportError as e:
    raise NotImplementedError(
        "`pydantic>=2.0` required to use `pydantic_validators`. Run pip install 'sf-hamilton[pydantic]' if needed."
    ) from e


COLUMN_FRIENDLY_DF_TYPE = False


class PydanticModelValidator(base.BaseDefaultValidator):
    """Pydantic model compatibility validator (requires ``pydantic>=2.0``)

    Note that this validator uses pydantic's strict mode, which does not allow for
    coercion of data. This means that if an object does not exactly match the reference
    type, it will fail validation, regardless of whether it could be coerced into the
    correct type.

    :param model: Pydantic model to validate against
    :param importance: Importance of the validator, possible values "warn" and "fail"
    :param arbitrary_types_allowed: Whether arbitrary types are allowed in the model
    """

    def __init__(self, model: Type[BaseModel], importance: str):
        super(PydanticModelValidator, self).__init__(importance)
        self.model = model
        self._model_adapter = TypeAdapter(model)

    @classmethod
    def applies_to(cls, datatype: Type[Type]) -> bool:
        # In addition to checking for a subclass of BaseModel, we also check for dict
        # as this is the standard 'de-serialized' format of pydantic models in python
        return custom_subclass_check(datatype, BaseModel) or custom_subclass_check(datatype, dict)

    def description(self) -> str:
        return "Validates that the returned object is compatible with the specified pydantic model"

    def validate(self, data: Any) -> base.ValidationResult:
        try:
            # Currently, validate can not alter the output data, so we must use
            # strict=True. The downside to this is that data that could be coerced
            # into the correct type will fail validation.
            self._model_adapter.validate_python(data, strict=True)
        except ValidationError as e:
            return base.ValidationResult(
                passes=False, message=str(e), diagnostics={"model_errors": e.errors()}
            )
        return base.ValidationResult(
            passes=True,
            message=f"Data passes pydantic check for model {str(self.model)}",
        )

    @classmethod
    def arg(cls) -> str:
        return "model"

    @classmethod
    def name(cls) -> str:
        return "pydantic_validator"


def register_validators():
    """Utility method to append pydantic validators as needed"""
    validators = [PydanticModelValidator]
    default_validators.AVAILABLE_DEFAULT_VALIDATORS.extend(validators)


register_validators()
