# SPDX-License-Identifier: MIT OR Apache-2.0
# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the MIT License.  See the LICENSE file in the root of this
# repository for complete details.

"""
Helpers that make development with *structlog* more pleasant.

See also the narrative documentation in `console-output`.
"""

from __future__ import annotations

import shutil
import sys
import warnings

from dataclasses import dataclass
from io import StringIO
from types import ModuleType
from typing import (
    Any,
    Callable,
    Literal,
    Protocol,
    Sequence,
    TextIO,
    Type,
    Union,
    cast,
)

from ._frames import _format_exception
from .processors import _figure_out_exc_info
from .typing import EventDict, ExceptionRenderer, ExcInfo, WrappedLogger


try:
    import colorama
except ImportError:
    colorama = None

try:
    import better_exceptions
except ImportError:
    better_exceptions = None

try:
    import rich

    from rich.console import Console
    from rich.traceback import Traceback
except ImportError:
    rich = None  # type: ignore[assignment]

__all__ = [
    "ConsoleRenderer",
    "better_traceback",
    "plain_traceback",
    "rich_traceback",
]

_IS_WINDOWS = sys.platform == "win32"

_MISSING = "{who} requires the {package} package installed.  "
_EVENT_WIDTH = 30  # pad the event name to so many characters


def _pad(s: str, length: int) -> str:
    """
    Pads *s* to length *length*.
    """
    missing = length - len(s)

    return s + " " * (max(0, missing))


if colorama is not None:
    RESET_ALL = colorama.Style.RESET_ALL
    BRIGHT = colorama.Style.BRIGHT
    DIM = colorama.Style.DIM
    RED = colorama.Fore.RED
    BLUE = colorama.Fore.BLUE
    CYAN = colorama.Fore.CYAN
    MAGENTA = colorama.Fore.MAGENTA
    YELLOW = colorama.Fore.YELLOW
    GREEN = colorama.Fore.GREEN
    RED_BACK = colorama.Back.RED
else:
    # These are the same values as the Colorama color codes. Redefining them
    # here allows users to specify that they want color without having to
    # install Colorama, which is only supposed to be necessary in Windows.
    RESET_ALL = "\033[0m"
    BRIGHT = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    BLUE = "\033[34m"
    CYAN = "\033[36m"
    MAGENTA = "\033[35m"
    YELLOW = "\033[33m"
    GREEN = "\033[32m"
    RED_BACK = "\033[41m"

# On Windows, colors are only available if Colorama is installed.
_has_colors = not _IS_WINDOWS or colorama is not None

# Prevent breakage of packages that used the old name of the variable.
_use_colors = _has_colors


class _Styles(Protocol):
    reset: str
    bright: str
    level_critical: str
    level_exception: str
    level_error: str
    level_warn: str
    level_info: str
    level_debug: str
    level_notset: str

    timestamp: str
    logger_name: str
    kv_key: str
    kv_value: str


Styles = Union[_Styles, Type[_Styles]]


class _ColorfulStyles:
    reset = RESET_ALL
    bright = BRIGHT

    level_critical = RED
    level_exception = RED
    level_error = RED
    level_warn = YELLOW
    level_info = GREEN
    level_debug = GREEN
    level_notset = RED_BACK

    timestamp = DIM
    logger_name = BLUE
    kv_key = CYAN
    kv_value = MAGENTA


class _PlainStyles:
    reset = ""
    bright = ""

    level_critical = ""
    level_exception = ""
    level_error = ""
    level_warn = ""
    level_info = ""
    level_debug = ""
    level_notset = ""

    timestamp = ""
    logger_name = ""
    kv_key = ""
    kv_value = ""


class ColumnFormatter(Protocol):
    """
    :class:`~typing.Protocol` for column formatters.

    See `KeyValueColumnFormatter` and `LogLevelColumnFormatter` for examples.

    .. versionadded:: 23.3.0
    """

    def __call__(self, key: str, value: object) -> str:
        """
        Format *value* for *key*.

        This method is responsible for formatting, *key*, the ``=``, and the
        *value*. That means that it can use any string instead of the ``=`` and
        it can leave out both the *key* or the *value*.

        If it returns an empty string, the column is omitted completely.
        """


