import json
import os

from src.utils import generate_ddls_from_semantics, generate_semantics, load_env_vars

load_env_vars()

DATASET_NAME = os.getenv("DATASET_NAME")

with open(f"./src/eval/data/{DATASET_NAME}_mdl_optimal.json", "r") as f:
    mdl_data = json.load(f)

optimal_ddl = {}

for schema in mdl_data:
    semantics = generate_semantics(json.dumps(schema["schema"]))
    ddl_commands = generate_ddls_from_semantics(
        semantics["models"],
        semantics["relationships"],
    )
    optimal_ddl[schema["query"]] = ddl_commands

with open(f"./src/eval/data/{DATASET_NAME}_optimal_ddl.json", "w") as f:
    json.dump(optimal_ddl, f)
