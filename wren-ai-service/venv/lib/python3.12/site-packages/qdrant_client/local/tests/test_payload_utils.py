from typing import Any, Dict

import pytest

from qdrant_client.local.json_path_parser import (
    JsonPathItem,
    JsonPathItemType,
    parse_json_path,
)
from qdrant_client.local.payload_value_extractor import value_by_key
from qdrant_client.local.payload_value_setter import set_value_by_key


def test_parse_json_path() -> None:
    jp_key = "a"
    keys = parse_json_path(jp_key)
    assert keys == [JsonPathItem(item_type=JsonPathItemType.KEY, key="a")]

    jp_key = "a.b"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
    ]

    jp_key = 'a."a[b]".c'
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a[b]"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="c"),
    ]

    jp_key = "a[0]"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=0),
    ]

    jp_key = "a[0].b"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=0),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
    ]

    jp_key = "a[0].b[1]"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=0),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=1),
    ]

    jp_key = "a[][]"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.WILDCARD_INDEX, index=None),
        JsonPathItem(item_type=JsonPathItemType.WILDCARD_INDEX, index=None),
    ]

    jp_key = "a[0][1]"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=0),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=1),
    ]

    jp_key = "a[0][1].b"
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=0),
        JsonPathItem(item_type=JsonPathItemType.INDEX, index=1),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
    ]

    jp_key = 'a."k.c"'
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="k.c"),
    ]

    jp_key = 'a."c[][]".b'
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="c[][]"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
    ]

    jp_key = 'a."c..q".b'
    keys = parse_json_path(jp_key)
    assert keys == [
        JsonPathItem(item_type=JsonPathItemType.KEY, key="a"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="c..q"),
        JsonPathItem(item_type=JsonPathItemType.KEY, key="b"),
    ]

    with pytest.raises(ValueError):
        jp_key = 'a."k.c'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = 'a."k.c".'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = 'a."k.c".[]'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a.'k.c'"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a["
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a[]]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a[][]."
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a[][]b"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = ".a"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a[x]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = 'a[]""'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = '""b'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "[]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a[.]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = 'a["1"]'
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = ""
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a..c"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a.c[]b[]"
        parse_json_path(jp_key)

    with pytest.raises(ValueError):
        jp_key = "a.c[].[]"
        parse_json_path(jp_key)


def test_value_by_key() -> None:
    payload = {
        "name": "John",
        "age": 25,
        "counts": [1, 2, 3],
        "address": {
            "city": "New York",
        },
        "location": [
            {"name": "home", "counts": [1, 2, 3]},
            {"name": "work", "counts": [4, 5, 6]},
        ],
        "nested": [{"empty": []}, {"empty": []}, {"empty": None}],
        "the_null": None,
        "the": {"nested.key": "cuckoo"},
        "double-nest-array": [[1, 2], [3, 4], [5, 6]],
    }
    # region flat=True
    assert value_by_key(payload, "name") == ["John"]
    assert value_by_key(payload, "address.city") == ["New York"]
    assert value_by_key(payload, "location[].name") == ["home", "work"]
    assert value_by_key(payload, "location[0].name") == ["home"]
    assert value_by_key(payload, "location[1].name") == ["work"]
    assert value_by_key(payload, "location[2].name") is None
    assert value_by_key(payload, "location[].name[0]") is None
    assert value_by_key(payload, "location[0]") == [{"name": "home", "counts": [1, 2, 3]}]
    assert value_by_key(payload, "not_exits") is None
    assert value_by_key(payload, "address") == [{"city": "New York"}]
    assert value_by_key(payload, "address.city[0]") is None
    assert value_by_key(payload, "counts") == [1, 2, 3]
    assert value_by_key(payload, "location[].counts") == [1, 2, 3, 4, 5, 6]
    assert value_by_key(payload, "nested[].empty") == [None]
    assert value_by_key(payload, "the_null") == [None]
    assert value_by_key(payload, 'the."nested.key"') == ["cuckoo"]
    assert value_by_key(payload, "double-nest-array[][]") == [1, 2, 3, 4, 5, 6]
    assert value_by_key(payload, "double-nest-array[0][]") == [1, 2]
    assert value_by_key(payload, "double-nest-array[0][0]") == [1]
    assert value_by_key(payload, "double-nest-array[0][0]") == [1]
    assert value_by_key(payload, "double-nest-array[][1]") == [2, 4, 6]
    # endregion

    # region flat=False
    assert value_by_key(payload, "name", flat=False) == ["John"]
    assert value_by_key(payload, "address.city", flat=False) == ["New York"]
    assert value_by_key(payload, "location[].name", flat=False) == ["home", "work"]
    assert value_by_key(payload, "location[0].name", flat=False) == ["home"]
    assert value_by_key(payload, "location[1].name", flat=False) == ["work"]
    assert value_by_key(payload, "location[2].name", flat=False) is None
    assert value_by_key(payload, "location[].name[0]", flat=False) is None
    assert value_by_key(payload, "location[0]", flat=False) == [
        {"name": "home", "counts": [1, 2, 3]}
    ]
    assert value_by_key(payload, "not_exist", flat=False) is None
    assert value_by_key(payload, "address", flat=False) == [{"city": "New York"}]
    assert value_by_key(payload, "address.city[0]", flat=False) is None
    assert value_by_key(payload, "counts", flat=False) == [[1, 2, 3]]
    assert value_by_key(payload, "location[].counts", flat=False) == [
        [1, 2, 3],
        [4, 5, 6],
    ]
    assert value_by_key(payload, "nested[].empty", flat=False) == [[], [], None]
    assert value_by_key(payload, "the_null", flat=False) == [None]

    assert value_by_key(payload, "age.nested.not_exist") is None
    # endregion


