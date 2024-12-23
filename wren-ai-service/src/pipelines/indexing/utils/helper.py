import importlib
import logging
import pkgutil
import re
import sys
from typing import Any, Callable, Dict

import orjson

logger = logging.getLogger("wren-ai-service")


class Helper:
    def __init__(
        self,
        condition: Callable[[Dict[str, Any]], bool],
        helper: Callable[[Dict[str, Any]], Any],
    ):
        self.condiction = condition
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

    if (json_type := props.get("json_type", "")) and json_type in [
        "JSON",
        "JSON_ARRAY",
    ]:
        json_fields = {
            k: v for k, v in column["properties"].items() if re.match(r".*json.*", k)
        }
        if json_fields:
            column_properties["json_type"] = json_type
            column_properties["json_fields"] = json_fields

    return f"-- {orjson.dumps(column_properties).decode('utf-8')}\n  "


COLUMN_PROPRECESSORS = {
    "properties": Helper(
        condition=lambda column, **_: "properties" in column,
        helper=lambda column, **_: column.get("properties"),
    ),
    "relationship": Helper(
        condition=lambda column, **_: "relationship" in column,
        helper=lambda column, **_: column.get("relationship"),
    ),
    "expression": Helper(
        condition=lambda column, **_: "expression" in column,
        helper=lambda column, **_: column.get("expression"),
    ),
    "isCalculated": Helper(
        condition=lambda column, **_: column.get("isCalculated", False),
        helper=lambda column, **_: column.get("isCalculated"),
    ),
}

COLUMN_COMMENT_HELPERS = {
    "properties": Helper(
        condition=lambda column, **_: "properties" in column,
        helper=_properties_comment,
    ),
    "isCalculated": Helper(
        condition=lambda column, **_: column.get("isCalculated", False),
        helper=lambda column,
        **_: f"-- This column is a Calculated Field\n  -- column expression: {column['expression']}\n  ",
    ),
}

MODEL_PREPROCESSORS = {}


def load_helpers(package_path: str = "src.pipelines.indexing.utils"):
    """
    Dynamically loads preprocessors and comment helpers from modules within a specified package path.

    This function walks through all modules in the given package path and looks for modules
    that define MODEL_PREPROCESSORS, COLUMN_PROPRECESSORS and COLUMN_COMMENT_HELPERS dictionaries.
    When found, these helpers are added to the corresponding global dictionaries.

    The helpers are used to preprocess and format comments for database schema elements like
    models and columns during the DB Schema indexing pipeline.

    Args:
        package_path (str): The Python package path to search for helper modules.
                          Defaults to "src.pipelines.indexing.utils".

    Returns:
        None: The function updates the global MODEL_PREPROCESSORS, COLUMN_PROPRECESSORS
              and COLUMN_COMMENT_HELPERS dictionaries in place.

    Example:
        If a module in the package path contains:

        MODEL_PREPROCESSORS = {
            "example": Helper(
                condition=lambda model: True,
                helper=lambda model, **_: model.get("example", ""),
            )
        }

        COLUMN_PROPRECESSORS = {
            "example": Helper(
                condition=lambda column: True,
                helper=lambda column, **_: column.get("example", ""),
            )
        }

        COLUMN_COMMENT_HELPERS = {
            "example": Helper(
                condition=lambda column: True,
                helper=lambda column, **_: f"-- {column.get('example')}\n  ",
            )
        }

        These will be added to their respective global dictionaries.
    """
    package = importlib.import_module(package_path)
    logger.info(f"Loading Helpers for DB Schema Indexing Pipeline: {package_path}")

    for _, name, _ in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
        if name in sys.modules:
            continue

        module = importlib.import_module(name)
        logger.info(f"Imported Helper from {name}")
        if hasattr(module, "MODEL_PREPROCESSORS"):
            MODEL_PREPROCESSORS.update(module.MODEL_PREPROCESSORS)
            logger.info(f"Updated Helper for model preprocessors: {name}")
        if hasattr(module, "COLUMN_PROPRECESSORS"):
            COLUMN_PROPRECESSORS.update(module.COLUMN_PROPRECESSORS)
            logger.info(f"Updated Helper for column preprocessors: {name}")
        if hasattr(module, "COLUMN_COMMENT_HELPERS"):
            COLUMN_COMMENT_HELPERS.update(module.COLUMN_COMMENT_HELPERS)
            logger.info(f"Updated Helper for column comment helpers: {name}")
