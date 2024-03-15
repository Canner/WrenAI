import json
import os
import re
import sqlite3
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import gdown
import pandas as pd
import sqlglot
import sqlparse
from tqdm import tqdm
from tqdm.contrib import tzip


def semantic_diff(sql_query1: str, sql_query2: str):
    try:
        diff = sqlglot.diff(
            sqlglot.parse_one(sql_query1, read=sqlglot.Dialects.TRINO),
            sqlglot.parse_one(sql_query2, read=sqlglot.Dialects.TRINO),
        )

        for d in diff:
            if str(d).startswith("Keep"):
                continue

            return True

        return False
    except Exception as e:
        print(f"semantic_diff: {e}")
        return True


def execute_sql_query(sql_query: str, db_path: str):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        cur.execute(sql_query)
        # make each row a tuple of strings for easier comparison with the results from wren-engine
        # also sort each row to make the order of the columns consistent
        results = tuple(tuple(sorted(map(str, row))) for row in cur.fetchall())
    except Exception:
        results = []
    finally:
        cur.close()
        conn.close()

    return results


def execute_sql_query_through_wren_engine(sql_query: str):
    command = f'psql -d "postgres://localhost:7432/canner-cml?options=--search_path%3Dspider" -c "{sql_query}"'
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True
    )
    output, error = process.communicate()

    if error:
        return "", error.decode()

    df = get_csv_table_from_response(output.decode())
    # also sort each row to make the order of the columns consistent
    sorted_df = df.apply(lambda x: tuple(sorted(x)), axis=1)
    return tuple(sorted_df.values.tolist()), ""


def get_csv_table_from_response(full_response: str):
    lines = [line.strip() for line in full_response.strip().split("\n")[2:-1]]
    table_content = [[element.strip() for element in line.split("|")] for line in lines]

    sql_query_result_in_csv = pd.DataFrame(table_content)
    return sql_query_result_in_csv


def ground_truth_query_results_issubset(
    ground_truth_query_results, prediction_query_results
):
    rows1 = sorted(frozenset(row) for row in ground_truth_query_results)
    rows2 = sorted(frozenset(row) for row in prediction_query_results)
    for row1, row2 in zip(rows1, rows2):
        if not row1.issubset(row2):
            return False

    return True


def get_ragas_eval_results(
    ragas_eval_results: Dict[str, Any],
    index: int,
):
    return {
        metric: eval_result["results"][index][0]["score"]
        for metric, eval_result in ragas_eval_results.items()
    }


def get_generation_model_pricing(
    model_name: str,
):
    # https://openai.com/pricing
    # https://docs.anthropic.com/claude/docs/models-overview#model-comparison
    generation_model_pricing = {
        "gpt-3.5-turbo": {
            "prompt_tokens": 0.5 / 10**6,
            "completion_tokens": 1.5 / 10**6,
        },
        "gpt-3.5-turbo-0125": {
            "prompt_tokens": 0.5 / 10**6,
            "completion_tokens": 1.5 / 10**6,
        },
        "gpt-4-turbo": {
            "prompt_tokens": 10 / 10**6,
            "completion_tokens": 30 / 10**6,
        },
        "gpt-4-0125-preview": {
            "prompt_tokens": 10 / 10**6,
            "completion_tokens": 30 / 10**6,
        },
        "claude-3-haiku-20240307": {
            "prompt_tokens": 0.25 / 10**6,
            "completion_tokens": 1.25 / 10**6,
        },
        "claude-3-opus-20240229": {
            "prompt_tokens": 15 / 10**6,
            "completion_tokens": 75 / 10**6,
        },
    }

    return generation_model_pricing[model_name]


