# SPDX-FileCopyrightText: 2022-present deepset GmbH <info@deepset.ai>
#
# SPDX-License-Identifier: Apache-2.0

import math
from typing import Any, Dict, List, Optional

from haystack import default_from_dict, default_to_dict, logging
from haystack.dataclasses import Document
from haystack.document_stores.errors import DocumentStoreError, DuplicateDocumentError
from haystack.document_stores.types import DuplicatePolicy
from haystack.lazy_imports import LazyImport
from haystack.utils.filters import raise_on_invalid_filter_syntax
from opensearchpy import AsyncOpenSearch, OpenSearch
from opensearchpy.helpers import async_bulk, bulk

logger = logging.getLogger(__name__)

with LazyImport("Run 'pip install opensearch-haystack opensearch-py[async]'") as opensearch_import:
    # pylint: disable=import-error
    from haystack_integrations.document_stores.opensearch.auth import AWSAuth
    from haystack_integrations.document_stores.opensearch.document_store import (
        BM25_SCALING_FACTOR,
        DEFAULT_MAX_CHUNK_BYTES,
        DEFAULT_SETTINGS,
        Hosts,
    )
    from haystack_integrations.document_stores.opensearch.filters import (
        normalize_filters,
    )


class OpenSearchDocumentStore:
    def __init__(  # pylint: disable=dangerous-default-value
        self,
        *,
        hosts: Optional[Hosts] = None,
        index: str = "default",
        max_chunk_bytes: int = DEFAULT_MAX_CHUNK_BYTES,
        embedding_dim: int = 768,
        return_embedding: bool = False,
        method: Optional[Dict[str, Any]] = None,
        mappings: Optional[Dict[str, Any]] = None,
        settings: Optional[Dict[str, Any]] = DEFAULT_SETTINGS,
        create_index: bool = True,
        http_auth: Any = None,
        use_ssl: Optional[bool] = None,
        verify_certs: Optional[bool] = None,
        timeout: Optional[int] = None,
        **kwargs,
    ):
        """
        Creates a new OpenSearchDocumentStore instance.

        The `embeddings_dim`, `method`, `mappings`, and `settings` arguments are only used if the index does not
        exists and needs to be created. If the index already exists, its current configurations will be used.

        For more information on connection parameters, see the [official OpenSearch documentation](https://opensearch.org/docs/latest/clients/python-low-level/#connecting-to-opensearch)

        :param hosts: List of hosts running the OpenSearch client. Defaults to None
        :param index: Name of index in OpenSearch, if it doesn't exist it will be created. Defaults to "default"
        :param max_chunk_bytes: Maximum size of the requests in bytes. Defaults to 100MB
        :param embedding_dim: Dimension of the embeddings. Defaults to 768
        :param return_embedding:
            Whether to return the embedding of the retrieved Documents.
        :param method: The method definition of the underlying configuration of the approximate k-NN algorithm. Please
            see the [official OpenSearch docs](https://opensearch.org/docs/latest/search-plugins/knn/knn-index/#method-definitions)
            for more information. Defaults to None
        :param mappings: The mapping of how the documents are stored and indexed. Please see the [official OpenSearch docs](https://opensearch.org/docs/latest/field-types/)
            for more information. If None, it uses the embedding_dim and method arguments to create default mappings.
            Defaults to None
        :param settings: The settings of the index to be created. Please see the [official OpenSearch docs](https://opensearch.org/docs/latest/search-plugins/knn/knn-index/#index-settings)
            for more information. Defaults to {"index.knn": True}
        :param create_index: Whether to create the index if it doesn't exist. Defaults to True
        :param http_auth: http_auth param passed to the underying connection class.
            For basic authentication with default connection class `Urllib3HttpConnection` this can be
            - a tuple of (username, password)
            - a list of [username, password]
            - a string of "username:password"
            For AWS authentication with `Urllib3HttpConnection` pass an instance of `AWSAuth`.
            Defaults to None
        :param use_ssl: Whether to use SSL. Defaults to None
        :param verify_certs: Whether to verify certificates. Defaults to None
        :param timeout: Timeout in seconds. Defaults to None
        :param **kwargs: Optional arguments that `OpenSearch` takes. For the full list of supported kwargs,
            see the [official OpenSearch reference](https://opensearch-project.github.io/opensearch-py/api-ref/clients/opensearch_client.html)
        """
        self._hosts = hosts
        self._index = index
        self._max_chunk_bytes = max_chunk_bytes
        self._embedding_dim = embedding_dim
        self._return_embedding = return_embedding
        self._method = method
        self._mappings = mappings or self._get_default_mappings()
        self._settings = settings
        self._create_index = create_index
        self._http_auth = http_auth
        self._use_ssl = use_ssl
        self._verify_certs = verify_certs
        self._timeout = timeout
        self._kwargs = kwargs

        # Client is initialized lazily to prevent side effects when
        # the document store is instantiated.
        self._client = None
        self._async_client = None
        self._initialized = False

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        return default_to_dict(
            self,
            hosts=self._hosts,
            index=self._index,
            max_chunk_bytes=self._max_chunk_bytes,
            embedding_dim=self._embedding_dim,
            method=self._method,
            mappings=self._mappings,
            settings=self._settings,
            create_index=self._create_index,
            return_embedding=self._return_embedding,
            http_auth=(self._http_auth.to_dict() if isinstance(self._http_auth, AWSAuth) else self._http_auth),
            use_ssl=self._use_ssl,
            verify_certs=self._verify_certs,
            timeout=self._timeout,
            **self._kwargs,
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "OpenSearchDocumentStore":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.

        :returns:
            Deserialized component.
        """
        if http_auth := data.get("init_parameters", {}).get(  # noqa: SIM102
            "http_auth"
        ):
            if isinstance(http_auth, dict):
                data["init_parameters"]["http_auth"] = AWSAuth.from_dict(http_auth)

        return default_from_dict(cls, data)

    def _ensure_initialized(self):
        # Ideally, we have a warm-up stage for document stores as well as components.
        if not self._initialized:
            self._client = OpenSearch(
                hosts=self._hosts,
                http_auth=self._http_auth,
                use_ssl=self._use_ssl,
                verify_certs=self._verify_certs,
                timeout=self._timeout,
                **self._kwargs,
            )
            self._async_client = AsyncOpenSearch(
                hosts=self._hosts,
                http_auth=self._http_auth,
                use_ssl=self._use_ssl,
                verify_certs=self._verify_certs,
                timeout=self._timeout,
                **self._kwargs,
            )

            self._initialized = True

        # In a just world, this is something that the document store shouldn't
        # be responsible for. However, the current implementation has become a
        # dependency of downstream users, so we'll have to preserve this behaviour
        # (for now).
        self._ensure_index_exists()

    def _ensure_index_exists(self):
        assert self._client is not None

        if self._client.indices.exists(index=self._index):
            logger.debug(
                "The index '{index}' already exists. The `embedding_dim`, `method`, `mappings`, and "
                "`settings` values will be ignored.",
                index=self._index,
            )
        elif self._create_index:
            # Create the index if it doesn't exist
            body = {"mappings": self._mappings, "settings": self._settings}
            self._client.indices.create(index=self._index, body=body)  # type:ignore

    def _get_default_mappings(self) -> Dict[str, Any]:
        default_mappings: Dict[str, Any] = {
            "properties": {
                "embedding": {
                    "type": "knn_vector",
                    "index": True,
                    "dimension": self._embedding_dim,
                },
                "content": {"type": "text"},
            },
            "dynamic_templates": [
                {
                    "strings": {
                        "match_mapping_type": "string",
                        "mapping": {"type": "keyword"},
                    }
                }
            ],
        }
        if self._method:
            default_mappings["properties"]["embedding"]["method"] = self._method
        return default_mappings

    def create_index(  # noqa: D102
        self,
        index: Optional[str] = None,
        mappings: Optional[Dict[str, Any]] = None,
        settings: Optional[Dict[str, Any]] = None,
    ) -> None:
        self._ensure_initialized()
        assert self._client is not None

        if not index:
            index = self._index
        if not mappings:
            mappings = self._mappings
        if not settings:
            settings = self._settings

        if not self._client.indices.exists(index=index):
            self._client.indices.create(index=index, body={"mappings": mappings, "settings": settings})

    def count_documents(self) -> int:  # noqa: D102
        self._ensure_initialized()

        assert self._client is not None
        return self._client.count(index=self._index)["count"]

    async def count_documents_async(self) -> int:  # noqa: D102
        self._ensure_initialized()

        assert self._async_client is not None
        return (await self._async_client.count(index=self._index))["count"]

    def _deserialize_search_hits(self, hits: List[Dict[str, Any]]) -> List[Document]:
        out = []
        for hit in hits:
            data = hit["_source"]
            if "highlight" in hit:
                data["metadata"]["highlighted"] = hit["highlight"]
            data["score"] = hit["_score"]
            out.append(Document.from_dict(data))

        return out

    def _prepare_filter_search_request(self, filters: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        raise_on_invalid_filter_syntax(filters)
        search_kwargs: Dict[str, Any] = {"size": 10_000}
        if filters:
            search_kwargs["query"] = {"bool": {"filter": normalize_filters(filters)}}
        return search_kwargs

    def _search_documents(self, request_body: Dict[str, Any]) -> List[Document]:
        assert self._client is not None
        search_results = self._client.search(index=self._index, body=request_body)
        return self._deserialize_search_hits(search_results["hits"]["hits"])

    async def _search_documents_async(self, request_body: Dict[str, Any]) -> List[Document]:
        assert self._async_client is not None
        search_results = await self._async_client.search(index=self._index, body=request_body)
        return self._deserialize_search_hits(search_results["hits"]["hits"])

    def filter_documents(  # noqa: D102
        self, filters: Optional[Dict[str, Any]] = None
    ) -> List[Document]:
        self._ensure_initialized()
        return self._search_documents(self._prepare_filter_search_request(filters))

    async def filter_documents_async(  # noqa: D102
        self, filters: Optional[Dict[str, Any]] = None
    ) -> List[Document]:
        self._ensure_initialized()
        return await self._search_documents_async(self._prepare_filter_search_request(filters))

    def _prepare_bulk_write_request(
        self, documents: List[Document], policy: DuplicatePolicy, is_async: bool
    ) -> Dict[str, Any]:
        if len(documents) > 0 and not isinstance(documents[0], Document):
            msg = "param 'documents' must contain a list of objects of type Document"
            raise ValueError(msg)

        if policy == DuplicatePolicy.NONE:
            policy = DuplicatePolicy.FAIL

        action = "index" if policy == DuplicatePolicy.OVERWRITE else "create"
        return {
            "client": self._client if not is_async else self._async_client,
            "actions": (
                {
                    "_op_type": action,
                    "_id": doc.id,
                    "_source": doc.to_dict(),
                }
                for doc in documents
            ),
            "refresh": "wait_for",
            "index": self._index,
            "raise_on_error": False,
            "max_chunk_bytes": self._max_chunk_bytes,
        }

    def _process_bulk_write_errors(self, errors: List[Dict[str, Any]], policy: DuplicatePolicy):
        if len(errors) == 0:
            return

        duplicate_errors_ids = []
        other_errors = []
        for e in errors:
            # OpenSearch might not return a correctly formatted error, in that case we
            # treat it as a generic error
            if "create" not in e:
                other_errors.append(e)
                continue
            error_type = e["create"]["error"]["type"]
            if policy == DuplicatePolicy.FAIL and error_type == "version_conflict_engine_exception":
                duplicate_errors_ids.append(e["create"]["_id"])
            elif policy == DuplicatePolicy.SKIP and error_type == "version_conflict_engine_exception":
                # when the policy is skip, duplication errors are OK and we should not raise an exception
                continue
            else:
                other_errors.append(e)

        if len(duplicate_errors_ids) > 0:
            msg = f"IDs '{', '.join(duplicate_errors_ids)}' already exist in the document store."
            raise DuplicateDocumentError(msg)

        if len(other_errors) > 0:
            msg = f"Failed to write documents to OpenSearch. Errors:\n{other_errors}"
            raise DocumentStoreError(msg)

    def write_documents(  # noqa: D102
        self, documents: List[Document], policy: DuplicatePolicy = DuplicatePolicy.NONE
    ) -> int:
        self._ensure_initialized()

        bulk_params = self._prepare_bulk_write_request(documents, policy, is_async=False)
        documents_written, errors = bulk(**bulk_params)
        self._process_bulk_write_errors(errors, policy)
        return documents_written

    async def write_documents_async(  # noqa: D102
        self, documents: List[Document], policy: DuplicatePolicy = DuplicatePolicy.NONE
    ) -> int:
        self._ensure_initialized()

        bulk_params = self._prepare_bulk_write_request(documents, policy, is_async=True)
        documents_written, errors = await async_bulk(**bulk_params)
        self._process_bulk_write_errors(errors, policy)  # type:ignore
        return documents_written

    def _prepare_bulk_delete_request(self, document_ids: List[str], is_async: bool) -> Dict[str, Any]:
        return {
            "client": self._client if not is_async else self._async_client,
            "actions": ({"_op_type": "delete", "_id": id_} for id_ in document_ids),
            "refresh": "wait_for",
            "index": self._index,
            "raise_on_error": False,
            "max_chunk_bytes": self._max_chunk_bytes,
        }

    def delete_documents(self, document_ids: List[str]) -> None:  # noqa: D102
        self._ensure_initialized()

        bulk(**self._prepare_bulk_delete_request(document_ids, is_async=False))

    async def delete_documents_async(  # noqa: D102
        self, document_ids: List[str]
    ) -> None:
        self._ensure_initialized()

        await async_bulk(**self._prepare_bulk_delete_request(document_ids, is_async=True))

    def _render_custom_query(self, custom_query: Any, substitutions: Dict[str, Any]) -> Any:
        """
        Recursively replaces the placeholders in the custom_query with the actual values.

        :param custom_query: The custom query to replace the placeholders in.
        :param substitutions: The dictionary containing the actual values to replace the placeholders with.
        :returns: The custom query with the placeholders replaced.
        """
        if isinstance(custom_query, dict):
            return {key: self._render_custom_query(value, substitutions) for key, value in custom_query.items()}
        elif isinstance(custom_query, list):
            return [self._render_custom_query(entry, substitutions) for entry in custom_query]
        elif isinstance(custom_query, str):
            return substitutions.get(custom_query, custom_query)

        return custom_query

    def _prepare_bm25_search_request(
        self,
        *,
        query: str,
        filters: Optional[Dict[str, Any]],
        fuzziness: str,
        top_k: int,
        all_terms_must_match: bool,
        custom_query: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        raise_on_invalid_filter_syntax(filters)

        if not query:
            body: Dict[str, Any] = {"query": {"bool": {"must": {"match_all": {}}}}}
            if filters:
                body["query"]["bool"]["filter"] = normalize_filters(filters)

        if isinstance(custom_query, dict):
            body = self._render_custom_query(
                custom_query,
                {
                    "$query": query,
                    "$filters": normalize_filters(filters),  # type:ignore
                },
            )

        else:
            operator = "AND" if all_terms_must_match else "OR"
            body = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query,
                                    "fuzziness": fuzziness,
                                    "type": "most_fields",
                                    "operator": operator,
                                }
                            }
                        ]
                    }
                },
            }

            if filters:
                body["query"]["bool"]["filter"] = normalize_filters(filters)

        body["size"] = top_k

        # For some applications not returning the embedding can save a lot of bandwidth
        # if you don't need this data not retrieving it can be a good idea
        if not self._return_embedding:
            body["_source"] = {"excludes": ["embedding"]}

        return body

    def _postprocess_bm25_search_results(self, results: List[Document], scale_score: bool):
        if not scale_score:
            return

        for doc in results:
            assert doc.score is not None
            doc.score = float(1 / (1 + math.exp(-(doc.score / float(BM25_SCALING_FACTOR)))))

    def _bm25_retrieval(
        self,
        query: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        fuzziness: str = "AUTO",
        top_k: int = 10,
        scale_score: bool = False,
        all_terms_must_match: bool = False,
        custom_query: Optional[Dict[str, Any]] = None,
    ) -> List[Document]:
        self._ensure_initialized()

        search_params = self._prepare_bm25_search_request(
            query=query,
            filters=filters,
            fuzziness=fuzziness,
            top_k=top_k,
            all_terms_must_match=all_terms_must_match,
            custom_query=custom_query,
        )
        documents = self._search_documents(search_params)
        self._postprocess_bm25_search_results(documents, scale_score)
        return documents

    async def _bm25_retrieval_async(
        self,
        query: str,
        *,
        filters: Optional[Dict[str, Any]] = None,
        fuzziness: str = "AUTO",
        top_k: int = 10,
        scale_score: bool = False,
        all_terms_must_match: bool = False,
        custom_query: Optional[Dict[str, Any]] = None,
    ) -> List[Document]:
        self._ensure_initialized()

        search_params = self._prepare_bm25_search_request(
            query=query,
            filters=filters,
            fuzziness=fuzziness,
            top_k=top_k,
            all_terms_must_match=all_terms_must_match,
            custom_query=custom_query,
        )
        documents = await self._search_documents_async(search_params)
        self._postprocess_bm25_search_results(documents, scale_score)
        return documents

    def _prepare_embedding_search_request(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]],
        top_k: int,
        custom_query: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        raise_on_invalid_filter_syntax(filters)

        if not query_embedding:
            msg = "query_embedding must be a non-empty list of floats"
            raise ValueError(msg)

        body: Dict[str, Any]
        if isinstance(custom_query, dict):
            body = self._render_custom_query(
                custom_query,
                {
                    "$query_embedding": query_embedding,
                    "$filters": normalize_filters(filters),  # type:ignore
                },
            )

        else:
            body = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "knn": {
                                    "embedding": {
                                        "vector": query_embedding,
                                        "k": top_k,
                                    }
                                }
                            }
                        ],
                    }
                },
            }

            if filters:
                body["query"]["bool"]["filter"] = normalize_filters(filters)

        body["size"] = top_k

        # For some applications not returning the embedding can save a lot of bandwidth
        # if you don't need this data not retrieving it can be a good idea
        if not self._return_embedding:
            body["_source"] = {"excludes": ["embedding"]}

        return body

    def _embedding_retrieval(
        self,
        query_embedding: List[float],
        *,
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        custom_query: Optional[Dict[str, Any]] = None,
    ) -> List[Document]:
        self._ensure_initialized()

        search_params = self._prepare_embedding_search_request(query_embedding, filters, top_k, custom_query)
        return self._search_documents(search_params)

    async def _embedding_retrieval_async(
        self,
        query_embedding: List[float],
        *,
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        custom_query: Optional[Dict[str, Any]] = None,
    ) -> List[Document]:
        self._ensure_initialized()

        search_params = self._prepare_embedding_search_request(query_embedding, filters, top_k, custom_query)
        return await self._search_documents_async(search_params)
