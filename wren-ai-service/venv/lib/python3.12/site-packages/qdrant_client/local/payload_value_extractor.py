import uuid
from typing import Any, List, Optional

from qdrant_client.local.json_path_parser import (
    JsonPathItem,
    JsonPathItemType,
    parse_json_path,
)


def value_by_key(payload: dict, key: str, flat: bool = True) -> Optional[List[Any]]:
    """
    Get value from payload by key.
    Args:
        payload: arbitrary json-like object
        flat: If True, extend list of values. If False, append. By default, we use True and flatten the arrays,
            we need it for filters, however for `count` method we need to keep the arrays as is.
        key:
            Key or path to value in payload.
            Examples:
                - "name"
                - "address.city"
                - "location[].name"
                - "location[0].name"

    Returns:
        List of values or None if key not found.
    """
    keys = parse_json_path(key)
    result = []

    def _get_value(data: Any, k_list: List[JsonPathItem]) -> None:
        if not k_list:
            return

        current_key = k_list.pop(0)
        if len(k_list) == 0:
            if isinstance(data, dict) and current_key.item_type == JsonPathItemType.KEY:
                if current_key.key in data:
                    value = data[current_key.key]
                    if isinstance(value, list) and flat:
                        result.extend(value)
                    else:
                        result.append(value)

            elif isinstance(data, list):
                if current_key.item_type == JsonPathItemType.WILDCARD_INDEX:
                    result.extend(data)

                elif current_key.item_type == JsonPathItemType.INDEX:
                    assert current_key.index is not None

                    if current_key.index < len(data):
                        result.append(data[current_key.index])

        elif current_key.item_type == JsonPathItemType.KEY:
            if not isinstance(data, dict):
                return

            if current_key.key in data:
                _get_value(data[current_key.key], k_list.copy())

        elif current_key.item_type == JsonPathItemType.INDEX:
            assert current_key.index is not None

            if not isinstance(data, list):
                return

            if current_key.index < len(data):
                _get_value(data[current_key.index], k_list.copy())

        elif current_key.item_type == JsonPathItemType.WILDCARD_INDEX:
            if not isinstance(data, list):
                return

            for item in data:
                _get_value(item, k_list.copy())

    _get_value(payload, keys)
    return result if result else None


def parse_uuid(value: Any) -> Optional[uuid.UUID]:
    """
    Parse UUID from value.
    Args:
        value: arbitrary value
    """
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None
