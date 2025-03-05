import dataclasses
import pathlib
from typing import IO, Any, Collection, Dict, Optional, Tuple, Type, Union

try:
    import numpy as np
except ImportError as e:
    raise NotImplementedError("Numpy is not installed.") from e

from typing import Literal

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataLoader, DataSaver


@dataclasses.dataclass
class NumpyNpyWriter(DataSaver):
    """Write Numpy multidimensional arrays to custom .npy format
    ref: https://numpy.org/doc/stable/reference/routines.io.html
    """

    path: Union[str, pathlib.Path, IO]
    allow_pickle: Optional[bool] = None
    fix_imports: Optional[bool] = None

    def save_data(self, data: np.ndarray) -> Dict[str, Any]:
        np.save(
            file=self.path,
            arr=data,
            allow_pickle=self.allow_pickle,
            fix_imports=self.fix_imports,
        )
        return utils.get_file_metadata(self.path)

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [np.ndarray]

    @classmethod
    def name(cls) -> str:
        return "npy"


@dataclasses.dataclass
class NumpyNpyReader(DataLoader):
    """Read Numpy multidimensional arrays from custom .npy format
    ref: https://numpy.org/doc/stable/reference/routines.io.html
    """

    path: Union[str, pathlib.Path, IO]
    mmap_mode: Optional[str] = None
    allow_pickle: Optional[bool] = None
    fix_imports: Optional[bool] = None
    encoding: Literal["ASCII", "latin1", "bytes"] = "ASCII"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [np.ndarray]

    def load_data(self, type_: Type) -> Tuple[np.ndarray, Dict[str, Any]]:
        array = np.load(
            file=self.path,
            mmap_mode=self.mmap_mode,
            allow_pickle=self.allow_pickle,
            fix_imports=self.fix_imports,
            encoding=self.encoding,
        )
        metadata = utils.get_file_metadata(self.path)
        return array, metadata

    @classmethod
    def name(cls) -> str:
        return "npy"


def register_data_loaders():
    for loader in [
        NumpyNpyWriter,
        NumpyNpyReader,
    ]:
        registry.register_adapter(loader)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
