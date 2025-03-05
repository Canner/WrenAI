import importlib.metadata
import pathlib

import anywidget
import traitlets

from itables.javascript import get_itables_extension_arguments

try:
    __version__ = importlib.metadata.version("itables_anywidget")
except importlib.metadata.PackageNotFoundError:
    __version__ = "unknown"


class ITable(anywidget.AnyWidget):
    _esm = pathlib.Path(__file__).parent / "static" / "widget.js"
    _css = pathlib.Path(__file__).parent / "static" / "widget.css"

    # public traits
    caption = traitlets.Unicode().tag(sync=True)
    classes = traitlets.Unicode().tag(sync=True)
    style = traitlets.Unicode().tag(sync=True)
    selected_rows = traitlets.List(traitlets.Int).tag(sync=True)

    # private traits that relate to df or to the DataTable arguments
    # (use .update() to update them)
    _data = traitlets.List(traitlets.List()).tag(sync=True)
    _columns = traitlets.List(traitlets.Dict()).tag(sync=True)
    _filtered_row_count = traitlets.Int().tag(sync=True)
    _downsampling_warning = traitlets.Unicode().tag(sync=True)
    _dt_args = traitlets.Dict().tag(sync=True)
    _destroy_and_recreate = traitlets.Int(0).tag(sync=True)

    def __init__(self, df=None, caption=None, selected_rows=None, **kwargs) -> None:
        super().__init__()

        dt_args, other_args = get_itables_extension_arguments(
            df, caption, selected_rows, **kwargs
        )
        self._df = df
        self.caption = other_args.pop("caption") or ""
        self.classes = other_args.pop("classes")
        self.style = other_args.pop("style")
        self.selected_rows = other_args.pop("selected_rows")

        self._data = dt_args.pop("data")
        self._columns = dt_args.pop("columns")
        self._dt_args = dt_args
        self._downsampling_warning = other_args.pop("downsampling_warning") or ""
        self._filtered_row_count = other_args.pop("filtered_row_count", 0)
        assert not other_args, other_args

    def update(self, df=None, caption=None, selected_rows=None, **kwargs):
        """
        Update either the table data, attributes, or the arguments passed
        to DataTable. Arguments that are not mentioned
        """
        data_or_dt_args_changed = False
        for key, value in list(kwargs.items()):
            if value is None:
                data_or_dt_args_changed = True
                self._dt_args.pop(key, None)
                del kwargs[key]

        if df is None:
            df = self._df
        if selected_rows is None:
            selected_rows = self.selected_rows
        if caption is None:
            caption = self.caption
        if "classes" not in kwargs:
            kwargs["classes"] = self.classes
        if "style" not in kwargs:
            kwargs["style"] = self.style

        dt_args, other_args = get_itables_extension_arguments(
            df, caption, selected_rows, **kwargs
        )

        self.classes = other_args.pop("classes")
        self.style = other_args.pop("style")
        self.caption = other_args.pop("caption")

        if df is None:
            del dt_args["data"]
            del dt_args["columns"]

            # Don't trigger an update if nor data nor the dt args changed
            data_or_dt_args_changed = data_or_dt_args_changed or self._update_dt_args(
                dt_args
            )
        else:
            self._df = df
            self._data = dt_args.pop("data")
            self._columns = dt_args.pop("columns")
            self._update_dt_args(dt_args)
            self._downsampling_warning = other_args.pop("downsampling_warning") or ""
            self._filtered_row_count = other_args.pop("filtered_row_count", 0)
            data_or_dt_args_changed = True

        if data_or_dt_args_changed:
            self._destroy_and_recreate += 1

        self.selected_rows = other_args.pop("selected_rows")

    def _update_dt_args(self, dt_args):
        changed = False
        for key, value in dt_args.items():
            if key not in self._dt_args or (self._dt_args[key] != value):
                self._dt_args[key] = value
                changed = True

        return changed

    @property
    def df(self):
        return self._df

    @df.setter
    def df(self, df):
        self.update(df)
