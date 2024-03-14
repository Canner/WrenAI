import argparse
from pathlib import Path

from src.eval.utils import (
    download_spider_data,
    generate_mdl_json,
    generate_text_to_sql_dataset,
    get_database_schema,
    get_table_names,
    get_table_relationships,
)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate text-to-sql dataset from Spider dataset"
    )
    parser.add_argument(
        "--database_name",
        type=str,
        default="book_2",
    )
    args = parser.parse_args()
    database_name = args.database_name

    if not Path("spider").exists():
        print("Downloading Spider dataset...")
        download_spider_data()

    print(f"Generating MDL JSON for {database_name}...")
    database_schema = get_database_schema(
        f"spider/database/{database_name}/{database_name}.sqlite",
        get_table_names(f"spider/database/{database_name}/{database_name}.sqlite"),
    )
    relationships = get_table_relationships(
        f"spider/database/{database_name}/{database_name}.sqlite"
    )
    generate_mdl_json(
        database_schema,
        "canner-cml",
        "spider",
        database_name,
        relationships,
        should_save_file=True,
        file_path=f"src/eval/data/{database_name}_mdl.json",
    )

    print(f"Generating the dataset for {database_name}...")
    generate_text_to_sql_dataset(
        ["spider/train_spider.json", "spider/train_others.json"],
        database_name=database_name,
        should_save_file=True,
        file_path=f"src/eval/data/{database_name}_data.json",
    )
