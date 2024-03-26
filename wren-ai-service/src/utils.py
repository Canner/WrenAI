import json
import os
import re
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv


def clean_generation_result(result: str) -> str:
    def _normalize_whitespace(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    return (
        _normalize_whitespace(result)
        .replace("\\n", " ")
        .replace("```sql", "")
        .replace('"""', "")
        .replace("'''", "")
        .replace("```", "")
    )


def load_env_vars() -> str:
    load_dotenv(override=True)

    if is_dev_env := os.getenv("ENV") and os.getenv("ENV").lower() == "dev":
        load_dotenv(".env.dev", override=True)
    else:
        load_dotenv(".env.prod", override=True)

    return "dev" if is_dev_env else "prod"


def classify_invalid_generation_results(
    api_endpoint: str,
    generation_results: List[Dict[str, str]],
) -> List[Optional[Dict[str, str]]]:
    valid_generation_results = []
    invalid_generation_results = []

    for generation_result in generation_results:
        response = requests.get(
            f"{api_endpoint}/v1/mdl/preview",
            json={
                "sql": generation_result["sql"],
                "limit": 1,
            },
        )
        if response.status_code == 200:
            valid_generation_results.append(generation_result)
        else:
            invalid_generation_results.append(
                {
                    "sql": generation_result["sql"],
                    "summary": generation_result["summary"],
                    "error": response.json()["message"],
                }
            )

    return valid_generation_results, invalid_generation_results


def check_if_sql_executable(
    api_endpoint: str,
    sql: str,
):
    response = requests.get(
        f"{api_endpoint}/v1/mdl/preview",
        json={
            "sql": sql,
            "limit": 1,
        },
    )

    return True if response.status_code == 200 else False


def generate_ddls_from_semantics(
    models: List[Dict[str, Any]],
    relationships: List[Dict[str, Any]],
) -> List[str]:
    ddl_commands = []
    # A map to store model primary keys for foreign key relationships
    primary_keys_map = {model["name"]: model["primaryKey"] for model in models}

    for model in models:
        table_name = model["name"]
        columns_ddl = []
        for column in model["columns"]:
            if "relationship" not in column:
                if column["properties"]:
                    comment = f"-- {json.dumps(column['properties'])}\n  "
                else:
                    comment = ""
                column_name = column["name"]
                column_type = column["type"]
                column_ddl = f"{comment}{column_name} {column_type}"

                # If column is a primary key
                if column_name == model.get("primaryKey", ""):
                    column_ddl += " PRIMARY KEY"

                columns_ddl.append(column_ddl)

        # Add foreign key constraints based on relationships
        for relationship in relationships:
            if (
                table_name == relationship["models"][0]
                and relationship["joinType"].upper() == "MANY_TO_ONE"
            ):
                related_table = relationship["models"][1]
                fk_column = relationship["condition"].split(" = ")[0].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)
            elif (
                table_name == relationship["models"][1]
                and relationship["joinType"].upper() == "ONE_TO_MANY"
            ):
                related_table = relationship["models"][0]
                fk_column = relationship["condition"].split(" = ")[1].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)
            elif (
                table_name in relationship["models"]
                and relationship["joinType"].upper() == "ONE_TO_ONE"
            ):
                index = relationship["models"].index(table_name)
                related_table = [m for m in relationship["models"] if m != table_name][
                    0
                ]
                fk_column = relationship["condition"].split(" = ")[index].split(".")[1]
                fk_constraint = f"FOREIGN KEY ({fk_column}) REFERENCES {related_table}({primary_keys_map[related_table]})"
                columns_ddl.append(fk_constraint)

        if model["properties"]:
            comment = f"\n/* {json.dumps(model['properties'])} */\n"
        else:
            comment = ""
        create_table_ddl = (
            f"{comment}CREATE TABLE {table_name} (\n  "
            + ",\n  ".join(columns_ddl)
            + "\n);"
        )

        ddl_commands.append(create_table_ddl)

    return ddl_commands
