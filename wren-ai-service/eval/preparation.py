"""
This file aims to prepare eval dataset from spider dataset for text-to-sql eval process
"""
import os
import zipfile
from pathlib import Path

import gdown


def download_spider_data():
    def _download_and_extract(path: Path, file_name: str, gdrive_id: str):
        DESTINATION_PATH = Path("./eval/spider1.0")
        if not (DESTINATION_PATH / path).exists():
            if Path(file_name).exists():
                os.remove(file_name)

            url = f"https://drive.google.com/u/0/uc?id={gdrive_id}&export=download"

            gdown.download(url, file_name, quiet=False)

            with zipfile.ZipFile(file_name, "r") as zip_ref:
                zip_ref.extractall(DESTINATION_PATH)

            os.remove(file_name)

    _download_and_extract(
        "database", "testsuitedatabases.zip", "1mkCx2GOFIqNesD4y8TDAO1yX1QZORP5w"
    )

    _download_and_extract(
        "spider_data", "spider_data.zip", "1403EGqzIDoHMdQF4c9Bkyl7dZLZ5Wt6J"
    )


if __name__ == "__main__":
    # download spider1.0 data if unavailable in wren-ai-service/eval/spider1.0
    download_spider_data()

    # dump data from sqlite to duckdb

    # generate mdl

    # generate question sql pairs

    # make eval dataset

    # save eval dataset
