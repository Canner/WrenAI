from pytest_mock import MockerFixture

from src.pipelines.indexing.utils.helper import (
    COLUMN_COMMENT_HELPERS,
    COLUMN_PROPRECESSORS,
    MODEL_PREPROCESSORS,
    Helper,
    load_helpers,
)


def test_helper():
    test_helper = Helper(
        condition=lambda x, **_: x.get("test", False),
        helper=lambda x, **_: x.get("value", ""),
    )

    assert test_helper.condition({"test": True}) is True
    assert test_helper.condition({"test": False}) is False

    assert test_helper({"test": True, "value": "test_value"}) == "test_value"
    assert test_helper({"test": False, "value": "test_value"}) == "test_value"


def test_column_properties_preprocessor():
    helper = COLUMN_PROPRECESSORS["properties"]

    test_column = {
        "name": "test_column",
        "properties": {"displayName": "Test Column", "description": "Test description"},
    }

    assert helper.condition(test_column) is True
    assert helper(test_column) == {
        "displayName": "Test Column",
        "description": "Test description",
    }


def test_column_relationship_preprocessor():
    helper = COLUMN_PROPRECESSORS["relationship"]

    test_column = {
        "name": "test_column",
        "relationship": "test_relationship",
    }

    assert helper.condition(test_column) is True
    assert helper(test_column) == "test_relationship"


def test_column_expression_preprocessor():
    helper = COLUMN_PROPRECESSORS["expression"]

    test_column = {
        "name": "test_column",
        "expression": "SUM(value)",
    }

    assert helper.condition(test_column) is True
    assert helper(test_column) == "SUM(value)"


def test_column_is_calculated_preprocessor():
    helper = COLUMN_PROPRECESSORS["isCalculated"]

    test_column = {
        "name": "test_column",
        "isCalculated": True,
    }

    assert helper.condition(test_column) is True
    assert helper(test_column) is True


def test_properties_comment_helper():
    helper = COLUMN_COMMENT_HELPERS["properties"]

    test_column = {
        "name": "test_column",
        "properties": {
            "displayName": "Test Column",
            "description": "Test description",
        },
    }

    assert helper.condition(test_column) is True

    expected_comment = '-- {"alias":"Test Column","description":"Test description"}\n  '
    assert helper(test_column) == expected_comment


def test_calculated_field_helpers():
    helper = COLUMN_COMMENT_HELPERS["isCalculated"]

    test_column = {
        "name": "calculated_column",
        "isCalculated": True,
        "expression": "SUM(value)",
    }

    assert helper.condition(test_column) is True

    expected_comment = (
        "-- This column is a Calculated Field\n  -- column expression: SUM(value)\n  "
    )
    assert helper(test_column) == expected_comment


def test_load_helpers(mocker: MockerFixture):
    mock_module = mocker.Mock()
    mock_module.__path__ = ["test/path"]
    mock_module.__name__ = "test.package"

    mocker.patch("pkgutil.walk_packages", return_value=[(None, "test_module", None)])

    mock_test_module = mocker.Mock()
    mock_test_module.MODEL_PREPROCESSORS = {"test": "test_preprocessor"}
    mock_test_module.COLUMN_PROPRECESSORS = {"test": "test_column_preprocessor"}
    mock_test_module.COLUMN_COMMENT_HELPERS = {"test": "test_comment_helper"}

    mocker.patch("importlib.import_module", side_effect=[mock_module, mock_test_module])

    load_helpers("test.package")

    assert len(MODEL_PREPROCESSORS) == 1
    assert MODEL_PREPROCESSORS.get("test") == "test_preprocessor"
    del MODEL_PREPROCESSORS["test"]

    assert len(COLUMN_PROPRECESSORS) == 5
    assert COLUMN_PROPRECESSORS.get("test") == "test_column_preprocessor"
    del COLUMN_PROPRECESSORS["test"]

    assert len(COLUMN_COMMENT_HELPERS) == 3
    assert COLUMN_COMMENT_HELPERS.get("test") == "test_comment_helper"
    del COLUMN_COMMENT_HELPERS["test"]
