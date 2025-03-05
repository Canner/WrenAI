from datetime import datetime
from typing import Optional, Union

from qdrant_client.http.models import OrderValue
from qdrant_client.local.datetime_utils import parse

MICROS_PER_SECOND = 1_000_000


def datetime_to_microseconds(dt: datetime) -> int:
    return int(dt.timestamp() * MICROS_PER_SECOND)


def to_order_value(value: Union[None, OrderValue, datetime, str]) -> Optional[OrderValue]:
    if value is None:
        return None

    # check if OrderValue
    if isinstance(value, (int, float)):
        return value

    if isinstance(value, datetime):
        return datetime_to_microseconds(value)

    if isinstance(value, str):
        dt = parse(value)
        if dt is not None:
            return datetime_to_microseconds(dt)

    return None
