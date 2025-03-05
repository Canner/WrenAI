import dataclasses
from os import PathLike
from typing import Any, Collection, Dict, Tuple, Type, Union

try:
    import xgboost
except ImportError as e:
    raise NotImplementedError("XGBoost is not installed.") from e


from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

XGBOOST_MODEL_TYPES = [xgboost.XGBModel, xgboost.Booster]
XGBOOST_MODEL_TYPES_ANNOTATION = Union[xgboost.XGBModel, xgboost.Booster]


@dataclasses.dataclass
class XGBoostJsonWriter(DataSaver):
    """Write XGBoost models and boosters to json format
    See differences with pickle format: https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html
    """

    path: Union[str, PathLike]

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return XGBOOST_MODEL_TYPES

    def save_data(self, data: XGBOOST_MODEL_TYPES_ANNOTATION) -> Dict[str, Any]:
        data.save_model(self.path)
        return utils.get_file_metadata(self.path)

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class XGBoostJsonReader(DataLoader):
    """Load XGBoost models and boosters to json format
    See differences with pickle format: https://xgboost.readthedocs.io/en/stable/tutorials/saving_model.html
    """

    path: Union[str, bytearray, PathLike]

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return XGBOOST_MODEL_TYPES

    def load_data(self, type_: Type) -> Tuple[XGBOOST_MODEL_TYPES_ANNOTATION, Dict[str, Any]]:
        model = type_()
        model.load_model(self.path)
        metadata = utils.get_file_metadata(self.path)
        return model, metadata

    @classmethod
    def name(cls) -> str:
        return "json"


def register_data_loaders():
    for loader in [
        XGBoostJsonReader,
        XGBoostJsonWriter,
    ]:
        registry.register_adapter(loader)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
