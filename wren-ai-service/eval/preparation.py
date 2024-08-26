import argparse
import csv
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

    with open(f"{Path(mdl_path).stem}.csv", "w", newline="\n") as file:
        writer = csv.writer(file, quoting=csv.QUOTE_MINIMAL)

        for row in csv_data:
            writer.writerow(row)


def gen_new_mdl_from_csv(mdl_path: str, csv_path: str):
    assert Path(mdl_path).exists(), f"File not found: {mdl_path}"
    assert Path(csv_path).exists(), f"File not found: {csv_path}"

    with open(mdl_path) as file:
        mdl = orjson.loads(file.read())

    csv_data_by_table = {}

    with open(csv_path, newline="\n") as file:
        csv_data = csv.reader(file)

        for row in csv_data:
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

        new_models = []
        for model in mdl["models"]:
            if model["name"] in csv_data_by_table:
                if "properties" not in model:
                    model["properties"] = {}
                if csv_data_by_table[model["name"]]["model"]["displayName"]:
                    model["properties"]["displayName"] = csv_data_by_table[
                        model["name"]
                    ]["model"]["displayName"]
                if csv_data_by_table[model["name"]]["model"]["description"]:
                    model["properties"]["description"] = csv_data_by_table[
                        model["name"]
                    ]["model"]["description"]

                new_columns = []
                for column in model["columns"]:
                    if column["name"] in csv_data_by_table[model["name"]]["columns"]:
                        if "properties" not in column:
                            column["properties"] = {}
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
                        new_columns.append(column)

                model["columns"] = new_columns
                new_models.append(model)

        mdl["models"] = new_models

    with open(f"{Path(mdl_path).stem}_new.json", "w") as file:
        file.write(orjson.dumps(mdl).decode())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mdl-path", type=str, help="Path to the MDL JSON file", required=True
    )
    parser.add_argument("--csv-path", type=str, help="Path to the input CSV file")
    args = parser.parse_args()

    if args.mdl_path and not args.csv_path:
        gen_eval_preparation_data_from_json_to_csv(args.mdl_path)
    elif args.mdl_path and args.csv_path:
        gen_new_mdl_from_csv(args.mdl_path, args.csv_path)
