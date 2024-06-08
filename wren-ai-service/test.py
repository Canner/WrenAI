import json

import requests

with open("tests/data/book_2_mdl.json", "r") as f:
    mdl_str = json.dumps(json.load(f))


response = requests.post(
    url="http://localhost:5556/v1/semantics-preparations",
    json={
        "mdl": mdl_str,
        "id": "1",
    },
)

print(response.status_code)
