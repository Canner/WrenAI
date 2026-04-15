import importlib
import inspect
import os
import re
from collections.abc import Mapping
from typing import Optional

from haystack.utils import Secret

from src.core.provider import DocumentStoreProvider
from src.providers.loader import provider

_PGVECTOR_DEPENDENCY_HINT = (
    "Provider `pgvector` requires optional pgvector dependencies. "
    "Install `pgvector-haystack` and a PostgreSQL driver such as `psycopg[binary]` "
    "before using it."
)
_PGVECTOR_COMPATIBILITY_HINT = (
    "Provider `pgvector` detected an incompatible pgvector runtime. "
    "Ensure `pgvector-haystack` is compatible with the installed `haystack-ai` "
    "and PostgreSQL driver versions."
)
_PGVECTOR_NATIVE_COLUMNS = {
    "id",
    "content",
    "dataframe",
    "blob_data",
    "blob_meta",
    "blob_mime_type",
    "meta",
    "embedding",
    "score",
}


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _coalesce_bool(*values: Optional[bool]) -> Optional[bool]:
    for value in values:
        if value is not None:
            return value
    return None


def _coalesce_int(*values: Optional[int]) -> Optional[int]:
    for value in values:
        if value not in (None, 0):
            return value
    return None


def _require_attr(module_name: str, attr_name: str):
    _ensure_haystack_filter_convert_compatibility()
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as exc:
        raise RuntimeError(_PGVECTOR_DEPENDENCY_HINT) from exc
    except ImportError as exc:
        raise RuntimeError(_PGVECTOR_COMPATIBILITY_HINT) from exc

    try:
        return getattr(module, attr_name)
    except AttributeError as exc:
        raise RuntimeError(
            f"Provider `pgvector` expected `{attr_name}` in `{module_name}`."
        ) from exc


def _ensure_haystack_filter_convert_compatibility():
    try:
        filters_module = importlib.import_module("haystack.utils.filters")
    except Exception:
        return

    if hasattr(filters_module, "convert"):
        return

    def convert(filters):
        if not isinstance(filters, Mapping):
            return filters
        if any(key in filters for key in ("field", "operator", "conditions")):
            return filters

        conditions = []
        for field, value in filters.items():
            if isinstance(value, Mapping) and "operator" in value:
                condition = {"field": field, **value}
            else:
                condition = {"field": field, "operator": "==", "value": value}
            conditions.append(condition)

        if len(conditions) == 1:
            return conditions[0]
        return {"operator": "AND", "conditions": conditions}

    setattr(filters_module, "convert", convert)


def _filter_supported_store_kwargs(document_store_cls, kwargs: dict) -> dict:
    signature = inspect.signature(document_store_cls.__init__)
    parameters = list(signature.parameters.values())

    if any(param.kind == inspect.Parameter.VAR_KEYWORD for param in parameters):
        return kwargs

    supported = {
        name
        for name, param in signature.parameters.items()
        if name != "self"
        and param.kind
        in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        )
    }
    filtered = {key: value for key, value in kwargs.items() if key in supported}

    if (
        "hnsw_recreate_index_if_exists" in supported
        and "hnsw_recreate_index_if_exists" not in filtered
    ):
        filtered["hnsw_recreate_index_if_exists"] = bool(
            filtered.get("recreate_table", False)
        )

    return filtered


def _normalize_pgvector_filters(filters):
    if not isinstance(filters, Mapping):
        return filters

    if "field" in filters:
        field = filters["field"]
        if (
            isinstance(field, str)
            and not field.startswith("meta.")
            and field not in _PGVECTOR_NATIVE_COLUMNS
        ):
            return {**filters, "field": f"meta.{field}"}
        return dict(filters)

    if "conditions" in filters:
        return {
            **filters,
            "conditions": [
                _normalize_pgvector_filters(condition)
                for condition in filters["conditions"]
            ],
        }

    conditions = []
    for field, value in filters.items():
        normalized_field = field
        if (
            isinstance(field, str)
            and not field.startswith("meta.")
            and field not in _PGVECTOR_NATIVE_COLUMNS
        ):
            normalized_field = f"meta.{field}"

        if isinstance(value, Mapping) and "operator" in value:
            conditions.append(
                {
                    "field": normalized_field,
                    **value,
                }
            )
        else:
            conditions.append(
                {
                    "field": normalized_field,
                    "operator": "==",
                    "value": value,
                }
            )

    if len(conditions) == 1:
        return conditions[0]

    return {
        "operator": "AND",
        "conditions": conditions,
    }


