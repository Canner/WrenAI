from typing import Any, Dict, List, Optional, Type

from qdrant_client.local.json_path_parser import JsonPathItem, JsonPathItemType


def set_value_by_key(payload: dict, keys: List[JsonPathItem], value: Any) -> None:
    """
    Set value in payload by key.
    Args:
        payload: arbitrary json-like object
        keys:
            list of json path items, e.g.:
            [
                JsonPathItem(item_type=<JsonPathItemType.KEY: 'key'>, value='a'),
                JsonPathItem(item_type=<JsonPathItemType.INDEX: 'index'>, value=0),
                JsonPathItem(item_type=<JsonPathItemType.INDEX: 'index'>, value=1),
                JsonPathItem(item_type=<JsonPathItemType.KEY: 'key'>, value='b')
            ]

            The original keys could look like this:
              - "name"
              - "address.city"
              - "location[].name"
              - "location[0].name"

        value: value to set
    """
    Setter.set(payload, keys.copy(), value, None, None)


class Setter:
    TYPE: Any
    SETTERS: Dict[JsonPathItemType, Type["Setter"]] = {}

    @classmethod
    def add_setter(cls, item_type: JsonPathItemType, setter: Type["Setter"]) -> None:
        cls.SETTERS[item_type] = setter

    @classmethod
    def set(
        cls,
        data: Any,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
        prev_data: Any,
        prev_key: Optional[JsonPathItem],
    ) -> None:
        if not k_list:
            return

        current_key = k_list.pop(0)
        cls.SETTERS[current_key.item_type]._set(
            data,
            current_key,
            k_list,
            value,
            prev_data,
            prev_key,
        )

    @classmethod
    def _set(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
        prev_data: Any,
        prev_key: Optional[JsonPathItem],
    ) -> None:
        if isinstance(data, cls.TYPE):
            cls._set_compatible_types(
                data=data, current_key=current_key, k_list=k_list, value=value
            )
        else:
            cls._set_incompatible_types(
                current_key=current_key,
                k_list=k_list,
                value=value,
                prev_data=prev_data,
                prev_key=prev_key,
            )

    @classmethod
    def _set_compatible_types(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
    ) -> None:
        raise NotImplementedError()

    @classmethod
    def _set_incompatible_types(
        cls,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
        prev_data: Any,
        prev_key: Optional[JsonPathItem],
    ) -> None:
        raise NotImplementedError()


class KeySetter(Setter):
    TYPE = Dict

    @classmethod
    def _set_compatible_types(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
    ) -> None:
        if current_key.key not in data:
            data[current_key.key] = {}

        if len(k_list) == 0:
            if isinstance(data[current_key.key], dict):
                data[current_key.key].update(value)
            else:
                data[current_key.key] = value
        else:
            cls.set(data[current_key.key], k_list.copy(), value, data, current_key)

    @classmethod
    def _set_incompatible_types(
        cls,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
        prev_data: Any,
        prev_key: Optional[JsonPathItem],
    ) -> None:
        assert prev_key is not None

        if len(k_list) == 0:
            if prev_key.item_type == JsonPathItemType.KEY:
                prev_data[prev_key.key] = {current_key.key: value}
            else:  # if prev key was WILDCARD, we need to pass INDEX instead with an index set
                prev_data[prev_key.index] = {current_key.key: value}
        else:
            if prev_key.item_type == JsonPathItemType.KEY:
                prev_data[prev_key.key] = {current_key.key: {}}
                cls.set(
                    prev_data[prev_key.key][current_key.key],
                    k_list.copy(),
                    value,
                    prev_data[prev_key.key],
                    current_key,
                )
            else:
                prev_data[prev_key.index] = {current_key.key: {}}
                cls.set(
                    prev_data[prev_key.index][current_key.key],
                    k_list.copy(),
                    value,
                    prev_data[prev_key.index],
                    current_key,
                )


class _ListSetter(Setter):
    TYPE = List

    @classmethod
    def _set_incompatible_types(
        cls,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
        prev_data: Any,
        prev_key: Optional[JsonPathItem],
    ) -> None:
        assert prev_key is not None

        if prev_key.item_type == JsonPathItemType.KEY:
            prev_data[prev_key.key] = []
            return
        else:
            prev_data[prev_key.index] = []
            return

    @classmethod
    def _set_compatible_types(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
    ) -> None:
        raise NotImplementedError()


class IndexSetter(_ListSetter):
    @classmethod
    def _set_compatible_types(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
    ) -> None:
        assert current_key.index is not None

        if current_key.index < len(data):
            if len(k_list) == 0:
                if isinstance(data[current_key.index], dict):
                    data[current_key.index].update(value)
                else:
                    data[current_key.index] = value
                return

            cls.set(data[current_key.index], k_list.copy(), value, data, current_key)


class WildcardIndexSetter(_ListSetter):
    @classmethod
    def _set_compatible_types(
        cls,
        data: Any,
        current_key: JsonPathItem,
        k_list: List[JsonPathItem],
        value: Dict[str, Any],
    ) -> None:
        if len(k_list) == 0:
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    data[i].update(value)
                else:
                    data[i] = value
        else:
            for i, item in enumerate(data):
                cls.set(
                    item,
                    k_list.copy(),
                    value,
                    data,
                    JsonPathItem(item_type=JsonPathItemType.INDEX, index=i),
                )


Setter.add_setter(JsonPathItemType.KEY, KeySetter)
Setter.add_setter(JsonPathItemType.INDEX, IndexSetter)
Setter.add_setter(JsonPathItemType.WILDCARD_INDEX, WildcardIndexSetter)
