import dataclasses
import pathlib
from typing import IO, Any, Collection, Dict, List, Optional, Type, Union

try:
    import plotly.graph_objects
except ImportError as e:
    raise NotImplementedError("Plotly is not installed.") from e

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataSaver


@dataclasses.dataclass
class PlotlyStaticWriter(DataSaver):
    """Write Plotly figure as static image format
    ref: https://plotly.com/python/static-image-export/
    """

    path: Union[str, pathlib.Path, IO]
    format: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    scale: Optional[Union[int, float]] = None
    validate: bool = True
    engine: str = "auto"

    def _get_saving_kwargs(self) -> dict:
        kwargs = {}
        if self.format is not None:
            kwargs["format"] = self.format
        if self.width is not None:
            kwargs["width"] = self.width
        if self.height is not None:
            kwargs["height"] = self.height
        if self.scale is not None:
            kwargs["scale"] = self.scale
        if self.validate is not None:
            kwargs["validate"] = self.validate
        if self.engine is not None:
            kwargs["engine"] = self.engine

        return kwargs

    def save_data(self, data: plotly.graph_objects.Figure) -> Dict[str, Any]:
        data.write_image(file=self.path, **self._get_saving_kwargs())
        return utils.get_file_metadata(self.path)

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [plotly.graph_objects.Figure]

    @classmethod
    def name(cls) -> str:
        return "plotly"


@dataclasses.dataclass
class PlotlyInteractiveWriter(DataSaver):
    """Write Plotly figure as interactive HTML + JS
    ref: https://plotly.com/python/interactive-html-export/
    """

    path: Union[str, pathlib.Path, IO]
    config: Optional[Dict] = None
    auto_play: bool = True
    include_plotlyjs: Union[bool, str] = (
        True  # or "cdn", "directory", "require", "False", "other string .js"
    )
    include_mathjax: Union[bool, str] = False  # "cdn", "string .js"
    post_script: Union[str, List[str], None] = None
    full_html: bool = True
    animation_opts: Optional[Dict] = None
    default_width: Union[int, float, str] = "100%"
    default_height: Union[int, float, str] = "100%"
    validate: bool = True
    auto_open: bool = True
    div_id: Optional[str] = None

    def _get_saving_kwargs(self) -> dict:
        kwargs = {}
        if self.config is not None:
            kwargs["config"] = self.config
        if self.auto_play is not None:
            kwargs["auto_play"] = self.auto_play
        if self.include_plotlyjs is not None:
            kwargs["include_plotlyjs"] = self.include_plotlyjs
        if self.include_mathjax is not None:
            kwargs["include_mathjax"] = self.include_mathjax
        if self.post_script is not None:
            kwargs["post_script"] = self.post_script
        if self.full_html is not None:
            kwargs["full_html"] = self.full_html
        if self.animation_opts is not None:
            kwargs["animation_opts"] = self.animation_opts
        if self.default_width is not None:
            kwargs["default_width"] = self.default_width
        if self.default_height is not None:
            kwargs["default_height"] = self.default_height
        if self.validate is not None:
            kwargs["validate"] = self.validate
        if self.auto_open is not None:
            kwargs["auto_open"] = self.auto_open
        if self.div_id is not None:
            kwargs["div_id"] = self.div_id
        return kwargs

    def save_data(self, data: plotly.graph_objects.Figure) -> Dict[str, Any]:
        data.write_html(file=self.path, **self._get_saving_kwargs())
        return utils.get_file_metadata(self.path)

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [plotly.graph_objects.Figure]

    @classmethod
    def name(cls) -> str:
        return "html"


def register_data_loaders():
    for loader in [
        PlotlyStaticWriter,
        PlotlyInteractiveWriter,
    ]:
        registry.register_adapter(loader)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
