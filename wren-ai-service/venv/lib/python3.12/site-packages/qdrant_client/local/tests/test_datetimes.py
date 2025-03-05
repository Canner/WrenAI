from datetime import datetime, timedelta, timezone

import pytest

from qdrant_client.local.datetime_utils import parse


@pytest.mark.parametrize(  # type: ignore
    "date_str, expected",
    [
        ("2021-01-01T00:00:00", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01T00:00:00Z", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01T00:00:00+00:00", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01T00:00:00.000000", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01T00:00:00.000000Z", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        (
            "2021-01-01T00:00:00.000000+01:00",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=1))),
        ),
        (
            "2021-01-01T00:00:00.000000-10:00",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=-10))),
        ),
        ("2021-01-01", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01 00:00:00", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01 00:00:00Z", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        (
            "2021-01-01 00:00:00+0200",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=2))),
        ),
        ("2021-01-01 00:00:00.000000", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        ("2021-01-01 00:00:00.000000Z", datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone.utc)),
        (
            "2021-01-01 00:00:00.000000+00:30",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(minutes=30))),
        ),
        (
            "2021-01-01 00:00:00.000009+00:30",
            datetime(2021, 1, 1, 0, 0, 0, 9, tzinfo=timezone(timedelta(minutes=30))),
        ),
        # this is accepted in core but not here, there is no specifier for only-hour offset
        (
            "2021-01-01 00:00:00.000+01",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=1))),
        ),
        (
            "2021-01-01 00:00:00.000-10",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=-10))),
        ),
        (
            "2021-01-01 00:00:00-03:00",
            datetime(2021, 1, 1, 0, 0, 0, tzinfo=timezone(timedelta(hours=-3))),
        ),
    ],
)
def test_parse_dates(date_str: str, expected: datetime):
    assert parse(date_str) == expected
