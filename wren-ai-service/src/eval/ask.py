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
from src.pipelines.ask.components.prompts import user_prompt_builder
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.utils import clean_generation_result, load_env_vars

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
    retrieval_end = time.perf_counter()

    generation_start = time.perf_counter()
    generation_result = generation_pipeline.run(
        query,
        contexts=retrieval_result["retriever"]["documents"],
        user_id=user_id,
    )
    generation_end = time.perf_counter()

    metadata = {
        "generation": generation_result["generator"]["meta"][0],
        "latency": {
            "retrieval": retrieval_end - retrieval_start,
            "generation": generation_end - generation_start,
        },
    }

    return {
        "contexts": retrieval_result["retriever"]["documents"],
        "prediction": json.loads(
            clean_generation_result(generation_result["generator"]["replies"][0])
        )["sql"],
        "metadata": metadata,
    }


def eval(prediction_results_file: Path, dataset_name: str, ground_truths: list[dict]):
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
        "--input_file",
        type=str,
        default=get_latest_prediction_outputs_file(Path("./outputs"), DATASET_NAME),
        help="Path to the prediction results file. If not provided, the latest prediction results file will be used. The file should be located in the outputs folder in the root directory of the project.",
    )
    parser.add_argument(
        "--eval_after_prediction",
        action="store_true",
        default=True,
        help="Whether to run the evaluation after making predictions. Default is True.",
    )
    parser.add_argument(
        "--eval_from_scratch",
        action="store_true",
        default=False,
        help="Whether to run the evaluation from scratch. Default is False.",
    )
    args = parser.parse_args()

    PREDICTION_RESULTS_FILE = args.input_file
    EVAL_AFTER_PREDICTION = args.eval_after_prediction

    with open(f"./src/eval/data/{DATASET_NAME}_data.json", "r") as f:
        ground_truths = [json.loads(line) for line in f]

    if (
        PREDICTION_RESULTS_FILE
        and Path(PREDICTION_RESULTS_FILE).exists()
        and not args.eval_from_scratch
    ):
        eval(Path(PREDICTION_RESULTS_FILE), DATASET_NAME, ground_truths)
    else:
        with open(f"./src/eval/data/{DATASET_NAME}_mdl.json", "r") as f:
            mdl_str = json.dumps(json.load(f))

        document_store = init_document_store()
        embedder = init_embedder(with_trace=with_trace)
        retriever = init_retriever(
            document_store=document_store,
            with_trace=with_trace,
        )
        generator = init_generator(with_trace=with_trace)

        Indexing(document_store=document_store).run(mdl_str)
        print(
            f"finished indexing documents, document count: {document_store.count_documents()}"
        )

        retrieval_pipeline = Retrieval(
            embedder=embedder,
            retriever=retriever,
            with_trace=with_trace,
        )

        generation_pipeline = Generation(
            generator=generator,
            with_trace=with_trace,
            prompt_builder=user_prompt_builder,
        )

        start = time.time()
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
        )
        if with_trace:
            langfuse.flush()

        if EVAL_AFTER_PREDICTION:
            eval(
                Path(f"./outputs/{DATASET_NAME}_predictions_{timestamp}.json"),
                DATASET_NAME,
                ground_truths,
            )
