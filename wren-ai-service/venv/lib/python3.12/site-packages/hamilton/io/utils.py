import os
import time
from datetime import datetime
from os import PathLike
from pathlib import Path
from typing import Any, Dict, Union
from urllib import parse

import pandas as pd

DATAFRAME_METADATA = "dataframe_metadata"
SQL_METADATA = "sql_metadata"
FILE_METADATA = "file_metadata"


def get_file_metadata(path: Union[str, Path, PathLike]) -> Dict[str, Any]:
    """Gives metadata from loading a file.

    Note: we reserve the right to change this schema. So if you're using this come
    chat so that we can make sure we don't break your code.

    This includes:
    - the file size
    - the file path
    - the last modified time
    - the current time
    """
    if isinstance(path, Path):
        path = str(path)
    parsed = parse.urlparse(path)
    size = None
    scheme = parsed.scheme
    last_modified = time.time()
    timestamp = datetime.now().utcnow().timestamp()
    notes = f"File metadata is unsupported for scheme: {scheme} or path: {path} does not exist."

    if parsed.scheme == "" and os.path.exists(path):
        size = os.path.getsize(path)
        last_modified = os.path.getmtime(path)
        notes = ""

    return {
        FILE_METADATA: {
            "size": size,
            "path": path,
            "last_modified": last_modified,
            "timestamp": timestamp,
            "scheme": scheme,
            "notes": notes,
            "__version__": "1.0.0",
        }
    }


def get_dataframe_metadata(df: pd.DataFrame) -> Dict[str, Any]:
    """Gives metadata from loading a dataframe.

    Note: we reserve the right to change this schema. So if you're using this come
    chat so that we can make sure we don't break your code.

    This includes:
    - the number of rows
    - the number of columns
    - the column names
    - the data types
    """
    metadata = {"__version__": "1.0.0"}
    try:
        metadata["rows"] = len(df)
    except TypeError:
        metadata["rows"] = None

    try:
        metadata["columns"] = len(df.columns)
    except (AttributeError, TypeError):
        metadata["columns"] = None

    try:
        metadata["column_names"] = list(df.columns)
    except (AttributeError, TypeError):
        metadata["column_names"] = None

    try:
        metadata["datatypes"] = [str(t) for t in list(df.dtypes)]
    except (AttributeError, TypeError):
        metadata["datatypes"] = None
    return {DATAFRAME_METADATA: metadata}


def get_file_and_dataframe_metadata(path: str, df: pd.DataFrame) -> Dict[str, Any]:
    """Gives metadata from loading a file and a dataframe.

    Note: we reserve the right to change this schema. So if you're using this come
    chat so that we can make sure we don't break your code.

    This includes:
        file_meta:
            - the file size
            - the file path
            - the last modified time
            - the current time
        dataframe_meta:
        - the number of rows
        - the number of columns
        - the column names
        - the data types
    """
    return {**get_file_metadata(path), **get_dataframe_metadata(df)}


def get_sql_metadata(query_or_table: str, results: Union[int, pd.DataFrame]) -> Dict[str, Any]:
    """Gives metadata from reading a SQL table or writing to SQL db.

    Note: we reserve the right to change this schema. So if you're using this come
    chat so that we can make sure we don't break your code.

    This includes:
    - the number of rows read, added, or to add.
    - the sql query (e.g., "SELECT foo FROM bar")
    - the table name (e.g., "bar")
    - the current time
    """
    query = query_or_table if "SELECT" in query_or_table else None
    table_name = query_or_table if "SELECT" not in query_or_table else None
    if isinstance(results, int):
        rows = results
    elif isinstance(results, pd.DataFrame):
        rows = len(results)
    else:
        rows = None
    return {
        SQL_METADATA: {
            "rows": rows,
            "query": query,
            "table_name": table_name,
            "timestamp": datetime.now().utcnow().timestamp(),
            "__version__": "1.0.0",
        }
    }
