import dataclasses
from os import PathLike
from typing import Any, Collection, Dict, Optional, Type, Union

try:
    import sklearn.inspection
    import sklearn.metrics
    import sklearn.model_selection
    from matplotlib import pyplot
except ImportError as e:
    raise NotImplementedError("scikit-learn is not installed.") from e


from hamilton import registry
from hamilton.io import utils
from hamilton.io.data_adapters import DataSaver

display_classes = [
    "ConfusionMatrixDisplay",
    "DetCurveDisplay",
    "PrecisionRecallDisplay",
    "PredictionErrorDisplay",
    "RocCurveDisplay",
    "CalibrationDisplay",
    "DecisionBoundaryDisplay",
    "LearningCurveDisplay",
    "PartialDependenceDisplay",
    "ValidationCurveDisplay",
]
SKLEARN_PLOT_TYPES = []
for class_name in display_classes:
    # get the attribute via string from sklearn.metrics; if not found return None
    class_metrics = getattr(sklearn.metrics, class_name, None)
    class_inspection = getattr(sklearn.inspection, class_name, None)
    class_model_selection = getattr(sklearn.model_selection, class_name, None)
    if class_metrics:
        SKLEARN_PLOT_TYPES.append(class_metrics)
    if class_inspection:
        SKLEARN_PLOT_TYPES.append(class_inspection)
    if class_model_selection:
        SKLEARN_PLOT_TYPES.append(class_model_selection)

SKLEARN_PLOT_TYPES.append(pyplot.Figure)
SKLEARN_PLOT_TYPES_ANNOTATION = Union[tuple(SKLEARN_PLOT_TYPES)]


@dataclasses.dataclass
class SklearnPlotSaver(DataSaver):
    path: Union[str, PathLike]
    # kwargs
    dpi: float = 200
    format: str = "png"
    metadata: Optional[dict] = None
    bbox_inches: str = None
    pad_inches: float = 0.1
    backend: Optional[str] = None
    papertype: str = None
    transparent: bool = None
    bbox_extra_artists: Optional[list] = None
    pil_kwargs: Optional[dict] = None

    @classmethod
    def applicable_types(cls) -> Collection[Type]:
        return SKLEARN_PLOT_TYPES

    def _get_saving_kwargs(self) -> Dict[str, Any]:
        kwargs = {}
        if self.dpi is not None:
            kwargs["dpi"] = self.dpi
        if self.format is not None:
            kwargs["format"] = self.format
        if self.metadata is not None:
            kwargs["metadata"] = self.metadata
        if self.bbox_inches is not None:
            kwargs["bbox_inches"] = self.bbox_inches
        if self.pad_inches is not None:
            kwargs["pad_inches"] = self.pad_inches
        if self.backend is not None:
            kwargs["backend"] = self.backend
        if self.papertype is not None:
            kwargs["papertype"] = self.papertype
        if self.transparent is not None:
            kwargs["transparent"] = self.transparent
        if self.bbox_extra_artists is not None:
            kwargs["bbox_extra_artists"] = self.bbox_extra_artists
        if self.pil_kwargs is not None:
            kwargs["pil_kwargs"] = self.pil_kwargs
        return kwargs

    def save_data(self, data: SKLEARN_PLOT_TYPES_ANNOTATION) -> Dict[str, Any]:
        if isinstance(data, pyplot.Figure):
            figure = data
        else:
            data.plot()
            figure = data.figure_
        figure.savefig(self.path, **self._get_saving_kwargs())
        return utils.get_file_metadata(self.path)

    @classmethod
    def name(cls) -> str:
        return "png"


def register_data_loaders():
    """Function to register the data loaders for this extension."""
    registry.register_adapter(SklearnPlotSaver)


register_data_loaders()

COLUMN_FRIENDLY_DF_TYPE = False
