"""
CAUTION: before running this code, please ensure the given dataset's mdl model is deployed already
"""

import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

import requests
from tqdm import tqdm

from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.utils import init_providers, load_env_vars

load_env_vars()


def get_mdl_from_wren_engine():
    response = requests.get(
        f'{os.getenv("WREN_ENGINE_ENDPOINT")}/v1/mdl',
    )
    assert response.status_code == 200

    return response.json()


def process_item(query: str):
    retrieval_start = time.perf_counter()
    retrieval_result = retrieval_pipeline.run(query)
    documents = retrieval_result["retriever"]["documents"]
    retrieval_end = time.perf_counter()

    text_to_sql_generation_start = time.perf_counter()
    text_to_sql_generation_results = generation_pipeline.run(
        query,
        contexts=documents,
    )
    text_to_sql_generation_end = time.perf_counter()
    text_to_sql_generation_time_cost = (
        text_to_sql_generation_end - text_to_sql_generation_start
    )

    valid_generation_results = []
    invalid_generation_results = []

    if text_to_sql_generation_results["post_processor"]["valid_generation_results"]:
        valid_generation_results += text_to_sql_generation_results["post_processor"][
            "valid_generation_results"
        ]

    sql_correction_results = None
    sql_correction_generation_time_cost = 0
    if text_to_sql_generation_results["post_processor"]["invalid_generation_results"]:
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

    return {
        "question": query,
        "valid_generation_results": valid_generation_results,
        "invalid_generation_results": invalid_generation_results,
        "metadata": {
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
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Evaluate the ask pipeline using the sample dataset: music, ecommerce, nba"
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default="music",
        choices=["music", "ecommerce", "nba"],
    )
    args = parser.parse_args()

    SAMPLE_DATASET_NAME = args.dataset
    with open("./src/eval/ask/sampledata_questions.json", "r") as f:
        SAMPLE_DATASET_QUESTIONS = json.load(f)

    if not Path("./outputs/ask/sampledata").exists():
        Path("./outputs/ask/sampledata").mkdir(parents=True)

    # init ask pipeline
    llm_provider, document_store_provider = init_providers()
    document_store = document_store_provider.get_store(
        dataset_name=SAMPLE_DATASET_NAME,
        recreate_index=True,
    )
    embedder = llm_provider.get_text_embedder()
    retriever = document_store_provider.get_retriever(
        document_store=document_store,
        top_k=10,
    )
    text_to_sql_generator = llm_provider.get_generator()
    sql_correction_generator = llm_provider.get_generator()

    retrieval_pipeline = Retrieval(
        embedder=embedder,
        retriever=retriever,
    )
    generation_pipeline = Generation(
        generator=text_to_sql_generator,
    )
    sql_correction_pipeline = SQLCorrection(
        generator=sql_correction_generator,
    )

    # indexing
    print("Indexing documents...")
    mdl = get_mdl_from_wren_engine()
    indexing_pipeline = Indexing(
        llm_provider=llm_provider,
        store_provider=document_store_provider,
    )
    indexing_pipeline.run(json.dumps(mdl))
    print(
        f"Finished indexing documents, document count: {document_store.count_documents()}"
    )

    print(
        f"Running predictions for {len(SAMPLE_DATASET_QUESTIONS[SAMPLE_DATASET_NAME])} questions..."
    )
    start = time.time()
    with ThreadPoolExecutor() as executor:
        args_list = [
            (question,) for question in SAMPLE_DATASET_QUESTIONS[SAMPLE_DATASET_NAME]
        ]
        outputs = list(
            tqdm(
                executor.map(lambda p: process_item(*p), args_list),
                total=len(args_list),
            )
        )
    end = time.time()
    print(f"Time taken: {end - start:.2f}s")

    no_valid_generations = list(
        filter(
            lambda x: (not x["valid_generation_results"])
            and x["invalid_generation_results"],
            outputs,
        )
    )

    total_invalid_generations = list(
        filter(lambda x: x["invalid_generation_results"], outputs)
    )

    results = {
        "mdl": mdl,
        "no_valid_generation": {
            "count": len(no_valid_generations),
            "details": no_valid_generations,
        },
        "total_invalid_generation": {
            "count": len(total_invalid_generations),
            "details": total_invalid_generations,
        },
        "outputs": outputs,
    }

    with open(
        f"./outputs/ask/sampledata/{SAMPLE_DATASET_NAME}_{datetime.now().strftime("%Y%m%d%H%M%S")}.json",
        "w",
    ) as f:
        json.dump(results, f, indent=2)
