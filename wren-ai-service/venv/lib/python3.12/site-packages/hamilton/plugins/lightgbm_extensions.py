import dataclasses
from pathlib import Path
from typing import Any, Collection, Dict, Literal, Optional, Tuple, Type, Union

try:
    import lightgbm
except ImportError as e:
    raise NotImplementedError("LightGBM is not installed.") from e


from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver

LIGHTGBM_MODEL_TYPES = [lightgbm.LGBMModel, lightgbm.Booster, lightgbm.CVBooster]
LIGHTGBM_MODEL_TYPES_ANNOTATION = Union[lightgbm.LGBMModel, lightgbm.Booster, lightgbm.CVBooster]


@dataclasses.dataclass
class LightGBMFileWriter(DataSaver):
    """Write LighGBM models and boosters to a file"""

    path: Union[str, Path]
    num_iteration: Optional[int] = None
    start_iteration: int = 0
    importance_type: Literal["split", "gain"] = "split"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return LIGHTGBM_MODEL_TYPES

    def save_data(self, data: LIGHTGBM_MODEL_TYPES_ANNOTATION) -> Dict[str, Any]:
        if isinstance(data, lightgbm.LGBMModel):
            data = data.booster_

        data.save_model(
            filename=self.path,
            num_iteration=self.num_iteration,
            start_iteration=self.start_iteration,
            importance_type=self.importance_type,
        )
        return utils.get_file_metadata(self.path)

    @classmethod
    def name(cls) -> str:
        return "file"


@dataclasses.dataclass
class LightGBMFileReader(DataLoader):
    """Load LighGBM models and boosters from a file"""

    path: Union[str, Path]

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return LIGHTGBM_MODEL_TYPES

    def load_data(
        self, type_: Type
    ) -> Tuple[Union[lightgbm.Booster, lightgbm.CVBooster], Dict[str, Any]]:
        model = type_(model_file=self.path)
        metadata = utils.get_file_metadata(self.path)
        return model, metadata

    @classmethod
    def name(cls) -> str:
        return "file"


def register_data_loaders():
    for loader in [
        LightGBMFileReader,
        LightGBMFileWriter,
    ]:
        registry.register_adapter(loader)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
