from datetime import datetime
from typing import List, Optional, Union

from haystack.utils.filters import COMPARISON_OPERATORS, LOGICAL_OPERATORS, FilterError
from qdrant_client.http import models

COMPARISON_OPERATORS = COMPARISON_OPERATORS.keys()
LOGICAL_OPERATORS = LOGICAL_OPERATORS.keys()


def convert_filters_to_qdrant(
    filter_term: Optional[Union[List[dict], dict, models.Filter]] = None, is_parent_call: bool = True
) -> Optional[Union[models.Filter, List[models.Filter], List[models.Condition]]]:
    """Converts Haystack filters to the format used by Qdrant.

    :param filter_term: the haystack filter to be converted to qdrant.
    :param is_parent_call: indicates if this is the top-level call to the function. If True, the function returns
      a single models.Filter object; if False, it may return a list of filters or conditions for further processing.

    :returns: a single Qdrant Filter in the parent call or a list of such Filters in recursive calls.

    :raises FilterError: If the invalid filter criteria is provided or if an unknown operator is encountered.

    """

    if isinstance(filter_term, models.Filter):
        return filter_term
    if not filter_term:
        return None

    must_clauses: List[models.Filter] = []
    should_clauses: List[models.Filter] = []
    must_not_clauses: List[models.Filter] = []
    # Indicates if there are multiple same LOGICAL OPERATORS on each level
    # and prevents them from being combined
    same_operator_flag = False
    conditions, qdrant_filter, current_level_operators = (
        [],
        [],
        [],
    )

    if isinstance(filter_term, dict):
        filter_term = [filter_term]

    # ======== IDENTIFY FILTER ITEMS ON EACH LEVEL ========

    for item in filter_term:
        operator = item.get("operator")

        # Check for repeated similar operators on each level
        same_operator_flag = operator in current_level_operators and operator in LOGICAL_OPERATORS
        if not same_operator_flag:
            current_level_operators.append(operator)

        if operator is None:
            msg = "Operator not found in filters"
            raise FilterError(msg)

        if operator in LOGICAL_OPERATORS and "conditions" not in item:
            msg = f"'conditions' not found for '{operator}'"
            raise FilterError(msg)

        if operator in LOGICAL_OPERATORS:
            # Recursively process nested conditions
            current_filter = convert_filters_to_qdrant(item.get("conditions", []), is_parent_call=False) or []

            # When same_operator_flag is set to True,
            # ensure each clause is appended as an independent list to avoid merging distinct clauses.
            if operator == "AND":
                must_clauses = [must_clauses, current_filter] if same_operator_flag else must_clauses + current_filter
            elif operator == "OR":
                should_clauses = (
                    [should_clauses, current_filter] if same_operator_flag else should_clauses + current_filter
                )
            elif operator == "NOT":
                must_not_clauses = (
                    [must_not_clauses, current_filter] if same_operator_flag else must_not_clauses + current_filter
                )

        elif operator in COMPARISON_OPERATORS:
            field = item.get("field")
            value = item.get("value")
            if field is None or value is None:
                msg = f"'field' or 'value' not found for '{operator}'"
                raise FilterError(msg)

            parsed_conditions = _parse_comparison_operation(comparison_operation=operator, key=field, value=value)

            # check if the parsed_conditions are models.Filter or models.Condition
            for condition in parsed_conditions:
                if isinstance(condition, models.Filter):
                    qdrant_filter.append(condition)
                else:
                    conditions.append(condition)

        else:
            msg = f"Unknown operator {operator} used in filters"
            raise FilterError(msg)

    # ======== PROCESS FILTER ITEMS ON EACH LEVEL ========

    # If same logical operators have separate clauses, create separate filters
    if same_operator_flag:
        qdrant_filter = build_filters_for_repeated_operators(
            must_clauses, should_clauses, must_not_clauses, qdrant_filter
        )

    # else append a single Filter for existing clauses
    elif must_clauses or should_clauses or must_not_clauses:
        qdrant_filter.append(
            models.Filter(
                must=must_clauses or None,
                should=should_clauses or None,
                must_not=must_not_clauses or None,
            )
        )

    # In case of parent call, a single Filter is returned
    if is_parent_call:
        # If qdrant_filter has just a single Filter in parent call,
        # then it might be returned instead.
        if len(qdrant_filter) == 1 and isinstance(qdrant_filter[0], models.Filter):
            return qdrant_filter[0]
        else:
            must_clauses.extend(conditions)
            return models.Filter(
                must=must_clauses or None,
                should=should_clauses or None,
                must_not=must_not_clauses or None,
            )

    # Store conditions of each level in output of the loop
    elif conditions:
        qdrant_filter.extend(conditions)

    return qdrant_filter


