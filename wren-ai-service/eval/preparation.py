import argparse
from pathlib import Path

import orjson


def gen_eval_preparation_data_from_json_to_csv(mdl_path: str):
    assert Path(mdl_path).exists(), f"File not found: {mdl_path}"

    with open(mdl_path) as file:
        mdl = orjson.loads(file.read())

    csv_data = [
        [
            "table",
            "table alias",
            "table description",
            "column",
            "column alias",
            "column description",
        ]
    ]
    for model in mdl["models"]:
        for column in model["columns"]:
            csv_data.append(
                [
                    model["name"],
                    model.get("properties", {}).get("displayName", ""),
                    model.get("properties", {}).get("description", ""),
                    column["name"],
                    column.get("properties", {}).get("displayName", ""),
                    column.get("properties", {}).get("description", ""),
                ]
            )

    with open(f"{Path(mdl_path).stem}.csv", "w") as file:
        for row in csv_data:
            file.write(",".join(row) + "\n")


def gen_new_mdl_from_csv(mdl_path: str, csv_path: str):
    assert Path(mdl_path).exists(), f"File not found: {mdl_path}"
    assert Path(csv_path).exists(), f"File not found: {csv_path}"

    with open(mdl_path) as file:
        mdl = orjson.loads(file.read())

    with open(csv_path) as file:
        csv_data = [line.strip().split(",") for line in file.readlines()]

    csv_data_by_table = {}

    for row in csv_data[1:]:
        model_name = row[0]
        if model_name not in csv_data_by_table:
            csv_data_by_table[model_name] = {
                "model": {
                    "displayName": row[1],
                    "description": row[2],
                },
                "columns": {},
            }

        csv_data_by_table[model_name]["columns"][row[3]] = {
            "displayName": row[4],
            "description": row[5],
        }

    for model in mdl["models"]:
        if model["name"] in csv_data_by_table:
            if csv_data_by_table[model["name"]]["model"]["displayName"]:
                model["properties"]["displayName"] = csv_data_by_table[model["name"]][
                    "model"
                ]["displayName"]
            if csv_data_by_table[model["name"]]["model"]["description"]:
                model["properties"]["description"] = csv_data_by_table[model["name"]][
                    "model"
                ]["description"]
            for column in model["columns"]:
                if column["name"] in csv_data_by_table[model["name"]]["columns"]:
                    if csv_data_by_table[model["name"]]["columns"][column["name"]][
                        "displayName"
                    ]:
                        column["properties"]["displayName"] = csv_data_by_table[
                            model["name"]
                        ]["columns"][column["name"]]["displayName"]
                    if csv_data_by_table[model["name"]]["columns"][column["name"]][
                        "description"
                    ]:
                        column["properties"]["description"] = csv_data_by_table[
                            model["name"]
                        ]["columns"][column["name"]]["description"]

    with open(f"{Path(mdl_path).stem}_new.json", "w") as file:
        file.write(orjson.dumps(mdl).decode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mdl_path", type=str, help="Path to the MDL JSON file")
    parser.add_argument("--csv_path", type=str, help="Path to the input CSV file")
    args = parser.parse_args()

    if args.mdl_path and not args.csv_path:
        gen_eval_preparation_data_from_json_to_csv(args.mdl_path)
    elif args.mdl_path and args.csv_path:
        gen_new_mdl_from_csv(args.mdl_path, args.csv_path)
