import base64
import json
from contextlib import nullcontext as does_not_raise

import pytest
from wren_core import (
    ManifestExtractor,
    RowLevelAccessControl,
    SessionContext,
    SessionProperty,
    is_backward_compatible,
    to_json_base64,
    to_manifest,
    validate_rlac_rule,
)

manifest = {
    "catalog": "my_catalog",
    "schema": "my_schema",
    "dataSource": "datafusion",
    "models": [
        {
            "name": "customer",
            "tableReference": {
                "schema": "main",
                "table": "customer",
            },
            "columns": [
                {"name": "c_custkey", "type": "integer"},
                {
                    "name": "c_name",
                    "type": "varchar",
                    "columnLevelAccessControl": {
                        "name": "c_name_access",
                        "requiredProperties": [
                            {
                                "name": "session_level",
                                "required": False,
                            }
                        ],
                        "operator": "EQUALS",
                        "threshold": "1",
                    },
                },
                {"name": "orders", "type": "orders", "relationship": "orders_customer"},
            ],
            "rowLevelAccessControls": [
                {
                    "name": "customer_access",
                    "requiredProperties": [
                        {
                            "name": "session_user",
                            "required": False,
                        }
                    ],
                    "condition": "c_name = @session_user",
                },
            ],
            "primaryKey": "c_custkey",
        },
        {
            "name": "orders",
            "tableReference": {
                "schema": "main",
                "table": "orders",
            },
            "columns": [
                {"name": "o_orderkey", "type": "integer"},
                {"name": "o_custkey", "type": "integer"},
                {"name": "o_orderdate", "type": "date"},
                {
                    "name": "lineitems",
                    "type": "Lineitem",
                    "relationship": "orders_lineitem",
                },
            ],
            "primaryKey": "o_orderkey",
        },
        {
            "name": "lineitem",
            "tableReference": {
                "schema": "main",
                "table": "lineitem",
            },
            "columns": [
                {"name": "l_orderkey", "type": "integer"},
                {"name": "l_quantity", "type": "decimal"},
                {"name": "l_extendedprice", "type": "decimal"},
            ],
            "primaryKey": "l_orderkey",
        },
    ],
    "relationships": [
        {
            "name": "orders_customer",
            "models": ["orders", "customer"],
            "joinType": "MANY_TO_ONE",
            "condition": "orders.custkey = customer.custkey",
        },
        {
            "name": "orders_lineitem",
            "models": ["orders", "lineitem"],
            "joinType": "ONE_TO_MANY",
            "condition": "orders.orderkey = lineitem.orderkey",
        },
    ],
    "views": [
        {
            "name": "customer_view",
            "statement": "SELECT * FROM my_catalog.my_schema.customer",
        },
    ],
}

manifest_str = base64.b64encode(json.dumps(manifest).encode("utf-8")).decode("utf-8")


def test_session_context():
    session_context = SessionContext(manifest_str, None)
    sql = "SELECT * FROM my_catalog.my_schema.customer"
    rewritten_sql = session_context.transform_sql(sql)
    assert (
        rewritten_sql
        == 'SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM "main".customer AS __source) AS customer) AS customer'
    )

    session_context = SessionContext(manifest_str, "tests/functions.csv")
    sql = "SELECT add_two(c_custkey, c_custkey) FROM my_catalog.my_schema.customer"
    rewritten_sql = session_context.transform_sql(sql)
    assert (
        rewritten_sql
        == 'SELECT add_two(customer.c_custkey, customer.c_custkey) FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM "main".customer AS __source) AS customer) AS customer'
    )


def test_read_function_list():
    path = "tests/functions.csv"
    session_context = SessionContext(manifest_str, path)
    functions = session_context.get_available_functions()
    assert len(functions) == 290

    rewritten_sql = session_context.transform_sql(
        "SELECT add_two(c_custkey, c_custkey) FROM my_catalog.my_schema.customer"
    )
    assert (
        rewritten_sql
        == 'SELECT add_two(customer.c_custkey, customer.c_custkey) FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM "main".customer AS __source) AS customer) AS customer'
    )

    session_context = SessionContext(manifest_str, None)
    functions = session_context.get_available_functions()
    assert len(functions) == 283