def _table_scoped_index_name(table_name: str, base_name: str) -> str:
    normalized_table_name = re.sub(r"[^a-zA-Z0-9_]+", "_", table_name).strip("_")
    normalized_base_name = re.sub(r"[^a-zA-Z0-9_]+", "_", base_name).strip("_")
    candidate = f"{normalized_table_name}_{normalized_base_name}".strip("_")
    return candidate[:63]


class PgvectorStoreAdapter:
    def __init__(self, store):
        self._store = store

    def __getattr__(self, item):
        return getattr(self._store, item)

    def _normalized_filters(self, filters):
        return _normalize_pgvector_filters(filters)

    async def write_documents(self, documents, policy):
        if not documents:
            return 0
        return self._store.write_documents(documents=documents, policy=policy)

    async def delete_documents(self, filters=None):
        documents = self.filter_documents(filters=filters)
        if documents:
            self._store.delete_documents([document.id for document in documents])

    async def count_documents(self, filters=None):
        if filters:
            return len(self.filter_documents(filters=filters))
        return self._store.count_documents()

    def filter_documents(self, filters=None):
        return self._store.filter_documents(filters=self._normalized_filters(filters))

    def _embedding_retrieval(
        self,
        query_embedding,
        *,
        filters=None,
        top_k=10,
        vector_function=None,
    ):
        return self._store._embedding_retrieval(
            query_embedding,
            filters=self._normalized_filters(filters),
            top_k=top_k,
            vector_function=vector_function,
        )

    def to_dict(self):
        if hasattr(self._store, "to_dict"):
            try:
                return self._store.to_dict()
            except ValueError:
                table_name = (
                    getattr(self._store, "table_name", None)
                    or getattr(self._store, "_table_name", None)
                    or getattr(self._store, "index", None)
                    or "unknown"
                )
                return {
                    "type": "pgvector",
                    "init_parameters": {
                        "table_name": table_name,
                        "index": table_name,
                    },
                }
        return {}


class PgvectorRetrieverAdapter:
    def __init__(self, retriever, document_store=None):
        self._retriever = retriever
        self._document_store = document_store

    def __getattr__(self, item):
        return getattr(self._retriever, item)

    async def run(
        self,
        query_embedding,
        filters=None,
        top_k=None,
        vector_function=None,
    ):
        normalized_filters = _normalize_pgvector_filters(filters)
        if not query_embedding:
            if not self._document_store or not hasattr(
                self._document_store, "filter_documents"
            ):
                raise ValueError("query_embedding must be a non-empty list of floats")

            documents = self._document_store.filter_documents(
                filters=normalized_filters
            )
            if top_k is not None:
                documents = documents[:top_k]
            return {"documents": documents}

        return self._retriever.run(
            query_embedding=query_embedding,
            filters=normalized_filters,
            top_k=top_k,
            vector_function=vector_function,
        )


