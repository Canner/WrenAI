"""
This file aims to prepare spider 1.0 eval dataset for text-to-sql eval purpose
"""
import asyncio
import os
import zipfile
from collections import defaultdict
from itertools import zip_longest
from pathlib import Path

import gdown
import orjson

from eval.utils import (
    get_contexts_from_sql,
    get_documents_given_contexts,
    get_eval_dataset_in_toml_string,
    get_next_few_items_circular,
    prepare_duckdb_init_sql,
    prepare_duckdb_session_sql,
)

SPIDER_DESTINATION_PATH = Path("./tools/dev/etc/spider1.0")
WREN_ENGINE_API_URL = "http://localhost:8080"
EVAL_DATASET_DESTINATION_PATH = Path("./eval/dataset")


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


def get_database_names(path: Path):
    return [folder.name for folder in path.iterdir() if folder.is_dir()]


def build_mdl_by_db(destination_path: Path):
    def _get_tables_by_db(path: Path, key: str):
        with open(path, "rb") as f:
            json_data = orjson.loads(f.read())

        return {item[key]: item for item in json_data}

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

    def _build_mdl_columns(tables_info, table_index):
        _columns = _get_columns_by_table_index(
            _merge_column_info(
                tables_info["column_names_original"], tables_info["column_types"]
            ),
            table_index,
        )

        return [
            {
                "name": column["column_name"],
                "type": column["column_type"],
                "notNull": False,
                "properties": {},
            }
            for column in _columns
        ]

    def _build_mdl_models(database, tables_info):
        return [
            {
                "name": table,
                "properties": {},
                "tableReference": {
                    "catalog": database,
                    "schema": "main",
                    "table": table,
                },
                "primaryKey": tables_info["column_names_original"][
                    primary_key_column_index
                ][-1]
                if primary_key_column_index
                else "",
                "columns": _build_mdl_columns(tables_info, i),
            }
            for i, (table, primary_key_column_index) in enumerate(
                zip_longest(
                    tables_info["table_names_original"], tables_info["primary_keys"]
                )
            )
        ]

    def _build_mdl_relationships(tables_info):
        relationships = []
        for first, second in tables_info["foreign_keys"]:
            first_table_index, first_column_name = tables_info["column_names_original"][
                first
            ]
            first_foreign_key_table = tables_info["table_names_original"][
                first_table_index
            ]

            second_table_index, second_column_name = tables_info[
                "column_names_original"
            ][second]
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

    # get all database names in the spider testsuite
    databases = get_database_names(destination_path / "database")

    # read tables.json and transform it to be a dictionary with database name as key
    tables_by_db = _get_tables_by_db(
        destination_path / "spider_data/tables.json", "db_id"
    )

    # build mdl for each database by checking the test_tables.json in spider_data
    mdl_by_db = {}
    for database in databases:
        if tables_info := tables_by_db.get(database):
            mdl_by_db[database] = {
                "catalog": database,
                "schema": "main",
                "models": _build_mdl_models(database, tables_info),
                "relationships": _build_mdl_relationships(tables_info),
                "views": [],
                "metrics": [],
            }

    return mdl_by_db


def build_question_sql_pairs_by_db(destination_path: Path):
    def _get_ground_truths_by_db(path: Path, key: str):
        with open(path, "rb") as f:
            json_data = orjson.loads(f.read())

        results = defaultdict(list)
        for item in json_data:
            results[item[key]].append(item)

        return results

    # get all database names in the spider testsuite
    databases = get_database_names(destination_path / "database")

    # get dev.json and transform it to be a dictionary with database name as key
    ground_truths_by_db = _get_ground_truths_by_db(
        destination_path / "spider_data/dev.json", "db_id"
    )

    question_sql_pairs_by_db = defaultdict(list)
    for database in databases:
        if ground_truths_info := ground_truths_by_db.get(database):
            for ground_truth in ground_truths_info:
                question_sql_pairs_by_db[database].append(
                    {
                        "question": ground_truth["question"],
                        "sql": ground_truth["query"],
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
    print(f"Downloading Spider 1.0 data if unavailable in {SPIDER_DESTINATION_PATH}...")
    download_spider_data(SPIDER_DESTINATION_PATH)

    print("Building mdl and question sql pairs using Spider 1.0 data...")
    # get mdl_by_db and question_sql_pairs_by_db whose dbs are present in both dictionaries
    mdl_and_ground_truths_by_db = get_mdls_and_question_sql_pairs_by_common_db(
        build_mdl_by_db(SPIDER_DESTINATION_PATH),
        build_question_sql_pairs_by_db(SPIDER_DESTINATION_PATH),
    )

    print("Creating eval dataset...")
    # create duckdb connection in wren engine
    # https://duckdb.org/docs/guides/database_integration/sqlite.html
    prepare_duckdb_session_sql(WREN_ENGINE_API_URL)
    for db, values in sorted(mdl_and_ground_truths_by_db.items()):
        candidate_eval_dataset = []

        print(f"Database: {db}")
        prepare_duckdb_init_sql(WREN_ENGINE_API_URL, db)

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
                candidate_eval_dataset.append(
                    {
                        "categories": [],
                        "question": ground_truth["question"],
                        "sql": ground_truth["sql"],
                        "context": context,
                        "document": get_documents_given_contexts(
                            [context], values["mdl"]
                        ),
                        "samples": get_next_few_items_circular(
                            values["ground_truth"], i
                        ),
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
            with open(
                f"{EVAL_DATASET_DESTINATION_PATH}/spider_{db}_eval_dataset.toml", "w"
            ) as f:
                f.write(
                    get_eval_dataset_in_toml_string(
                        values["mdl"], candidate_eval_dataset
                    )
                )
            print(
                f"Successfully creating eval dataset of database {db}, which has {len(candidate_eval_dataset)} questions"
            )
            print()