def test_get_available_functions():
    session_context = SessionContext(manifest_str, "tests/functions.csv")
    functions = session_context.get_available_functions()
    add_two = next(f for f in functions if f.name == "add_two")
    assert add_two.name == "add_two"
    assert add_two.function_type == "scalar"
    assert add_two.description == "Adds two numbers together."
    assert add_two.return_type is None
    assert add_two.param_names is None
    assert add_two.param_types is None

    max_if = next(f for f in functions if f.name == "max_if")
    assert max_if.name == "max_if"
    assert max_if.function_type == "window"
    assert max_if.param_names is None
    assert max_if.param_types is None

    func = next(f for f in functions if f.name == "add_custom")
    assert func.name == "add_custom"
    assert func.function_type == "scalar"
    assert func.description == "Adds two numbers together."
    assert func.return_type is None
    assert func.param_names is None
    assert func.param_types is None

    func = next(f for f in functions if f.name == "test_same_as_input_array")
    assert func.name == "test_same_as_input_array"
    assert func.function_type == "scalar"
    assert func.description == "Returns the greatest value from the first array."
    assert func.return_type is None
    assert func.param_names is None
    assert func.param_types is None

    func = next(f for f in functions if f.name == "test_return_type")
    assert func.name == "test_return_type"
    assert func.function_type == "scalar"
    assert func.description == "Returns the same type as the input."
    assert func.return_type is None
    assert func.param_names is None
    assert func.param_types is None

    func = next(f for f in functions if f.name == "test_without_param_type")
    assert func.name == "test_without_param_type"
    assert func.function_type == "scalar"
    assert func.description == "Without param type"
    # It's a string type actually. However, it misses the param type in the CSV.
    # DataFusion builds the return type from the param type in information_schema.
    # If lossing the param type, it will be None.
    assert func.return_type is None
    assert func.param_names is None
    assert func.param_types is None


@pytest.mark.parametrize(
    ("value", "expected_error", "error_message"),
    [
        (
            None,
            Exception,
            "Expected a valid base64 encoded string for the model definition, but got None.",
        ),
        ("xxx", Exception, "Base64 decode error: Invalid padding"),
        ("{}", Exception, "Base64 decode error: Invalid symbol 123, offset 0."),
        (
            "",
            Exception,
            "Serde JSON error: EOF while parsing a value at line 1 column 0",
        ),
    ],
)
def test_extractor_with_invalid_manifest(value, expected_error, error_message):
    with pytest.raises(expected_error) as e:
        ManifestExtractor(value)
    assert str(e.value) == error_message


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("SELECT * FROM customer", ["customer"]),
        ("SELECT * FROM not_my_catalog.my_schema.customer", []),
        ("SELECT * FROM my_catalog.not_my_schema.customer", []),
        ("SELECT * FROM my_catalog.my_schema.customer", ["customer"]),
        (
            "SELECT * FROM my_catalog.my_schema.customer JOIN my_catalog.my_schema.orders ON customer.custkey = orders.custkey",
            ["customer", "orders"],
        ),
        ("SELECT * FROM my_catalog.my_schema.customer_view", ["customer_view"]),
    ],
)
def test_resolve_used_table_names(sql, expected):
    tables = ManifestExtractor(manifest_str).resolve_used_table_names(sql)
    assert tables == expected


@pytest.mark.parametrize(
    ("dataset", "expected_models"),
    [
        (["customer"], ["customer", "lineitem", "orders"]),
        (["customer_view"], ["customer", "lineitem", "orders"]),
        (["orders"], ["lineitem", "orders"]),
        (["lineitem"], ["lineitem"]),
    ],
)
def test_extract_by(dataset, expected_models):
    extracted_manifest = ManifestExtractor(manifest_str).extract_by(dataset)
    assert len(extracted_manifest.models) == len(expected_models)
    assert [m.name for m in extracted_manifest.models] == expected_models
    assert extracted_manifest.data_source.__str__() == "DataSource.Datafusion"


def test_to_json_base64():
    extracted_manifest = ManifestExtractor(manifest_str).extract_by(["customer"])
    base64_str = to_json_base64(extracted_manifest)
    with does_not_raise():
        json_str = base64.b64decode(base64_str)
        decoded_manifest = json.loads(json_str)
        assert decoded_manifest["catalog"] == "my_catalog"
        assert len(decoded_manifest["models"]) == 3


