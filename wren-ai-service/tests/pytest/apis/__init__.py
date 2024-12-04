import os
import uuid

import pytest


@pytest.fixture(scope="module", autouse=True)
def app():
    os.environ["CONFIG_PATH"] = "tests/data/config.test.yaml"
    from src.__main__ import app

    yield app
    # Clean up (if necessary)
    del os.environ["CONFIG_PATH"]


GLOBAL_DATA = {
    "semantics_preperation_id": str(uuid.uuid4()),
    "query_id": None,
}
