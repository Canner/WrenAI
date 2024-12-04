import json
import os
import uuid

import orjson
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module", autouse=True)
def app():
    os.environ["CONFIG_PATH"] = "tests/data/config.test.yaml"
    from src.__main__ import app

    # make sure semantics preparation is ready per test
    semantics_preparation(GLOBAL_DATA["semantics_preperation_id"], app)

    yield app
    # Clean up (if necessary)
    del os.environ["CONFIG_PATH"]


GLOBAL_DATA = {
    "semantics_preperation_id": str(uuid.uuid4()),
    "query_id": None,
}


def semantics_preparation(semantics_preperation_id: str, app: app):
    with TestClient(app) as client:
        with open("tests/data/book_2_mdl.json", "r") as f:
            mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

        response = client.post(
            url="/v1/semantics-preparations",
            json={
                "mdl": mdl_str,
                "id": semantics_preperation_id,
            },
        )

        status = "indexing"

        while status != "finished":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status"
            )
            status = response.json()["status"]