def generate_eval_report(
    database_name: str,
    groundtruths: List[Dict[str, str]],
    predictions: List[Dict[str, Any]],
    ragas_eval_results: Dict[str, Any],
):
    results = {
        "eval_results": {
            "average_accuracy": 0,
            "average_cost": {
                "total": 0,
                "input": 0,
                "output": 0,
            },
            "average_latency": {
                "total": 0,
                "retrieval": 0,
                "generation": 0,
            },
            "number_of_failed_queries": 0,
            "details": {
                "correct": {
                    "sql_semantic_same": [],
                    "query_results_same": [],
                    "ground_truth_query_results_issubset": [],
                },
                "wrong": [],
            },
        },
        "pipelines": [],
    }

    if len(predictions) > 0:
        results["pipelines"] = predictions[0]["pipelines"]

    total = 0
    correct = 0
    retrieval_total_latency = 0
    generation_total_latency = 0
    input_total_cost = 0
    output_total_cost = 0
    for i, (ground_truth, prediction) in enumerate(tzip(groundtruths, predictions)):
        ## dealing with cost part
        model_name = prediction["metadata"]["generation"]["model"]
        generation_model_pricing = get_generation_model_pricing(model_name)
        input_total_cost += (
            generation_model_pricing["prompt_tokens"]
            * prediction["metadata"]["generation"]["usage"]["prompt_tokens"]
        )
        output_total_cost += (
            generation_model_pricing["completion_tokens"]
            * prediction["metadata"]["generation"]["usage"]["completion_tokens"]
        )

        ## dealing with latency part
        retrieval_total_latency += prediction["metadata"]["latency"]["retrieval"]
        generation_total_latency += prediction["metadata"]["latency"]["generation"]

        ## dealing with accuracy part
        assert ground_truth["question"] == prediction["question"]
        question = ground_truth["question"]
        total += 1

        # directly compare the sql query using semantic diff
        if not semantic_diff(ground_truth["answer"], prediction["answer"]):
            correct += 1
            results["eval_results"]["details"]["correct"]["sql_semantic_same"].append(
                {
                    "question": ground_truth["question"],
                    "ground_truth_answer": ground_truth["answer"],
                    "prediction_answer": prediction["answer"],
                    "ragas_eval_results": get_ragas_eval_results(
                        ragas_eval_results,
                        i,
                    ),
                }
            )
            continue

        # since the order of the sql query may be different, we compare the results as sets
        ground_truth_query_results = execute_sql_query(
            ground_truth["answer"],
            f"./spider/database/{database_name}/{database_name}.sqlite",
        )

        (
            prediction_query_results,
            prediction_error_details,
        ) = execute_sql_query_through_wren_engine(
            prediction["answer"],
        )
        if prediction_error_details:
            results["eval_results"]["number_of_failed_queries"] += 1
        if len(ground_truth_query_results) == len(prediction_query_results):
            if set(ground_truth_query_results) == set(prediction_query_results):
                correct += 1
                results["eval_results"]["details"]["correct"][
                    "query_results_same"
                ].append(
                    {
                        "question": question,
                        "ground_truth_answer": ground_truth["answer"],
                        "prediction_answer": prediction["answer"],
                        "ragas_eval_results": get_ragas_eval_results(
                            ragas_eval_results,
                            i,
                        ),
                    }
                )
                continue
            elif ground_truth_query_results_issubset(
                ground_truth_query_results, prediction_query_results
            ):
                correct += 1
                results["eval_results"]["details"]["correct"][
                    "ground_truth_query_results_issubset"
                ].append(
                    {
                        "question": question,
                        "ground_truth_answer": ground_truth["answer"],
                        "prediction_answer": prediction["answer"],
                        "ground_truth_query_results": ground_truth_query_results,
                        "prediction_query_results": prediction_query_results,
                        "ragas_eval_results": get_ragas_eval_results(
                            ragas_eval_results,
                            i,
                        ),
                    }
                )
                continue

        results["eval_results"]["details"]["wrong"].append(
            {
                "question": question,
                "ground_truth_answer": ground_truth["answer"],
                "prediction_answer": prediction["answer"],
                "ground_truth_query_results": ground_truth_query_results,
                "prediction_query_results": prediction_query_results,
                "prediction_error_details": prediction_error_details,
                "ragas_eval_results": get_ragas_eval_results(
                    ragas_eval_results,
                    i,
                ),
            }
        )

    results["eval_results"]["average_accuracy"] = correct / total
    results["eval_results"]["average_cost"]["total"] = (
        input_total_cost + output_total_cost
    ) / total
    results["eval_results"]["average_cost"]["input"] = input_total_cost / total
    results["eval_results"]["average_cost"]["output"] = output_total_cost / total
    results["eval_results"]["average_latency"]["total"] = (
        retrieval_total_latency + generation_total_latency
    ) / total
    results["eval_results"]["average_latency"]["retrieval"] = (
        retrieval_total_latency
    ) / total
    results["eval_results"]["average_latency"]["generation"] = (
        generation_total_latency
    ) / total

    return results


