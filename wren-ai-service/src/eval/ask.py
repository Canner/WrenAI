import argparse
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from tqdm import tqdm

from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.utils import load_env_vars

# from .eval_pipeline import Evaluation
from .utils import (
    download_spider_data,
    generate_eval_report,
    get_latest_prediction_outputs_file,
    write_prediction_results,
)

load_env_vars()

if with_trace := os.getenv("ENABLE_TRACE", default=False):
    from src.pipelines.trace import (
        langfuse,
    )


def process_item(query: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    retrieval_start = time.perf_counter()
    retrieval_result = retrieval_pipeline.run(
        query,
        user_id=user_id,
    )
    documents = retrieval_result["post_processor"]["documents"]
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
        user_id=user_id,
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
        predictions = [json.loads(line) for line in f]

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

    with open(f"./outputs/{dataset_name}_eval_results_{timestamp}.json", "w") as f:
        json.dump(eval_results, f, indent=2)


if __name__ == "__main__":
    DATASET_NAME = os.getenv("DATASET_NAME")

    parser = argparse.ArgumentParser(
        description=f"Evaluate the ask pipeline using the Spider dataset: {DATASET_NAME}"
    )
    parser.add_argument(
        "--input-file",
        type=str,
        default=get_latest_prediction_outputs_file(Path("./outputs"), DATASET_NAME),
        help="Path to the prediction results file. If not provided, the latest prediction results file will be used. The file should be located in the outputs folder in the root directory of the project.",
    )
    parser.add_argument(
        "--eval-after-prediction",
        action=argparse.BooleanOptionalAction,
        help="Whether to run the evaluation after making predictions. Default is True.",
    )
    parser.add_argument(
        "--eval-from-scratch",
        action=argparse.BooleanOptionalAction,
        help="Whether to run the evaluation from scratch. Default is False.",
    )
    parser.add_argument(
        "--llm_provider",
        type=str,
        default="openai",
        choices=["openai", "anthropic"],
        help="The LLM provider to use. Default is 'openai'.",
    )
    args = parser.parse_args()

    PREDICTION_RESULTS_FILE = args.input_file
    EVAL_AFTER_PREDICTION = args.eval_after_prediction
    LLM_PROVIDER = args.llm_provider

    if LLM_PROVIDER not in ["openai", "anthropic"]:
        raise ValueError(f"Invalid LLM provider: {LLM_PROVIDER}")

    with open(f"./src/eval/data/{DATASET_NAME}_data.json", "r") as f:
        ground_truths = [json.loads(line) for line in f]

    print(f"Running ask pipeline evaluation for the {DATASET_NAME} dataset...\n")
    if (
        PREDICTION_RESULTS_FILE
        and Path(PREDICTION_RESULTS_FILE).exists()
        and not args.eval_from_scratch
    ):
        eval(Path(PREDICTION_RESULTS_FILE), DATASET_NAME, ground_truths)
    else:
        with open(f"./src/eval/data/{DATASET_NAME}_mdl.json", "r") as f:
            mdl_str = json.dumps(json.load(f))

        document_store = init_document_store(
            dataset_name=DATASET_NAME,
            recreate_index=True,
        )
        embedder = init_embedder(with_trace=with_trace)
        retriever = init_retriever(
            document_store=document_store,
            with_trace=with_trace,
            top_k=10,
        )
        text_to_sql_generator = init_generator(
            with_trace=with_trace,
        )
        sql_correction_generator = init_generator(
            with_trace=with_trace,
        )

        print("Indexing documents...")
        indexing_pipeline = Indexing(document_store=document_store)
        indexing_pipeline_def = indexing_pipeline._pipe.dumps()
        indexing_pipeline.run(mdl_str)
        print(
            f"Finished indexing documents, document count: {document_store.count_documents()}"
        )

        retrieval_pipeline = Retrieval(
            embedder=embedder,
            retriever=retriever,
            with_trace=with_trace,
        )
        retrieval_pipeline_def = retrieval_pipeline._pipe.dumps()

        generation_pipeline = Generation(
            text_to_sql_generator=text_to_sql_generator,
            with_trace=with_trace,
        )
        generation_pipeline_def = generation_pipeline._pipe.dumps()

        sql_correction_pipeline = SQLCorrection(
            sql_correction_generator=sql_correction_generator,
        )
        sql_correction_pipeline_def = sql_correction_pipeline._pipe.dumps()

        print(f"Running predictions for {len(ground_truths)} questions...")
        start = time.time()
        user_id = str(uuid.uuid4())
        max_workers = os.cpu_count() // 2 if with_trace else None
        user_id = str(uuid.uuid4()) if with_trace else None
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            args_list = [
                (ground_truth["question"], user_id) for ground_truth in ground_truths
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
        write_prediction_results(
            f"./outputs/{DATASET_NAME}_predictions_{timestamp}.json",
            ground_truths,
            outputs,
            {
                "indexing": indexing_pipeline_def,
                "retrieval": retrieval_pipeline_def,
                "generation": generation_pipeline_def,
                "sql_correction": sql_correction_pipeline_def,
            },
        )
        if with_trace:
            langfuse.flush()

        if EVAL_AFTER_PREDICTION:
            eval(
                Path(f"./outputs/{DATASET_NAME}_predictions_{timestamp}.json"),
                DATASET_NAME,
                ground_truths,
            )
