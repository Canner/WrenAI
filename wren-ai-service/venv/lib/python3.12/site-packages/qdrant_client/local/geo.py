from math import asin, cos, radians, sin, sqrt
from typing import List, Tuple


def geo_distance(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """
    Calculate distance between two points on Earth using Haversine formula.

    Args:
        lon1: longitude of first point
        lat1: latitude of first point
        lon2: longitude of second point
        lat2: latitude of second point

    Returns:
        distance in meters
    """

    # convert decimal degrees to radians
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    # haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))
    # Radius of earth in kilometers is 6371
    km = 6371 * c
    return km * 1000


def test_geo_distance() -> None:
    moscow = {"lon": 37.6173, "lat": 55.7558}
    london = {"lon": -0.1278, "lat": 51.5074}
    berlin = {"lon": 13.4050, "lat": 52.5200}

    assert geo_distance(moscow["lon"], moscow["lat"], moscow["lon"], moscow["lat"]) < 1.0

    assert geo_distance(moscow["lon"], moscow["lat"], london["lon"], london["lat"]) > 2400 * 1000
    assert geo_distance(moscow["lon"], moscow["lat"], london["lon"], london["lat"]) < 2600 * 1000
    assert geo_distance(moscow["lon"], moscow["lat"], berlin["lon"], berlin["lat"]) > 1600 * 1000
    assert geo_distance(moscow["lon"], moscow["lat"], berlin["lon"], berlin["lat"]) < 1650 * 1000


def boolean_point_in_polygon(
    point: Tuple[float, float],
    exterior: List[Tuple[float, float]],
    interiors: List[List[Tuple[float, float]]],
) -> bool:
    inside_poly = False

    if in_ring(point, exterior, True):
        in_hole = False
        k = 0
        while k < len(interiors) and not in_hole:
            if in_ring(point, interiors[k], False):
                in_hole = True
            k += 1
        if not in_hole:
            inside_poly = True

    return inside_poly


def in_ring(
    pt: Tuple[float, float], ring: List[Tuple[float, float]], ignore_boundary: bool
) -> bool:
    is_inside = False
    if ring[0][0] == ring[len(ring) - 1][0] and ring[0][1] == ring[len(ring) - 1][1]:
        ring = ring[0 : len(ring) - 1]
    j = len(ring) - 1
    for i in range(0, len(ring)):
        xi = ring[i][0]
        yi = ring[i][1]
        xj = ring[j][0]
        yj = ring[j][1]
        on_boundary = (
            (pt[1] * (xi - xj) + yi * (xj - pt[0]) + yj * (pt[0] - xi) == 0)
            and ((xi - pt[0]) * (xj - pt[0]) <= 0)
            and ((yi - pt[1]) * (yj - pt[1]) <= 0)
        )
        if on_boundary:
            return not ignore_boundary
        intersect = ((yi > pt[1]) != (yj > pt[1])) and (
            pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi
        )
        if intersect:
            is_inside = not is_inside
        j = i
    return is_inside
