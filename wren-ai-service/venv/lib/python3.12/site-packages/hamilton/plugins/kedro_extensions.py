import dataclasses
from typing import Any, Collection, Dict, Optional, Tuple, Type

from kedro.io import DataCatalog

from hamilton import registry
from hamilton.io.data_adapters import DataLoader, DataSaver


@dataclasses.dataclass
class KedroSaver(DataSaver):
    """Use Kedro DataCatalog and Dataset to save results
    ref: https://docs.kedro.org/en/stable/data/advanced_data_catalog_usage.html

    .. code-block:: python

        from kedro.framework.session import KedroSession

        with KedroSession.create() as session:
            context = session.load_context()
            catalog = context.catalog

        dr.materialize(
            to.kedro(
                id="my_dataset__kedro",
                dependencies=["my_dataset"],
                dataset_name="my_dataset",
                catalog=catalog,
            )
        )
    """

    dataset_name: str
    catalog: DataCatalog

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [Any]

    def save_data(self, data: Any) -> Dict[str, Any]:
        self.catalog.save(name=self.dataset_name, data=data)
        return dict(success=True)

    @classmethod
    def name(cls) -> str:
        return "kedro"


@dataclasses.dataclass
class KedroLoader(DataLoader):
    """Use Kedro DataCatalog and Dataset to load data
    ref: https://docs.kedro.org/en/stable/data/advanced_data_catalog_usage.html

    .. code-block:: python

        from kedro.framework.session import KedroSession

        with KedroSession.create() as session:
            context = session.load_context()
            catalog = context.catalog

        dr.materialize(
            from_.kedro(
                target="input_table",
                dataset_name="input_table",
                catalog=catalog
            )
        )
    """

    dataset_name: str
    catalog: DataCatalog
    version: Optional[str] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [Any]

    def load_data(self, type_: Type) -> Tuple[Any, Dict[str, Any]]:
        data = self.catalog.load(name=self.dataset_name, version=self.version)
        metadata = dict(dataset_name=self.dataset_name, version=self.version)
        return data, metadata

    @classmethod
    def name(cls) -> str:
        return "kedro"


def register_data_loaders():
    for loader in [
        KedroSaver,
        KedroLoader,
    ]:
        registry.register_adapter(loader)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
