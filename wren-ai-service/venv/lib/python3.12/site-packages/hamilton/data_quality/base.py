import abc
import dataclasses
import enum
import logging
from typing import Any, Dict, List, Tuple, Type

logger = logging.getLogger(__name__)


class DataValidationError(Exception):
    pass


class DataValidationLevel(enum.Enum):
    WARN = "warn"
    FAIL = "fail"


@dataclasses.dataclass
class ValidationResult:
    passes: bool  # Whether or not this passed the validation
    message: str  # Error message or success message
    diagnostics: Dict[str, Any] = dataclasses.field(
        default_factory=dict
    )  # Any extra diagnostics information needed, free-form


class DataValidator(abc.ABC):
    """Base class for a data quality operator. This will be used by the `data_quality` operator"""

    def __init__(self, importance: str):
        self._importance = DataValidationLevel(importance)

    @property
    def importance(self) -> DataValidationLevel:
        return self._importance

    @abc.abstractmethod
    def applies_to(self, datatype: Type[Type]) -> bool:
        """Whether or not this data validator can apply to the specified dataset

        :param datatype:
        :return: True if it can be run on the specified type, false otherwise
        """
        pass

    @abc.abstractmethod
    def description(self) -> str:
        """Gives a description of this validator. E.G.
        `Checks whether the entire dataset lies between 0 and 1.`
        Note it should be able to access internal state (E.G. constructor arguments).
        :return: The description of the validator as a string
        """
        pass

    @classmethod
    @abc.abstractmethod
    def name(cls) -> str:
        """Returns the name for this validator."""

    @abc.abstractmethod
    def validate(self, dataset: Any) -> ValidationResult:
        """Actually performs the validation. Note when you

        :param dataset: dataset to validate
        :return: The result of validation
        """
        pass


def act_warn(node_name: str, validation_result: ValidationResult, validator: DataValidator):
    """This is the current default for acting on the validation result when you want to warn.
    Note that we might move this at some point -- we'll want to make it configurable. But for now, this
    seems like a fine place to put it.

    :param node_name: the name of the node we are validating.
    :param validation_result:  the result
    :param validator: the validator object.
    """
    if not validation_result.passes:
        logger.warning(_create_error_string(node_name, validation_result, validator))


def _create_error_string(node_name, validation_result, validator):
    return (
        f"[{node_name}:{validator.name()}] validator failed. Message was: {validation_result.message}. "
        f"Diagnostic information is: {validation_result.diagnostics}."
    )


def act_fail_bulk(node_name: str, failures: List[Tuple[ValidationResult, DataValidator]]):
    """This is the current default for acting on the validation result when you want to fail.
    Note that we might move this at some point -- we'll want to make it configurable. But for now, this
    seems like a fine place to put it.
    :param node_name: the name of the node we are validating.
    :param failures: list of tuples of (validation_result, validator)
    :raises DataValidationError: if there are errors detected.
    """
    error_messages = []
    for validation_result, validator in failures:
        if not validation_result.passes:
            message = f"{_create_error_string(node_name, validation_result, validator)}\n"
            logger.error(message)  # log here so things print nicely at least
            error_messages.append(message)
    if error_messages:
        raise DataValidationError(error_messages)


class BaseDefaultValidator(DataValidator, abc.ABC):
    """Base class for a default validator.
    These are all validators that utilize a single argument to be passed to the decorator check_output.
    check_output can thus delegate to multiple of these. This is an internal abstraction to allow for easy
    creation of validators.
    """

    def __init__(self, importance: str):
        super(BaseDefaultValidator, self).__init__(importance)

    @classmethod
    @abc.abstractmethod
    def applies_to(cls, datatype: Type[Type]) -> bool:
        pass

    @abc.abstractmethod
    def description(self) -> str:
        pass

    @abc.abstractmethod
    def validate(self, data: Any) -> ValidationResult:
        pass

    @classmethod
    @abc.abstractmethod
    def arg(cls) -> str:
        """Yields a string that represents this validator's argument.
        @check_output() will be passed a series of kwargs, each one of which will correspond to
        one of these default validators. Note that we have the limitation of allowing just a single
        argument.

        :return: The argument that this needs.
        """
        pass

    @classmethod
    def name(cls) -> str:
        return f"{cls.arg()}_validator"
