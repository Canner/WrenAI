"""
This file aims to prepare spider 1.0 or bird eval dataset for text-to-sql eval purpose
"""

import argparse
import asyncio
import os
import zipfile
from collections import defaultdict
from itertools import zip_longest
from pathlib import Path
from urllib.request import urlretrieve

import gdown
import orjson
import pandas as pd

from eval import (
    BIRD_DESTINATION_PATH,
    EVAL_DATASET_DESTINATION_PATH,
    SPIDER_DESTINATION_PATH,
    WREN_ENGINE_API_URL,
)
from eval.utils import (
    get_contexts_from_sql,
    get_documents_given_contexts,
    get_eval_dataset_in_toml_string,
    get_next_few_items_circular,
)


def download_spider_data(destination_path: Path):
    def _download_and_extract(
        destination_path: Path, path: Path, file_name: str, gdrive_id: str
    ):
        if not (destination_path / path).exists():
            if Path(file_name).exists():
                os.remove(file_name)

            url = f"https://drive.google.com/u/0/uc?id={gdrive_id}&export=download"

            gdown.download(url, file_name, quiet=False)

            with zipfile.ZipFile(file_name, "r") as zip_ref:
                zip_ref.extractall(destination_path)

            os.remove(file_name)

    _download_and_extract(
        destination_path,
        "database",
        "testsuitedatabases.zip",
        "1mkCx2GOFIqNesD4y8TDAO1yX1QZORP5w",
    )

    _download_and_extract(
        destination_path,
        "spider_data",
        "spider_data.zip",
        "1403EGqzIDoHMdQF4c9Bkyl7dZLZ5Wt6J",
    )


def download_bird_data(destination_path: Path):
    def _download_and_extract(destination_path: Path, path: Path, file_name: str):
        if not (destination_path / path).exists():
            if Path(file_name).exists():
                os.remove(file_name)

            url = "https://bird-bench.oss-cn-beijing.aliyuncs.com/minidev.zip"

            print(f"Downloading {file_name} from {url}...")
            urlretrieve(url, file_name)

            with zipfile.ZipFile(file_name, "r") as zip_ref:
                zip_ref.extractall(destination_path)

            os.remove(file_name)

    _download_and_extract(
        destination_path,
        "minidev",
        "minidev.zip",
    )


def get_database_names(path: Path):
    return [folder.name for folder in path.iterdir() if folder.is_dir()]


def get_tables_by_db(path: Path, key: str):
    with open(path, "rb") as f:
        json_data = orjson.loads(f.read())

    return {item[key]: item for item in json_data}


def build_mdl_models(database, tables_info, database_info={}):
    def _build_mdl_columns(tables_info, table_index, table_info=None):
        def _merge_column_info(column_names_original, column_types):
            merged_info = []
            for (table_index, column_name), column_type in zip(
                column_names_original, column_types
            ):
                merged_info.append(
                    {
                        "table_index": table_index,
                        "column_name": column_name,
                        "column_type": column_type,
                    }
                )
            return merged_info

        def _get_columns_by_table_index(columns, table_index):
            return list(filter(lambda col: col["table_index"] == table_index, columns))

        _columns = _get_columns_by_table_index(
            _merge_column_info(
                tables_info["column_names_original"], tables_info["column_types"]
            ),
            table_index,
        )

        columns_info = {}
        if table_info:
            for column_info in table_info:
                original_col_key = next(
                    key for key in column_info.keys() if "original_column_name" in key
                )
                if value_description := column_info.get("value_description", ""):
                    columns_info[column_info[original_col_key]] = (
                        column_info.get("column_description", "")
                        + ", "
                        + value_description
                    ).strip()
                else:
                    columns_info[column_info[original_col_key]] = column_info.get(
                        "column_description", ""
                    ).strip()

        # dealing with some edge cases
        return [
            {
                "name": column["column_name"],
                "type": column["column_type"],
                "notNull": False,
                "properties": {
                    "description": columns_info.get(column["column_name"], ""),
                }
                if columns_info and columns_info.get(column["column_name"], "")
                else {},
            }
            for column in _columns
        ]

    return [
        {
            "name": table,
            "properties": {},
            "tableReference": {
                "catalog": database,
                "schema": "main",
                "table": table,
            },
            "primaryKey": (
                tables_info["column_names_original"][primary_key_column_index][-1]
                if primary_key_column_index
                else "",
            ),
            "columns": _build_mdl_columns(
                tables_info, i, database_info.get(table, None)
            ),
        }
        for i, (table, primary_key_column_index) in enumerate(
            zip_longest(
                tables_info["table_names_original"],
                filter(
                    lambda x: isinstance(x, int), tables_info["primary_keys"]
                ),  # filter out composite primary keys as of now
            )
        )
    ]