def test_set_value_by_key() -> None:
    # region valid keys
    payload: Dict[str, Any] = {}
    new_value: Dict[str, Any] = {}
    key = "a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {}}, payload

    payload = {"a": {"a": 2}}
    new_value = {}
    key = "a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": 2}}, payload

    payload = {"a": {"a": 2}}
    new_value = {"b": 3}
    key = "a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": 2, "b": 3}}, payload

    payload = {"a": {"a": 2}}
    new_value = {"a": 3}
    key = "a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": 3}}, payload

    payload = {"a": {"a": 2}}
    new_value = {"a": 3}
    key = "a.a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": {"a": 3}}}, payload

    payload = {"a": {"a": {"a": 1}}}
    new_value = {"b": 2}
    key = "a.a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": {"a": 1, "b": 2}}}, payload

    payload = {"a": {"a": {"a": 1}}}
    new_value = {"a": 2}
    key = "a.a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"a": {"a": 2}}}, payload

    payload = {"a": []}
    new_value = {"b": 2}
    key = "a[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": []}, payload

    payload = {"a": [{}]}
    new_value = {"b": 2}
    key = "a[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"b": 2}]}, payload

    payload = {"a": [{"a": 1}]}
    new_value = {"b": 2}
    key = "a[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"a": 1, "b": 2}]}, payload

    payload = {"a": [[]]}
    new_value = {"b": 2}
    key = "a[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"b": 2}]}, payload

    payload = {"a": [[]]}
    new_value = {"b": 2}
    key = "a[1]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[]]}, payload

    payload = {"a": [{"a": []}]}
    new_value = {"b": 2}
    key = "a[0].a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"a": {"b": 2}}]}, payload

    payload = {"a": [{"a": []}]}
    new_value = {"b": 2}
    key = "a[].a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"a": {"b": 2}}]}, payload

    payload = {"a": [{"a": []}, {"a": []}]}
    new_value = {"b": 2}
    key = "a[].a"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"a": {"b": 2}}, {"a": {"b": 2}}]}, payload

    payload = {"a": 1, "b": 2}
    new_value = {"c": 3}
    key = "c"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": 1, "b": 2, "c": {"c": 3}}, payload

    payload = {"a": {"b": {"c": 1}}}
    new_value = {"d": 2}
    key = "a.b.d"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": 1, "d": {"d": 2}}}}, payload

    payload = {"a": {"b": {"c": 1}}}
    new_value = {"c": 2}
    key = "a.b"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": 2}}}, payload

    payload = {"a": [{"b": 1}, {"b": 2}]}
    new_value = {"c": 3}
    key = "a[1]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"b": 1}, {"b": 2, "c": 3}]}, payload

    payload = {"a": []}
    new_value = {"b": {"c": 1}}
    key = "a[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": []}, payload

    payload = {"a": {"b": {"c": {"d": {"e": 1}}}}}
    new_value = {"f": 2}
    key = "a.b.c.d"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": {"d": {"e": 1, "f": 2}}}}}, payload

    payload = {"a": {"b": {"c": 1}}}
    new_value = {"d": {"e": 2}}
    key = "a.b.c"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": {"d": {"e": 2}}}}}, payload

    payload = {"a": [{"b": 1}]}
    new_value = {"c": 2}
    key = "a[1]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [{"b": 1}]}, payload

    payload = {"a": {"b": [{"c": 1}, {"c": 2}]}}
    new_value = {"d": 3}
    key = "a.b[0].c"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": [{"c": {"d": 3}}, {"c": 2}]}}, payload

    payload = {"a": {"b": {"c": [{"d": 1}]}}}
    new_value = {"e": {"f": 2}}
    key = "a.b.c[0].d"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": [{"d": {"e": {"f": 2}}}]}}}, payload

    payload = {"a": [[{"b": 1}], [{"b": 2}]]}
    new_value = {"c": 3}
    key = "a[0][0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[{"b": 1, "c": 3}], [{"b": 2}]]}, payload

    payload = {"a": [[{"b": 1}], [{"b": 2}]]}
    new_value = {"c": 3}
    key = "a[1][0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[{"b": 1}], [{"b": 2, "c": 3}]]}, payload

    payload = {"a": [[{"b": 1}], [{"b": 2}]]}
    new_value = {"c": 3}
    key = "a[1][1]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[{"b": 1}], [{"b": 2}]]}, payload

    payload = {"a": [[{"b": 1}], [{"b": 2}]]}
    new_value = {"c": 3}
    key = "a[][0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[{"b": 1, "c": 3}], [{"b": 2, "c": 3}]]}, payload

    payload = {"a": [[{"b": 1}], [{"b": 2}]]}
    new_value = {"c": 3}
    key = "a[][]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": [[{"b": 1, "c": 3}], [{"b": 2, "c": 3}]]}, payload

    payload = {"a": []}
    new_value = {"c": 3}
    key = 'a."b.c"'
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b.c": {"c": 3}}}, payload

    payload = {"a": {"c": [1]}}
    new_value = {"a": 1}
    key = "a.c[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"c": [{"a": 1}]}}, payload

    payload = {"a": {"c": [1]}}
    new_value = {"a": 1}
    key = "a.c[0].d"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"c": [{"d": {"a": 1}}]}}, payload

    payload = {"": 2}
    new_value = {"a": 1}
    key = '""'
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"": {"a": 1}}, payload
    # endregion

    # region exceptions

    try:
        payload = {"a": []}
        new_value = {"c": 3}
        key = "a.'b.c'"
        set_value_by_key(payload, parse_json_path(key), new_value)
        assert False, f"Should've raised an exception due to the key with incorrect quotes: {key}"
    except Exception:
        assert True

    try:
        payload = {"a": [{"b": 1}, {"b": 2}]}
        new_value = {"c": 3}
        key = "a[-1]"
        set_value_by_key(payload, parse_json_path(key), new_value)
        assert False, "Negative indexation is not supported"
    except Exception:
        assert True

    try:
        payload = {"a": [{"b": 1}, {"b": 2}]}
        new_value = {"c": 3}
        key = "a["
        set_value_by_key(payload, parse_json_path(key), new_value)
        assert False, f"Should've raised an exception due to the incorrect key: {key}"
    except Exception:
        assert True

    try:
        payload = {"a": [{"b": 1}, {"b": 2}]}
        new_value = {"c": 3}
        key = "a]"
        set_value_by_key(payload, parse_json_path(key), new_value)
        assert False, f"Should've raise an exception due to the incorrect key: {key}"
    except Exception:
        assert True

    # endregion

    # region wrong keys
    payload = {"a": []}
    new_value = {}
    key = "a.b[0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": []}}, payload

    payload = {"a": []}
    new_value = {}
    key = "a.b"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {}}}, payload

    payload = {"a": []}
    new_value = {"c": 2}
    key = "a.b"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": {"c": 2}}}, payload

    payload = {"a": [[{"a": 1}]]}
    new_value = {"a": 2}
    key = "a.b[0][0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"b": []}}, payload

    payload = {"a": {"c": 2}}
    new_value = {"a": 1}
    key = "a[]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": []}, payload

    payload = {"a": {"c": 2}}
    new_value = {"a": 1}
    key = "a[].b"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": []}, payload

    payload = {"a": {"c": [1]}}
    new_value = {"a": 1}
    key = "a.c[][][0]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"c": [[]]}}, payload

    payload = {"a": {"c": [{"d": 1}]}}
    new_value = {"a": 1}
    key = "a.c[][]"
    set_value_by_key(payload, parse_json_path(key), new_value)
    assert payload == {"a": {"c": [[]]}}, payload
    # endregion
