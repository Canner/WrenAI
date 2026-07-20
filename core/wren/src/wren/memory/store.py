"""LanceDB-backed memory store for schema items and query history."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa

from wren.memory.embeddings import (
    _DEFAULT_DIM,
    _DEFAULT_MODEL,
    get_embedding_function,
    warm_up,
)
from wren.memory.schema_indexer import (
    SCHEMA_DESCRIBE_THRESHOLD,
    describe_schema,
    extract_schema_items,
    manifest_hash,
)

_WREN_MEMORY_DIR = Path.home() / ".wren" / "memory"

_SCHEMA_TABLE = "schema_items"
_QUERY_TABLE = "query_history"


def _esc(value: str) -> str:
    """Escape single quotes for LanceDB where-clause literals."""
    return value.replace("'", "''")


def _schema_items_arrow_schema(dim: int = _DEFAULT_DIM) -> pa.Schema:
    return pa.schema(
        [
            pa.field("text", pa.utf8()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
            pa.field("item_type", pa.utf8()),
            pa.field("model_name", pa.utf8()),
            pa.field("item_name", pa.utf8()),
            pa.field("data_type", pa.utf8()),
            pa.field("expression", pa.utf8()),
            pa.field("is_calculated", pa.bool_()),
            pa.field("mdl_hash", pa.utf8()),
            pa.field("indexed_at", pa.timestamp("us", tz="UTC")),
        ]
    )


def _query_history_arrow_schema(dim: int = _DEFAULT_DIM) -> pa.Schema:
    return pa.schema(
        [
            pa.field("text", pa.utf8()),
            pa.field("vector", pa.list_(pa.float32(), dim)),
            pa.field("nl_query", pa.utf8()),
            pa.field("sql_query", pa.utf8()),
            pa.field("datasource", pa.utf8()),
            pa.field("created_at", pa.timestamp("us", tz="UTC")),
            pa.field("tags", pa.utf8()),
        ]
    )


def _table_names(db) -> list[str]:
    """Get table names, compatible with lancedb >=0.30 (ListTablesResponse)."""
    result = db.list_tables()
    if isinstance(result, list):
        return result
    return result.tables


class MemoryStore:
    """Manage LanceDB tables for schema and query memory.

    Parameters
    ----------
    path:
        Directory for LanceDB storage.  Defaults to ``~/.wren/memory/``.
    model_name:
        Sentence-transformers model name.  ``None`` → default multilingual model.
    """

    def __init__(
        self,
        path: str | Path | None = None,
        model_name: str | None = None,
    ):
        import lancedb  # noqa: PLC0415

        resolved = Path(path).expanduser() if path else _WREN_MEMORY_DIR
        resolved.mkdir(parents=True, exist_ok=True)
        self._path = resolved
        self._db = lancedb.connect(str(resolved))
        self._model_name = model_name or _DEFAULT_MODEL
        self._embed_fn_cached = None
        self._dim_cached = None
        self._init_lock = threading.Lock()
        # _resolve_dim() may initialize _embed_fn while holding _dim_lock.
        self._dim_lock = threading.Lock()

    @property
    def _embed_fn(self):
        """Construct the shared embedding function on first use."""
        if self._embed_fn_cached is None:
            with self._init_lock:
                if self._embed_fn_cached is None:
                    self._embed_fn_cached = get_embedding_function(self._model_name)
        return self._embed_fn_cached

    @property
    def _dim(self) -> int:
        if self._dim_cached is None:
            with self._dim_lock:
                if self._dim_cached is None:
                    self._dim_cached = self._resolve_dim()
        return self._dim_cached

    def _table_vector_dim(self, name: str) -> int | None:
        """Return an existing table's fixed vector dimension."""
        if name not in _table_names(self._db):
            return None
        table = self._db.open_table(name)
        vector_field = table.schema.field("vector")
        if not isinstance(vector_field.type, pa.FixedSizeListType):
            raise ValueError(
                f"Table '{name}' vector column is not a fixed-size list "
                f"(got {vector_field.type!r}); cannot resolve dimension."
            )
        return vector_field.type.list_size

    def _resolve_dim(self) -> int:
        """Resolve dimension from existing tables or an embedding probe."""
        dims: dict[str, int] = {}
        for name in (_SCHEMA_TABLE, _QUERY_TABLE):
            dim = self._table_vector_dim(name)
            if dim is not None:
                dims[name] = dim

        if dims:
            unique_dims = set(dims.values())
            if len(unique_dims) > 1:
                raise ValueError(
                    f"Mixed-dimension memory store: {dims!r}. This happens "
                    "when WREN_EMBEDDING_MODEL was swapped for a "
                    "different-dim model against an existing store. Reset "
                    "the store or restore the original model to continue."
                )
            return next(iter(unique_dims))

        return warm_up(self._embed_fn)

    def _validate_and_set_dim(self, dim: int) -> None:
        """Validate a computed vector dimension before caching it."""
        with self._dim_lock:
            for name in (_SCHEMA_TABLE, _QUERY_TABLE):
                existing_dim = self._table_vector_dim(name)
                if existing_dim is not None and existing_dim != dim:
                    raise ValueError(
                        f"New vector dim {dim} does not match existing "
                        f"table '{name}' dim {existing_dim}. This happens "
                        "when WREN_EMBEDDING_MODEL was swapped for a "
                        "different-dim model against an existing store. "
                        "Reset the store or restore the original model to "
                        "continue."
                    )
            self._dim_cached = dim

    def _schema_table_schema(self) -> pa.Schema:
        return _schema_items_arrow_schema(dim=self._dim)

    def _query_table_schema(self) -> pa.Schema:
        return _query_history_arrow_schema(dim=self._dim)

    # ── Schema indexing ───────────────────────────────────────────────────

    def index_schema(
        self,
        manifest: dict,
        *,
        replace: bool = True,
        seed_queries: bool = True,
    ) -> dict:
        """Extract schema items from *manifest*, embed, and store.

        If *seed_queries* is True, also generates canonical NL-SQL pairs
        and inserts them into query_history (tagged 'source:seed').
        Old seed entries are replaced; user-confirmed entries are preserved.

        Returns {"schema_items": int, "seed_queries": int}.
        """
        items = extract_schema_items(manifest)
        table_exists = _SCHEMA_TABLE in _table_names(self._db)

        if not items:
            if replace and table_exists:
                self._db.drop_table(_SCHEMA_TABLE)
            schema_count = 0
        else:
            texts = [item["text"] for item in items]
            vectors = self._embed_fn.compute_source_embeddings(texts)
            self._validate_and_set_dim(len(vectors[0]))

            for item, vec in zip(items, vectors):
                item["vector"] = vec

            if replace:
                if table_exists:
                    self._db.drop_table(_SCHEMA_TABLE)
                self._db.create_table(
                    _SCHEMA_TABLE,
                    items,
                    schema=self._schema_table_schema(),
                )
            else:
                if table_exists:
                    tbl = self._db.open_table(_SCHEMA_TABLE)
                    tbl.add(items)
                else:
                    self._db.create_table(
                        _SCHEMA_TABLE,
                        items,
                        schema=self._schema_table_schema(),
                    )
            schema_count = len(items)

        seed_count = 0
        if seed_queries:
            seed_count = self._upsert_seed_queries(manifest)

        return {"schema_items": schema_count, "seed_queries": seed_count}

    def _upsert_seed_queries(self, manifest: dict) -> int:
        """Replace seed queries after their embeddings are ready."""
        from wren.memory.seed_queries import (  # noqa: PLC0415
            SEED_TAG,
            generate_seed_queries,
        )

        pairs = generate_seed_queries(manifest)

        if not pairs:
            if _QUERY_TABLE in _table_names(self._db):
                table = self._db.open_table(_QUERY_TABLE)
                table.delete(f"tags = '{SEED_TAG}'")
            return 0

        records = self._prepare_query_records(pairs, tags=SEED_TAG)

        if _QUERY_TABLE in _table_names(self._db):
            table = self._db.open_table(_QUERY_TABLE)
            table.delete(f"tags = '{SEED_TAG}'")

        self._write_query_records(records)
        return len(pairs)

    def schema_is_current(self, manifest: dict) -> bool:
        """Check whether the indexed schema matches *manifest*.

        Returns ``True`` only when every row in the schema table carries
        the current manifest hash (i.e. no stale rows from a previous
        manifest remain).
        """
        if _SCHEMA_TABLE not in _table_names(self._db):
            return False
        table = self._db.open_table(_SCHEMA_TABLE)
        if table.count_rows() == 0:
            return False
        current_hash = manifest_hash(manifest)
        df = table.to_pandas()
        return bool((df["mdl_hash"] == current_hash).all())

    # ── Plain-text / hybrid ────────────────────────────────────────────────

    @staticmethod
    def describe_schema(manifest: dict) -> str:
        """Return the full schema as structured plain text (no embedding)."""
        return describe_schema(manifest)

    def get_context(
        self,
        manifest: dict,
        query: str,
        *,
        limit: int = 5,
        item_type: str | None = None,
        model_name: str | None = None,
        threshold: int = SCHEMA_DESCRIBE_THRESHOLD,
    ) -> dict:
        """Return schema context using the best strategy for the schema size.

        For small schemas (plain-text description below *threshold* chars),
        returns the full text (``strategy="full"``).  For large schemas,
        uses embedding search with optional filters (``strategy="search"``).

        Returns a dict with keys ``strategy``, ``schema`` (full) or
        ``results`` (search).
        """
        text = describe_schema(manifest)
        if len(text) <= threshold:
            return {"strategy": "full", "schema": text}

        mdl_hash_val = manifest_hash(manifest)
        results = self._search_schema(
            query,
            limit=limit,
            item_type=item_type,
            model_name=model_name,
            mdl_hash=mdl_hash_val,
        )
        return {"strategy": "search", "results": results}

    def _search_schema(
        self,
        query: str,
        *,
        limit: int = 5,
        item_type: str | None = None,
        model_name: str | None = None,
        mdl_hash: str | None = None,
    ) -> list[dict]:
        """Embedding search over indexed schema items (internal)."""
        if _SCHEMA_TABLE not in _table_names(self._db):
            return []

        table = self._db.open_table(_SCHEMA_TABLE)
        q = table.search(
            self._embed_fn.compute_query_embeddings(query)[0],
        )

        where_parts: list[str] = []
        if mdl_hash:
            where_parts.append(f"mdl_hash = '{_esc(mdl_hash)}'")
        if item_type:
            where_parts.append(f"item_type = '{_esc(item_type)}'")
        if model_name:
            where_parts.append(f"model_name = '{_esc(model_name)}'")
        if where_parts:
            q = q.where(" AND ".join(where_parts))

        results = q.limit(limit).to_list()
        for r in results:
            r.pop("vector", None)
        return results

    # ── Query history ─────────────────────────────────────────────────────

    def store_query(
        self,
        nl_query: str,
        sql_query: str,
        *,
        datasource: str | None = None,
        tags: str | None = None,
    ) -> None:
        """Store a NL→SQL pair with embedding of the NL query."""
        now = datetime.now(timezone.utc)
        vectors = self._embed_fn.compute_source_embeddings([nl_query])
        self._validate_and_set_dim(len(vectors[0]))

        record = {
            "text": nl_query,
            "vector": vectors[0],
            "nl_query": nl_query,
            "sql_query": sql_query,
            "datasource": datasource or "",
            "created_at": now,
            "tags": tags or "",
        }

        if _QUERY_TABLE in _table_names(self._db):
            table = self._db.open_table(_QUERY_TABLE)
            table.add([record])
        else:
            self._db.create_table(
                _QUERY_TABLE,
                [record],
                schema=self._query_table_schema(),
            )

    def recall_queries(
        self,
        query: str,
        *,
        limit: int = 3,
        datasource: str | None = None,
    ) -> list[dict]:
        """Search past NL→SQL pairs by semantic similarity."""
        if _QUERY_TABLE not in _table_names(self._db):
            return []

        table = self._db.open_table(_QUERY_TABLE)
        q = table.search(
            self._embed_fn.compute_query_embeddings(query)[0],
        )

        if datasource:
            q = q.where(f"datasource = '{_esc(datasource)}'")

        results = q.limit(limit).to_list()
        for r in results:
            r.pop("vector", None)
        return results

    # ── Query listing & management ───────────────────────────────────────

    def list_queries(
        self,
        *,
        source: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """List query_history pairs.

        Returns (rows, total_count).  Rows include ``_row_id`` for use
        with :meth:`forget_queries_by_ids`.  The ``_row_id`` is the
        positional index in the *unfiltered* table so it can be passed
        directly to :meth:`forget_queries_by_ids`.
        """
        if _QUERY_TABLE not in _table_names(self._db):
            return [], 0

        table = self._db.open_table(_QUERY_TABLE)
        df = table.to_pandas()
        # Ensure a clean 0-based index matching the unfiltered table.
        df = df.reset_index(drop=True)
        if source:
            df = df[df["tags"] == f"source:{source}"]
        total = len(df)
        df = df.sort_values("created_at", ascending=False)
        rows = df.iloc[offset : offset + limit]
        results = rows.drop(columns=["vector"], errors="ignore").to_dict("records")
        # Attach the *original* DataFrame index so forget_queries_by_ids
        # deletes the correct rows even when a source filter is applied.
        for idx, (orig_idx, _) in zip(range(len(results)), rows.iterrows()):
            results[idx]["_row_id"] = orig_idx
        return results, total

    def count_queries_by_source(self, source: str) -> int:
        """Return the number of query_history rows matching *source* tag."""
        if _QUERY_TABLE not in _table_names(self._db):
            return 0
        table = self._db.open_table(_QUERY_TABLE)
        df = table.to_pandas()
        return int((df["tags"] == f"source:{source}").sum())

    def forget_queries_by_ids(self, row_ids: list[int]) -> int:
        """Delete rows at the given positional indices.  Returns deleted count."""
        if _QUERY_TABLE not in _table_names(self._db):
            return 0
        table = self._db.open_table(_QUERY_TABLE)
        existing_schema = table.schema
        df = table.to_pandas()
        to_delete = sorted({i for i in row_ids if 0 <= i < len(df)})
        if not to_delete:
            return 0
        keep = df.drop(index=to_delete).reset_index(drop=True)
        if len(keep) == 0:
            self._db.drop_table(_QUERY_TABLE)
            return len(to_delete)
        # Build the replacement before asking LanceDB to overwrite the table.
        keep_arrow = pa.Table.from_pandas(keep, schema=existing_schema)
        self._db.create_table(
            _QUERY_TABLE,
            keep_arrow,
            schema=existing_schema,
            mode="overwrite",
        )
        return len(to_delete)

    def forget_queries_by_source(self, source: str) -> int:
        """Delete all query_history rows matching *source* tag.  Returns deleted count."""
        if _QUERY_TABLE not in _table_names(self._db):
            return 0
        table = self._db.open_table(_QUERY_TABLE)
        where = f"tags = 'source:{_esc(source)}'"
        before = table.count_rows()
        table.delete(where)
        return before - table.count_rows()

    # ── Dump / Load ──────────────────────────────────────────────────────

    def dump_queries(
        self,
        *,
        source: str | None = None,
    ) -> list[dict]:
        """Export all query_history pairs (without vector column)."""
        if _QUERY_TABLE not in _table_names(self._db):
            return []
        table = self._db.open_table(_QUERY_TABLE)
        df = table.to_pandas()
        if source:
            df = df[df["tags"] == f"source:{source}"]
        df = df.sort_values("created_at", ascending=True)
        return df.drop(columns=["vector"], errors="ignore").to_dict("records")

    def _existing_pairs_index(
        self,
    ) -> tuple[set[tuple[str, str]], dict[str, list[int]]]:
        """Build lookup indexes from existing query_history.

        Returns
        -------
        (exact_set, nl_to_rowids)
            *exact_set*: ``{(nl_query, sql_query)}`` for skip dedup.
            *nl_to_rowids*: ``{nl_query: [positional_indices]}`` for upsert.
        """
        if _QUERY_TABLE not in _table_names(self._db):
            return set(), {}
        table = self._db.open_table(_QUERY_TABLE)
        df = table.to_pandas()
        exact_set: set[tuple[str, str]] = set(zip(df["nl_query"], df["sql_query"]))
        # Collect *all* row ids per nl_query so upsert removes every duplicate.
        nl_to_rowids: dict[str, list[int]] = {}
        for idx, nl in zip(df.index, df["nl_query"]):
            nl_to_rowids.setdefault(nl, []).append(idx)
        return exact_set, nl_to_rowids

    def _prepare_query_records(
        self, pairs: list[dict], *, tags: str | None = None
    ) -> list[dict]:
        """Prepare a complete query batch without changing its table."""
        if not pairs:
            return []
        texts = [p["nl"] for p in pairs]
        vectors = self._embed_fn.compute_source_embeddings(texts)
        self._validate_and_set_dim(len(vectors[0]))
        now = datetime.now(timezone.utc)
        records = []
        for p, vec in zip(pairs, vectors):
            record_tags = (
                tags if tags is not None else f"source:{p.get('source', 'user')}"
            )
            records.append(
                {
                    "text": p["nl"],
                    "vector": vec,
                    "nl_query": p["nl"],
                    "sql_query": p["sql"],
                    "datasource": p.get("datasource") or "",
                    "created_at": now,
                    "tags": record_tags,
                }
            )
        return records

    def _write_query_records(self, records: list[dict]) -> None:
        """Batch-insert precomputed query_history records built by
        :meth:`_prepare_query_records`."""
        if not records:
            return
        if _QUERY_TABLE in _table_names(self._db):
            table = self._db.open_table(_QUERY_TABLE)
            table.add(records)
        else:
            self._db.create_table(
                _QUERY_TABLE,
                records,
                schema=self._query_table_schema(),
            )

    def load_queries(
        self,
        pairs: list[dict],
        *,
        overwrite: bool = False,
        upsert: bool = False,
    ) -> dict[str, int]:
        """Batch-import parsed YAML pairs into query_history.

        Returns ``{"loaded": N, "skipped": M, "updated": U}``.
        """
        if overwrite:
            sources = {p.get("source", "user") for p in pairs}
            records = self._prepare_query_records(pairs)
            for src in sources:
                self.forget_queries_by_source(src)
            self._write_query_records(records)
            return {"loaded": len(records), "skipped": 0, "updated": 0}

        exact_set, nl_to_rowids = self._existing_pairs_index()

        if upsert:
            # Deduplicate input by nl_query (last occurrence wins).
            seen_nl: dict[str, dict] = {}
            for p in pairs:
                seen_nl[p["nl"]] = p
            deduped = list(seen_nl.values())

            records = self._prepare_query_records(deduped)

            # Batch: collect IDs to delete, then delete once, then insert all.
            ids_to_delete = []
            updated = 0
            for p in deduped:
                if p["nl"] in nl_to_rowids:
                    ids_to_delete.extend(nl_to_rowids[p["nl"]])
                    updated += 1
            if ids_to_delete:
                self.forget_queries_by_ids(ids_to_delete)
            self._write_query_records(records)
            loaded = len(deduped) - updated
            return {"loaded": loaded, "skipped": 0, "updated": updated}

        # Default (skip duplicates)
        loaded, skipped = 0, 0
        for p in pairs:
            nl, sql = p["nl"], p["sql"]
            if (nl, sql) in exact_set:
                skipped += 1
                continue
            loaded += 1
            exact_set.add((nl, sql))  # prevent duplicates within input
            tags = f"source:{p.get('source', 'user')}"
            self.store_query(
                nl_query=nl,
                sql_query=sql,
                datasource=p.get("datasource"),
                tags=tags,
            )

        return {"loaded": loaded, "skipped": skipped, "updated": 0}

    # ── Housekeeping ──────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return index statistics."""
        info: dict = {"path": str(self._path), "tables": {}}
        for name in _table_names(self._db):
            table = self._db.open_table(name)
            info["tables"][name] = table.count_rows()
        return info

    def reset(self) -> None:
        """Drop Wren memory tables."""
        for name in (_SCHEMA_TABLE, _QUERY_TABLE):
            if name in _table_names(self._db):
                self._db.drop_table(name)
