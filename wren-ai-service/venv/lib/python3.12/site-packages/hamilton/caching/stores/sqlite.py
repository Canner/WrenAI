import pathlib
import sqlite3
import threading
from typing import List, Optional

from hamilton.caching.cache_key import decode_key
from hamilton.caching.stores.base import MetadataStore


class SQLiteMetadataStore(MetadataStore):
    def __init__(
        self,
        path: str,
        connection_kwargs: Optional[dict] = None,
    ) -> None:
        self._directory = pathlib.Path(path).resolve()
        self._directory.mkdir(parents=True, exist_ok=True)
        self._path = self._directory.joinpath("metadata_store").with_suffix(".db")
        self.connection_kwargs: dict = connection_kwargs if connection_kwargs else {}

        self._thread_local = threading.local()

        # creating tables at `__init__` prevents other methods from encountering
        # `sqlite3.OperationalError` because tables are missing.
        self._create_tables_if_not_exists()

    def __getstate__(self) -> dict:
        """Serialized `__init__` arguments required to initialize the
        MetadataStore in a new thread or process.
        """
        state = {}
        # NOTE kwarg `path` is not equivalent to `self._path`
        state["path"] = self._directory
        state["connection_kwargs"] = self.connection_kwargs
        return state

    def _get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._thread_local, "connection"):
            self._thread_local.connection = sqlite3.connect(
                str(self._path), check_same_thread=False, **self.connection_kwargs
            )
        return self._thread_local.connection

    def _close_connection(self) -> None:
        if hasattr(self._thread_local, "connection"):
            self._thread_local.connection.close()
            del self._thread_local.connection

    @property
    def connection(self) -> sqlite3.Connection:
        """Connection to the SQLite database."""
        return self._get_connection()

    def __del__(self):
        """Close the SQLite connection when the object is deleted"""
        self._close_connection()

    def _create_tables_if_not_exists(self) -> None:
        """Create the tables necessary for the cache:

        run_ids: queue of run_ids, ordered by start time.
        history: queue of executed node; allows to query "latest" execution of a node
        cache_metadata: information to determine if a node needs to be computed or not

        In the table ``cache_metadata``, the ``cache_key`` is unique whereas
        ``history`` allows duplicate.
        """
        cur = self.connection.cursor()

        cur.execute(
            """\
            CREATE TABLE IF NOT EXISTS run_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute(
            """\
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cache_key TEXT,
                run_id TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (cache_key) REFERENCES cache_metadata(cache_key)
            );
            """
        )
        cur.execute(
            """\
            CREATE TABLE IF NOT EXISTS cache_metadata (
                cache_key TEXT PRIMARY KEY,
                data_version TEXT NOT NULL,
                node_name TEXT NOT NULL,
                code_version TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                FOREIGN KEY (cache_key) REFERENCES history(cache_key)
            );
            """
        )
        self.connection.commit()

    def initialize(self, run_id) -> None:
        """Call initialize when starting a run. This will create database tables
        if necessary.
        """
        cur = self.connection.cursor()
        cur.execute("INSERT INTO run_ids (run_id) VALUES (?)", (run_id,))
        self.connection.commit()

    def __len__(self) -> int:
        """Number of entries in cache_metadata"""
        cur = self.connection.cursor()
        cur.execute("SELECT COUNT(*) FROM cache_metadata")
        return cur.fetchone()[0]

    def set(
        self,
        *,
        cache_key: str,
        data_version: str,
        run_id: str,
        node_name: str = None,
        code_version: str = None,
        **kwargs,
    ) -> None:
        cur = self.connection.cursor()

        # if the caller of ``.set()`` directly provides the ``node_name`` and ``code_version``,
        # we can skip the decoding step.
        if (node_name is None) or (code_version is None):
            try:
                decoded_key = decode_key(cache_key)
            except BaseException as e:
                raise ValueError(
                    f"Failed decoding the cache_key: {cache_key}.\n",
                    "The `cache_key` must be created by `hamilton.caching.cache_key.create_cache_key()` ",
                    "if `node_name` and `code_version` are not provided.",
                ) from e

            node_name = decoded_key["node_name"]
            code_version = decoded_key["code_version"]

        cur.execute("INSERT INTO history (cache_key, run_id) VALUES (?, ?)", (cache_key, run_id))
        cur.execute(
            """\
            INSERT OR IGNORE INTO cache_metadata (
                cache_key, node_name, code_version, data_version
            ) VALUES (?, ?, ?, ?)
            """,
            (cache_key, node_name, code_version, data_version),
        )

        self.connection.commit()

    def get(self, cache_key: str) -> Optional[str]:
        cur = self.connection.cursor()
        cur.execute(
            """\
            SELECT data_version
            FROM cache_metadata
            WHERE cache_key = ?
            """,
            (cache_key,),
        )
        result = cur.fetchone()

        if result is None:
            data_version = None
        else:
            data_version = result[0]

        return data_version

    def delete(self, cache_key: str) -> None:
        """Delete metadata associated with ``cache_key``."""
        cur = self.connection.cursor()
        cur.execute("DELETE FROM cache_metadata WHERE cache_key = ?", (cache_key,))
        self.connection.commit()

    def delete_all(self) -> None:
        """Delete all existing tables from the database"""
        cur = self.connection.cursor()

        for table_name in ["run_ids", "history", "cache_metadata"]:
            cur.execute(f"DROP TABLE IF EXISTS {table_name};")

        self.connection.commit()

    def exists(self, cache_key: str) -> bool:
        """boolean check if a ``data_version`` is found for ``cache_key``
        If True, ``.get()`` should successfully retrieve the ``data_version``.
        """
        cur = self.connection.cursor()
        cur.execute("SELECT cache_key FROM cache_metadata WHERE cache_key = ?", (cache_key,))
        result = cur.fetchone()

        return result is not None

    def get_run_ids(self) -> List[str]:
        """Return a list of run ids, sorted from oldest to newest start time."""
        cur = self.connection.cursor()
        cur.execute("SELECT run_id FROM run_ids ORDER BY id")
        result = cur.fetchall()

        return [r[0] for r in result]

    def _run_exists(self, run_id: str) -> bool:
        """Returns True if a run was initialized with ``run_id``, even
        if the run recorded no node executions.
        """
        cur = self.connection.cursor()
        cur.execute(
            """\
            SELECT EXISTS(
                SELECT 1
                FROM run_ids
                WHERE run_id = ?
            )
            """,
            (run_id,),
        )
        result = cur.fetchone()
        # SELECT EXISTS returns 1 for True, i.e., `run_id` is found
        return result[0] == 1

    def get_run(self, run_id: str) -> List[dict]:
        """Return a list of node metadata associated with a run.

        :param run_id: ID of the run to retrieve
        :return: List of node metadata which includes ``cache_key``, ``data_version``,
            ``node_name``, and ``code_version``. The list can be empty if a run was initialized
            but no nodes were executed.

        :raises IndexError: if the ``run_id`` is not found in metadata store.
        """
        cur = self.connection.cursor()
        if self._run_exists(run_id) is False:
            raise IndexError(f"`run_id` not found in table `run_ids`: {run_id}")

        cur.execute(
            """\
            SELECT
                cache_metadata.cache_key,
                cache_metadata.data_version,
                cache_metadata.node_name,
                cache_metadata.code_version
            FROM history
            JOIN cache_metadata ON history.cache_key = cache_metadata.cache_key
            WHERE history.run_id = ?
            """,
            (run_id,),
        )
        results = cur.fetchall()
        return [
            dict(
                cache_key=cache_key,
                data_version=data_version,
                node_name=node_name,
                code_version=code_version,
            )
            for cache_key, data_version, node_name, code_version in results
        ]
