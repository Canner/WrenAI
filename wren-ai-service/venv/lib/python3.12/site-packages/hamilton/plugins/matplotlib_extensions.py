import dataclasses
from os import PathLike
from typing import IO, Any, Collection, Dict, List, Optional, Tuple, Type, Union

try:
    from matplotlib.artist import Artist
    from matplotlib.figure import Figure
    from matplotlib.transforms import Bbox
except ImportError as e:
    raise NotImplementedError("Matplotlib is not installed.") from e

from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataSaver


@dataclasses.dataclass
class MatplotlibWriter(DataSaver):
    """Write Matplotlib figure as static image format
    ref: https://matplotlib.org/stable/api/figure_api.html#matplotlib.figure.Figure
    """

    path: Union[str, PathLike, IO]
    dpi: Optional[Union[float, str]] = None
    format: Optional[str] = None
    metadata: Optional[Dict] = None
    bbox_inches: Optional[Union[str, Bbox]] = None
    pad_inches: Optional[Union[float, str]] = None
    facecolor: Optional[Union[str, float, Tuple]] = None
    edgecolor: Optional[Union[str, float, Tuple]] = None
    backend: Optional[str] = None
    orientation: Optional[str] = None
    papertype: Optional[str] = None
    transparent: Optional[bool] = None
    bbox_extra_artists: Optional[List[Artist]] = None
    pil_kwargs: Optional[Dict] = None

    def _get_saving_kwargs(self) -> dict:
        kwargs = {}
        if self.format is not None:
            kwargs["format"] = self.format
        if self.metadata is not None:
            kwargs["metadata"] = self.metadata
        if self.bbox_inches is not None:
            kwargs["bbox_inches"] = self.bbox_inches
        if self.pad_inches is not None:
            kwargs["pad_inches"] = self.pad_inches
        if self.facecolor is not None:
            kwargs["facecolor"] = self.facecolor
        if self.edgecolor is not None:
            kwargs["edgecolor"] = self.edgecolor
        if self.backend is not None:
            kwargs["backend"] = self.backend
        if self.orientation is not None:
            kwargs["orientation"] = self.orientation
        if self.papertype is not None:
            kwargs["papertype"] = self.papertype
        if self.transparent is not None:
            kwargs["transparent"] = self.transparent
        if self.bbox_extra_artists is not None:
            kwargs["bbox_extra_artists"] = self.bbox_extra_artists
        if self.pil_kwargs is not None:
            kwargs["pil_kwargs"] = self.pil_kwargs

        return kwargs

    def save_data(self, data: Figure) -> Dict[str, Any]:
        data.savefig(fname=self.path, **self._get_saving_kwargs())
        # TODO make utils.get_file_metadata() safer for when self.path is IO type
        return utils.get_file_metadata(self.path)

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return [Figure]

    @classmethod
    def name(cls) -> str:
        return "plt"


def register_data_savers():
    for saver in [
        MatplotlibWriter,
    ]:
        registry.register_adapter(saver)


register_data_savers()

COLUMN_FRIENDLY_DF_TYPE = False