def build_filters_for_repeated_operators(
    must_clauses,
    should_clauses,
    must_not_clauses,
    qdrant_filter,
) -> List[models.Filter]:
    """
    Flattens the nested lists of clauses by creating separate Filters for each clause of a logical operator.

    :param must_clauses: a nested list of must clauses or an empty list.
    :param should_clauses: a nested list of should clauses or an empty list.
    :param must_not_clauses: a nested list of must_not clauses or an empty list.
    :param qdrant_filter: a list where the generated Filter objects will be appended.
      This list will be modified in-place.


    :returns: the modified `qdrant_filter` list with appended generated Filter objects.
    """

    if any(isinstance(i, list) for i in must_clauses):
        for i in must_clauses:
            qdrant_filter.append(
                models.Filter(
                    must=i or None,
                    should=should_clauses or None,
                    must_not=must_not_clauses or None,
                )
            )
    if any(isinstance(i, list) for i in should_clauses):
        for i in should_clauses:
            qdrant_filter.append(
                models.Filter(
                    must=must_clauses or None,
                    should=i or None,
                    must_not=must_not_clauses or None,
                )
            )
    if any(isinstance(i, list) for i in must_not_clauses):
        for i in must_clauses:
            qdrant_filter.append(
                models.Filter(
                    must=must_clauses or None,
                    should=should_clauses or None,
                    must_not=i or None,
                )
            )

    return qdrant_filter


def _parse_comparison_operation(
    comparison_operation: str, key: str, value: Union[dict, List, str, float]
) -> List[models.Condition]:
    conditions: List[models.Condition] = []

    condition_builder_mapping = {
        "==": _build_eq_condition,
        "in": _build_in_condition,
        "!=": _build_ne_condition,
        "not in": _build_nin_condition,
        ">": _build_gt_condition,
        ">=": _build_gte_condition,
        "<": _build_lt_condition,
        "<=": _build_lte_condition,
    }

    condition_builder = condition_builder_mapping.get(comparison_operation)

    if condition_builder is None:
        msg = f"Unknown operator {comparison_operation} used in filters"
        raise ValueError(msg)

    conditions.append(condition_builder(key, value))

    return conditions


def _build_eq_condition(key: str, value: models.ValueVariants) -> models.Condition:
    if isinstance(value, str) and " " in value:
        return models.FieldCondition(key=key, match=models.MatchText(text=value))
    return models.FieldCondition(key=key, match=models.MatchValue(value=value))


def _build_in_condition(key: str, value: List[models.ValueVariants]) -> models.Condition:
    if not isinstance(value, list):
        msg = f"Value {value} is not a list"
        raise FilterError(msg)
    return models.Filter(
        should=[
            (
                models.FieldCondition(key=key, match=models.MatchText(text=item))
                if isinstance(item, str) and " " not in item
                else models.FieldCondition(key=key, match=models.MatchValue(value=item))
            )
            for item in value
        ]
    )


def _build_ne_condition(key: str, value: models.ValueVariants) -> models.Condition:
    return models.Filter(
        must_not=[
            (
                models.FieldCondition(key=key, match=models.MatchText(text=value))
                if isinstance(value, str) and " " not in value
                else models.FieldCondition(key=key, match=models.MatchValue(value=value))
            )
        ]
    )


def _build_nin_condition(key: str, value: List[models.ValueVariants]) -> models.Condition:
    if not isinstance(value, list):
        msg = f"Value {value} is not a list"
        raise FilterError(msg)
    return models.Filter(
        must_not=[
            (
                models.FieldCondition(key=key, match=models.MatchText(text=item))
                if isinstance(item, str) and " " in item
                else models.FieldCondition(key=key, match=models.MatchValue(value=item))
            )
            for item in value
        ]
    )


def _build_lt_condition(key: str, value: Union[str, float, int]) -> models.Condition:
    if isinstance(value, str) and is_datetime_string(value):
        return models.FieldCondition(key=key, range=models.DatetimeRange(lt=value))

    if isinstance(value, (int, float)):
        return models.FieldCondition(key=key, range=models.Range(lt=value))

    msg = f"Value {value} is not an int or float or datetime string"
    raise FilterError(msg)


def _build_lte_condition(key: str, value: Union[str, float, int]) -> models.Condition:
    if isinstance(value, str) and is_datetime_string(value):
        return models.FieldCondition(key=key, range=models.DatetimeRange(lte=value))

    if isinstance(value, (int, float)):
        return models.FieldCondition(key=key, range=models.Range(lte=value))

    msg = f"Value {value} is not an int or float or datetime string"
    raise FilterError(msg)


def _build_gt_condition(key: str, value: Union[str, float, int]) -> models.Condition:
    if isinstance(value, str) and is_datetime_string(value):
        return models.FieldCondition(key=key, range=models.DatetimeRange(gt=value))

    if isinstance(value, (int, float)):
        return models.FieldCondition(key=key, range=models.Range(gt=value))

    msg = f"Value {value} is not an int or float or datetime string"
    raise FilterError(msg)


def _build_gte_condition(key: str, value: Union[str, float, int]) -> models.Condition:
    if isinstance(value, str) and is_datetime_string(value):
        return models.FieldCondition(key=key, range=models.DatetimeRange(gte=value))

    if isinstance(value, (int, float)):
        return models.FieldCondition(key=key, range=models.Range(gte=value))

    msg = f"Value {value} is not an int or float or datetime string"
    raise FilterError(msg)


def is_datetime_string(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
        return True
    except ValueError:
        return False
