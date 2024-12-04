import json

import orjson
from fastapi.testclient import TestClient

from tests.pytest.apis import GLOBAL_DATA, app


def test_semantics_preparations(app: app):
    with TestClient(app) as client:
        semantics_preperation_id = GLOBAL_DATA["semantics_preperation_id"]

        with open("tests/data/book_2_mdl.json", "r") as f:
            mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

        response = client.post(
            url="/v1/semantics-preparations",
            json={
                "mdl": mdl_str,
                "mdl_hash": semantics_preperation_id,
            },
        )

        assert response.status_code == 200
        assert response.json()["id"] == semantics_preperation_id

        status = "indexing"

        while status == "indexing":
            response = client.get(
                url=f"/v1/semantics-preparations/{semantics_preperation_id}/status"
            )

            assert response.status_code == 200
            assert response.json()["status"] in ["indexing", "finished", "failed"]
            status = response.json()["status"]

        assert status == "finished"
