import abc
from typing import Any, Dict, List

import pandas as pd


class DynamicTransformBase(abc.ABC):
    """Abstract class for a dynamic transform transform as seen by hamilton.
    These are transforms that come from configuration parameters, and define the following:
    1. The nodes that they depend on
    2. What the transform does

    Paired with the decorator @dynamic_transform(CLS, config_item, **extra_params) one can write incredibly powerful
    DAGs that depend on dynamic transform configs.
    """

    def __init__(self, config_parameters: Any, name: str):
        self._config_parameters = config_parameters
        self._name = name

    @abc.abstractmethod
    def get_dependents(self) -> List[str]:
        """Gets the names/types of the inputs to this transform.
        :return: A list of columns on which this model depends.
        """
        pass

    @abc.abstractmethod
    def compute(self, **inputs: Any) -> Any:
        """Runs a computation based on a set of input values.
        :param inputs: data that are inputs to the transform
        :return: The result of the transform.
        """
        pass

    @property
    def config_parameters(self) -> Dict[str, Any]:
        """Accessor for configuration parameters"""
        return self._config_parameters

    @property
    def name(self) -> str:
        return self._name


# Maintained for backwards compatibility
# Will likely keep this in some way, but might change the name or the approach
# with the 2.0 release
class BaseModel(DynamicTransformBase, abc.ABC):
    """Base classes for models in hamilton
    We define a model as anything whose inputs are configuration-driven.
    The goal of this is to allow users to write something like:

    @model(...)
    def my_column():
        #column that is some combinations of other columns using some previously trained model

    Note that the model-training is not yet in scope."""

    def compute(self, **inputs: Any) -> Any:
        """Delegates to predict function to compute this model's return.

        :param inputs: Inputs for the model
        :return: The result of calling the model.
        """
        return self.predict(**inputs)

    @abc.abstractmethod
    def predict(self, **inputs: pd.Series) -> pd.Series:
        """Runs the predict() function on the model, given the set of kwargs.
        :param inputs: Inputs to the model.
        :return: A series representing the output of the model.
        """

        pass
