from __future__ import annotations

import itertools
import logging
import os
import re
import typing as t
import warnings
from functools import lru_cache

import numpy as np
import tiktoken
from datasets import Dataset

if t.TYPE_CHECKING:
    from ragas.metrics.base import Metric

DEBUG_ENV_VAR = "RAGAS_DEBUG"


@lru_cache(maxsize=1)
def get_cache_dir() -> str:
    "get cache location"
    DEFAULT_XDG_CACHE_HOME = "~/.cache"
    xdg_cache = os.getenv("XDG_CACHE_HOME", DEFAULT_XDG_CACHE_HOME)
    default_ragas_cache = os.path.join(xdg_cache, "ragas")
    return os.path.expanduser(os.getenv("RAGAS_CACHE_HOME", default_ragas_cache))


@lru_cache(maxsize=1)
def get_debug_mode() -> bool:
    if os.environ.get(DEBUG_ENV_VAR, str(False)).lower() == "true":
        return True
    else:
        return False


def safe_nanmean(arr: t.List[float]) -> float:
    if len(arr) == 0:
        return np.nan  # or some other value or behavior for empty arrays

    arr_numpy = np.asarray(arr)  # Ensure input is a numpy array

    if np.isnan(arr_numpy).all():
        return np.nan  # or some other value or behavior for all-NaN arrays

    return float(np.nanmean(arr_numpy))


def check_if_sum_is_close(
    values: t.List[float], close_to: float, num_places: int
) -> bool:
    multiplier = 10**num_places
    total = sum(int(round(v * multiplier)) for v in values)
    return total == int(round(close_to * multiplier))


def patch_logger(module: str, level: int):
    # enable debug logging
    patched_logger = logging.getLogger(module)
    patched_logger.setLevel(level=level)
    # Create a handler for the asyncio logger
    handler = logging.StreamHandler()  # or another type of Handler
    handler.setLevel(logging.DEBUG)
    # Optional: Set a formatter if you want a specific format for the logs
    formatter = logging.Formatter("[%(name)s.%(levelname)s] %(message)s")
    handler.setFormatter(formatter)
    # Add the handler to the asyncio logger
    patched_logger.addHandler(handler)
    # Set propagate to False if you don't want it to log to the root logger's handlers as well
    patched_logger.propagate = False


# Function to check if an element is NaN
def is_nan(x):
    try:
        return np.isnan(x)
    except TypeError:
        return False


def get_metric_language(metric: Metric) -> str:
    from ragas.prompt import BasePrompt

    languags = [
        value.language
        for _, value in vars(metric).items()
        if isinstance(value, BasePrompt)
    ]
    return languags[0] if len(languags) > 0 else ""


def deprecated(
    since: str,
    *,
    removal: t.Optional[str] = None,
    alternative: t.Optional[str] = None,
    addendum: t.Optional[str] = None,
    pending: bool = False,
):
    """
    Decorator to mark functions or classes as deprecated.

    Args:
        since: str
             The release at which this API became deprecated.
        removal: str, optional
            The expected removal version. Cannot be used with pending=True.
            Must be specified with pending=False.
        alternative: str, optional
            The alternative API or function to be used instead
            of the deprecated function.
        addendum: str, optional
            Additional text appended directly to the final message.
        pending: bool
            Whether the deprecation version is already scheduled or not.
            Cannot be used with removal.


    Examples
    --------

        .. code-block:: python

            @deprecated("0.1", removal="0.2", alternative="some_new_function")
            def some_old_function():
                print("This is an old function.")

    """

    def deprecate(func: t.Callable):
        def emit_warning(*args, **kwargs):
            if pending and removal:
                raise ValueError(
                    "A pending deprecation cannot have a scheduled removal"
                )

            message = f"The function {func.__name__} was deprecated in {since},"

            if not pending:
                if removal:
                    message += f" and will be removed in the {removal} release."
                else:
                    raise ValueError(
                        "A non-pending deprecation must have a scheduled removal."
                    )
            else:
                message += " and will be removed in a future release."

            if alternative:
                message += f" Use {alternative} instead."

            if addendum:
                message += f" {addendum}"

            warnings.warn(message, stacklevel=2, category=DeprecationWarning)
            return func(*args, **kwargs)

        return emit_warning

    return deprecate


def get_or_init(
    dictionary: t.Dict[str, t.Any], key: str, default: t.Callable[[], t.Any]
) -> t.Any:
    _value = dictionary.get(key)
    value = _value if _value is not None else default()

    return value


def get_from_dict(data_dict: t.Dict, key: str, default=None) -> t.Any:
    keys = key.split(".")
    current = data_dict

    for k in keys:
        if isinstance(current, dict) and k in current:
            current = current[k]
        else:
            return default

    return current


REQUIRED_COLS_v1 = {
    "user_input": "question",
    "retrieved_contexts": "contexts",
    "response": "answer",
    "reference": "ground_truth",
}


def get_required_columns_v1(metric: Metric):
    required_cols = metric.required_columns.get("SINGLE_TURN", set())
    required_cols = [REQUIRED_COLS_v1.get(col) for col in required_cols]
    return [col for col in required_cols if col is not None]


def convert_row_v1_to_v2(row: t.Dict[str, t.Any]) -> t.Dict[str, t.Any]:
    required_cols_v2 = {k: v for v, k in REQUIRED_COLS_v1.items()}
    return {required_cols_v2[k]: v for k, v in row.items() if k in required_cols_v2}


def convert_v1_to_v2_dataset(dataset: Dataset) -> Dataset:
    columns_map = {v: k for k, v in REQUIRED_COLS_v1.items() if v in dataset.features}
    return dataset.rename_columns(columns_map)


def convert_v2_to_v1_dataset(dataset: Dataset) -> Dataset:
    columns_map = {k: v for k, v in REQUIRED_COLS_v1.items() if k in dataset.features}
    return dataset.rename_columns(columns_map)


def camel_to_snake(name):
    """
    Convert a camelCase string to snake_case.
    eg: HaiThere -> hai_there
    """
    pattern = re.compile(r"(?<!^)(?=[A-Z])")
    return pattern.sub("_", name).lower()


def num_tokens_from_string(string: str, encoding_name: str = "cl100k_base") -> int:
    """Returns the number of tokens in a text string."""
    encoding = tiktoken.get_encoding(encoding_name)
    num_tokens = len(encoding.encode(string))
    return num_tokens


def batched(iterable: t.Iterable, n: int) -> t.Iterator[t.Tuple]:
    """Batch data from the iterable into tuples of length n. The last batch may be shorter than n."""
    # batched('ABCDEFG', 3) → ABC DEF G
    if n < 1:
        raise ValueError("n must be at least one")
    iterator = iter(iterable)
    while batch := tuple(itertools.islice(iterator, n)):
        yield batch


def set_logging_level(logger_name: str, level: int):
    """
    Set the logging level for a logger. Useful for debugging.
    """
    logger = logging.getLogger(logger_name)
    logger.setLevel(level)

    # Create a console handler and set its level
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG)

    # Create a formatter and add it to the handler
    formatter = logging.Formatter("%(name)s - %(levelname)s - %(message)s")
    console_handler.setFormatter(formatter)

    # Add the handler to the logger
    logger.addHandler(console_handler)
