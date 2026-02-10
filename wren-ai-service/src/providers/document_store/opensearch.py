import logging
import os
from typing import Any, Dict, List, Optional

from haystack import Document, component
from haystack.document_stores.types import DuplicatePolicy
from haystack.utils import Secret
from haystack_integrations.document_stores.opensearch import OpenSearchDocumentStore
from opensearchpy import AsyncOpenSearch, OpenSearch
from tqdm import tqdm

from src.core.provider import DocumentStoreProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")

# Fields from Document.to_dict() that are internal to Haystack and should not be stored
_SKIP_FIELDS = {"id", "blob", "dataframe", "score", "sparse_embedding"}

# Fields that are part of the OpenSearch document structure, not user metadata
_KNOWN_FIELDS = {"content", "embedding"}


def _hit_to_document(hit: dict, return_embedding: bool = False) -> Document:
    """Convert an OpenSearch hit to a Haystack Document."""
    doc_dict = hit["_source"]
    meta = {k: v for k, v in doc_dict.items() if k not in _KNOWN_FIELDS}
    return Document(
        id=hit["_id"],
        content=doc_dict.get("content", ""),
        embedding=doc_dict.get("embedding") if return_embedding else None,
        score=hit.get("_score"),
        meta=meta,
    )


def _convert_filters(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert Haystack v2 filters to OpenSearch query DSL."""
    if not filters:
        return []

    if "operator" not in filters or "conditions" not in filters:
        return []

    op = filters["operator"]
    clauses = []

    for condition in filters["conditions"]:
        if "operator" in condition and "conditions" in condition:
            clauses.extend(_convert_filters(condition))
        elif "field" in condition and "operator" in condition:
            field = condition["field"]
            cond_op = condition["operator"]
            value = condition.get("value")

            if cond_op in ("==", "eq"):
                if isinstance(value, (list, tuple)):
                    value = [v for v in value if v is not None]
                    if value:
                        clauses.append({"terms": {field: value}})
                elif value is not None:
                    clauses.append({"term": {field: value}})
            elif cond_op in ("!=", "ne"):
                if value is not None:
                    clauses.append({"bool": {"must_not": [{"term": {field: value}}]}})
            elif cond_op == "in":
                if isinstance(value, (list, tuple)):
                    value = [v for v in value if v is not None]
                    if value:
                        clauses.append({"terms": {field: value}})
            elif cond_op == "not in":
                if isinstance(value, (list, tuple)):
                    value = [v for v in value if v is not None]
                    if value:
                        clauses.append({"bool": {"must_not": [{"terms": {field: value}}]}})
            elif cond_op == ">":
                clauses.append({"range": {field: {"gt": value}}})
            elif cond_op == ">=":
                clauses.append({"range": {field: {"gte": value}}})
            elif cond_op == "<":
                clauses.append({"range": {field: {"lt": value}}})
            elif cond_op == "<=":
                clauses.append({"range": {field: {"lte": value}}})

    if not clauses:
        return []

    if op == "AND":
        return [{"bool": {"must": clauses}}] if len(clauses) > 1 else clauses
    elif op == "OR":
        return [{"bool": {"should": clauses, "minimum_should_match": 1}}]
    elif op == "NOT":
        return [{"bool": {"must_not": clauses}}]
    return clauses


def _build_filter_query(filters: Optional[Dict[str, Any]]) -> Optional[Dict]:
    """Convert filters to a single OpenSearch filter query object."""
    if not filters:
        return None
    clauses = _convert_filters(filters)
    if not clauses:
        return None
    return clauses[0] if len(clauses) == 1 else clauses


class AsyncOpenSearchDocumentStore(OpenSearchDocumentStore):
    def __init__(
        self,
        hosts: str | List[str] | None = None,
        index: str = "Document",
        max_chunk_bytes: int = 100 * 1024 * 1024,
        embedding_dim: int = 768,
        return_embedding: bool = False,
        method: Optional[Dict[str, Any]] = None,
        mappings: Optional[Dict[str, Any]] = None,
        settings: Optional[Dict[str, Any]] = None,
        create_index: bool = True,
        http_auth: Any = None,
        use_ssl: bool = True,
        verify_certs: bool = True,
        timeout: int = 120,
        progress_bar: bool = True,
        write_batch_size: int = 100,
        **kwargs: Any,
    ):
        super(AsyncOpenSearchDocumentStore, self).__init__(
            hosts=hosts,
            index=index,
            max_chunk_bytes=max_chunk_bytes,
            embedding_dim=embedding_dim,
            return_embedding=return_embedding,
            method=method,
            mappings=mappings,
            settings=settings,
            create_index=create_index,
            http_auth=http_auth,
            use_ssl=use_ssl,
            verify_certs=verify_certs,
            timeout=timeout,
            **kwargs,
        )

        self.index = index
        self.progress_bar = progress_bar
        self.write_batch_size = write_batch_size

        # Resolve http_auth Secrets for the async client
        resolved_http_auth = http_auth
        if isinstance(http_auth, tuple) and len(http_auth) == 2:
            username, password = http_auth
            resolved_username = username.resolve_value() if isinstance(username, Secret) else username
            resolved_password = password.resolve_value() if isinstance(password, Secret) else password
            resolved_http_auth = (resolved_username, resolved_password)

        self.async_client = AsyncOpenSearch(
            hosts=hosts,
            http_auth=resolved_http_auth,
            use_ssl=use_ssl,
            verify_certs=verify_certs,
            timeout=timeout,
            **kwargs,
        )

    async def _query_by_embedding(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ) -> List[Document]:
        query = {
            "size": top_k,
            "query": {
                "knn": {
                    "embedding": {
                        "vector": query_embedding,
                        "k": top_k,
                    }
                }
            },
            "_source": {"excludes": [] if return_embedding else ["embedding"]},
        }

        filter_query = _build_filter_query(filters)
        if filter_query:
            query["query"] = {
                "bool": {
                    "must": [query["query"]],
                    "filter": filter_query,
                }
            }

        try:
            response = await self.async_client.search(index=self.index, body=query)
        except Exception as e:
            if "index_not_found_exception" in str(e):
                return []
            raise

        return [_hit_to_document(hit, return_embedding) for hit in response["hits"]["hits"]]

    async def _query_by_filters(
        self,
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
    ) -> List[Document]:
        query = {"query": {"match_all": {}}}

        filter_query = _build_filter_query(filters)
        if filter_query:
            query["query"] = {"bool": {"filter": filter_query}}

        documents = []

        try:
            if top_k:
                query["size"] = top_k
                response = await self.async_client.search(index=self.index, body=query)
                documents = [_hit_to_document(hit) for hit in response["hits"]["hits"]]
            else:
                # Use scroll API for unlimited results
                query["size"] = 1000
                scroll_id = None
                try:
                    response = await self.async_client.search(
                        index=self.index, body=query, scroll="2m",
                    )
                    scroll_id = response.get("_scroll_id")
                    documents = [_hit_to_document(hit) for hit in response["hits"]["hits"]]

                    while scroll_id and response["hits"]["hits"]:
                        response = await self.async_client.scroll(
                            scroll_id=scroll_id, scroll="2m",
                        )
                        documents.extend(
                            _hit_to_document(hit) for hit in response["hits"]["hits"]
                        )
                finally:
                    if scroll_id:
                        try:
                            await self.async_client.clear_scroll(scroll_id=scroll_id)
                        except Exception:
                            pass
        except Exception as e:
            if "index_not_found_exception" in str(e):
                return []
            raise

        return documents

    async def delete_documents(self, filters: Optional[Dict[str, Any]] = None):
        query = {"match_all": {}}

        filter_query = _build_filter_query(filters)
        if filter_query:
            query = {"bool": {"filter": filter_query}}

        try:
            await self.async_client.delete_by_query(
                index=self.index, body={"query": query},
            )
        except Exception as e:
            if "index_not_found_exception" in str(e):
                logger.info(f"Index {self.index} does not exist yet, skipping deletion")
            else:
                raise

    async def count_documents(self, filters: Optional[Dict[str, Any]] = None) -> int:
        query = {"match_all": {}}

        filter_query = _build_filter_query(filters)
        if filter_query:
            query = {"bool": {"filter": filter_query}}

        try:
            response = await self.async_client.count(
                index=self.index, body={"query": query},
            )
            return response["count"]
        except Exception as e:
            if "index_not_found_exception" in str(e):
                return 0
            raise

    async def write_documents(
        self,
        documents: List[Document],
        policy: DuplicatePolicy = DuplicatePolicy.FAIL,
    ):
        if not documents:
            logger.warning("Calling AsyncOpenSearchDocumentStore.write_documents() with empty list")
            return 0

        for doc in documents:
            if not isinstance(doc, Document):
                msg = f"DocumentStore.write_documents() expects a list of Documents but got an element of {type(doc)}."
                raise ValueError(msg)

        # Prepare bulk operations
        bulk_operations = []
        for doc in documents:
            doc_dict = doc.to_dict()

            bulk_operations.append({
                "index": {"_index": self.index, "_id": doc.id}
            })
            # Haystack v2 Document.to_dict() flattens meta to top-level.
            # Include all fields except internal Haystack-only fields.
            bulk_operations.append({
                k: v for k, v in doc_dict.items()
                if k not in _SKIP_FIELDS and v is not None
            })

        # Execute async bulk insert in batches
        total_written = 0
        with tqdm(
            total=len(documents), disable=not self.progress_bar, desc="Indexing documents"
        ) as pbar:
            for i in range(0, len(bulk_operations), self.write_batch_size * 2):
                batch = bulk_operations[i:i + self.write_batch_size * 2]
                response = await self.async_client.bulk(body=batch)

                if response.get("errors"):
                    error_items = [
                        item for item in response["items"]
                        if "error" in item.get("index", {})
                    ]
                    if error_items:
                        logger.warning(f"Bulk indexing errors: {error_items[:5]}")

                batch_written = len(batch) // 2
                total_written += batch_written
                pbar.update(batch_written)

        return total_written


class AsyncOpenSearchEmbeddingRetriever:
    def __init__(
        self,
        document_store: AsyncOpenSearchDocumentStore,
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ):
        self._document_store = document_store
        self._filters = filters
        self._top_k = top_k
        self._scale_score = scale_score
        self._return_embedding = return_embedding

    @component.output_types(documents=List[Document])
    async def run(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
    ):
        if query_embedding:
            docs = await self._document_store._query_by_embedding(
                query_embedding=query_embedding,
                filters=filters or self._filters,
                top_k=top_k or self._top_k,
                scale_score=scale_score if scale_score is not None else self._scale_score,
                return_embedding=return_embedding if return_embedding is not None else self._return_embedding,
            )
        else:
            docs = await self._document_store._query_by_filters(
                filters=filters,
                top_k=top_k,
            )

        return {"documents": docs}


@provider("opensearch")
class OpenSearchProvider(DocumentStoreProvider):
    def __init__(
        self,
        hosts: str = os.getenv("OPENSEARCH_HOST", "https://localhost:9200"),
        username: Optional[str] = os.getenv("OPENSEARCH_USERNAME"),
        password: Optional[str] = os.getenv("OPENSEARCH_PASSWORD"),
        timeout: Optional[int] = (
            int(os.getenv("OPENSEARCH_TIMEOUT")) if os.getenv("OPENSEARCH_TIMEOUT") else 120
        ),
        embedding_model_dim: int = (
            int(os.getenv("EMBEDDING_MODEL_DIMENSION"))
            if os.getenv("EMBEDDING_MODEL_DIMENSION")
            else 768
        ),
        recreate_index: bool = (
            os.getenv("SHOULD_FORCE_DEPLOY", "").lower() in ("true", "1", "yes")
        ),
        **_,
    ):
        self._hosts = hosts
        self._timeout = timeout
        self._embedding_model_dim = embedding_model_dim

        if username and password:
            self._http_auth = (
                Secret.from_token(username),
                Secret.from_token(password),
            )
        else:
            self._http_auth = None

        # Validate connection
        sync_client = self._get_sync_client()
        info = sync_client.info()
        logger.info(
            f"Connected to OpenSearch cluster: {info['cluster_name']}, "
            f"version: {info['version']['number']}"
        )

        self._reset_document_store(recreate_index)

    def _get_sync_client(self) -> OpenSearch:
        return OpenSearch(
            hosts=self._hosts,
            http_auth=(
                (self._http_auth[0].resolve_value(), self._http_auth[1].resolve_value())
                if self._http_auth
                else None
            ),
            use_ssl=True,
            verify_certs=True,
            timeout=self._timeout,
        )

    def _reset_document_store(self, recreate_index: bool):
        self.get_store(recreate_index=recreate_index)
        self.get_store(dataset_name="table_descriptions", recreate_index=recreate_index)
        self.get_store(dataset_name="view_questions", recreate_index=recreate_index)
        self.get_store(dataset_name="sql_pairs", recreate_index=recreate_index)
        self.get_store(dataset_name="instructions", recreate_index=recreate_index)
        self.get_store(dataset_name="project_meta", recreate_index=recreate_index)

    def get_store(
        self,
        dataset_name: Optional[str] = None,
        recreate_index: bool = False,
    ):
        index_name = (dataset_name or "Document").lower()

        if recreate_index:
            try:
                sync_client = self._get_sync_client()
                if sync_client.indices.exists(index=index_name):
                    logger.info(f"Deleting existing OpenSearch index: {index_name}")
                    sync_client.indices.delete(index=index_name)
            except Exception as e:
                logger.warning(f"Error deleting index {index_name}: {e}")

        method = {
            "name": "hnsw",
            "engine": "faiss",
            "space_type": "l2",
            "parameters": {"ef_construction": 128, "m": 24},
        }

        settings = {
            "index.knn": True,
            "index.knn.algo_param.ef_search": 100,
        }

        mappings = {
            "properties": {
                "content": {"type": "text"},
                "embedding": {
                    "type": "knn_vector",
                    "dimension": self._embedding_model_dim,
                    "method": method,
                },
                "project_id": {"type": "keyword"},
                "type": {"type": "keyword"},
            }
        }

        # Create index before initializing the document store
        try:
            sync_client = self._get_sync_client()
            if not sync_client.indices.exists(index=index_name):
                logger.info(f"Creating OpenSearch index: {index_name}")
                sync_client.indices.create(
                    index=index_name,
                    body={"settings": settings, "mappings": mappings},
                )
        except Exception as e:
            if "resource_already_exists_exception" not in str(e):
                logger.warning(f"Could not pre-create index {index_name}: {e}")

        return AsyncOpenSearchDocumentStore(
            hosts=self._hosts,
            index=index_name,
            embedding_dim=self._embedding_model_dim,
            method=method,
            mappings=mappings,
            settings=settings,
            create_index=False,
            http_auth=self._http_auth,
            use_ssl=True,
            verify_certs=True,
            timeout=self._timeout,
            return_embedding=False,
            progress_bar=True,
        )

    def get_retriever(
        self,
        document_store: AsyncOpenSearchDocumentStore,
        top_k: int = 10,
    ):
        return AsyncOpenSearchEmbeddingRetriever(
            document_store=document_store,
            top_k=top_k,
        )
