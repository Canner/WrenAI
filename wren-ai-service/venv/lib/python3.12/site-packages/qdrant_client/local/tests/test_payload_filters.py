from qdrant_client.http.models import models
from qdrant_client.local.payload_filters import check_filter


def test_nested_payload_filters():
    payload = {
        "country": {
            "name": "Germany",
            "capital": "Berlin",
            "cities": [
                {
                    "name": "Berlin",
                    "population": 3.7,
                    "location": {
                        "lon": 13.76116,
                        "lat": 52.33826,
                    },
                    "sightseeing": ["Brandenburg Gate", "Reichstag"],
                },
                {
                    "name": "Munich",
                    "population": 1.5,
                    "location": {
                        "lon": 11.57549,
                        "lat": 48.13743,
                    },
                    "sightseeing": ["Marienplatz", "Olympiapark"],
                },
                {
                    "name": "Hamburg",
                    "population": 1.8,
                    "location": {
                        "lon": 9.99368,
                        "lat": 53.55108,
                    },
                    "sightseeing": ["Reeperbahn", "Elbphilharmonie"],
                },
            ],
        }
    }

    query = models.Filter(
        **{
            "must": [
                {
                    "nested": {
                        "key": "country.cities",
                        "filter": {
                            "must": [
                                {
                                    "key": "population",
                                    "range": {
                                        "gte": 1.0,
                                    },
                                }
                            ],
                            "must_not": [{"key": "sightseeing", "values_count": {"gt": 1}}],
                        },
                    }
                }
            ]
        }
    )

    res = check_filter(query, payload, 0)
    assert res is False

    query = models.Filter(
        **{
            "must": [
                {
                    "nested": {
                        "key": "country.cities",
                        "filter": {
                            "must": [
                                {
                                    "key": "population",
                                    "range": {
                                        "gte": 1.0,
                                    },
                                }
                            ]
                        },
                    }
                }
            ]
        }
    )

    res = check_filter(query, payload, 0)
    assert res is True

    query = models.Filter(
        **{
            "must": [
                {
                    "nested": {
                        "key": "country.cities",
                        "filter": {
                            "must": [
                                {
                                    "key": "population",
                                    "range": {
                                        "gte": 1.0,
                                    },
                                },
                                {"key": "sightseeing", "values_count": {"gt": 2}},
                            ]
                        },
                    }
                }
            ]
        }
    )

    res = check_filter(query, payload, 0)
    assert res is False

    query = models.Filter(
        **{
            "must": [
                {
                    "nested": {
                        "key": "country.cities",
                        "filter": {
                            "must": [
                                {
                                    "key": "population",
                                    "range": {
                                        "gte": 9.0,
                                    },
                                }
                            ]
                        },
                    }
                }
            ]
        }
    )

    res = check_filter(query, payload, 0)
    assert res is False


def test_geo_polygon_filter_query():
    payload = {
        "location": [
            {
                "lon": 70.0,
                "lat": 70.0,
            },
        ]
    }

    query = models.Filter(
        **{
            "must": [
                {
                    "key": "location",
                    "geo_polygon": {
                        "exterior": {
                            "points": [
                                {"lon": 55.455868, "lat": 55.495862},
                                {"lon": 86.455868, "lat": 55.495862},
                                {"lon": 86.455868, "lat": 86.495862},
                                {"lon": 55.455868, "lat": 86.495862},
                                {"lon": 55.455868, "lat": 55.495862},
                            ]
                        },
                    },
                }
            ]
        }
    )

    res = check_filter(query, payload, 0)
    assert res is True

    payload = {
        "location": [
            {
                "lon": 30.693738,
                "lat": 30.502165,
            },
        ]
    }

    res = check_filter(query, payload, 0)
    assert res is False
