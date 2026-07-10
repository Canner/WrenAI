"""Qdrant-backed memory store for schema items and query history.

Replaces the previous local vector store. Qdrant runs as a remote server
(``QDRANT_URL``); each Wren project indexes into two collections:
``{prefix}_schema_items`` and ``{prefix}_query_history``. Markdown
(``knowledge/sql/``) and the MDL manifest remain the source of truth - the
Qdrant index is a derived artifact rebuilt by ``wren memory index``.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from wren.memory.embeddings import EmbeddingProvider, get_default_embedding
from wren.memory.schema_indexer import (
    SCHEMA_DESCRIBE_THRESHOLD,
    describe_schema,
    extract_schema_items,
    manifest_hash,
)

_SCHEMA_TABLE = "schema_items"
_QUERY_TABLE = "query_history"
_DEFAULT_PREFIX = "wren"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _condition(key: str, value) -> FieldCondition:
    """Build a Qdrant equality filter condition."""
    return FieldCondition(key=key, match=MatchValue(value=value))


def _serialize_payload(payload: dict) -> dict:
    """Make a payload JSON-safe for Qdrant (datetime -> ISO string)."""
    safe: dict = {}
    for k, v in payload.items():
        if hasattr(v, "isoformat"):
            safe[k] = v.isoformat()
        else:
            safe[k] = v
    return safe


class MemoryStore:
    """Manage Qdrant collections for schema and query memory.

    Parameters
    ----------
    url:
        Qdrant server URL.  Defaults to ``$QDRANT_URL`` (required).
    api_key:
        Qdrant API key for authenticated clusters.  Defaults to
        ``$QDRANT_API_KEY``.
    embedding:
        :class:`EmbeddingProvider` used to vectorize text.  Defaults to
        :class:`VolcArkEmbedding` (reads Ark env vars).  Tests inject a
        :class:`~wren.memory.embeddings.FakeEmbedding`.
    collection_prefix:
        Prefix for collection names, to isolate projects sharing one Qdrant.
    """

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        embedding: EmbeddingProvider | None = None,
        collection_prefix: str = _DEFAULT_PREFIX,
    ) -> None:
        resolved_url = url or os.environ.get("QDRANT_URL")
        if not resolved_url:
            raise RuntimeError(
                "QDRANT_URL is not set. Point it at a Qdrant server, e.g. "
                "http://localhost:6333 (or pass url=... explicitly)."
            )
        self._url = resolved_url
        self._prefix = collection_prefix or _DEFAULT_PREFIX
        self._embedding = embedding or get_default_embedding()
        self._client = QdrantClient(
            url=resolved_url,
            api_key=api_key or os.environ.get("QDRANT_API_KEY"),
        )

    @property
    def embedding(self) -> EmbeddingProvider:
        return self._embedding

    def _schema_collection(self) -> str:
        return f"{self._prefix}_{_SCHEMA_TABLE}"

    def _query_collection(self) -> str:
        return f"{self._prefix}_{_QUERY_TABLE}"

    def _ensure_collection(self, name: str) -> None:
        """Create the collection with the embedding dimension if absent."""
        if not self._client.collection_exists(name):
            self._client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(
                    size=self._embedding.dim,
                    distance=Distance.COSINE,
                ),
            )

    def _scroll_all(
        self, collection: str, flt: Filter | None = None
    ) -> list:
        """Scroll every point in *collection* (optionally filtered)."""
        points: list = []
        offset = None
        while True:
            batch, offset = self._client.scroll(
                collection_name=collection,
                scroll_filter=flt,
                limit=256,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            points.extend(batch)
            if offset is None:
                break
        return points

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
        coll = self._schema_collection()
        exists = self._client.collection_exists(coll)

        if not items:
            if replace and exists:
                self._client.delete_collection(coll)
            schema_count = 0
        else:
            payloads = [_serialize_payload(item) for item in items]
            texts = [item["text"] for item in items]
            vectors = self._embedding.embed_texts(texts)
            points = [
                PointStruct(id=str(uuid.uuid4()), vector=vec, payload=p)
                for p, vec in zip(payloads, vectors)
            ]
            if replace:
                if exists:
                    self._client.delete_collection(coll)
                self._ensure_collection(coll)
            else:
                self._ensure_collection(coll)
            self._client.upsert(collection_name=coll, points=points)
            schema_count = len(items)

        seed_count = 0
        if seed_queries:
            seed_count = self._upsert_seed_queries(manifest)

        return {"schema_items": schema_count, "seed_queries": seed_count}

    def _upsert_seed_queries(self, manifest: dict) -> int:
        """Replace seed query entries, preserving user-confirmed ones."""
        from wren.memory.seed_queries import (  # noqa: PLC0415
            SEED_TAG,
            generate_seed_queries,
        )

        qcoll = self._query_collection()
        if self._client.collection_exists(qcoll):
            self._client.delete(
                collection_name=qcoll,
                points_selector=Filter(must=[_condition("tags", SEED_TAG)]),
            )

        pairs = generate_seed_queries(manifest)
        if not pairs:
            return 0

        for pair in pairs:
            self.store_query(
                nl_query=pair["nl"],
                sql_query=pair["sql"],
                tags=SEED_TAG,
            )

        return len(pairs)

    def schema_is_current(self, manifest: dict) -> bool:
        """Check whether the indexed schema matches *manifest*.

        Returns ``True`` only when every point in the schema collection
        carries the current manifest hash (i.e. no stale points from a
        previous manifest remain).
        """
        coll = self._schema_collection()
        if not self._client.collection_exists(coll):
            return False
        if self._client.count(coll, exact=True).count == 0:
            return False
        current_hash = manifest_hash(manifest)
        hashes = {
            p.payload.get("mdl_hash")
            for p in self._scroll_all(coll)
            if p.payload
        }
        return bool(hashes) and hashes == {current_hash}

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
        coll = self._schema_collection()
        if not self._client.collection_exists(coll):
            return []

        qvec = self._embedding.embed_texts([query])[0]
        must: list[FieldCondition] = []
        if mdl_hash:
            must.append(_condition("mdl_hash", mdl_hash))
        if item_type:
            must.append(_condition("item_type", item_type))
        if model_name:
            must.append(_condition("model_name", model_name))
        flt = Filter(must=must) if must else None

        result = self._client.query_points(
            collection_name=coll,
            query=qvec,
            query_filter=flt,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        out: list[dict] = []
        for scored in result.points:
            payload = dict(scored.payload) if scored.payload else {}
            payload.pop("vector", None)
            payload["score"] = scored.score
            out.append(payload)
        return out

    # ── Query history ─────────────────────────────────────────────────────

    def store_query(
        self,
        nl_query: str,
        sql_query: str,
        *,
        datasource: str | None = None,
        tags: str | None = None,
    ) -> None:
        """Store a NL->SQL pair with embedding of the NL query."""
        qcoll = self._query_collection()
        self._ensure_collection(qcoll)
        vec = self._embedding.embed_texts([nl_query])[0]
        payload = _serialize_payload(
            {
                "text": nl_query,
                "nl_query": nl_query,
                "sql_query": sql_query,
                "datasource": datasource or "",
                "created_at": datetime.now(timezone.utc),
                "tags": tags or "",
            }
        )
        self._client.upsert(
            collection_name=qcoll,
            points=[
                PointStruct(id=str(uuid.uuid4()), vector=vec, payload=payload)
            ],
        )

    def recall_queries(
        self,
        query: str,
        *,
        limit: int = 3,
        datasource: str | None = None,
    ) -> list[dict]:
        """Search past NL->SQL pairs by semantic similarity."""
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return []

        qvec = self._embedding.embed_texts([query])[0]
        flt = Filter(must=[_condition("datasource", datasource)]) if datasource else None
        result = self._client.query_points(
            collection_name=qcoll,
            query=qvec,
            query_filter=flt,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        out: list[dict] = []
        for scored in result.points:
            payload = dict(scored.payload) if scored.payload else {}
            payload.pop("vector", None)
            payload["score"] = scored.score
            out.append(payload)
        return out

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
        with :meth:`forget_queries_by_ids`.  ``_row_id`` is the Qdrant
        point id (a UUID string).
        """
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return [], 0

        flt = (
            Filter(must=[_condition("tags", f"source:{source}")])
            if source
            else None
        )
        total = self._client.count(qcoll, count_filter=flt, exact=True).count

        points = self._scroll_all(qcoll, flt)
        # Most recent first (created_at is an ISO string).
        points.sort(key=lambda p: (p.payload or {}).get("created_at", ""), reverse=True)
        rows: list[dict] = []
        for p in points[offset : offset + limit]:
            payload = dict(p.payload) if p.payload else {}
            payload.pop("vector", None)
            payload["_row_id"] = p.id
            rows.append(payload)
        return rows, total

    def count_queries_by_source(self, source: str) -> int:
        """Return the number of query_history rows matching *source* tag."""
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return 0
        flt = Filter(must=[_condition("tags", f"source:{source}")])
        return self._client.count(qcoll, count_filter=flt, exact=True).count

    def forget_queries_by_ids(self, row_ids: list[str]) -> int:
        """Delete points by Qdrant point id.  Returns deleted count."""
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return 0
        valid = [rid for rid in row_ids if rid is not None]
        if not valid:
            return 0
        before = self._client.count(qcoll, exact=True).count
        self._client.delete(collection_name=qcoll, points_selector=valid)
        after = self._client.count(qcoll, exact=True).count
        return before - after

    def forget_queries_by_source(self, source: str) -> int:
        """Delete all query_history rows matching *source* tag.  Returns deleted count."""
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return 0
        flt = Filter(must=[_condition("tags", f"source:{source}")])
        before = self._client.count(qcoll, exact=True).count
        self._client.delete(collection_name=qcoll, points_selector=flt)
        after = self._client.count(qcoll, exact=True).count
        return before - after

    # ── Dump / Load ──────────────────────────────────────────────────────

    def dump_queries(
        self,
        *,
        source: str | None = None,
    ) -> list[dict]:
        """Export all query_history pairs (without vector column)."""
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return []
        flt = (
            Filter(must=[_condition("tags", f"source:{source}")])
            if source
            else None
        )
        points = self._scroll_all(qcoll, flt)
        points.sort(key=lambda p: (p.payload or {}).get("created_at", ""))
        rows: list[dict] = []
        for p in points:
            payload = dict(p.payload) if p.payload else {}
            payload.pop("vector", None)
            rows.append(payload)
        return rows

    def _existing_pairs_index(
        self,
    ) -> tuple[set[tuple[str, str]], dict[str, list[str]]]:
        """Build lookup indexes from existing query_history.

        Returns
        -------
        (exact_set, nl_to_ids)
            *exact_set*: ``{(nl_query, sql_query)}`` for skip dedup.
            *nl_to_ids*: ``{nl_query: [point_ids]}`` for upsert.
        """
        qcoll = self._query_collection()
        if not self._client.collection_exists(qcoll):
            return set(), {}
        exact_set: set[tuple[str, str]] = set()
        nl_to_ids: dict[str, list[str]] = {}
        for p in self._scroll_all(qcoll):
            payload = p.payload or {}
            nl = payload.get("nl_query")
            sql = payload.get("sql_query")
            exact_set.add((nl, sql))
            nl_to_ids.setdefault(nl, []).append(p.id)
        return exact_set, nl_to_ids

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
            for src in sources:
                self.forget_queries_by_source(src)
            loaded = 0
            for p in pairs:
                tags = f"source:{p.get('source', 'user')}"
                self.store_query(
                    nl_query=p["nl"],
                    sql_query=p["sql"],
                    datasource=p.get("datasource"),
                    tags=tags,
                )
                loaded += 1
            return {"loaded": loaded, "skipped": 0, "updated": 0}

        exact_set, nl_to_ids = self._existing_pairs_index()

        if upsert:
            # Deduplicate input by nl_query (last occurrence wins).
            seen_nl: dict[str, dict] = {}
            for p in pairs:
                seen_nl[p["nl"]] = p
            deduped = list(seen_nl.values())

            ids_to_delete: list[str] = []
            updated = 0
            for p in deduped:
                if p["nl"] in nl_to_ids:
                    ids_to_delete.extend(nl_to_ids[p["nl"]])
                    updated += 1
            if ids_to_delete:
                self.forget_queries_by_ids(ids_to_delete)
            for p in deduped:
                tags = f"source:{p.get('source', 'user')}"
                self.store_query(
                    nl_query=p["nl"],
                    sql_query=p["sql"],
                    datasource=p.get("datasource"),
                    tags=tags,
                )
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
        info: dict = {"url": self._url, "tables": {}}
        for name, coll in (
            (_SCHEMA_TABLE, self._schema_collection()),
            (_QUERY_TABLE, self._query_collection()),
        ):
            if self._client.collection_exists(coll):
                info["tables"][name] = self._client.count(coll, exact=True).count
        return info

    def reset(self) -> None:
        """Drop Wren memory collections."""
        for coll in (self._schema_collection(), self._query_collection()):
            if self._client.collection_exists(coll):
                self._client.delete_collection(coll)