def download_spider_data():
    if Path("spider").exists():
        return

    if Path("spider.zip").exists():
        os.remove("spider.zip")

        # 1. uploaded to Jimmy's google drive from the official Spider dataset website(data based at 2024/01/28)
        # 2. added `table_counts_in_database.json`
        # 3. changed column `salary` to `player_salary` in `baseball_1.player` table,
        #     since in bigquery, column name should not be the same as table name
    url = "https://drive.google.com/u/0/uc?id=1StzD_Yha1W-BJOLimuvdzH-cF6sEc_ak&export=download"

    output = "spider.zip"
    gdown.download(url, output, quiet=False)

    with zipfile.ZipFile(output, "r") as zip_ref:
        zip_ref.extractall(".")

    os.remove("spider.zip")


def write_prediction_results(
    file_name: str,
    ground_truths: List[Dict],
    outputs: List[Dict[str, Any]],
    pipeline_defs: Dict[str, str],
):
    with open(file_name, "w") as f:
        for ground_truth, output in tzip(ground_truths, outputs):
            json.dump(
                {
                    "question": ground_truth["question"],
                    "contexts": [
                        {
                            "content": [json.loads(context.content)],
                            "score": context.score,
                        }
                        for context in output["contexts"]
                    ],
                    "answer": output["prediction"],
                    "metadata": output["metadata"],
                    "pipelines": pipeline_defs,
                },
                f,
            )
            f.write("\n")


def prepare_evaluation_pipeline_inputs(
    component_names: List[str],
    ground_truths_data: List[Dict[str, Any]],
    predictions_data: List[Dict[str, Any]],
):
    inputs = {}

    questions = []
    ground_truths = []
    contexts = []
    responses = []
    for ground_truth, prediction in tzip(ground_truths_data, predictions_data):
        assert ground_truth["question"] == prediction["question"]

        questions.append(ground_truth["question"])
        ground_truths.append(ground_truth["answer"])
        contexts.append(
            [json.dumps(context["content"]) for context in prediction["contexts"]]
        )
        responses.append(prediction["answer"])

    for component_name in tqdm(component_names):
        ragas_metric = "_".join(component_name.split("_")[1:])

        # https://docs.haystack.deepset.ai/v2.0/docs/ragasevaluator#supported-metrics
        if ragas_metric == "ANSWER_CORRECTNESS":
            inputs[component_name] = {
                "questions": questions,
                "responses": responses,
                "ground_truths": ground_truths,
            }
        elif ragas_metric == "FAITHFULNESS":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "responses": responses,
            }
        elif ragas_metric == "ANSWER_SIMILARITY":
            inputs[component_name] = {
                "responses": responses,
                "ground_truths": ground_truths,
            }
        elif ragas_metric == "CONTEXT_PRECISION":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "ground_truths": ground_truths,
            }
        elif ragas_metric == "CONTEXT_UTILIZATION":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "responses": responses,
            }
        elif ragas_metric == "CONTEXT_RECALL":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "ground_truths": ground_truths,
            }
        elif ragas_metric == "ASPECT_CRITIQUE":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "responses": responses,
            }
        elif ragas_metric == "CONTEXT_RELEVANCY":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
            }
        elif ragas_metric == "ANSWER_RELEVANCY":
            inputs[component_name] = {
                "questions": questions,
                "contexts": contexts,
                "responses": responses,
            }

    return inputs


def get_latest_prediction_outputs_file(path: Path, dataset_name: str) -> str:
    def _extract_datetime(file_name: Path) -> datetime:
        file_name, _ = os.path.splitext(file_name)
        timestamp_str = file_name.split("_")[-1]
        return datetime.strptime(timestamp_str, "%Y%m%d%H%M%S")

    files = list(path.glob(f"{dataset_name}_predictions*.json"))
    if not files:
        return ""

    return str(sorted(files, key=_extract_datetime, reverse=True)[0])


def transpile_sql_from_sqlite_to_trino(sql_query: str):
    return sqlglot.transpile(
        sql_query, read=sqlglot.Dialects.SQLITE, write=sqlglot.Dialects.TRINO
    )[0]


def get_database_names() -> list[str]:
    return [
        folder.name for folder in Path("spider/database").iterdir() if folder.is_dir()
    ]