def test_limit_pushdown():
    session_context = SessionContext()
    sql = "SELECT * FROM my_catalog.my_schema.customer"
    assert (
        session_context.pushdown_limit(sql, 10)
        == "SELECT * FROM my_catalog.my_schema.customer LIMIT 10"
    )

    sql = "SELECT * FROM my_catalog.my_schema.customer LIMIT 100"
    assert (
        session_context.pushdown_limit(sql, 10)
        == "SELECT * FROM my_catalog.my_schema.customer LIMIT 10"
    )

    sql = "SELECT * FROM my_catalog.my_schema.customer LIMIT 10"
    assert (
        session_context.pushdown_limit(sql, 100)
        == "SELECT * FROM my_catalog.my_schema.customer LIMIT 10"
    )

    sql = "SELECT * FROM my_catalog.my_schema.customer LIMIT 10 OFFSET 5"
    assert (
        session_context.pushdown_limit(sql, 100)
        == "SELECT * FROM my_catalog.my_schema.customer LIMIT 10 OFFSET 5"
    )

    sql = "SELECT * FROM my_catalog.my_schema.customer LIMIT 100 OFFSET 5"
    assert (
        session_context.pushdown_limit(sql, 10)
        == "SELECT * FROM my_catalog.my_schema.customer LIMIT 10 OFFSET 5"
    )


def test_rlac():
    headers = {
        "session_user": "'test_user'",
    }
    properties_hashable = frozenset(headers.items()) if headers else None
    session_context = SessionContext(manifest_str, None, properties_hashable)
    sql = "SELECT * FROM my_catalog.my_schema.customer"
    rewritten_sql = session_context.transform_sql(sql)
    assert (
        rewritten_sql
        == 'SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT customer.c_custkey, customer.c_name FROM (SELECT __source.c_custkey AS c_custkey, __source.c_name AS c_name FROM "main".customer AS __source) AS customer) AS customer WHERE customer.c_name = \'test_user\') AS customer'
    )


def test_validate_rlac_rule():
    manifest = to_manifest(manifest_str)
    model = manifest.get_model("customer")
    if model is None:
        raise ValueError("Model customer not found in manifest")
    rlac = RowLevelAccessControl(
        name="test",
        required_properties=[
            SessionProperty(
                name="session_user",
                required=False,
            )
        ],
        condition="customer.c_name = @session_user",
    )

    validate_rlac_rule(rlac, model)

    # Test case insensitivity
    rlac = RowLevelAccessControl(
        name="test",
        required_properties=[
            SessionProperty(
                name="session_usEr",
                required=False,
            )
        ],
        condition="c_name = @SEssion_user",
    )

    validate_rlac_rule(rlac, model)

    rlac = RowLevelAccessControl(
        name="test",
        required_properties=[],
        condition="c_name = @session_user",
    )

    with pytest.raises(Exception) as e:
        validate_rlac_rule(rlac, model)
        assert (
            str(e.value)
            == "Exception: DataFusion error: Error during planning: The session property @session_user is used, but not found in the session properties"
        )


def test_clac():
    headers = {
        "session_level": "2",
    }
    properties_hashable = frozenset(headers.items()) if headers else None

    session_context = SessionContext(manifest_str, None, properties_hashable)
    sql = "SELECT * FROM my_catalog.my_schema.customer"
    rewritten_sql = session_context.transform_sql(sql)
    assert (
        rewritten_sql
        == 'SELECT customer.c_custkey FROM (SELECT customer.c_custkey FROM (SELECT __source.c_custkey AS c_custkey FROM "main".customer AS __source) AS customer) AS customer'
    )

    session_context = SessionContext(manifest_str, None, properties_hashable)
    sql = "SELECT c_name FROM my_catalog.my_schema.customer"
    try:
        session_context.transform_sql(sql)
    except Exception as e:
        assert (
            str(e)
            == 'Permission Denied: Access denied to column "customer"."c_name": violates access control rule "c_name_access"'
        )


