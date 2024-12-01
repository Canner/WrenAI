import importlib
import logging
import pkgutil
import sys
from typing import Any, Callable, Dict

import orjson

logger = logging.getLogger("wren-ai-service")


class ColumnHelper:
    def __init__(
        self,
        condiction: Callable[[Dict[str, Any]], bool],
        helper: Callable[[Dict[str, Any]], Any],
    ):
        self.condiction = condiction
        self.helper = helper

    def condition(self, column: Dict[str, Any], **kwargs) -> bool:
        return self.condiction(column, **kwargs)

    def __call__(self, column: Dict[str, Any], **kwargs) -> Any:
        return self.helper(column, **kwargs)


def _properties_comment(column: Dict[str, Any], **_) -> str:
    props = column["properties"]
    column_properties = {
        "alias": props.get("displayName", ""),
        "description": props.get("description", ""),
    }

    # Add any nested columns if they exist
    nested = {k: v for k, v in props.items() if k.startswith("nested")}
    if nested:
        column_properties["nested_columns"] = nested

    return f"-- {orjson.dumps(column_properties).decode('utf-8')}\n  "


COLUMN_PROPRECESSORS = {
    "properties": ColumnHelper(
        condiction=lambda column, **_: "properties" in column,
        helper=lambda column, **_: column.get("properties"),
    ),
    "relationship": ColumnHelper(
        condiction=lambda column, **_: "relationship" in column,
        helper=lambda column, **_: column.get("relationship"),
    ),
    "expression": ColumnHelper(
        condiction=lambda column, **_: "expression" in column,
        helper=lambda column, **_: column.get("expression"),
    ),
    "isCalculated": ColumnHelper(
        condiction=lambda column, **_: column.get("isCalculated", False),
        helper=lambda column, **_: column.get("isCalculated"),
    ),
}

COLUMN_COMMENT_HELPERS = {
    "properties": ColumnHelper(
        condiction=lambda column, **_: "properties" in column,
        helper=_properties_comment,
    ),
    "isCalculated": ColumnHelper(
        condiction=lambda column, **_: column.get("isCalculated", False),
        helper=lambda column,
        **_: f"-- This column is a Calculated Field\n  -- column expression: {column['expression']}\n  ",
    ),
}


def load_helpers(package_path: str = "src.pipelines.indexing.db_schema"):
    """
    Dynamically loads column helpers from modules within a specified package path.

    This function walks through all modules in the given package path and looks for modules
    that define a HELPER dictionary. When found, these helpers are added to the
    global COLUMN_HELPER dictionary.

    Args:
        package_path (str): The Python package path to search for helper modules.
                          Defaults to "src.pipelines.indexing.db_schema".

    Returns:
        None: The function updates the global COLUMN_HELPER dictionary in place.

    Example:
        If a module in the package path contains:
        HELPER = {
            "sample": Helper(
                condiction=lambda column: True,
                processor=lambda column, **_: column.get("sample", ""),
            )
        }
        This will be added to COLUMN_HELPER.
    """
    if package_path in sys.modules:
        return

    package = importlib.import_module(package_path)

    for _, name, _ in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        if name in sys.modules:
            continue

        module = importlib.import_module(name)
        logger.debug(f"Imported Helper: {name}")
        if hasattr(module, "COLUMN_PROPRECESSORS"):
            COLUMN_PROPRECESSORS.update(module.COLUMN_PROPRECESSORS)
            logger.debug(f"Updated Helper: {name} for column preprocessors")
        if hasattr(module, "COLUMN_COMMENT_HELPERS"):
            COLUMN_COMMENT_HELPERS.update(module.COLUMN_COMMENT_HELPERS)
            logger.debug(f"Updated Helper: {name} for column comment helpers")


load_helpers()