def get_table_names(db_path: str) -> list[str]:
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)

    # Create a cursor object
    cur = conn.cursor()

    # Get the table names
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

    # Fetch the results
    results = cur.fetchall()

    cur.close()

    conn.close()

    return [result[0] for result in results]


def get_database_schema(
    db_path: str, table_names: list[str], should_save_file: bool = False
) -> list[dict]:
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)

    # Create a cursor object
    cur = conn.cursor()

    # Get the table schemas
    table_schemas = []
    for table_name in table_names:
        cur.execute(
            f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}'"
        )
        row = cur.fetchone()
        if row is not None:
            table_schema = row[0]
            table_schemas.append(
                {
                    "table_name": table_name,
                    "table_schema": re.sub(r"\s+", " ", table_schema).strip(),
                }
            )
        else:
            print(f"No table named {table_name} found.")

    cur.close()

    if should_save_file:
        file_name = db_path.split("/")[-1].split(".")[0]
        with open(f"{file_name}_schema.txt", "w") as file:
            for table_schema in table_schemas:
                file.write(f"Table name: {table_schema['table_name']}\n")
                file.write(f"Table schema: {table_schema['table_schema']}\n\n")

    return table_schemas


def get_table_relationships(db_path: str):
    # Connect to the SQLite database
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get a list of tables in the database
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]

    # Function to check if a column is part of a unique or primary key
    def is_unique_or_pk(table, column):
        cursor.execute(f"PRAGMA table_info('{table}')")
        for col in cursor.fetchall():
            # Check if the column is a primary key or part of a unique constraint
            if col[1] == column and (col[5] > 0 or col[3]):
                return True
        return False

    # Analyze relationships
    relationships = {}
    for table in tables:
        cursor.execute(f"PRAGMA foreign_key_list('{table}')")
        fk_list = cursor.fetchall()

        if not fk_list:
            continue

        for fk in fk_list:
            ref_table = fk[2]
            from_column = fk[3]
            to_column = fk[4]

            # Determine relationship type
            if is_unique_or_pk(table, from_column):
                if is_unique_or_pk(ref_table, to_column):
                    relation_type = "ONE_TO_ONE"
                else:
                    relation_type = "ONE_TO_MANY"
            else:
                if is_unique_or_pk(ref_table, to_column):
                    relation_type = "MANY_TO_ONE"
                else:
                    relation_type = "MANY_TO_MANY"

            relationships[(table, ref_table)] = relation_type

    conn.close()
    return relationships


def get_appropriat_column_type(column_type: str):
    if column_type.lower() == "text" or "varchar" in column_type.lower():
        return "VARCHAR"
    elif column_type.lower() == "numeric":
        return "REAL"
    elif column_type.lower() == "int":
        return "INTEGER"

    return column_type.upper()


def split_table_definition(table_definition: str):
    return table_definition.split(", ")


def parse_column_definition(column_definition: str):
    column_def = column_definition.split(" ")

    return {
        "name": column_def[0],
        "type": column_def[1] if len(column_def) > 1 else "TEXT",
        "not_null": True
        if len(column_def) == 3 and column_def[2].lower() == "not null"
        else False,
    }


