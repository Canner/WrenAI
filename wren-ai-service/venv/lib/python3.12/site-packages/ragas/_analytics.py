from __future__ import annotations

import atexit
import json
import logging
import os
import time
import typing as t
import uuid
from functools import lru_cache, wraps
from threading import Lock, Thread
from typing import List

import requests
from appdirs import user_data_dir
from pydantic import BaseModel, Field

from ragas._version import __version__
from ragas.utils import get_debug_mode

if t.TYPE_CHECKING:
    P = t.ParamSpec("P")
    T = t.TypeVar("T")
    AsyncFunc = t.Callable[P, t.Coroutine[t.Any, t.Any, t.Any]]

logger = logging.getLogger(__name__)


USAGE_TRACKING_URL = "https://t.explodinggradients.com"
USAGE_REQUESTS_TIMEOUT_SEC = 1
USER_DATA_DIR_NAME = "ragas"
# Any chance you chance this also change the variable in our ci.yaml file
RAGAS_DO_NOT_TRACK = "RAGAS_DO_NOT_TRACK"
RAGAS_DEBUG_TRACKING = "__RAGAS_DEBUG_TRACKING"


@lru_cache(maxsize=1)
def do_not_track() -> bool:  # pragma: no cover
    # Returns True if and only if the environment variable is defined and has value True
    # The function is cached for better performance.
    return os.environ.get(RAGAS_DO_NOT_TRACK, str(False)).lower() == "true"


@lru_cache(maxsize=1)
def _usage_event_debugging() -> bool:
    # For Ragas developers only - debug and print event payload if turned on
    return os.environ.get(RAGAS_DEBUG_TRACKING, str(False)).lower() == "true"


def silent(func: t.Callable[P, T]) -> t.Callable[P, T]:  # pragma: no cover
    # Silent errors when tracking
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> t.Any:
        try:
            return func(*args, **kwargs)
        except Exception as err:  # pylint: disable=broad-except
            if _usage_event_debugging():
                if get_debug_mode():
                    logger.error(
                        "Tracking Error: %s", err, stack_info=True, stacklevel=3
                    )
                    raise err
                else:
                    logger.info("Tracking Error: %s", err)
            else:
                logger.debug("Tracking Error: %s", err)

    return wrapper


@lru_cache(maxsize=1)
@silent
def get_userid() -> str:
    user_id_path = user_data_dir(appname=USER_DATA_DIR_NAME)
    uuid_filepath = os.path.join(user_id_path, "uuid.json")
    if os.path.exists(uuid_filepath):
        user_id = json.load(open(uuid_filepath))["userid"]
    else:
        user_id = "a-" + uuid.uuid4().hex
        os.makedirs(user_id_path)
        with open(uuid_filepath, "w") as f:
            json.dump({"userid": user_id}, f)
    return user_id


# Analytics Events
class BaseEvent(BaseModel):
    event_type: str
    user_id: str = Field(default_factory=get_userid)
    ragas_version: str = Field(default=__version__)


class EvaluationEvent(BaseEvent):
    metrics: t.List[str]
    num_rows: int
    evaluation_type: t.Literal["SINGLE_TURN", "MULTI_TURN"]
    language: str
    event_type: str = "evaluation"


class TestsetGenerationEvent(BaseEvent):
    evolution_names: t.List[str]
    evolution_percentages: t.List[float]
    num_rows: int
    language: str
    is_experiment: bool = False
    version: str = "3"  # the version of testset generation pipeline


class AnalyticsBatcher:
    def __init__(self, batch_size: int = 50, flush_interval: float = 120):
        """
        Initialize an AnalyticsBatcher instance.

        Args:
            batch_size (int, optional): Maximum number of events to batch before flushing. Defaults to 50.
            flush_interval (float, optional): Maximum time in seconds between flushes. Defaults to 5.
        """
        self.buffer: List[EvaluationEvent] = []
        self.lock = Lock()
        self.last_flush_time = time.time()
        self.BATCH_SIZE = batch_size
        self.FLUSH_INTERVAL = flush_interval  # seconds
        self._running = True

        # Create and start daemon thread
        self._flush_thread = Thread(target=self._flush_loop, daemon=True)
        logger.debug(
            f"Starting AnalyticsBatcher thread with interval {self.FLUSH_INTERVAL} seconds"
        )
        self._flush_thread.start()

    def _flush_loop(self) -> None:
        """Background thread that periodically flushes the buffer."""
        while self._running:
            time.sleep(1)  # Check every second
            if (
                len(self.buffer) >= self.BATCH_SIZE
                or (time.time() - self.last_flush_time) > self.FLUSH_INTERVAL
            ):
                self.flush()

    def add_evaluation(self, evaluation_event: EvaluationEvent) -> None:
        with self.lock:
            self.buffer.append(evaluation_event)

    def _join_evaluation_events(
        self, events: List[EvaluationEvent]
    ) -> List[EvaluationEvent]:
        """
        Join multiple evaluation events into a single event and increase the num_rows.
        Group properties except for num_rows.
        """
        if not events:
            return []

        # Group events by their properties (except num_rows)
        grouped_events = {}
        for event in events:
            key = (
                event.event_type,
                tuple(event.metrics),
                event.evaluation_type,
            )
            if key not in grouped_events:
                grouped_events[key] = event
            else:
                grouped_events[key].num_rows += event.num_rows

        # Convert grouped events back to a list
        logger.debug(f"Grouped events: {grouped_events}")
        return list(grouped_events.values())

    def flush(self) -> None:
        # if no events to send, do nothing
        if not self.buffer:
            return

        logger.debug(f"Flushing triggered for {len(self.buffer)} events")
        try:
            # join all the EvaluationEvents into a single event and send it
            events_to_send = self._join_evaluation_events(self.buffer)
            for event in events_to_send:
                track(event)
        except Exception as err:
            if _usage_event_debugging():
                logger.error("Tracking Error: %s", err, stack_info=True, stacklevel=3)
        finally:
            with self.lock:
                self.buffer = []
                self.last_flush_time = time.time()

    def shutdown(self) -> None:
        """Cleanup method to stop the background thread and flush remaining events."""
        self._running = False
        self.flush()  # Final flush of any remaining events
        logger.debug("AnalyticsBatcher shutdown complete")


@silent
def track(event_properties: BaseEvent):
    if do_not_track():
        return

    payload = dict(event_properties)
    if _usage_event_debugging():
        # For internal debugging purpose
        logger.info("Tracking Payload: %s", payload)
        return

    requests.post(USAGE_TRACKING_URL, json=payload, timeout=USAGE_REQUESTS_TIMEOUT_SEC)


class IsCompleteEvent(BaseEvent):
    is_completed: bool = True  # True if the event was completed, False otherwise


@silent
def track_was_completed(func: t.Callable[P, T]) -> t.Callable[P, T]:  # pragma: no cover
    """
    Track if the function was completed. This helps us understand failure cases and improve the user experience. Disable tracking by setting the environment variable RAGAS_DO_NOT_TRACK to True as usual.
    """

    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> t.Any:
        track(IsCompleteEvent(event_type=func.__name__, is_completed=False))
        result = func(*args, **kwargs)
        track(IsCompleteEvent(event_type=func.__name__, is_completed=True))

        return result

    return wrapper


# Create a global batcher instance
_analytics_batcher = AnalyticsBatcher(batch_size=10, flush_interval=10)
# Register shutdown handler
atexit.register(_analytics_batcher.shutdown)
