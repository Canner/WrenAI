from datetime import date, datetime, timezone
from typing import Any, List, Optional, Union

import numpy as np

from qdrant_client.http import models
from qdrant_client.local import datetime_utils
from qdrant_client.local.geo import boolean_point_in_polygon, geo_distance
from qdrant_client.local.payload_value_extractor import value_by_key


def get_value_counts(values: List[Any]) -> List[int]:
    counts = []

    if all(value is None for value in values):
        counts.append(0)
    else:
        for value in values:
            if value is None:
                counts.append(0)
            elif hasattr(value, "__len__") and not isinstance(value, str):
                counts.append(len(value))
            else:
                counts.append(1)
    return counts


def check_values_count(condition: models.ValuesCount, values: Optional[List[Any]]) -> bool:
    if values is None:
        return False

    counts = get_value_counts(values)

    if condition.lt is not None and all(count >= condition.lt for count in counts):
        return False
    if condition.lte is not None and all(count > condition.lte for count in counts):
        return False
    if condition.gt is not None and all(count <= condition.gt for count in counts):
        return False
    if condition.gte is not None and all(count < condition.gte for count in counts):
        return False
    return True


def check_geo_radius(condition: models.GeoRadius, values: Any) -> bool:
    if isinstance(values, dict) and "lat" in values and "lon" in values:
        lat = values["lat"]
        lon = values["lon"]

        distance = geo_distance(
            lon1=lon,
            lat1=lat,
            lon2=condition.center.lon,
            lat2=condition.center.lat,
        )

        return distance < condition.radius

    return False


def check_geo_bounding_box(condition: models.GeoBoundingBox, values: Any) -> bool:
    if isinstance(values, dict) and "lat" in values and "lon" in values:
        lat = values["lat"]
        lon = values["lon"]

        # handle anti-meridian crossing case
        if condition.top_left.lon > condition.bottom_right.lon:
            longitude_condition = (
                (condition.top_left.lon <= lon <= 180 or -180 <= lon <= condition.bottom_right.lon)
            )
        else:
            longitude_condition = (condition.top_left.lon <= lon <= condition.bottom_right.lon)

        latitude_condition = condition.top_left.lat >= lat >= condition.bottom_right.lat

        return (
            longitude_condition
            and latitude_condition
        )

    return False


def check_geo_polygon(condition: models.GeoPolygon, values: Any) -> bool:
    if isinstance(values, dict) and "lat" in values and "lon" in values:
        lat = values["lat"]
        lon = values["lon"]
        exterior = [(point.lat, point.lon) for point in condition.exterior.points]
        interiors = []
        if condition.interiors is not None:
            interiors = [
                [(point.lat, point.lon) for point in interior.points]
                for interior in condition.interiors
            ]
        return boolean_point_in_polygon(point=(lat, lon), exterior=exterior, interiors=interiors)

    return False


def check_range_interface(condition: models.RangeInterface, value: Any) -> bool:
    if isinstance(condition, models.Range):
        return check_range(condition, value)
    if isinstance(condition, models.DatetimeRange):
        return check_datetime_range(condition, value)
    return False


def check_range(condition: models.Range, value: Any) -> bool:
    if not isinstance(value, (int, float)):
        return False
    return (
        (condition.lt is None or value < condition.lt)
        and (condition.lte is None or value <= condition.lte)
        and (condition.gt is None or value > condition.gt)
        and (condition.gte is None or value >= condition.gte)
    )


def check_datetime_range(condition: models.DatetimeRange, value: Any) -> bool:
    def make_condition_tz_aware(dt: Optional[Union[datetime, date]]) -> Optional[datetime]:
        if isinstance(dt, date) and not isinstance(dt, datetime):
            dt = datetime.combine(dt, datetime.min.time())

        if dt is None or dt.tzinfo is not None:
            return dt

        # Assume UTC if no timezone is provided
        return dt.replace(tzinfo=timezone.utc)

    if not isinstance(value, str):
        return False

    dt = datetime_utils.parse(value)

    if dt is None:
        return False

    condition.lt = make_condition_tz_aware(condition.lt)
    condition.lte = make_condition_tz_aware(condition.lte)
    condition.gt = make_condition_tz_aware(condition.gt)
    condition.gte = make_condition_tz_aware(condition.gte)

    return (
        (condition.lt is None or dt < condition.lt)
        and (condition.lte is None or dt <= condition.lte)
        and (condition.gt is None or dt > condition.gt)
        and (condition.gte is None or dt >= condition.gte)
    )