def parse_table_definition(
    table_name: str, table_definition: str, relationships_info: dict
):
    match = re.search(r"\((.*)\)", table_definition)
    assert match
    inside_parentheses = match.group(1)
    parts = split_table_definition(inside_parentheses)

    # Lists to store columns and foreign keys
    columns = []
    relationships = []
    primary_key = ""

    for part in parts:
        if part.startswith("foreign key") or part.startswith("FOREIGN KEY"):
            part = part.replace("`", "").replace('"', "")
            regex1 = r"FOREIGN KEY\(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\)"
            regex2 = r"foreign key\(([^)]+)\) references ([^(]+)\(([^)]+)\)"
            match = re.search(regex1, part)
            match2 = re.search(regex2, part)
            match_result = False

            if match:
                match_result = match
            elif match2:
                match_result = match2

            if match_result:
                relationships.append(
                    {
                        "table_name": table_name,
                        "foreign_key": match_result.group(1),
                        "ref_table_name": match_result.group(2),
                        "ref_column": match_result.group(3),
                        "join_type": relationships_info[
                            (table_name, match_result.group(2))
                        ],
                        "properties": {},
                    }
                )
        else:
            if "PRIMARY KEY" in part or "primary key" in part:
                primary_key = part.strip().split(" ")[0]
                part = (
                    part.replace("PRIMARY KEY", "").replace("primary key", "").strip()
                )

            # Splitting the column name and type
            column_def = parse_column_definition(part.strip())

            columns.append(
                {
                    "name": column_def["name"].replace('"', ""),
                    "type": get_appropriat_column_type(column_def["type"]),
                    "notNull": column_def[
                        "not_null"
                    ],  # Assuming notNull is False by default as not specified in the string
                    "isCalculated": False,  # Assuming isCalculated is False by default
                    "expression": column_def["name"].replace(
                        '"', ""
                    ),  # Assuming expression is the column name itself
                    "properties": {},
                }
            )

    if relationships:
        for relationship in relationships:
            columns.append(
                {
                    "name": relationship["ref_table_name"],
                    "type": relationship["ref_table_name"],
                    "notNull": True,
                    "isCalculated": False,
                    "relationship": f"{relationship['table_name']}_{relationship['ref_table_name']}",
                    "properties": {},
                }
            )

    return {
        "columns": columns,
        "primary_key": primary_key,
        "relationships": relationships,
    }


def generate_mdl_json(
    database_schema: list[dict],
    catalog_name: str,
    schema_name: str,
    database_name: str,
    relationships_info: dict,
    should_save_file: bool = False,
    file_path: str = "",
):
    mdl_json = {
        "catalog": catalog_name,
        "schema": schema_name,
        "models": [],
        "relationships": [],
        # these will be empty for now
        "metrics": [],
        "cumulativeMetrics": [],
        "enumDefinitions": [],
        "views": [],
        "macros": [],
    }

    for table in database_schema:
        # remove comments
        clean_table_schema = table["table_schema"].replace(
            "-- this should be removed", ""
        )
        parsed = sqlparse.parse(clean_table_schema)[0]
        table_definition = parse_table_definition(
            table["table_name"], str(parsed.tokens[-1]), relationships_info
        )

        mdl_json["models"].append(
            {
                "name": table["table_name"],
                "properties": {},
                "refSql": f"select * from \"{catalog_name}\".{schema_name}.\"{database_name}-{table['table_name']}\"",
                "columns": table_definition["columns"],
                "primaryKey": table_definition["primary_key"],
            }
        )

        if table_definition["relationships"]:
            for relationship in table_definition["relationships"]:
                mdl_json["relationships"].append(
                    {
                        "name": f"{relationship['table_name']}_{relationship['ref_table_name']}",
                        "models": [
                            relationship["table_name"],
                            relationship["ref_table_name"],
                        ],
                        "joinType": relationship["join_type"],
                        "condition": f"{relationship['table_name']}.{relationship['foreign_key']} = {relationship['ref_table_name']}.{relationship['ref_column']}",
                    }
                )

    if should_save_file:
        data_root = "src/eval/data"
        if not Path(data_root).exists():
            Path(data_root).mkdir(parents=True, exist_ok=True)

        if not file_path:
            file_path = f"{data_root}/{database_name}.json"
        # save the file
        with open(file_path, "w") as file:
            json.dump(mdl_json, file, indent=2)

        print(
            f"MDL JSON for {database_name} generated successfully. Check the {data_root} folder."
        )

    return mdl_json


def generate_text_to_sql_dataset(
    paths: list[str],
    database_name: str = "baseball_1",
    should_save_file: bool = False,
    file_path: str = "data/baseball_1_data.json",
):
    target_data = []
    for path in paths:
        with open(path, "r") as f:
            data = json.load(f)

        if database_name == "":
            target_data += data
        else:
            for entry in data:
                if entry["db_id"] == database_name:
                    target_data.append(
                        {
                            "question": entry["question"],
                            "answer": transpile_sql_from_sqlite_to_trino(
                                re.sub(r"\s+", " ", entry["query"]).strip()
                            ),
                        }
                    )

    if should_save_file:
        data_root = "src/eval/data"
        if not Path(data_root).exists():
            Path(data_root).mkdir(parents=True, exist_ok=True)

        with open(file_path, "w") as f:
            for entry in target_data:
                json.dump(entry, f)
                f.write("\n")

        print(
            f"Dataset for {database_name} is generated successfully. Check the {data_root} folder."
        )

    return target_data
