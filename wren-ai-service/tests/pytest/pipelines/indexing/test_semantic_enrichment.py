import orjson

from src.pipelines.indexing.semantic_enrichment import (
    enrich_mdl_for_retrieval,
    enrich_mdl_str_for_retrieval,
)


def test_enriches_model_and_column_semantics_without_hardcoded_tables():
    mdl = {
        "models": [
            {
                "name": "dbo_SalesOrders",
                "tableReference": {"schema": "dbo", "table": "SalesOrders"},
                "columns": [
                    {"name": "OrderDate", "type": "DATE", "isCalculated": False},
                    {"name": "CountryCode", "type": "VARCHAR", "isCalculated": False},
                    {"name": "SalesValue", "type": "FLOAT", "isCalculated": False},
                ],
                "primaryKey": "",
                "cached": False,
                "properties": {},
            }
        ],
        "relationships": [],
        "views": [],
        "metrics": [],
    }

    enriched = enrich_mdl_for_retrieval(mdl)
    model = enriched["models"][0]
    columns = {column["name"]: column for column in model["columns"]}

    assert model["properties"]["displayName"] == "Sales Orders"
    assert (
        "Business model for Sales Orders records"
        in model["properties"]["description"]
    )
    assert "date/time filter" in columns["OrderDate"]["properties"]["description"]
    assert (
        "country/geography filter"
        in columns["CountryCode"]["properties"]["description"]
    )
    assert "numeric measure" in columns["SalesValue"]["properties"]["description"]


def test_infers_only_high_confidence_primary_key_relationships():
    mdl = {
        "models": [
            {
                "name": "Orders",
                "columns": [
                    {"name": "OrderId", "type": "INT", "isCalculated": False},
                    {"name": "CustomerId", "type": "INT", "isCalculated": False},
                ],
                "primaryKey": "OrderId",
                "cached": False,
                "properties": {},
            },
            {
                "name": "Customers",
                "columns": [
                    {"name": "Id", "type": "INT", "isCalculated": False},
                    {"name": "CustomerName", "type": "VARCHAR", "isCalculated": False},
                ],
                "primaryKey": "Id",
                "cached": False,
                "properties": {},
            },
            {
                "name": "Products",
                "columns": [
                    {"name": "Id", "type": "INT", "isCalculated": False},
                    {"name": "ProductName", "type": "VARCHAR", "isCalculated": False},
                ],
                "primaryKey": "Id",
                "cached": False,
                "properties": {},
            },
        ],
        "relationships": [],
        "views": [],
        "metrics": [],
    }

    enriched = enrich_mdl_for_retrieval(mdl)

    assert enriched["relationships"] == [
        {
            "name": "Orders_Customers_CustomerId",
            "models": ["Orders", "Customers"],
            "joinType": "MANY_TO_ONE",
            "condition": "Orders.CustomerId = Customers.Id",
            "properties": {
                "description": (
                    "Connects Orders records to Customers using Customer ID."
                )
            },
        }
    ]


def test_enrich_mdl_string_round_trips_json():
    mdl = {"models": [], "relationships": [], "views": [], "metrics": []}

    enriched = orjson.loads(enrich_mdl_str_for_retrieval(orjson.dumps(mdl)))

    assert enriched == mdl
