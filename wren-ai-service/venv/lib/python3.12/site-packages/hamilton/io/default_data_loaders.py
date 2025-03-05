import dataclasses
import io
import json
import os
import pathlib
import pickle
from typing import Any, Collection, Dict, Tuple, Type, Union

from hamilton.io.data_adapters import DataLoader, DataSaver
from hamilton.io.utils import get_file_metadata


@dataclasses.dataclass
class JSONDataLoader(DataLoader):
    path: str

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [dict, list]

    def load_data(self, type_: Type) -> Tuple[dict, Dict[str, Any]]:
        with open(self.path, "r") as f:
            return json.load(f), get_file_metadata(self.path)

    @classmethod
    def name(cls) -> str:
        return "json"


@dataclasses.dataclass
class JSONDataSaver(DataSaver):
    path: str

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [dict, list]

    @classmethod
    def name(cls) -> str:
        return "json"

    def save_data(self, data: Any) -> Dict[str, Any]:
        with open(self.path, "w") as f:
            json.dump(data, f)
        return get_file_metadata(self.path)


@dataclasses.dataclass
class RawFileDataLoader(DataLoader):
    path: str
    encoding: str = "utf-8"

    def load_data(self, type_: Type) -> Tuple[str, Dict[str, Any]]:
        with open(self.path, "r", encoding=self.encoding) as f:
            return f.read(), get_file_metadata(self.path)

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [str]

    @classmethod
    def name(cls) -> str:
        return "file"


@dataclasses.dataclass
class RawFileDataSaver(DataSaver):
    path: str
    encoding: str = "utf-8"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [str]

    @classmethod
    def name(cls) -> str:
        return "file"

    def save_data(self, data: Any) -> Dict[str, Any]:
        with open(self.path, "w", encoding=self.encoding) as f:
            f.write(data)
        return get_file_metadata(self.path)


@dataclasses.dataclass
class RawFileDataSaverBytes(DataSaver):
    path: Union[pathlib.Path, str]

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [bytes, io.BytesIO]

    @classmethod
    def name(cls) -> str:
        return "file"

    def save_data(self, data: Union[bytes, io.BytesIO]) -> Dict[str, Any]:
        if isinstance(data, io.BytesIO):
            data_bytes = data.getvalue()  # Extract bytes from BytesIO
        else:
            data_bytes = data

        with open(self.path, "wb") as file:
            file.write(data_bytes)

        return get_file_metadata(str(self.path))


@dataclasses.dataclass
class PickleLoader(DataLoader):
    path: str

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [object, Any]

    @classmethod
    def name(cls) -> str:
        return "pickle"

    def load_data(self, type_: Type[object]) -> Tuple[object, Dict[str, Any]]:
        with open(self.path, "rb") as f:
            return pickle.load(f), get_file_metadata(self.path)


@dataclasses.dataclass
class PickleSaver(DataSaver):
    path: str

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [object]

    @classmethod
    def name(cls) -> str:
        return "pickle"

    def save_data(self, data: Any) -> Dict[str, Any]:
        with open(self.path, "wb") as f:
            pickle.dump(data, f)
        return get_file_metadata(self.path)


@dataclasses.dataclass
class EnvVarDataLoader(DataLoader):
    names: Tuple[str, ...]

    def load_data(self, type_: Type[dict]) -> Tuple[dict, Dict[str, Any]]:
        return {name: os.environ[name] for name in self.names}, {}

    @classmethod
    def name(cls) -> str:
        return "environment"

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [dict]


@dataclasses.dataclass
class LiteralValueDataLoader(DataLoader):
    value: Any

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [Any]

    def load_data(self, type_: Type) -> Tuple[dict, Dict[str, Any]]:
        return self.value, {}

    @classmethod
    def name(cls) -> str:
        return "literal"


@dataclasses.dataclass
class InMemoryResult(DataSaver):
    """Class specifically to returning an in memory result without saving it anywhere.

    Use this to get the result of a combiner easily; depends on their use.
    """

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [Any]

    def save_data(self, data: Any) -> Any:
        return data

    @classmethod
    def name(cls) -> str:
        return "memory"


DATA_ADAPTERS = [
    JSONDataSaver,
    JSONDataLoader,
    LiteralValueDataLoader,
    RawFileDataLoader,
    RawFileDataSaver,
    RawFileDataSaverBytes,
    PickleLoader,
    PickleSaver,
    EnvVarDataLoader,
    InMemoryResult,
]
