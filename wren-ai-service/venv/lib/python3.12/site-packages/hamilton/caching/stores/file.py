import inspect
import shutil
from pathlib import Path
from typing import Any, Optional

try:
    from typing import override
except ImportError:
    override = lambda x: x  # noqa E731

from hamilton.io.data_adapters import DataLoader, DataSaver

from .base import ResultStore, StoredResult


class FileResultStore(ResultStore):
    def __init__(self, path: str, create_dir: bool = True) -> None:
        self.path = Path(path)
        self.create_dir = create_dir

        if self.create_dir:
            self.path.mkdir(exist_ok=True, parents=True)

    def __getstate__(self) -> dict:
        """Serialize the `__init__` kwargs to pass in Parallelizable branches
        when using multiprocessing.
        """
        return {"path": str(self.path)}

    @staticmethod
    def _write_result(file_path: Path, stored_result: StoredResult) -> None:
        file_path.write_bytes(stored_result.save())

    @staticmethod
    def _load_result_from_path(path: Path) -> Optional[StoredResult]:
        try:
            data = path.read_bytes()
            return StoredResult.load(data)
        except FileNotFoundError:
            return None

    def _path_from_data_version(self, data_version: str) -> Path:
        return self.path.joinpath(data_version)

    def _materialized_path(self, data_version: str, saver_cls: DataSaver) -> Path:
        # TODO allow a more flexible mechanism to specify file path extension
        return self._path_from_data_version(data_version).with_suffix(f".{saver_cls.name()}")

    @override
    def exists(self, data_version: str) -> bool:
        result_path = self._path_from_data_version(data_version)
        return result_path.exists()

    @override
    def set(
        self,
        data_version: str,
        result: Any,
        saver_cls: Optional[DataSaver] = None,
        loader_cls: Optional[DataLoader] = None,
    ) -> None:
        # != operator on boolean is XOR
        if bool(saver_cls is not None) != bool(loader_cls is not None):
            raise ValueError(
                "Must pass both `saver` and `loader` or neither. Currently received: "
                f"`saver`: `{saver_cls}`; `loader`: `{loader_cls}`"
            )

        if saver_cls is not None:
            # materialized_path
            materialized_path = self._materialized_path(data_version, saver_cls)
            saver_argspec = inspect.getfullargspec(saver_cls.__init__)
            loader_argspec = inspect.getfullargspec(loader_cls.__init__)
            if "file" in saver_argspec.args:
                saver = saver_cls(file=str(materialized_path.absolute()))
            elif "path" in saver_argspec.args:
                saver = saver_cls(path=str(materialized_path.absolute()))
            else:
                raise ValueError(
                    f"Saver [{saver_cls.name()}] must have either `file` or `path` as an argument."
                )
            if "file" in loader_argspec.args:
                loader = loader_cls(file=str(materialized_path.absolute()))
            elif "path" in loader_argspec.args:
                loader = loader_cls(path=str(materialized_path.absolute()))
            else:
                raise ValueError(
                    f"Loader [{loader_cls.name()}] must have either `file` or `path` as an argument."
                )
        else:
            saver = None
            loader = None

        self.path.mkdir(exist_ok=True)
        result_path = self._path_from_data_version(data_version)
        stored_result = StoredResult.new(value=result, saver=saver, loader=loader)
        self._write_result(result_path, stored_result)

    @override
    def get(self, data_version: str) -> Optional[Any]:
        result_path = self._path_from_data_version(data_version)
        stored_result = self._load_result_from_path(result_path)

        if stored_result is None:
            return None

        return stored_result.value

    @override
    def delete(self, data_version: str) -> None:
        result_path = self._path_from_data_version(data_version)
        result_path.unlink(missing_ok=True)

    @override
    def delete_all(self) -> None:
        shutil.rmtree(self.path)
        self.path.mkdir(exist_ok=True)

    def delete_expired(self) -> None:
        for file_path in self.path.iterdir():
            stored_result = self._load_result_from_path(file_path)
            if stored_result and stored_result.expired:
                file_path.unlink(missing_ok=True)
