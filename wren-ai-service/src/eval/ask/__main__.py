import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import orjson
from tqdm import tqdm

from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.pipelines.semantics import description
from src.utils import init_providers, load_env_vars
from src.web.v1.services.semantics import (
    GenerateDescriptionRequest,
    SemanticsService,
)

# from .eval_pipeline import Evaluation
from .utils import (
    download_spider_data,
    generate_eval_report,
    get_latest_prediction_outputs_file,
    write_prediction_results,
)

load_env_vars()


def process_item(
    query: str,
    no_db_schema: Optional[bool],
) -> Dict[str, Any]:
    retrieval_start = time.perf_counter()
    if not no_db_schema:
        retrieval_result = retrieval_pipeline.run(
            query,
        )

        documents = retrieval_result["retriever"]["documents"]
    else:
        documents = []
    retrieval_end = time.perf_counter()

    valid_generation_results = []
    invalid_generation_results = []

    sql_statistics = {
        "text_to_sql": {
            "valid": 0,
            "invalid": 0,
            "empty": 0,
        },
        "sql_correction": {
            "valid": 0,
            "invalid": 0,
        },
    }

    text_to_sql_generation_start = time.perf_counter()
    text_to_sql_generation_results = generation_pipeline.run(
        query,
        contexts=documents,
    )
    text_to_sql_generation_end = time.perf_counter()
    text_to_sql_generation_time_cost = (
        text_to_sql_generation_end - text_to_sql_generation_start
    )

    if text_to_sql_generation_results["post_processor"]["valid_generation_results"]:
        valid_generation_results += text_to_sql_generation_results["post_processor"][
            "valid_generation_results"
        ]
        sql_statistics["text_to_sql"]["valid"] += len(
            text_to_sql_generation_results["post_processor"]["valid_generation_results"]
        )

    sql_correction_results = None
    sql_correction_generation_time_cost = 0
    if text_to_sql_generation_results["post_processor"]["invalid_generation_results"]:
        print("before:")
        print(
            f'invalid: {text_to_sql_generation_results["post_processor"]["invalid_generation_results"]}'
        )

        sql_statistics["text_to_sql"]["invalid"] += len(
            text_to_sql_generation_results["post_processor"][
                "invalid_generation_results"
            ]
        )

        sql_correction_generation_start = time.perf_counter()
        sql_correction_results = sql_correction_pipeline.run(
            contexts=documents,
            invalid_generation_results=text_to_sql_generation_results["post_processor"][
                "invalid_generation_results"
            ],
        )
        sql_correction_generation_end = time.perf_counter()
        sql_correction_generation_time_cost = (
            sql_correction_generation_end - sql_correction_generation_start
        )

        valid_generation_results += sql_correction_results["post_processor"][
            "valid_generation_results"
        ]
        invalid_generation_results += sql_correction_results["post_processor"][
            "invalid_generation_results"
        ]
        sql_statistics["sql_correction"]["valid"] += len(
            sql_correction_results["post_processor"]["valid_generation_results"]
        )
        sql_statistics["sql_correction"]["invalid"] += len(
            sql_correction_results["post_processor"]["invalid_generation_results"]
        )

        print("after:")
        print(
            f'valid: {sql_correction_results["post_processor"][
            "valid_generation_results"
        ]}'
        )
        print(
            f'invalid: {sql_correction_results["post_processor"]["invalid_generation_results"]}'
        )

    if (
        not text_to_sql_generation_results["post_processor"]["valid_generation_results"]
        and not text_to_sql_generation_results["post_processor"][
            "invalid_generation_results"
        ]
    ):
        sql_statistics["text_to_sql"]["empty"] += 1

    metadata = {
        "generation": {
            "text_to_sql": text_to_sql_generation_results["text_to_sql_generator"][
                "meta"
            ][0],
            "sql_correction": (
                sql_correction_results["sql_correction_generator"]["meta"][0]
                if sql_correction_results
                else []
            ),
        },
        "latency": {
            "retrieval": retrieval_end - retrieval_start,
            "generation": {
                "text_to_sql": text_to_sql_generation_time_cost,
                "sql_correction": sql_correction_generation_time_cost,
            },
        },
    }

    return {
        "contexts": documents,
        "prediction": (
            valid_generation_results[0]["sql"] if valid_generation_results else ""
        ),
        "metadata": metadata,
        "sql_statistics": sql_statistics,
    }


def eval(prediction_results_file: Path, dataset_name: str, ground_truths: list[dict]):
    print(f"Generating evaluation report for {dataset_name} dataset...")

    download_spider_data()

    with open(prediction_results_file, "r") as f:
        predictions = [orjson.loads(line) for line in f]

    # eval_pipeline = Evaluation()
    # eval_pipeline_inputs = prepare_evaluation_pipeline_inputs(
    #     eval_pipeline.component_names,
    #     ground_truths,
    #     predictions,
    # )
    # ragas_eval_results = eval_pipeline.run(eval_pipeline_inputs)

    ragas_eval_results = {}

    eval_results = generate_eval_report(
        dataset_name,
        ground_truths,
        predictions,
        ragas_eval_results,
    )

    timestamp = prediction_results_file.stem.split("_")[-1]

    with open(f"./outputs/ask/{dataset_name}_eval_results_{timestamp}.json", "w") as f:
        json.dump(eval_results, f, indent=2)


