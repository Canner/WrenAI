import ast

import pytest

from src.pipelines.indexing.db_schema import DDLChunker
from src.pipelines.indexing.semantic_overlay import apply_semantic_overlay


def test_semantic_overlay_merges_metadata_and_composite_relationships():
    mdl = {
        "models": [
            {
                "name": "po_invoices",
                "columns": [
                    {"name": "docnumber", "type": "VARCHAR"},
                    {"name": "bunit", "type": "VARCHAR"},
                    {"name": "supplierid", "type": "VARCHAR"},
                ],
                "relationships": [],
                "properties": {},
            },
            {
                "name": "supplierMaster",
                "columns": [
                    {"name": "bunit", "type": "VARCHAR"},
                    {"name": "supplierid", "type": "VARCHAR"},
                ],
                "relationships": [],
                "properties": {},
            },
        ],
        "relationships": [],
        "views": [],
        "metrics": [],
    }
    overlay = {
        "models": {
            "PO Invoices": {
                "displayName": "PO Invoices",
                "description": "Primary PO invoice header model.",
                "columns": {
                    "Doc Number": {"description": "Invoice document number."}
                },
            }
        },
        "relationships": [
            {
                "name": "po_invoices_supplierMaster",
                "fromModel": "po_invoices",
                "toModel": "supplierMaster",
                "type": "MANY_TO_ONE",
                "description": "Supplier lookup for PO invoices.",
                "join": [
                    {"from": "bunit", "to": "bunit"},
                    {"from": "supplierid", "to": "supplierid"},
                ],
            }
        ],
    }

    enriched = apply_semantic_overlay(mdl, overlay)

    assert enriched["models"][0]["properties"]["displayName"] == "PO Invoices"
    assert (
        enriched["models"][0]["columns"][0]["properties"]["description"]
        == "Invoice document number."
    )
    assert enriched["relationships"] == [
        {
            "name": "po_invoices_supplierMaster",
            "models": ["po_invoices", "supplierMaster"],
            "joinType": "MANY_TO_ONE",
            "condition": (
                "po_invoices.bunit = supplierMaster.bunit AND "
                "po_invoices.supplierid = supplierMaster.supplierid"
            ),
            "properties": {
                "description": "Supplier lookup for PO invoices.",
                "semanticJoinPath": "",
                "semanticSource": "semantic_overlay",
            },
        }
    ]


def test_semantic_overlay_skips_missing_relationship_columns():
    mdl = {
        "models": [
            {"name": "po_invoices", "columns": [{"name": "bunit"}]},
            {"name": "supplierMaster", "columns": [{"name": "supplierid"}]},
        ],
        "relationships": [],
        "views": [],
        "metrics": [],
    }
    overlay = {
        "relationships": [
            {
                "fromModel": "po_invoices",
                "toModel": "supplierMaster",
                "join": [{"from": "missing", "to": "supplierid"}],
            }
        ]
    }

    enriched = apply_semantic_overlay(mdl, overlay)

    assert enriched["relationships"] == []


@pytest.mark.asyncio
async def test_db_schema_indexes_composite_relationship_as_join_path():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "po_invoices",
                "columns": [
                    {"name": "bunit", "type": "VARCHAR"},
                    {"name": "supplierid", "type": "VARCHAR"},
                ],
                "primaryKey": "",
                "properties": {},
            },
            {
                "name": "supplierMaster",
                "columns": [
                    {"name": "bunit", "type": "VARCHAR"},
                    {"name": "supplierid", "type": "VARCHAR"},
                ],
                "primaryKey": "",
                "properties": {},
            },
        ],
        "relationships": [
            {
                "name": "po_invoices_supplierMaster",
                "models": ["po_invoices", "supplierMaster"],
                "joinType": "MANY_TO_ONE",
                "condition": (
                    "po_invoices.bunit = supplierMaster.bunit AND "
                    "po_invoices.supplierid = supplierMaster.supplierid"
                ),
                "properties": {"description": "Supplier lookup for PO invoices."},
            }
        ],
        "views": [],
        "metrics": [],
    }

    result = await chunker.run(mdl, column_batch_size=50)
    po_columns_doc = next(
        document
        for document in result["documents"]
        if document.meta["name"] == "po_invoices" and "TABLE_COLUMNS" in document.content
    )
    content = ast.literal_eval(po_columns_doc.content)
    join_paths = [
        column for column in content["columns"] if column["type"] == "JOIN_PATH"
    ]

    assert join_paths == [
        {
            "type": "JOIN_PATH",
            "comment": (
                "-- {'name': 'po_invoices_supplierMaster', "
                "'condition': 'po_invoices.bunit = supplierMaster.bunit AND "
                "po_invoices.supplierid = supplierMaster.supplierid', "
                "'joinType': 'MANY_TO_ONE', "
                "'description': 'Supplier lookup for PO invoices.'}\n  "
            ),
            "constraint": (
                "JOIN supplierMaster ON "
                "supplierMaster.bunit = po_invoices.bunit AND "
                "supplierMaster.supplierid = po_invoices.supplierid"
            ),
            "tables": ["po_invoices", "supplierMaster"],
            "columns": ["bunit", "supplierid"],
            "referenced_table": "supplierMaster",
            "referenced_columns": ["bunit", "supplierid"],
        }
    ]