def build_mdl_relationships(tables_info):
    relationships = []
    for first, second in tables_info["foreign_keys"]:
        first_table_index, first_column_name = tables_info["column_names_original"][
            first
        ]
        first_foreign_key_table = tables_info["table_names_original"][first_table_index]

        second_table_index, second_column_name = tables_info["column_names_original"][
            second
        ]
        second_foreign_key_table = tables_info["table_names_original"][
            second_table_index
        ]

        relationships.append(
            {
                "name": f"{first_foreign_key_table}_{first_column_name}_{second_foreign_key_table}_{second_column_name}",
                "models": [first_foreign_key_table, second_foreign_key_table],
                "joinType": "MANY_TO_MANY",
                "condition": f"{first_foreign_key_table}.{first_column_name} = {second_foreign_key_table}.{second_column_name}",
            }
        )

    return relationships


def get_ground_truths_by_db(path: Path, key: str):
    with open(path, "rb") as f:
        json_data = orjson.loads(f.read())

    results = defaultdict(list)
    for item in json_data:
        results[item[key]].append(item)

    return results


def build_mdl_by_db_using_spider(destination_path: Path):
    # get all database names in the spider testsuite
    database_names = get_database_names(destination_path / "database")

    # read tables.json and transform it to be a dictionary with database name as key
    tables_by_db = get_tables_by_db(
        destination_path / "spider_data/tables.json", "db_id"
    )

    # build mdl for each database by checking the test_tables.json in spider_data
    mdl_by_db = {}
    for database in database_names:
        if tables_info := tables_by_db.get(database):
            mdl_by_db[database] = {
                "catalog": database,
                "schema": "main",
                "dataSource": "postgres",
                "models": build_mdl_models(database, tables_info),
                "relationships": build_mdl_relationships(tables_info),
                "views": [],
                "metrics": [],
            }

    return mdl_by_db


def build_question_sql_pairs_by_db_using_spider(destination_path: Path):
    # get all database names in the spider testsuite
    database_names = get_database_names(destination_path / "database")

    # get dev.json and transform it to be a dictionary with database name as key
    ground_truths_by_db = get_ground_truths_by_db(
        destination_path / "spider_data/dev.json", "db_id"
    )

    question_sql_pairs_by_db = defaultdict(list)
    for database in database_names:
        if ground_truths_info := ground_truths_by_db.get(database):
            for ground_truth in ground_truths_info:
                question_sql_pairs_by_db[database].append(
                    {
                        "question": ground_truth["question"],
                        "sql": ground_truth["query"],
                    }
                )

    return question_sql_pairs_by_db


def build_mdl_by_db_using_bird(destination_path: Path):
    def _get_database_infos(path: Path):
        database_infos = {}
        for folder in path.iterdir():
            if folder.is_dir():
                path_to_database_description = (
                    path / folder.name / "database_description"
                )
                if (
                    path_to_database_description in folder.iterdir()
                    and path_to_database_description.is_dir()
                ):
                    database_infos[folder.name] = {}
                    for file in path_to_database_description.iterdir():
                        if file.is_file() and file.suffix == ".csv":
                            df = pd.read_csv(
                                file, encoding="ISO-8859-1", keep_default_na=False
                            )
                            database_infos[folder.name][file.stem] = df.to_dict(
                                orient="records"
                            )

        return database_infos

    database_names = get_database_names(
        destination_path / "minidev/MINIDEV/dev_databases"
    )
    database_infos = _get_database_infos(
        destination_path / "minidev/MINIDEV/dev_databases"
    )
    tables_by_db = get_tables_by_db(
        destination_path / "minidev/MINIDEV/dev_tables.json", "db_id"
    )

    # build mdl for each database by checking the test_tables.json in spider_data
    mdl_by_db = {}
    for database in database_names:
        if tables_info := tables_by_db.get(database):
            mdl_by_db[database] = {
                "catalog": database,
                "schema": "main",
                "dataSource": "postgres",
                "models": build_mdl_models(
                    database, tables_info, database_infos.get(database, {})
                ),
                "relationships": build_mdl_relationships(tables_info),
                "views": [],
                "metrics": [],
            }

    return mdl_by_db