def check_match(condition: models.Match, value: Any) -> bool:
    if isinstance(condition, models.MatchValue):
        return value == condition.value
    if isinstance(condition, models.MatchText):
        return value is not None and condition.text in value
    if isinstance(condition, models.MatchAny):
        return value in condition.any
    if isinstance(condition, models.MatchExcept):
        return value not in condition.except_
    raise ValueError(f"Unknown match condition: {condition}")


def check_nested_filter(nested_filter: models.Filter, values: List[Any]) -> bool:
    return any(check_filter(nested_filter, v, point_id=-1) for v in values)


def check_condition(
    condition: models.Condition, payload: dict, point_id: models.ExtendedPointId
) -> bool:
    if isinstance(condition, models.IsNullCondition):
        values = value_by_key(payload, condition.is_null.key, flat=False)
        if values is None:
            return False
        if any(v is None for v in values):
            return True
    elif isinstance(condition, models.IsEmptyCondition):
        values = value_by_key(payload, condition.is_empty.key, flat=False)
        if (
            values is None
            or len(values) == 0
            or all((v is None or (isinstance(v, list) and len(v) == 0)) for v in values)
        ):
            return True
    elif isinstance(condition, models.HasIdCondition):
        if point_id in condition.has_id:
            return True
    elif isinstance(condition, models.FieldCondition):
        values = value_by_key(payload, condition.key)
        if condition.match is not None:
            if values is None:
                return False
            return any(check_match(condition.match, v) for v in values)
        if condition.range is not None:
            if values is None:
                return False
            return any(check_range_interface(condition.range, v) for v in values)
        if condition.geo_bounding_box is not None:
            if values is None:
                return False
            return any(check_geo_bounding_box(condition.geo_bounding_box, v) for v in values)
        if condition.geo_radius is not None:
            if values is None:
                return False
            return any(check_geo_radius(condition.geo_radius, v) for v in values)
        if condition.values_count is not None:
            values = value_by_key(payload, condition.key, flat=False)
            return check_values_count(condition.values_count, values)
        if condition.geo_polygon is not None:
            if values is None:
                return False
            return any(check_geo_polygon(condition.geo_polygon, v) for v in values)
    elif isinstance(condition, models.NestedCondition):
        values = value_by_key(payload, condition.nested.key)
        if values is None:
            return False
        return check_nested_filter(condition.nested.filter, values)
    elif isinstance(condition, models.Filter):
        return check_filter(condition, payload, point_id)
    else:
        raise ValueError(f"Unknown condition: {condition}")
    return False


def check_must(
    conditions: List[models.Condition], payload: dict, point_id: models.ExtendedPointId
) -> bool:
    return all(check_condition(condition, payload, point_id) for condition in conditions)


def check_must_not(
    conditions: List[models.Condition], payload: dict, point_id: models.ExtendedPointId
) -> bool:
    return all(not check_condition(condition, payload, point_id) for condition in conditions)


def check_should(
    conditions: List[models.Condition], payload: dict, point_id: models.ExtendedPointId
) -> bool:
    return any(check_condition(condition, payload, point_id) for condition in conditions)


def check_min_should(
    conditions: List[models.Condition],
    payload: dict,
    point_id: models.ExtendedPointId,
    min_count: int,
) -> bool:
    return (
        sum(check_condition(condition, payload, point_id) for condition in conditions) >= min_count
    )


def check_filter(
    payload_filter: models.Filter, payload: dict, point_id: models.ExtendedPointId
) -> bool:
    if payload_filter.must is not None:
        if not check_must(payload_filter.must, payload, point_id):
            return False
    if payload_filter.must_not is not None:
        if not check_must_not(payload_filter.must_not, payload, point_id):
            return False
    if payload_filter.should is not None:
        if not check_should(payload_filter.should, payload, point_id):
            return False
    if payload_filter.min_should is not None:
        if not check_min_should(
            payload_filter.min_should.conditions,
            payload,
            point_id,
            payload_filter.min_should.min_count,
        ):
            return False
    return True


def calculate_payload_mask(
    payloads: List[dict],
    payload_filter: Optional[models.Filter],
    ids_inv: List[models.ExtendedPointId],
) -> np.ndarray:
    if payload_filter is None:
        return np.ones(len(payloads), dtype=bool)

    mask = np.zeros(len(payloads), dtype=bool)
    for i, payload in enumerate(payloads):
        if check_filter(payload_filter, payload, ids_inv[i]):
            mask[i] = True
    return mask
