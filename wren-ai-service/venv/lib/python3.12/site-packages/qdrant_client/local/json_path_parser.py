from enum import Enum
from typing import List, Optional, Tuple

from pydantic import BaseModel


class JsonPathItemType(str, Enum):
    KEY = "key"
    INDEX = "index"
    WILDCARD_INDEX = "wildcard_index"


class JsonPathItem(BaseModel):
    item_type: JsonPathItemType
    index: Optional[
        int
    ] = None  # split into index and key instead of using Union, because pydantic coerces
    # int to str even in case of Union[int, str]. Tested with pydantic==1.10.14
    key: Optional[str] = None


def parse_json_path(key: str) -> List[JsonPathItem]:
    """Parse and validate json path

    Args:
        key: json path

    Returns:
        List[JsonPathItem]: json path split into separate keys

    Raises:
        ValueError: if json path is invalid or empty

    Examples:

        # >>> parse_json_path("a[0][1].b")
        # [
        # JsonPathItem(item_type=<JsonPathItemType.KEY: 'key'>, value='a'),
        # JsonPathItem(item_type=<JsonPathItemType.INDEX: 'index'>, value=0),
        # JsonPathItem(item_type=<JsonPathItemType.INDEX: 'index'>, value=1),
        # JsonPathItem(item_type=<JsonPathItemType.KEY: 'key'>, value='b')
        # ]
    """
    keys = []
    json_path = key
    while json_path:
        json_path_item, rest = match_quote(json_path)
        if json_path_item is None:
            json_path_item, rest = match_key(json_path)

        if json_path_item is None:
            raise ValueError("Invalid path")

        keys.append(json_path_item)
        brackets_chunks, rest = match_brackets(rest)
        keys.extend(brackets_chunks)
        json_path = trunk_sep(rest)
        if not json_path:
            return keys
        continue

    raise ValueError("Invalid path")


def trunk_sep(path: str) -> str:
    if not path:
        return path

    if len(path) == 1:
        raise ValueError("Invalid path")

    if path.startswith("."):
        return path[1:]

    elif path.startswith("["):
        return path
    else:
        raise ValueError("Invalid path")


def match_quote(path: str) -> Tuple[Optional[JsonPathItem], str]:
    if not path.startswith('"'):
        return None, path

    left_quote_pos = 0
    right_quote_pos = path.find('"', 1)

    if path.count('"') < 2:
        raise ValueError("Invalid path")

    return (
        JsonPathItem(
            item_type=JsonPathItemType.KEY, key=path[left_quote_pos + 1 : right_quote_pos]
        ),
        path[right_quote_pos + 1 :],
    )


def match_key(path: str) -> Tuple[Optional[JsonPathItem], str]:
    char_counter = 0
    for char in path:
        if not char.isalnum() and char not in ["_", "-"]:
            break
        char_counter += 1
    if char_counter == 0:
        return None, path

    return (
        JsonPathItem(item_type=JsonPathItemType.KEY, key=path[:char_counter]),
        path[char_counter:],
    )


def match_brackets(rest: str) -> Tuple[List[JsonPathItem], str]:
    keys = []

    while rest:
        json_path_item, rest = _match_brackets(rest)

        if json_path_item is None:
            break

        keys.append(json_path_item)

    return keys, rest


def _match_brackets(path: str) -> Tuple[Optional[JsonPathItem], str]:
    if "[" not in path or not path.startswith("["):
        return None, path

    left_bracket_pos = 0
    right_bracket_pos = path.find("]", left_bracket_pos + 1)

    if right_bracket_pos == -1:
        raise ValueError("Invalid path")

    if right_bracket_pos == (left_bracket_pos + 1):
        return (
            JsonPathItem(item_type=JsonPathItemType.WILDCARD_INDEX),
            path[right_bracket_pos + 1 :],
        )

    try:
        index = int(path[left_bracket_pos + 1 : right_bracket_pos])
        return (
            JsonPathItem(item_type=JsonPathItemType.INDEX, index=index),
            path[right_bracket_pos + 1 :],
        )
    except ValueError as e:
        raise ValueError("Invalid path") from e