@dataclass
class Column:
    """
    A column defines the way a key-value pair is formatted, and, by it's
    position to the *columns* argument of `ConsoleRenderer`, the order in which
    it is rendered.

    Args:
        key:
            The key for which this column is responsible. Leave empty to define
            it as the default formatter.

        formatter: The formatter for columns with *key*.

    .. versionadded:: 23.3.0
    """

    key: str
    formatter: ColumnFormatter


@dataclass
class KeyValueColumnFormatter:
    """
    Format a key-value pair.

    Args:
        key_style: The style to apply to the key. If None, the key is omitted.

        value_style: The style to apply to the value.

        reset_style: The style to apply whenever a style is no longer needed.

        value_repr:
            A callable that returns the string representation of the value.

        width: The width to pad the value to. If 0, no padding is done.

        prefix:
            A string to prepend to the formatted key-value pair. May contain
            styles.

        postfix:
            A string to append to the formatted key-value pair. May contain
            styles.

    .. versionadded:: 23.3.0
    """

    key_style: str | None
    value_style: str
    reset_style: str
    value_repr: Callable[[object], str]
    width: int = 0
    prefix: str = ""
    postfix: str = ""

    def __call__(self, key: str, value: object) -> str:
        sio = StringIO()

        if self.prefix:
            sio.write(self.prefix)
            sio.write(self.reset_style)

        if self.key_style is not None:
            sio.write(self.key_style)
            sio.write(key)
            sio.write(self.reset_style)
            sio.write("=")

        sio.write(self.value_style)
        sio.write(_pad(self.value_repr(value), self.width))
        sio.write(self.reset_style)

        if self.postfix:
            sio.write(self.postfix)
            sio.write(self.reset_style)

        return sio.getvalue()


class LogLevelColumnFormatter:
    """
    Format a log level according to *level_styles*.

    The width is padded to the longest level name (if *level_styles* is passed
    -- otherwise there's no way to know the lengths of all levels).

    Args:
        level_styles:
            A dictionary of level names to styles that are applied to it. If
            None, the level is formatted as a plain ``[level]``.

        reset_style:
            What to use to reset the style after the level name. Ignored if
            if *level_styles* is None.

        width:
            The width to pad the level to. If 0, no padding is done.

    .. versionadded:: 23.3.0
    .. versionadded:: 24.2.0 *width*
    """

    level_styles: dict[str, str] | None
    reset_style: str
    width: int

    def __init__(
        self,
        level_styles: dict[str, str],
        reset_style: str,
        width: int | None = None,
    ) -> None:
        self.level_styles = level_styles
        if level_styles:
            self.width = (
                0
                if width == 0
                else len(max(self.level_styles.keys(), key=lambda e: len(e)))
            )
            self.reset_style = reset_style
        else:
            self.width = 0
            self.reset_style = ""

    def __call__(self, key: str, value: object) -> str:
        level = cast(str, value)
        style = (
            ""
            if self.level_styles is None
            else self.level_styles.get(level, "")
        )

        return f"[{style}{_pad(level, self.width)}{self.reset_style}]"


_NOTHING = object()


def plain_traceback(sio: TextIO, exc_info: ExcInfo) -> None:
    """
    "Pretty"-print *exc_info* to *sio* using our own plain formatter.

    To be passed into `ConsoleRenderer`'s ``exception_formatter`` argument.

    Used by default if neither Rich nor *better-exceptions* are present.

    .. versionadded:: 21.2.0
    """
    sio.write("\n" + _format_exception(exc_info))


@dataclass
class RichTracebackFormatter:
    """
    A Rich traceback renderer with the given options.

    Pass an instance as `ConsoleRenderer`'s ``exception_formatter`` argument.

    See :class:`rich.traceback.Traceback` for details on the arguments.

    If a *width* of -1 is passed, the terminal width is used. If the width
    can't be determined, fall back to 80.

    .. versionadded:: 23.2.0
    """

    color_system: Literal[
        "auto", "standard", "256", "truecolor", "windows"
    ] = "truecolor"
    show_locals: bool = True
    max_frames: int = 100
    theme: str | None = None
    word_wrap: bool = False
    extra_lines: int = 3
    width: int = 100
    indent_guides: bool = True
    locals_max_length: int = 10
    locals_max_string: int = 80
    locals_hide_dunder: bool = True
    locals_hide_sunder: bool = False
    suppress: Sequence[str | ModuleType] = ()

    def __call__(self, sio: TextIO, exc_info: ExcInfo) -> None:
        if self.width == -1:
            self.width, _ = shutil.get_terminal_size((80, 0))

        sio.write("\n")

        Console(
            file=sio, color_system=self.color_system, width=self.width
        ).print(
            Traceback.from_exception(
                *exc_info,
                show_locals=self.show_locals,
                max_frames=self.max_frames,
                theme=self.theme,
                word_wrap=self.word_wrap,
                extra_lines=self.extra_lines,
                width=self.width,
                indent_guides=self.indent_guides,
                locals_max_length=self.locals_max_length,
                locals_max_string=self.locals_max_string,
                locals_hide_dunder=self.locals_hide_dunder,
                locals_hide_sunder=self.locals_hide_sunder,
                suppress=self.suppress,
            )
        )