def test_opt_clac():
    headers = {}
    properties_hashable = frozenset(headers.items()) if headers else None

    manifest = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "bigquery",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {
                        "name": "o_orderkey",
                        "type": "integer",
                        "columnLevelAccessControl": {
                            "name": "o_orderkey_access",
                            "requiredProperties": [
                                {
                                    "name": "session_level",
                                    "required": False,
                                    "defaultExpr": "2",
                                }
                            ],
                            "operator": "GREATER_THAN",
                            "threshold": "3",
                        },
                    },
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
            },
        ],
    }

    manifest_str = base64.b64encode(json.dumps(manifest).encode("utf-8")).decode(
        "utf-8"
    )

    session_context = SessionContext(manifest_str, None, properties_hashable)
    sql = "SELECT o_orderkey FROM my_catalog.my_schema.orders"
    try:
        session_context.transform_sql(sql)
    except Exception as e:
        assert (
            str(e)
            == 'Permission Denied: Access denied to column "orders"."o_orderkey": violates access control rule "o_orderkey_access"'
        )


def test_backward_compatible_check():
    manifest_with_clac = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "bigquery",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {
                        "name": "o_orderkey",
                        "type": "integer",
                        "columnLevelAccessControl": {
                            "name": "o_orderkey_access",
                            "requiredProperties": [
                                {
                                    "name": "session_level",
                                    "required": False,
                                    "defaultExpr": "2",
                                }
                            ],
                            "operator": "GREATER_THAN",
                            "threshold": "3",
                        },
                    },
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
            },
        ],
    }

    manifest_with_clac_str = base64.b64encode(
        json.dumps(manifest_with_clac).encode("utf-8")
    ).decode("utf-8")
    assert not is_backward_compatible(manifest_with_clac_str)

    manifest_with_rlac = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "bigquery",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
                "rowLevelAccessControls": [
                    {
                        "name": "customer_access",
                        "requiredProperties": [
                            {
                                "name": "session_user",
                                "required": False,
                            }
                        ],
                        "condition": "o_custkey = @session_user",
                    },
                ],
            },
        ],
    }
    manifest_with_rlac_str = base64.b64encode(
        json.dumps(manifest_with_rlac).encode("utf-8")
    ).decode("utf-8")
    assert not is_backward_compatible(manifest_with_rlac_str)

    manifest_backward = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "bigquery",
        "models": [
            {
                "name": "orders",
                "tableReference": {
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {"name": "o_orderkey", "type": "integer"},
                    {"name": "o_custkey", "type": "integer"},
                    {"name": "o_orderdate", "type": "date"},
                ],
                "primaryKey": "o_orderkey",
            },
        ],
    }
    manifest_backward_str = base64.b64encode(
        json.dumps(manifest_backward).encode("utf-8")
    ).decode("utf-8")
    assert is_backward_compatible(manifest_backward_str)


def test_case_sensitive_without_quote():
    manifest = {
        "catalog": "my_catalog",
        "schema": "my_schema",
        "dataSource": "mysql",
        "models": [
            {
                "name": "Orders",
                "tableReference": {
                    "schema": "main",
                    "table": "orders",
                },
                "columns": [
                    {"name": "O_orderkey", "type": "integer"},
                    {"name": "O_custkey", "type": "integer"},
                    {"name": "O_orderdate", "type": "date"},
                ],
            },
        ],
    }
    manifest_str = base64.b64encode(json.dumps(manifest).encode("utf-8")).decode(
        "utf-8"
    )
    sql = "select O_orderkey, O_custkey, O_orderdate from Orders"
    extractor = ManifestExtractor(manifest_str)
    tables = extractor.resolve_used_table_names(sql)
    assert tables == ["Orders"]

    extracted_manifest = extractor.extract_by(tables)
    encoded_str = to_json_base64(extracted_manifest)

    session_context = SessionContext(encoded_str, None)
    actual = session_context.transform_sql(sql)
    assert (
        actual
        == 'SELECT "Orders"."O_orderkey", "Orders"."O_custkey", "Orders"."O_orderdate" FROM (SELECT "Orders"."O_custkey", "Orders"."O_orderdate", "Orders"."O_orderkey" FROM (SELECT __source."O_custkey" AS "O_custkey", __source."O_orderdate" AS "O_orderdate", __source."O_orderkey" AS "O_orderkey" FROM "main".orders AS __source) AS "Orders") AS "Orders"'
    )
