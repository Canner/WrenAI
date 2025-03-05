import sentry_sdk
from sentry_sdk._lru_cache import LRUCache

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from typing import TypedDict

    FlagData = TypedDict("FlagData", {"flag": str, "result": bool})


DEFAULT_FLAG_CAPACITY = 100


class FlagBuffer:

    def __init__(self, capacity):
        # type: (int) -> None
        self.buffer = LRUCache(capacity)
        self.capacity = capacity

    def clear(self):
        # type: () -> None
        self.buffer = LRUCache(self.capacity)

    def get(self):
        # type: () -> list[FlagData]
        return [{"flag": key, "result": value} for key, value in self.buffer.get_all()]

    def set(self, flag, result):
        # type: (str, bool) -> None
        self.buffer.set(flag, result)


def add_feature_flag(flag, result):
    # type: (str, bool) -> None
    """
    Records a flag and its value to be sent on subsequent error events.
    We recommend you do this on flag evaluations. Flags are buffered per Sentry scope.
    """
    flags = sentry_sdk.get_current_scope().flags
    flags.set(flag, result)