def build_question_sql_pairs_by_db_using_bird(destination_path: Path):
    database_names = get_database_names(
        destination_path / "minidev/MINIDEV/dev_databases"
    )

    ground_truths_by_db = get_ground_truths_by_db(
        destination_path / "minidev/MINIDEV/mini_dev_sqlite.json", "db_id"
    )

    question_sql_pairs_by_db = defaultdict(list)
    for database in database_names:
        if ground_truths_info := ground_truths_by_db.get(database):
            for ground_truth in ground_truths_info:
                question_sql_pairs_by_db[database].append(
                    {
                        "question": ground_truth["question"],
                        "sql": ground_truth["SQL"],
                        "question_id": ground_truth["question_id"],
                        "evidence": ground_truth["evidence"],
                        "difficulty": ground_truth["difficulty"],
                    }
                )

    return question_sql_pairs_by_db


def get_mdls_and_question_sql_pairs_by_common_db(mdl_by_db, question_sql_pairs_by_db):
    common_dbs = set(mdl_by_db.keys()) & set(question_sql_pairs_by_db.keys())

    return {
        db: {"mdl": mdl_by_db[db], "ground_truth": question_sql_pairs_by_db[db]}
        for db in common_dbs
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Prepare evaluation dataset for text-to-sql tasks."
    )
    parser.add_argument(
        "--dataset",
        choices=["spider1.0", "bird"],
        default="spider1.0",
        help="Choose which dataset to prepare (spider1.0 or bird)",
    )
    args = parser.parse_args()

    if args.dataset == "spider1.0":
        destination_path = SPIDER_DESTINATION_PATH
        print(
            f"Downloading {args.dataset} data if unavailable in {destination_path}..."
        )
        download_spider_data(destination_path)
    elif args.dataset == "bird":
        destination_path = BIRD_DESTINATION_PATH
        print(
            f"Downloading {args.dataset} data if unavailable in {destination_path}..."
        )
        download_bird_data(destination_path)

    print(f"Building mdl and question sql pairs using {args.dataset} data...")
    # get mdl_by_db and question_sql_pairs_by_db whose dbs are present in both dictionaries
    if args.dataset == "spider1.0":
        mdl_and_ground_truths_by_db = get_mdls_and_question_sql_pairs_by_common_db(
            build_mdl_by_db_using_spider(destination_path),
            build_question_sql_pairs_by_db_using_spider(destination_path),
        )
    elif args.dataset == "bird":
        mdl_and_ground_truths_by_db = get_mdls_and_question_sql_pairs_by_common_db(
            build_mdl_by_db_using_bird(destination_path),
            build_question_sql_pairs_by_db_using_bird(destination_path),
        )

    print("Creating eval dataset...")
    questions_size = 0
    if args.dataset == "spider1.0":
        eval_data_db_path = "etc/spider1.0/database"
    elif args.dataset == "bird":
        eval_data_db_path = "etc/bird/minidev/MINIDEV/dev_databases"
    for db, values in sorted(mdl_and_ground_truths_by_db.items()):
        candidate_eval_dataset = []

        print(f"Database: {db}")
        for i, ground_truth in enumerate(values["ground_truth"]):
            context = asyncio.run(
                get_contexts_from_sql(
                    ground_truth["sql"],
                    values["mdl"],
                    WREN_ENGINE_API_URL,
                )
            )

            # ignore empty context
            if context:
                previous_ground_truths = get_next_few_items_circular(
                    values["ground_truth"], i
                )
                sql_pairs = [
                    {
                        "question": ground_truth["question"],
                        "sql": ground_truth["sql"],
                    }
                    for ground_truth in previous_ground_truths
                ]

                instructions = [ground_truth.get("evidence", "")]

                candidate_eval_dataset.append(
                    {
                        "categories": [],
                        "question": ground_truth["question"],
                        "sql": ground_truth["sql"],
                        "context": context,
                        "document": get_documents_given_contexts(
                            [context], values["mdl"]
                        ),
                        "samples": sql_pairs,
                        "instructions": instructions,
                    }
                )
            # else:
            #     print(
            #         "Warning: context is empty, ignore this question sql pair as of now..."
            #     )
            #     print(f"database: {db}")
            #     print(f'question: {ground_truth["question"]}')
            #     print(f'sql: {ground_truth["sql"]}')
            #     print()

        # save eval dataset
        if candidate_eval_dataset:
            if args.dataset == "spider1.0":
                file_name = f"spider_{db}_eval_dataset.toml"
            elif args.dataset == "bird":
                file_name = f"bird_{db}_eval_dataset.toml"

            with open(f"{EVAL_DATASET_DESTINATION_PATH}/{file_name}", "w") as f:
                f.write(
                    get_eval_dataset_in_toml_string(
                        values["mdl"], candidate_eval_dataset
                    )
                )
            print(
                f"Successfully creating eval dataset of database {db}, which has {len(candidate_eval_dataset)} questions"
            )
            questions_size += len(candidate_eval_dataset)
            print()

    print(f"Total questions size: {questions_size}")
