"""
This file aims to prepare spider 1.0 eval dataset for text-to-sql eval purpose
"""
import asyncio
import os
import zipfile
from collections import defaultdict
from pathlib import Path

import gdown
import orjson
import requests

from eval.utils import get_data_from_wren_engine

DESTINATION_PATH = Path("./tools/dev/etc/spider1.0")
WREN_ENGINE_API_URL = "http://localhost:8080"


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


def get_json_data_by_key(path: Path, key: str):
    with open(path, "rb") as f:
        json_data = orjson.loads(f.read())

    return {item[key]: item for item in json_data}


def build_mdl_by_db(destination_path: Path):
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
                "primaryKey": tables_info["column_names_original"][i][-1],
                "columns": _build_mdl_columns(tables_info, i),
            }
            for i, table in enumerate(tables_info["table_names_original"])
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
                    "name": f"{first_foreign_key_table}_{second_foreign_key_table}",
                    "models": [first_foreign_key_table, second_foreign_key_table],
                    "joinType": "MANY_TO_MANY",
                    "condition": f"{first_foreign_key_table}.{first_column_name} = {second_foreign_key_table}.{second_column_name}",
                }
            )

        return relationships

    # get all database names in the spider testsuite
    databases = get_database_names(destination_path / "database")

    # read tables.json and transform it to be a dictionary with database name as key
    tables_by_db = get_json_data_by_key(
        destination_path / "spider_data/tables.json", "db_id"
    )

    # build mdl for each database by checking the tables.json in spider_data
    mdl_by_db = {}
    for database in databases:
        if tables_info := tables_by_db.get(database):
            mdl_by_db[database] = {
                "catalog": "wrenai",
                "schema": database,
                "models": _build_mdl_models(database, tables_info),
                "relationships": _build_mdl_relationships(tables_info),
                "views": [],
                "metrics": [],
            }

    return mdl_by_db


def build_question_sql_pairs_by_db(destination_path: Path):
    # get all database names in the spider testsuite
    databases = get_database_names(destination_path / "database")

    # get dev.json and transform it to be a dictionary with database name as key
    ground_truth_by_db = get_json_data_by_key(
        destination_path / "spider_data/dev.json", "db_id"
    )

    question_sql_pairs_by_db = defaultdict(list)
    for database in databases:
        if ground_truth_info := ground_truth_by_db.get(database):
            question_sql_pairs_by_db[database].append(
                {
                    "question": ground_truth_info["question"],
                    "sql": ground_truth_info["query"],
                }
            )

    return question_sql_pairs_by_db


def get_mdls_and_question_sql_pairs_by_common_db(mdl_by_db, question_sql_pairs_by_db):
    common_dbs = set(mdl_by_db.keys()) & set(question_sql_pairs_by_db.keys())

    return {
        db: {"mdl": mdl_by_db[db], "ground_truth": question_sql_pairs_by_db[db]}
        for db in common_dbs
    }


def prepare_duckdb_session_sql():
    session_sql = "INSTALL sqlite;"

    response = requests.put(
        f"{WREN_ENGINE_API_URL}/v1/data-source/duckdb/settings/session-sql",
        data=session_sql,
    )

    assert response.status_code == 200, response.text


def prepare_duckdb_init_sql(db: str):
    init_sql = (
        f"ATTACH 'etc/spider1.0/database/{db}/{db}.sqlite' AS {db} (TYPE sqlite);"
    )

    response = requests.put(
        f"{WREN_ENGINE_API_URL}/v1/data-source/duckdb/settings/init-sql",
        data=init_sql,
    )

    assert response.status_code == 200, response.text


if __name__ == "__main__":
    # download spider1.0 data if unavailable in wren-ai-service/eval/spider1.0
    download_spider_data(DESTINATION_PATH)

    # get mdl_by_db and question_sql_pairs_by_db whose dbs are present in both dictionaries
    mdl_and_ground_truth_by_db = get_mdls_and_question_sql_pairs_by_common_db(
        build_mdl_by_db(DESTINATION_PATH),
        build_question_sql_pairs_by_db(DESTINATION_PATH),
    )

    # create duckdb connection in wren engine
    # https://duckdb.org/docs/guides/database_integration/sqlite.html
    prepare_duckdb_session_sql()
    for db, values in mdl_and_ground_truth_by_db.items():
        prepare_duckdb_init_sql(db)

        print(f'sql: {values["ground_truth"][0]["sql"]}')
        print(f'mdl: {values["mdl"]}')

        results = asyncio.run(
            get_data_from_wren_engine(
                values["ground_truth"][0]["sql"],
                "duckdb",
                values["mdl"],
                {},
                WREN_ENGINE_API_URL,
            )
        )
        print(results)

        break

    # sql validation using duckdb

    # make eval dataset

    # save eval dataset
