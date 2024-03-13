import json
import os
import sqlite3
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import gdown
import pandas as pd
import sqlglot
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
        # make each row a tuple of strings for easier comparison with the results from Vulcan
        # also sort each row to make the order of the columns consistent
        results = tuple(tuple(sorted(map(str, row))) for row in cur.fetchall())
    except Exception:
        results = []
    finally:
        cur.close()
        conn.close()

    return results


def execute_sql_query_through_vulcan(sql_query: str):
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
            "details": {
                "correct": {
                    "sql_semantic_same": [],
                    "query_results_same": [],
                    "ground_truth_query_results_issubset": [],
                },
                "wrong": [],
            },
        }
    }

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
                    "regas_eval_results": get_ragas_eval_results(
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
        ) = execute_sql_query_through_vulcan(
            prediction["answer"],
        )
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
                        "regas_eval_results": get_ragas_eval_results(
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
                        "regas_eval_results": get_ragas_eval_results(
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
                "regas_eval_results": get_ragas_eval_results(
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
    file_name: str, ground_truths: List[Dict], outputs: List[Dict[str, Any]]
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