@provider("pgvector")
class PgvectorProvider(DocumentStoreProvider):
    def __init__(
        self,
        connection_string: Optional[str] = os.getenv("PG_CONN_STR"),
        connection_string_env: str = "PG_CONN_STR",
        create_extension: Optional[bool] = None,
        schema_name: str = os.getenv("PGVECTOR_SCHEMA", "public"),
        table_name: str = os.getenv("PGVECTOR_TABLE_NAME", "document"),
        language: str = os.getenv("PGVECTOR_LANGUAGE", "english"),
        embedding_dimension: Optional[int] = None,
        embedding_model_dim: Optional[int] = None,
        vector_type: str = os.getenv("PGVECTOR_VECTOR_TYPE", "vector"),
        vector_function: str = os.getenv(
            "PGVECTOR_VECTOR_FUNCTION", "cosine_similarity"
        ),
        recreate_table: Optional[bool] = None,
        recreate_index: Optional[bool] = None,
        search_strategy: str = os.getenv(
            "PGVECTOR_SEARCH_STRATEGY", "exact_nearest_neighbor"
        ),
        hnsw_index_name: str = os.getenv(
            "PGVECTOR_HNSW_INDEX_NAME", "haystack_hnsw_index"
        ),
        hnsw_ef_search: Optional[int] = (
            int(os.getenv("PGVECTOR_HNSW_EF_SEARCH"))
            if os.getenv("PGVECTOR_HNSW_EF_SEARCH")
            else None
        ),
        keyword_index_name: str = os.getenv(
            "PGVECTOR_KEYWORD_INDEX_NAME", "haystack_keyword_index"
        ),
        **_,
    ):
        self._connection_string = connection_string
        self._connection_string_env = connection_string_env
        self._create_extension = _coalesce_bool(
            create_extension,
            _bool_env("PGVECTOR_CREATE_EXTENSION", False),
        )
        self._schema_name = schema_name
        self._table_name = table_name
        self._language = language
        self._embedding_dimension = _coalesce_int(
            embedding_dimension,
            embedding_model_dim,
            (
                int(os.getenv("EMBEDDING_MODEL_DIMENSION"))
                if os.getenv("EMBEDDING_MODEL_DIMENSION")
                else None
            ),
        ) or 0
        self._vector_type = vector_type
        self._vector_function = vector_function
        self._recreate_table = _coalesce_bool(
            recreate_table,
            recreate_index,
            _bool_env("SHOULD_FORCE_DEPLOY", False),
        )
        self._search_strategy = search_strategy
        self._hnsw_index_name = hnsw_index_name
        self._hnsw_ef_search = hnsw_ef_search
        self._keyword_index_name = keyword_index_name

    def _connection_secret(self) -> Secret:
        if self._connection_string:
            return Secret.from_token(self._connection_string)
        return Secret.from_env_var(self._connection_string_env)

    def get_store(
        self,
        dataset_name: Optional[str] = None,
        recreate_table: Optional[bool] = None,
        recreate_index: Optional[bool] = None,
    ):
        PgvectorDocumentStore = _require_attr(
            "haystack_integrations.document_stores.pgvector",
            "PgvectorDocumentStore",
        )

        recreate_table = _coalesce_bool(recreate_table, recreate_index, False)

        kwargs = {
            "connection_string": self._connection_secret(),
            "create_extension": self._create_extension,
            "schema_name": self._schema_name,
            "table_name": dataset_name or self._table_name,
            "language": self._language,
            "embedding_dimension": self._embedding_dimension,
            "vector_type": self._vector_type,
            "vector_function": self._vector_function,
            "recreate_table": (
                recreate_table
            ),
            "search_strategy": self._search_strategy,
            "keyword_index_name": _table_scoped_index_name(
                dataset_name or self._table_name,
                self._keyword_index_name,
            ),
        }
        if self._search_strategy == "hnsw":
            kwargs["hnsw_index_name"] = _table_scoped_index_name(
                dataset_name or self._table_name,
                self._hnsw_index_name,
            )
            if self._hnsw_ef_search is not None:
                kwargs["hnsw_ef_search"] = self._hnsw_ef_search

        try:
            native_store = PgvectorDocumentStore(
                **_filter_supported_store_kwargs(PgvectorDocumentStore, kwargs)
            )
            if recreate_table and hasattr(native_store, "count_documents"):
                # PgvectorDocumentStore applies destructive recreate lazily on first
                # connection use. Force a no-op read here so callers that only request
                # a reset do not accidentally defer the drop/create until a later
                # unrelated access.
                native_store.count_documents()

            return PgvectorStoreAdapter(native_store)
        except ModuleNotFoundError as exc:
            raise RuntimeError(_PGVECTOR_DEPENDENCY_HINT) from exc
        except ImportError as exc:
            raise RuntimeError(_PGVECTOR_COMPATIBILITY_HINT) from exc

    def get_retriever(
        self,
        document_store,
        top_k: int = 10,
    ):
        PgvectorEmbeddingRetriever = _require_attr(
            "haystack_integrations.components.retrievers.pgvector",
            "PgvectorEmbeddingRetriever",
        )

        try:
            native_store = (
                document_store._store
                if isinstance(document_store, PgvectorStoreAdapter)
                else document_store
            )
            return PgvectorRetrieverAdapter(
                PgvectorEmbeddingRetriever(
                    document_store=native_store,
                    top_k=top_k,
                ),
                document_store=document_store,
            )
        except ModuleNotFoundError as exc:
            raise RuntimeError(_PGVECTOR_DEPENDENCY_HINT) from exc
        except ImportError as exc:
            raise RuntimeError(_PGVECTOR_COMPATIBILITY_HINT) from exc
