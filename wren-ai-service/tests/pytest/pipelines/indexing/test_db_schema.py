from unittest.mock import AsyncMock

import orjson
import pytest
from haystack import Document
from pytest_mock import MockFixture

from src.pipelines.indexing.db_schema import DBSchema, DDLChunker


@pytest.mark.asyncio
async def test_empty_mdl():
    chunker = DDLChunker()
    mdl = {"models": [], "views": [], "relationships": [], "metrics": []}

    document = await chunker.run(mdl, column_batch_size=1)
    assert document == {"documents": []}


@pytest.mark.asyncio
async def test_single_model():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "properties": {
                    "description": "A table containing user information.",
                    "displayName": "user",
                },
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 1

    document: Document = actual["documents"][0]
    assert document.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document.content == str(
        {
            "type": "TABLE",
            "comment": "\n/* {'alias': 'user', 'description': 'A table containing user information.'} */\n",
            "name": "user",
        }
    )


@pytest.mark.asyncio
async def test_multiple_models():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "properties": {
                    "description": "A table containing user information.",
                    "displayName": "user",
                },
            },
            {
                "name": "order",
                "properties": {
                    "description": "A table containing order details.",
                    "displayName": "order",
                },
            },
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 2

    document_1: Document = actual["documents"][0]
    assert document_1.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_1.content == str(
        {
            "type": "TABLE",
            "comment": "\n/* {'alias': 'user', 'description': 'A table containing user information.'} */\n",
            "name": "user",
        }
    )

    document_2: Document = actual["documents"][1]
    assert document_2.meta == {"type": "TABLE_SCHEMA", "name": "order"}
    assert document_2.content == str(
        {
            "type": "TABLE",
            "comment": "\n/* {'alias': 'order', 'description': 'A table containing order details.'} */\n",
            "name": "order",
        }
    )


@pytest.mark.asyncio
async def test_column_is_primary_key():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                    }
                ],
                "primaryKey": "id",
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 2

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "",
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": True,
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_column_with_properties():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "properties": {
                            "displayName": "iid",
                            "description": "The unique identifier for a user.",
                        },
                    }
                ],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 2

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": '-- {"alias":"iid","description":"The unique identifier for a user."}\n  ',
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": False,
                }
            ],
        }
    )

    document_1: Document = actual["documents"][1]
    assert document_1.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_1.content == str(
        {
            "type": "TABLE",
            "comment": "\n/* {'alias': '', 'description': ''} */\n",
            "name": "user",
        }
    )


@pytest.mark.asyncio
async def test_column_with_nested_columns():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "properties": {
                            "displayName": "iid",
                            "description": "The unique identifier for a user.",
                            "nested.address": {"name": "address", "type": "VARCHAR"},
                            "nested.orders": {"name": "orders", "type": "ARRAY"},
                        },
                    }
                ],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 2

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": '-- {"alias":"iid","description":"The unique identifier for a user.","nested_columns":{"nested.address":{"name":"address","type":"VARCHAR"},"nested.orders":{"name":"orders","type":"ARRAY"}}}\n  ',
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": False,
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_column_with_calculated_property():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                        "expression": "id + 1",
                        "isCalculated": True,
                    }
                ],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 2

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "-- This column is a Calculated Field\n  -- column expression: id + 1\n  ",
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": False,
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_column_with_relationship():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {
                        "name": "id",
                        "type": "INTEGER",
                    },
                    {
                        "name": "order_id",
                        "type": "INTEGER",
                        "relationship": "relationship_1",
                    },
                ],
                "primaryKey": "id",
            },
            {
                "name": "order",
                "columns": [
                    {
                        "name": "user_id",
                        "type": "INTEGER",
                    }
                ],
                "primaryKey": "user_id",
            },
        ],
        "views": [],
        "relationships": [
            {
                "name": "relationship_1",
                "condition": "user.id = order.user_id",
                "joinType": "ONE_TO_MANY",
                "models": ["user", "order"],
            }
        ],
        "metrics": [],
    }

    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 6

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "",
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": True,
                }
            ],
        }
    )

    document_1: Document = actual["documents"][1]
    assert document_1.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_1.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "FOREIGN_KEY",
                    "comment": '-- {"condition": user.id = order.user_id, "joinType": ONE_TO_MANY}\n  ',
                    "constraint": "FOREIGN KEY (id) REFERENCES order(user_id)",
                    "tables": ["user", "order"],
                }
            ],
        }
    )

    document_4: Document = actual["documents"][4]
    assert document_4.meta == {"type": "TABLE_SCHEMA", "name": "order"}
    assert document_4.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "FOREIGN_KEY",
                    "comment": '-- {"condition": user.id = order.user_id, "joinType": ONE_TO_MANY}\n  ',
                    "constraint": "FOREIGN KEY (user_id) REFERENCES user(id)",
                    "tables": ["user", "order"],
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_column_batch_size():
    chunker = DDLChunker()
    mdl = {
        "models": [
            {
                "name": "user",
                "columns": [
                    {"name": "id", "type": "INTEGER"},
                    {"name": "name", "type": "VARCHAR"},
                    {"name": "age", "type": "INTEGER"},
                ],
            }
        ],
        "views": [],
        "relationships": [],
        "metrics": [],
    }
    actual = await chunker.run(mdl, column_batch_size=2)
    assert len(actual["documents"]) == 3

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_0.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "",
                    "name": "id",
                    "data_type": "INTEGER",
                    "is_primary_key": False,
                },
                {
                    "type": "COLUMN",
                    "comment": "",
                    "name": "name",
                    "data_type": "VARCHAR",
                    "is_primary_key": False,
                },
            ],
        }
    )

    document_1: Document = actual["documents"][1]
    assert document_1.meta == {"type": "TABLE_SCHEMA", "name": "user"}
    assert document_1.content == str(
        {
            "type": "TABLE_COLUMNS",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "",
                    "name": "age",
                    "data_type": "INTEGER",
                    "is_primary_key": False,
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_view():
    chunker = DDLChunker()
    mdl = {
        "models": [],
        "views": [{"name": "view_1", "statement": "SELECT * FROM user"}],
        "relationships": [],
        "metrics": [],
    }
    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 1

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "view_1"}
    assert document_0.content == str(
        {
            "type": "VIEW",
            "comment": "",
            "name": "view_1",
            "statement": "SELECT * FROM user",
        }
    )


@pytest.mark.asyncio
async def test_view_with_properties():
    chunker = DDLChunker()
    mdl = {
        "models": [],
        "views": [
            {
                "name": "view_1",
                "statement": "SELECT * FROM user",
                "properties": {"description": "A view containing user information."},
            }
        ],
        "relationships": [],
        "metrics": [],
    }
    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 1

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "view_1"}
    assert document_0.content == str(
        {
            "type": "VIEW",
            "comment": "/* {'description': 'A view containing user information.'} */\n",
            "name": "view_1",
            "statement": "SELECT * FROM user",
        }
    )


