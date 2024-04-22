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

from src.pipelines.ask.components.document_store import init_document_store
from src.pipelines.ask.components.embedder import init_embedder
from src.pipelines.ask.components.generator import init_generator
from src.pipelines.ask.components.retriever import init_retriever
from src.pipelines.ask.generation_pipeline import Generation
from src.pipelines.ask.indexing_pipeline import Indexing
from src.pipelines.ask.retrieval_pipeline import Retrieval
from src.pipelines.ask.sql_correction_pipeline import SQLCorrection
from src.utils import load_env_vars

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
    SAMPLE_DATASET_QUESTIONS = {
        "nba": [
            "How many assists were made by each player in each game?",
            "How many blocks were made by each player in each game?",
            "How many field goal attempts were made by each player in each game?",
            "How many field goals were made by each player in each game?",
            "How many games went into overtime, and which teams were involved?",
            "How many games were played by each team in the season?",
            "How many personal fouls were committed by each player in each game?",
            "How many points were scored by each player in each game, and what are their full names?",
            "How many points were scored by each team in each quarter of the game?",
            "How many rebounds were grabbed by each player in each game?",
            "How many steals were made by each player in each game?",
            "How many three-point attempts were made by each player in each game?",
            "How many three-pointers were made by each player in each game?",
            "How many turnovers were committed by each player in each game?",
            "What is the differences in turnover rates between teams with high and low average scores?",
            "Which players participated in each game along with their teams and ages?",
            "Which players recorded the highest number of triple-doubles throughout the season?",
            "Which teams exhibited the most consistent performance in terms of points scored per quarter?",
            "Which teams had the highest average points scored per game throughout the season?",
        ],
        "music": [
            "How many invoices were issued for tracks in each genre?",
            "How many tracks are there in each genre?",
            "How many tracks were purchased by each customer, and what is the total cost of those tracks?",
            "How many tracks were purchased in each genre, and what is the average unit price of those tracks?",
            "How many tracks were purchased in each invoice, along with their unit prices?",
            "How many tracks were purchased in each invoice, and what is the average unit price of those tracks?",
            "How many tracks were purchased in each invoice, and what is the total cost of those tracks?",
            "What are the details of customers who made purchases in each invoice?",
            "What are the details of invoices along with the album titles purchased by each customer?",
            "What are the details of invoices along with the customer names who made those purchases?",
            "What are the details of invoices along with the total quantity of tracks purchased by each customer?",
            "What are the details of invoices along with the total quantity of tracks purchased in each invoice?",
            "What are the names of composers for tracks in a specific album?",
            "What are the titles of albums along with their artists' names and genres?",
            "What are the titles of albums along with their corresponding artist names?",
            "What are the total sales generated from each customer?",
            "What are the top 5 selling albums in the US?",
            "What is the total revenue generated from each album?",
            "What is the total revenue generated from each genre?",
            "What is the total revenue generated from tracks composed by a specific composer?",
            "What is the total revenue generated from tracks in each album?",
            "Which albums have been purchased by customers in each invoice, along with their track details?",
            "Which albums have been purchased by customers in each invoice, and what is the total cost of those albums?",
            "Which albums have been purchased by each customer, and what is the total cost of those albums?",
            "Which albums have been purchased in each invoice, and what is the total cost of each album?",
            "Which customers have made purchases of tracks composed by a specific composer?",
            "Which customers have made purchases of tracks from albums by a specific artist?",
            "Which customers have made purchases of tracks from albums in each genre?",
            "Which tracks are associated with each album and their respective genres?",
            "Which tracks have been purchased by each customer in each invoice, along with their composers?",
            "Which tracks have been purchased in each invoice along with their composers?",
        ],
        "ecommerce": [
            "How many items have been purchased in orders placed by customers in each state?",
            "How many items were purchased in each order, and what was the total price?",
            "How many orders have been delivered to customers in each city, and when were they delivered?",
            "What are the sequential numbers of payments made for each order?",
            "What are the top 3 value for orders placed by customers in each city?",
            "What is the average score of reviews submitted for orders placed by customers in each city?",
            "What is the creation timestamp of each review along with its associated order's status?",
            "What is the delivery carrier date of each order along with its customer's city and state?",
            "What is the estimated delivery date of each order along with its customer's city?",
            "What is the status of each order along with its customer's city and state?",
            "What is the total freight value for each order?",
            "What is the total freight value for orders placed by customers in each state?",
            "What is the total price of products included in each order along with their shipping limit dates?",
            "What is the total value of payments made by customers from each state?",
        ],
    }

    if not Path("./outputs/ask/sampledata").exists():
        Path("./outputs/ask/sampledata").mkdir(parents=True)

    # init ask pipeline
    document_store = init_document_store(
        dataset_name=SAMPLE_DATASET_NAME,
        recreate_index=True,
    )
    embedder = init_embedder()
    retriever = init_retriever(
        document_store=document_store,
        top_k=10,
    )
    text_to_sql_generator = init_generator()
    sql_correction_generator = init_generator()

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
    indexing_pipeline = Indexing(document_store=document_store)
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
