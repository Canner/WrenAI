"""
Thoughts on mapping mdl's data model to nebula's property graph schema
For models, columns and relationships:
1. each table in mdl will be a vertex in nebula
2. each column in mdl will also be a vertex in nebula
3. columns will have a relationship with the table they belong to
4. relationships between tables will be represented as edges between each column from respective table
5. we don't need to store the data in nebula, just the schema

For metrics:
1. each metric in mdl will be a vertex in nebula

For views:
1. each view in mdl will be a vertex in nebula
"""

import json
import time

from nebula3.Config import Config
from nebula3.gclient.net import ConnectionPool

from src.utils import init_providers

llm_provider, _ = init_providers()


def init_nebula_connection():
    ## connect to nebula
    config = Config()
    config.max_connection_pool_size = 1
    # init connection pool
    connection_pool = ConnectionPool()
    assert connection_pool.init([("127.0.0.1", 9669)], config)

    # get session from connection pool
    nebula_client = connection_pool.get_session("root", "nebula")
    assert nebula_client is not None
    return nebula_client


def get_mdl_data():
    with open("demo/sample_dataset/ecommerce_duckdb_mdl.json", "r") as f:
        mdl_data = json.load(f)

    return mdl_data


def ingest_mdl_data_to_nebula(nebula_client, mdl_data):
    try:
        ## create and define schema
        nebula_client.execute(
            "CREATE SPACE IF NOT EXISTS mdl(vid_type=FIXED_STRING(36)); USE mdl;"
            "CREATE TAG IF NOT EXISTS table(name string NOT NULL, primary_key string NULL);"
            "CREATE TAG IF NOT EXISTS column(name string NOT NULL, type string NOT NULL, is_calculated bool NOT NULL, not_null bool NOT NULL, description string NULL, expression string NULL);"
            "CREATE EDGE IF NOT EXISTS relationship(from_table string NOT NULL, to_table string NOT NULL, join_type string NOT NULL, condition string NOT NULL, name string NOT NULL, description string NULL);"
            "CREATE EDGE IF NOT EXISTS is_column();"
        )

        # sleep for a while to make sure the schema is created
        time.sleep(10)

        ## insert mdl data to nebula
        for model in mdl_data["models"]:
            # insert table vertex
            resp = nebula_client.execute(
                f"""
                INSERT VERTEX table(name, primary_key) VALUES "{model['name']}":("{model['name']}", "{model['primaryKey']}")'
                """
            )
            assert resp.is_succeeded(), resp.error_msg()

            # insert column vertices
            for column in model["columns"]:
                resp = nebula_client.execute(
                    f"""
                    INSERT VERTEX column(name, type, is_calculated, not_null, description, expression)
                    VALUES "{column['name']}":("{column['name']}", "{column['type']}", {column['isCalculated']}, {column['notNull']}, "{column['properties'].get('description', '')}", "{column.get('expression', '')}")
                    """
                )
                assert resp.is_succeeded(), resp.error_msg()

                # create edge between column and table
                resp = nebula_client.execute(
                    f"""
                    INSERT EDGE is_column() VALUES "{column['name']}"->"{model['name']}":()"
                    """
                )
                assert resp.is_succeeded(), resp.error_msg()

        for relationship in mdl_data["relationships"]:
            # create edge between tables
            resp = nebula_client.execute(
                f"""
                INSERT EDGE relationship(
                    from_table,
                    to_table,
                    join_type,
                    condition,
                    name,
                    description
                ) VALUES "{relationship['models'][0]}"->"{relationship['models'][1]}":("{relationship['models'][0]}", "{relationship['models'][1]}", "{relationship['joinType']}", "{relationship['condition']}", "{relationship['name']}", "{relationship['properties'].get('description', '')}")
                """
            )
            assert resp.is_succeeded(), resp.error_msg()
    except Exception:
        import traceback

        print(traceback.format_exc())
        if nebula_client is not None:
            nebula_client.release()
        exit(1)


if __name__ == "__main__":
    nebula_client = init_nebula_connection()
    mdl_data = get_mdl_data()
    ingest_mdl_data_to_nebula(nebula_client, mdl_data)

    if nebula_client is not None:
        nebula_client.release()