@pytest.mark.asyncio
async def test_metric():
    chunker = DDLChunker()
    mdl = {
        "models": [],
        "views": [],
        "relationships": [],
        "metrics": [
            {
                "name": "metric_1",
                "baseObject": "user",
                "measure": [
                    {"name": "age", "type": "INTEGER", "expression": "SUM(age)"}
                ],
                "dimension": [
                    {"name": "gender", "type": "VARCHAR"},
                ],
            }
        ],
    }
    actual = await chunker.run(mdl, column_batch_size=1)
    assert len(actual["documents"]) == 1

    document_0: Document = actual["documents"][0]
    assert document_0.meta == {"type": "TABLE_SCHEMA", "name": "metric_1"}
    assert document_0.content == str(
        {
            "type": "METRIC",
            "comment": "\n/* This table is a metric */\n/* Metric Base Object: user */\n",
            "name": "metric_1",
            "columns": [
                {
                    "type": "COLUMN",
                    "comment": "-- This column is a dimension\n  ",
                    "name": "gender",
                    "data_type": "VARCHAR",
                },
                {
                    "type": "COLUMN",
                    "comment": "-- This column is a measure\n  -- expression: SUM(age)\n  ",
                    "name": "age",
                    "data_type": "INTEGER",
                },
            ],
        }
    )


@pytest.mark.asyncio
async def test_pipeline_run(mocker: MockFixture):
    test_mdl = {
        "models": [
            {
                "name": "user",
                "columns": [{"name": "id", "type": "INTEGER"}],
                "primaryKey": "id",
            },
            {
                "name": "order",
                "columns": [{"name": "user_id", "type": "INTEGER"}],
                "primaryKey": "user_id",
            },
        ],
        "views": [
            {
                "name": "view_1",
                "statement": "SELECT * FROM user",
            }
        ],
        "relationships": [
            {
                "name": "relationship_1",
                "condition": "user.id = order.user_id",
                "joinType": "ONE_TO_MANY",
                "models": ["user", "order"],
            }
        ],
        "metrics": [
            {
                "name": "metric_1",
                "baseObject": "user",
                "measure": [
                    {"name": "age", "type": "INTEGER", "expression": "SUM(age)"}
                ],
                "dimension": [{"name": "gender", "type": "VARCHAR"}],
            }
        ],
    }

    # Mock embedder provider
    embedder_provider = mocker.patch("src.core.provider.EmbedderProvider")
    embedder = mocker.Mock()
    mocker.patch.object(
        embedder,
        "run",
        new_callable=AsyncMock,
        side_effect=lambda documents: {"documents": documents},
    )
    embedder_provider.get_document_embedder.return_value = embedder

    # Mock document store provider
    document_store = mocker.Mock()
    mocker.patch.object(
        document_store, "delete_documents", new_callable=AsyncMock, return_value=None
    )
    mocker.patch.object(
        document_store,
        "write_documents",
        new_callable=AsyncMock,
        side_effect=lambda documents, *_, **__: len(documents),
    )
    document_store_provider = mocker.patch("src.core.provider.DocumentStoreProvider")
    document_store_provider.get_store.return_value = document_store

    pipe = DBSchema(
        embedder_provider=embedder_provider,
        document_store_provider=document_store_provider,
    )
    result = await pipe.run(orjson.dumps(test_mdl), project_id="test-project")
    assert result is not None
    assert result == {"write": {"documents_written": 6}}
