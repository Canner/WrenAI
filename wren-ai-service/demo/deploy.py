import json

import requests

WREN_ENGINE_API_URL = "http://localhost:8080"

with open("./sample_dataset/music_mdl.json", "r") as file:
    mdl_json = json.load(file)

response = requests.post(
    f"{WREN_ENGINE_API_URL}/v1/mdl/deploy",
    json={
        "manifest": mdl_json,
        "version": "latest",
    },
)

assert response.status_code == 202

wren_engine_is_ready = False

while not wren_engine_is_ready:
    response = requests.get(
        f"{WREN_ENGINE_API_URL}/v1/mdl/status",
    )

    assert response.status_code == 200

    if response.json()["systemStatus"] == "READY":
        wren_engine_is_ready = True

assert wren_engine_is_ready