if __name__ == "__main__":
    DATASET_NAME = os.getenv("DATASET_NAME")

    parser = argparse.ArgumentParser(
        description=f"Evaluate the ask pipeline using the Spider dataset: {DATASET_NAME}"
    )
    parser.add_argument(
        "--input-file",
        type=str,
        default=get_latest_prediction_outputs_file(Path("./outputs/ask"), DATASET_NAME),
        help="Path to the prediction results file. If not provided, the latest prediction results file will be used. The file should be located in the outputs folder in the root directory of the project.",
    )
    parser.add_argument(
        "--eval-after-prediction",
        action=argparse.BooleanOptionalAction,
        help="Run the evaluation after making predictions. Default is False.",
    )
    parser.add_argument(
        "--eval-from-scratch",
        action=argparse.BooleanOptionalAction,
        help="Run the evaluation from scratch. Default is False.",
    )
    parser.add_argument(
        "--semantic-description",
        action=argparse.BooleanOptionalAction,
        help="Whether to add semantic description before asking. Default is False.",
    )
    parser.add_argument(
        "--custom-semantic-description",
        action=argparse.BooleanOptionalAction,
        help="Whether to add customized semantic description before asking. Default is False.",
    )
    parser.add_argument(
        "--without-db-schema",
        action=argparse.BooleanOptionalAction,
        help="Whether to exclude the database schema information. Default is False.",
    )
    parser.add_argument(
        "--easy-questions",
        action=argparse.BooleanOptionalAction,
        help="Whether to use easy questions for evaluation. Default is False.",
    )
    parser.add_argument(
        "--hard-questions",
        action=argparse.BooleanOptionalAction,
        help="Whether to use hard questions for evaluation. Default is False.",
    )

    args = parser.parse_args()

    PREDICTION_RESULTS_FILE = args.input_file
    EVAL_AFTER_PREDICTION = args.eval_after_prediction
    EVAL_FROM_SCRATCH = args.eval_from_scratch
    ENABLE_SEMANTIC_DESCRIPTION = args.semantic_description
    CUSTOM_SEMANTIC_DESCRIPTION = args.custom_semantic_description
    NO_DB_SCHEMA = args.without_db_schema
    EASY_QUESTIONS = args.easy_questions
    HARD_QUESTIONS = args.hard_questions

    assert not (
        CUSTOM_SEMANTIC_DESCRIPTION and ENABLE_SEMANTIC_DESCRIPTION
    ), "Cannot use both custom and general semantic description for evaluation."
    assert not (
        EASY_QUESTIONS and HARD_QUESTIONS
    ), "Cannot use both easy and hard questions for evaluation."

    if EASY_QUESTIONS:
        with open(f"./src/eval/data/{DATASET_NAME}_data_easy.json", "r") as f:
            ground_truths = [orjson.loads(line) for line in f]
    elif HARD_QUESTIONS:
        with open(f"./src/eval/data/{DATASET_NAME}_data_hard.json", "r") as f:
            ground_truths = [orjson.loads(line) for line in f]
    else:
        with open(f"./src/eval/data/{DATASET_NAME}_data.json", "r") as f:
            ground_truths = [orjson.loads(line) for line in f]

    if ENABLE_SEMANTIC_DESCRIPTION:
        if os.path.exists(f"./src/eval/data/{DATASET_NAME}_with_semantic_mdl.json"):
            print(f"Use the existed {DATASET_NAME}_with_semantic_mdl.json...\n")
        else:
            print(
                f"Generating semantic description for the {DATASET_NAME} dataset...\n"
            )
            semantics_service = SemanticsService(
                pipelines={
                    "generate_description": description.Generation(),
                }
            )
            with open(f"./src/eval/data/{DATASET_NAME}_mdl.json", "r") as f:
                mdl_data = json.load(f)

            for model in tqdm(mdl_data["models"]):
                semantic_desc = semantics_service.generate_description(
                    GenerateDescriptionRequest(
                        mdl=model,
                        model=model["name"],
                        identifier="model",
                    )
                )
                model["properties"]["description"] = semantic_desc.description
                model["properties"]["display_name"] = semantic_desc.display_name
                for column in model["columns"]:
                    semantic_desc = semantics_service.generate_description(
                        GenerateDescriptionRequest(
                            mdl=model,
                            model=model["name"],
                            identifier="column@" + column["name"],
                        )
                    )
                    column["properties"]["description"] = semantic_desc.description
                    column["properties"]["display_name"] = semantic_desc.display_name

            with open(
                f"./src/eval/data/{DATASET_NAME}_with_semantic_mdl.json", "w"
            ) as f:
                json.dump(mdl_data, f)

    if not Path("./outputs/ask").exists():
        Path("./outputs/ask").mkdir(parents=True)

    if ENABLE_SEMANTIC_DESCRIPTION:
        if os.path.exists(f"./src/eval/data/{DATASET_NAME}_with_semantic_mdl.json"):
            print(f"Use the existed {DATASET_NAME}_with_semantic_mdl.json...\n")
        else:
            print(
                f"Generating semantic description for the {DATASET_NAME} dataset...\n"
            )
            semantics_service = SemanticsService(
                pipelines={
                    "generate_description": description.Generation(),
                }
            )
            with open(f"./src/eval/data/{DATASET_NAME}_mdl.json", "r") as f:
                mdl_data = json.load(f)

            for model in tqdm(mdl_data["models"]):
                semantic_desc = semantics_service.generate_description(
                    GenerateDescriptionRequest(
                        mdl=model,
                        model=model["name"],
                        identifier="model",
                    )
                )
                model["properties"]["description"] = semantic_desc.description
                model["properties"]["display_name"] = semantic_desc.display_name
                for column in model["columns"]:
                    semantic_desc = semantics_service.generate_description(
                        GenerateDescriptionRequest(
                            mdl=model,
                            model=model["name"],
                            identifier="column@" + column["name"],
                        )
                    )
                    column["properties"]["description"] = semantic_desc.description
                    column["properties"]["display_name"] = semantic_desc.display_name

            with open(
                f"./src/eval/data/{DATASET_NAME}_with_semantic_mdl.json", "w"
            ) as f:
                json.dump(mdl_data, f)

    if not Path("./outputs").exists():
        Path("./outputs").mkdir()

    print(f"Running ask pipeline evaluation for the {DATASET_NAME} dataset...\n")
    if (
        PREDICTION_RESULTS_FILE
        and Path(PREDICTION_RESULTS_FILE).exists()
        and not EVAL_FROM_SCRATCH
    ):
        eval(Path(PREDICTION_RESULTS_FILE), DATASET_NAME, ground_truths)
    else:
        if ENABLE_SEMANTIC_DESCRIPTION:
            with open(
                f"./src/eval/data/{DATASET_NAME}_with_semantic_mdl.json", "r"
            ) as f:
                mdl_str = orjson.dumps(json.load(f)).decode("utf-8")
        elif CUSTOM_SEMANTIC_DESCRIPTION:
            with open(
                f"./src/eval/data/{DATASET_NAME}_custom_semantic_mdl.json", "r"
            ) as f:
                mdl_str = orjson.dumps(json.load(f)).decode("utf-8")
        else:
            with open(f"./src/eval/data/{DATASET_NAME}_mdl.json", "r") as f:
                mdl_str = orjson.dumps(json.load(f)).decode("utf-8")

        llm_provider, document_store_provider = init_providers()

        print("Indexing documents...")
        indexing_pipeline = Indexing(
            llm_provider=llm_provider,
            document_store_provider=document_store_provider,
        )
        indexing_pipeline_def = indexing_pipeline._pipeline.dumps()
        indexing_pipeline.run(mdl_str)
        print(
            f"Finished indexing documents, document count: {document_store_provider.get_store().count_documents()}"
        )

        retrieval_pipeline = Retrieval(
            llm_provider=llm_provider,
            document_store_provider=document_store_provider,
        )
        retrieval_pipeline_def = retrieval_pipeline._pipe.dumps()

        generation_pipeline = Generation(
            llm_provider=llm_provider,
        )
        generation_pipeline_def = generation_pipeline._pipe.dumps()

        sql_correction_pipeline = SQLCorrection(
            llm_provider=llm_provider,
        )
        sql_correction_pipeline_def = sql_correction_pipeline._pipe.dumps()

        print(f"Running predictions for {len(ground_truths)} questions...")
        start = time.time()
        with ThreadPoolExecutor() as executor:
            args_list = [
                (
                    ground_truth["question"],
                    NO_DB_SCHEMA,
                )
                for ground_truth in ground_truths
            ]
            outputs = list(
                tqdm(
                    executor.map(lambda p: process_item(*p), args_list),
                    total=len(args_list),
                )
            )
        end = time.time()
        print(f"Time taken: {end - start:.2f}s")

        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        print(
            f"Write predictions to ./outputs/ask/{DATASET_NAME}_predictions_{timestamp}.json"
        )
        write_prediction_results(
            f"./outputs/ask/{DATASET_NAME}_predictions_{timestamp}.json",
            ground_truths,
            outputs,
            {
                "indexing": indexing_pipeline_def,
                "retrieval": retrieval_pipeline_def,
                "generation": generation_pipeline_def,
                "sql_correction": sql_correction_pipeline_def,
            },
        )

        if EVAL_AFTER_PREDICTION:
            eval(
                Path(f"./outputs/ask/{DATASET_NAME}_predictions_{timestamp}.json"),
                DATASET_NAME,
                ground_truths,
            )