rich_traceback = RichTracebackFormatter()
"""
Pretty-print *exc_info* to *sio* using the Rich package.

To be passed into `ConsoleRenderer`'s ``exception_formatter`` argument.

This is a `RichTracebackFormatter` with default arguments and used by default
if Rich is installed.

.. versionadded:: 21.2.0
"""


def better_traceback(sio: TextIO, exc_info: ExcInfo) -> None:
    """
    Pretty-print *exc_info* to *sio* using the *better-exceptions* package.

    To be passed into `ConsoleRenderer`'s ``exception_formatter`` argument.

    Used by default if *better-exceptions* is installed and Rich is absent.

    .. versionadded:: 21.2.0
    """
    sio.write("\n" + "".join(better_exceptions.format_exception(*exc_info)))


if rich is not None:
    default_exception_formatter = rich_traceback
elif better_exceptions is not None:
    default_exception_formatter = better_traceback
else:
    default_exception_formatter = plain_traceback


class ConsoleRenderer:
    r"""
    Render ``event_dict`` nicely aligned, possibly in colors, and ordered.

    If ``event_dict`` contains a true-ish ``exc_info`` key, it will be rendered
    *after* the log line. If Rich_ or better-exceptions_ are present, in colors
    and with extra context.

    Args:
        columns:
            A list of `Column` objects defining both the order and format of
            the key-value pairs in the output. If passed, most other arguments
            become meaningless.

            **Must** contain a column with ``key=''`` that defines the default
            formatter.

            .. seealso:: `columns-config`

        pad_event:
            Pad the event to this many characters. Ignored if *columns* are
            passed.

        colors:
            Use colors for a nicer output. `True` by default. On Windows only
            if Colorama_ is installed. Ignored if *columns* are passed.

        force_colors:
            Force colors even for non-tty destinations. Use this option if your
            logs are stored in a file that is meant to be streamed to the
            console. Only meaningful on Windows. Ignored if *columns* are
            passed.

        repr_native_str:
            When `True`, `repr` is also applied to ``str``\ s. The ``event``
            key is *never* `repr` -ed. Ignored if *columns* are passed.

        level_styles:
            When present, use these styles for colors. This must be a dict from
            level names (strings) to terminal sequences (for example, Colorama)
            styles. The default can be obtained by calling
            `ConsoleRenderer.get_default_level_styles`. Ignored when *columns*
            are passed.

        exception_formatter:
            A callable to render ``exc_infos``. If Rich_ or better-exceptions_
            are installed, they are used for pretty-printing by default (rich_
            taking precedence). You can also manually set it to
            `plain_traceback`, `better_traceback`, an instance of
            `RichTracebackFormatter` like `rich_traceback`, or implement your
            own.

        sort_keys:
            Whether to sort keys when formatting. `True` by default. Ignored if
            *columns* are passed.

        event_key:
            The key to look for the main log message. Needed when you rename it
            e.g. using `structlog.processors.EventRenamer`. Ignored if
            *columns* are passed.

        timestamp_key:
            The key to look for timestamp of the log message. Needed when you
            rename it e.g. using `structlog.processors.EventRenamer`. Ignored
            if *columns* are passed.

        pad_level:
            Whether to pad log level with blanks to the longest amongst all
            level label.

    Requires the Colorama_ package if *colors* is `True` **on Windows**.

    Raises:
        ValueError: If there's not exactly one default column formatter.

    .. _Colorama: https://pypi.org/project/colorama/
    .. _better-exceptions: https://pypi.org/project/better-exceptions/
    .. _Rich: https://pypi.org/project/rich/

    .. versionadded:: 16.0.0
    .. versionadded:: 16.1.0 *colors*
    .. versionadded:: 17.1.0 *repr_native_str*
    .. versionadded:: 18.1.0 *force_colors*
    .. versionadded:: 18.1.0 *level_styles*
    .. versionchanged:: 19.2.0
       Colorama now initializes lazily to avoid unwanted initializations as
       ``ConsoleRenderer`` is used by default.
    .. versionchanged:: 19.2.0 Can be pickled now.
    .. versionchanged:: 20.1.0
       Colorama does not initialize lazily on Windows anymore because it breaks
       rendering.
    .. versionchanged:: 21.1.0
       It is additionally possible to set the logger name using the
       ``logger_name`` key in the ``event_dict``.
    .. versionadded:: 21.2.0 *exception_formatter*
    .. versionchanged:: 21.2.0
       `ConsoleRenderer` now handles the ``exc_info`` event dict key itself. Do
       **not** use the `structlog.processors.format_exc_info` processor
       together with `ConsoleRenderer` anymore! It will keep working, but you
       can't have customize exception formatting and a warning will be raised
       if you ask for it.
    .. versionchanged:: 21.2.0
       The colors keyword now defaults to True on non-Windows systems, and
       either True or False in Windows depending on whether Colorama is
       installed.
    .. versionadded:: 21.3.0 *sort_keys*
    .. versionadded:: 22.1.0 *event_key*
    .. versionadded:: 23.2.0 *timestamp_key*
    .. versionadded:: 23.3.0 *columns*
    .. versionadded:: 24.2.0 *pad_level*
    """

    def __init__(  # noqa: PLR0912, PLR0915
        self,
        pad_event: int = _EVENT_WIDTH,
        colors: bool = _has_colors,
        force_colors: bool = False,
        repr_native_str: bool = False,
        level_styles: dict[str, str] | None = None,
        exception_formatter: ExceptionRenderer = default_exception_formatter,
        sort_keys: bool = True,
        event_key: str = "event",
        timestamp_key: str = "timestamp",
        columns: list[Column] | None = None,
        pad_level: bool = True,
    ):
        self._exception_formatter = exception_formatter
        self._sort_keys = sort_keys

        if columns is not None:
            to_warn = []

            def add_meaningless_arg(arg: str) -> None:
                to_warn.append(
                    f"The `{arg}` argument is ignored when passing `columns`.",
                )

            if pad_event != _EVENT_WIDTH:
                add_meaningless_arg("pad_event")

            if colors != _has_colors:
                add_meaningless_arg("colors")

            if force_colors is not False:
                add_meaningless_arg("force_colors")

            if repr_native_str is not False:
                add_meaningless_arg("repr_native_str")

            if level_styles is not None:
                add_meaningless_arg("level_styles")

            if event_key != "event":
                add_meaningless_arg("event_key")

            if timestamp_key != "timestamp":
                add_meaningless_arg("timestamp_key")

            for w in to_warn:
                warnings.warn(w, stacklevel=2)

            defaults = [col for col in columns if col.key == ""]
            if not defaults:
                raise ValueError(
                    "Must pass a default column formatter (a column with `key=''`)."
                )
            if len(defaults) > 1:
                raise ValueError("Only one default column formatter allowed.")

            self._default_column_formatter = defaults[0].formatter
            self._columns = [col for col in columns if col.key]

            return

        # Create default columns configuration.
        styles: Styles
        if colors:
            if _IS_WINDOWS:  # pragma: no cover
                # On Windows, we can't do colorful output without colorama.
                if colorama is None:
                    classname = self.__class__.__name__
                    raise SystemError(
                        _MISSING.format(
                            who=classname + " with `colors=True`",
                            package="colorama",
                        )
                    )
                # Colorama must be init'd on Windows, but must NOT be
                # init'd on other OSes, because it can break colors.
                if force_colors:
                    colorama.deinit()
                    colorama.init(strip=False)
                else:
                    colorama.init()

            styles = _ColorfulStyles
        else:
            styles = _PlainStyles

        self._styles = styles

        level_to_color = (
            self.get_default_level_styles(colors)
            if level_styles is None
            else level_styles
        ).copy()

        for key in level_to_color:
            level_to_color[key] += styles.bright
        self._longest_level = len(
            max(level_to_color.keys(), key=lambda e: len(e))
        )

        self._repr_native_str = repr_native_str

        self._default_column_formatter = KeyValueColumnFormatter(
            styles.kv_key,
            styles.kv_value,
            styles.reset,
            value_repr=self._repr,
            width=0,
        )

        logger_name_formatter = KeyValueColumnFormatter(
            key_style=None,
            value_style=styles.bright + styles.logger_name,
            reset_style=styles.reset,
            value_repr=str,
            prefix="[",
            postfix="]",
        )

        level_width = 0 if not pad_level else None

        self._columns = [
            Column(
                timestamp_key,
                KeyValueColumnFormatter(
                    key_style=None,
                    value_style=styles.timestamp,
                    reset_style=styles.reset,
                    value_repr=str,
                ),
            ),
            Column(
                "level",
                LogLevelColumnFormatter(
                    level_to_color, reset_style=styles.reset, width=level_width
                ),
            ),
            Column(
                event_key,
                KeyValueColumnFormatter(
                    key_style=None,
                    value_style=styles.bright,
                    reset_style=styles.reset,
                    value_repr=str,
                    width=pad_event,
                ),
            ),
            Column("logger", logger_name_formatter),
            Column("logger_name", logger_name_formatter),
        ]

    def _repr(self, val: Any) -> str:
        """
        Determine representation of *val* depending on its type &
        self._repr_native_str.
        """
        if self._repr_native_str is True:
            return repr(val)

        if isinstance(val, str):
            if set(val) & {" ", "\t", "=", "\r", "\n", '"', "'"}:
                return repr(val)
            return val

        return repr(val)

    def __call__(
        self, logger: WrappedLogger, name: str, event_dict: EventDict
    ) -> str:
        stack = event_dict.pop("stack", None)
        exc = event_dict.pop("exception", None)
        exc_info = event_dict.pop("exc_info", None)

        kvs = [
            col.formatter(col.key, val)
            for col in self._columns
            if (val := event_dict.pop(col.key, _NOTHING)) is not _NOTHING
        ] + [
            self._default_column_formatter(key, event_dict[key])
            for key in (sorted(event_dict) if self._sort_keys else event_dict)
        ]

        sio = StringIO()
        sio.write((" ".join(kv for kv in kvs if kv)).rstrip(" "))

        if stack is not None:
            sio.write("\n" + stack)
            if exc_info or exc is not None:
                sio.write("\n\n" + "=" * 79 + "\n")

        exc_info = _figure_out_exc_info(exc_info)
        if exc_info:
            self._exception_formatter(sio, exc_info)
        elif exc is not None:
            if self._exception_formatter is not plain_traceback:
                warnings.warn(
                    "Remove `format_exc_info` from your processor chain "
                    "if you want pretty exceptions.",
                    stacklevel=2,
                )

            sio.write("\n" + exc)

        return sio.getvalue()

    @staticmethod
    def get_default_level_styles(colors: bool = True) -> dict[str, str]:
        """
        Get the default styles for log levels

        This is intended to be used with `ConsoleRenderer`'s ``level_styles``
        parameter.  For example, if you are adding custom levels in your
        home-grown :func:`~structlog.stdlib.add_log_level` you could do::

            my_styles = ConsoleRenderer.get_default_level_styles()
            my_styles["EVERYTHING_IS_ON_FIRE"] = my_styles["critical"] renderer
            = ConsoleRenderer(level_styles=my_styles)

        Args:
            colors:
                Whether to use colorful styles. This must match the *colors*
                parameter to `ConsoleRenderer`. Default: `True`.
        """
        styles: Styles
        styles = _ColorfulStyles if colors else _PlainStyles
        return {
            "critical": styles.level_critical,
            "exception": styles.level_exception,
            "error": styles.level_error,
            "warn": styles.level_warn,
            "warning": styles.level_warn,
            "info": styles.level_info,
            "debug": styles.level_debug,
            "notset": styles.level_notset,
        }


_SENTINEL = object()


def set_exc_info(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """
    Set ``event_dict["exc_info"] = True`` if *method_name* is ``"exception"``.

    Do nothing if the name is different or ``exc_info`` is already set.
    """
    if (
        method_name != "exception"
        or event_dict.get("exc_info", _SENTINEL) is not _SENTINEL
    ):
        return event_dict

    event_dict["exc_info"] = True

    return event_dict
