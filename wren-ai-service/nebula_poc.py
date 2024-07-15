import json

from nebula3.Config import Config
from nebula3.gclient.net import ConnectionPool

from src.utils import init_providers

llm_provider, _ = init_providers()

# get mdl data
with open("demo/sample_dataset/ecommerce_duckdb_mdl.json", "r") as f:
    mdl_data = json.load(f)
    print(mdl_data)

nebula_client = None
try:
    pass
    ## connect to nebula
    config = Config()
    config.max_connection_pool_size = 1
    # init connection pool
    connection_pool = ConnectionPool()
    assert connection_pool.init([("127.0.0.1", 9669)], config)

    # get session from connection pool
    nebula_client = connection_pool.get_session("root", "nebula")
    assert nebula_client is not None

    ## create and define schema

    ## insert mdl data to nebula
except Exception:
    import traceback

    print(traceback.format_exc())
    if nebula_client is not None:
        nebula_client.release()
    exit(1)

if nebula_client is not None:
    nebula_client.release()
