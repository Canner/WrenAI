import inspect
import logging
from itertools import islice
from typing import Any, ClassVar, Dict, Generator, List, Optional, Set, Union

import numpy as np
import qdrant_client
from haystack import default_from_dict, default_to_dict
from haystack.dataclasses import Document
from haystack.dataclasses.sparse_embedding import SparseEmbedding
from haystack.document_stores.errors import DocumentStoreError, DuplicateDocumentError
from haystack.document_stores.types import DuplicatePolicy
from haystack.utils import Secret, deserialize_secrets_inplace
from qdrant_client import grpc
from qdrant_client.http import models as rest
from qdrant_client.http.exceptions import UnexpectedResponse
from tqdm import tqdm

from .converters import (
    DENSE_VECTORS_NAME,
    SPARSE_VECTORS_NAME,
    convert_haystack_documents_to_qdrant_points,
    convert_id,
    convert_qdrant_point_to_haystack_document,
)
from .filters import convert_filters_to_qdrant

logger = logging.getLogger(__name__)


class QdrantStoreError(DocumentStoreError):
    pass


FilterType = Dict[str, Union[Dict[str, Any], List[Any], str, int, float, bool]]


def get_batches_from_generator(iterable, n):
    """
    Batch elements of an iterable into fixed-length chunks or blocks.
    """
    it = iter(iterable)
    x = tuple(islice(it, n))
    while x:
        yield x
        x = tuple(islice(it, n))


class QdrantDocumentStore:
    """
    QdrantDocumentStore is a Document Store for Qdrant.
    It can be used with any Qdrant instance: in-memory, disk-persisted, Docker-based,
    and Qdrant Cloud Cluster deployments.

    Usage example by creating an in-memory instance:

    ```python
    from haystack.dataclasses.document import Document
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

    document_store = QdrantDocumentStore(
        ":memory:",
        recreate_index=True
    )
    document_store.write_documents([
        Document(content="This is first", embedding=[0.0]*5),
        Document(content="This is second", embedding=[0.1, 0.2, 0.3, 0.4, 0.5])
    ])
    ```

    Usage example with Qdrant Cloud:

    ```python
    from haystack.dataclasses.document import Document
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

    document_store = QdrantDocumentStore(
            url="https://xxxxxx-xxxxx-xxxxx-xxxx-xxxxxxxxx.us-east.aws.cloud.qdrant.io:6333",
        api_key="<your-api-key>",
    )
    document_store.write_documents([
        Document(content="This is first", embedding=[0.0]*5),
        Document(content="This is second", embedding=[0.1, 0.2, 0.3, 0.4, 0.5])
    ])
    ```
    """

    SIMILARITY: ClassVar[Dict[str, str]] = {
        "cosine": rest.Distance.COSINE,
        "dot_product": rest.Distance.DOT,
        "l2": rest.Distance.EUCLID,
    }

    def __init__(
        self,
        location: Optional[str] = None,
        url: Optional[str] = None,
        port: int = 6333,
        grpc_port: int = 6334,
        prefer_grpc: bool = False,
        https: Optional[bool] = None,
        api_key: Optional[Secret] = None,
        prefix: Optional[str] = None,
        timeout: Optional[int] = None,
        host: Optional[str] = None,
        path: Optional[str] = None,
        force_disable_check_same_thread: bool = False,
        index: str = "Document",
        embedding_dim: int = 768,
        on_disk: bool = False,
        use_sparse_embeddings: bool = False,
        sparse_idf: bool = False,
        similarity: str = "cosine",
        return_embedding: bool = False,
        progress_bar: bool = True,
        recreate_index: bool = False,
        shard_number: Optional[int] = None,
        replication_factor: Optional[int] = None,
        write_consistency_factor: Optional[int] = None,
        on_disk_payload: Optional[bool] = None,
        hnsw_config: Optional[dict] = None,
        optimizers_config: Optional[dict] = None,
        wal_config: Optional[dict] = None,
        quantization_config: Optional[dict] = None,
        init_from: Optional[dict] = None,
        wait_result_from_api: bool = True,
        metadata: Optional[dict] = None,
        write_batch_size: int = 100,
        scroll_size: int = 10_000,
        payload_fields_to_index: Optional[List[dict]] = None,
    ):
        """
        :param location:
            If `memory` - use in-memory Qdrant instance.
            If `str` - use it as a URL parameter.
            If `None` - use default values for host and port.
        :param url:
            Either host or str of `Optional[scheme], host, Optional[port], Optional[prefix]`.
        :param port:
            Port of the REST API interface.
        :param grpc_port:
            Port of the gRPC interface.
        :param prefer_grpc:
            If `True` - use gRPC interface whenever possible in custom methods.
        :param https:
            If `True` - use HTTPS(SSL) protocol.
        :param api_key:
            API key for authentication in Qdrant Cloud.
        :param prefix:
            If not `None` - add prefix to the REST URL path.
            Example: service/v1 will result in http://localhost:6333/service/v1/{qdrant-endpoint}
            for REST API.
        :param timeout:
            Timeout for REST and gRPC API requests.
        :param host:
            Host name of Qdrant service. If ùrl` and `host` are `None`, set to `localhost`.
        :param path:
            Persistence path for QdrantLocal.
        :param force_disable_check_same_thread:
            For QdrantLocal, force disable check_same_thread.
            Only use this if you can guarantee that you can resolve the thread safety outside QdrantClient.
        :param index:
            Name of the index.
        :param embedding_dim:
            Dimension of the embeddings.
        :param on_disk:
            Whether to store the collection on disk.
        :param use_sparse_embedding:
            If set to `True`, enables support for sparse embeddings.
        :param sparse_idf:
            If set to `True`, computes the Inverse Document Frequency (IDF) when using sparse embeddings.
            It is required to use techniques like BM42. It is ignored if `use_sparse_embeddings` is `False`.
        :param similarity:
            The similarity metric to use.
        :param return_embedding:
            Whether to return embeddings in the search results.
        :param progress_bar:
            Whether to show a progress bar or not.
        :param recreate_index:
            Whether to recreate the index.
        :param shard_number:
            Number of shards in the collection.
        :param replication_factor:
            Replication factor for the collection.
            Defines how many copies of each shard will be created. Effective only in distributed mode.
        :param write_consistency_factor:
            Write consistency factor for the collection. Minimum value is 1.
            Defines how many replicas should apply to the operation for it to be considered successful.
            Increasing this number makes the collection more resilient to inconsistencies
            but will cause failures if not enough replicas are available.
            Effective only in distributed mode.
        :param on_disk_payload:
            If `True`, the point's payload will not be stored in memory and
            will be read from the disk every time it is requested.
            This setting saves RAM by slightly increasing response time.
            Note: indexed payload values remain in RAM.
        :param hnsw_config:
            Params for HNSW index.
        :param optimizers_config:
            Params for optimizer.
        :param wal_config:
            Params for Write-Ahead-Log.
        :param quantization_config:
            Params for quantization. If `None`, quantization will be disabled.
        :param init_from:
            Use data stored in another collection to initialize this collection.
        :param wait_result_from_api:
            Whether to wait for the result from the API after each request.
        :param metadata:
            Additional metadata to include with the documents.
        :param write_batch_size:
            The batch size for writing documents.
        :param scroll_size:
            The scroll size for reading documents.
        :param payload_fields_to_index:
            List of payload fields to index.
        """

        self._client = None

        # Store the Qdrant client specific attributes
        self.location = location
        self.url = url
        self.port = port
        self.grpc_port = grpc_port
        self.prefer_grpc = prefer_grpc
        self.https = https
        self.api_key = api_key
        self.prefix = prefix
        self.timeout = timeout
        self.host = host
        self.path = path
        self.force_disable_check_same_thread = force_disable_check_same_thread
        self.metadata = metadata or {}
        self.api_key = api_key

        # Store the Qdrant collection specific attributes
        self.shard_number = shard_number
        self.replication_factor = replication_factor
        self.write_consistency_factor = write_consistency_factor
        self.on_disk_payload = on_disk_payload
        self.hnsw_config = hnsw_config
        self.optimizers_config = optimizers_config
        self.wal_config = wal_config
        self.quantization_config = quantization_config
        self.init_from = init_from
        self.wait_result_from_api = wait_result_from_api
        self.recreate_index = recreate_index
        self.payload_fields_to_index = payload_fields_to_index
        self.use_sparse_embeddings = use_sparse_embeddings
        self.sparse_idf = use_sparse_embeddings and sparse_idf
        self.embedding_dim = embedding_dim
        self.on_disk = on_disk
        self.similarity = similarity
        self.index = index
        self.return_embedding = return_embedding
        self.progress_bar = progress_bar
        self.write_batch_size = write_batch_size
        self.scroll_size = scroll_size

    @property
    def client(self):
        if not self._client:
            self._client = qdrant_client.QdrantClient(
                location=self.location,
                url=self.url,
                port=self.port,
                grpc_port=self.grpc_port,
                prefer_grpc=self.prefer_grpc,
                https=self.https,
                api_key=self.api_key.resolve_value() if self.api_key else None,
                prefix=self.prefix,
                timeout=self.timeout,
                host=self.host,
                path=self.path,
                metadata=self.metadata,
                force_disable_check_same_thread=self.force_disable_check_same_thread,
            )
            # Make sure the collection is properly set up
            self._set_up_collection(
                self.index,
                self.embedding_dim,
                self.recreate_index,
                self.similarity,
                self.use_sparse_embeddings,
                self.sparse_idf,
                self.on_disk,
                self.payload_fields_to_index,
            )
        return self._client

    def count_documents(self) -> int:
        """
        Returns the number of documents present in the Document Store.
        """
        try:
            response = self.client.count(
                collection_name=self.index,
            )
            return response.count
        except (UnexpectedResponse, ValueError):
            # Qdrant local raises ValueError if the collection is not found, but
            # with the remote server UnexpectedResponse is raised. Until that's unified,
            # we need to catch both.
            return 0

    def filter_documents(
        self,
        filters: Optional[Union[Dict[str, Any], rest.Filter]] = None,
    ) -> List[Document]:
        """
        Returns the documents that match the provided filters.

        For a detailed specification of the filters, refer to the
        [documentation](https://docs.haystack.deepset.ai/docs/metadata-filtering)

        :param filters: The filters to apply to the document list.
        :returns: A list of documents that match the given filters.
        """
        if filters and not isinstance(filters, dict) and not isinstance(filters, rest.Filter):
            msg = "Filter must be a dictionary or an instance of `qdrant_client.http.models.Filter`"
            raise ValueError(msg)

        if filters and not isinstance(filters, rest.Filter) and "operator" not in filters:
            msg = "Invalid filter syntax. See https://docs.haystack.deepset.ai/docs/metadata-filtering for details."
            raise ValueError(msg)
        return list(
            self.get_documents_generator(
                filters,
            )
        )

    def write_documents(
        self,
        documents: List[Document],
        policy: DuplicatePolicy = DuplicatePolicy.FAIL,
    ) -> int:
        """
        Writes documents to Qdrant using the specified policy.
        The QdrantDocumentStore can handle duplicate documents based on the given policy.
        The available policies are:
        - `FAIL`: The operation will raise an error if any document already exists.
        - `OVERWRITE`: Existing documents will be overwritten with the new ones.
        - `SKIP`: Existing documents will be skipped, and only new documents will be added.

        :param documents: A list of Document objects to write to Qdrant.
        :param policy: The policy for handling duplicate documents.

        :returns: The number of documents written to the document store.
        """
        for doc in documents:
            if not isinstance(doc, Document):
                msg = f"DocumentStore.write_documents() expects a list of Documents but got an element of {type(doc)}."
                raise ValueError(msg)
        self._set_up_collection(
            self.index, self.embedding_dim, False, self.similarity, self.use_sparse_embeddings, self.sparse_idf
        )

        if len(documents) == 0:
            logger.warning("Calling QdrantDocumentStore.write_documents() with empty list")
            return 0

        document_objects = self._handle_duplicate_documents(
            documents=documents,
            policy=policy,
        )

        batched_documents = get_batches_from_generator(document_objects, self.write_batch_size)
        with tqdm(total=len(document_objects), disable=not self.progress_bar) as progress_bar:
            for document_batch in batched_documents:
                batch = convert_haystack_documents_to_qdrant_points(
                    document_batch,
                    use_sparse_embeddings=self.use_sparse_embeddings,
                )

                self.client.upsert(
                    collection_name=self.index,
                    points=batch,
                    wait=self.wait_result_from_api,
                )

                progress_bar.update(self.write_batch_size)
        return len(document_objects)

    def delete_documents(self, document_ids: List[str]) -> None:
        """
        Deletes documents that match the provided `document_ids` from the document store.

        :param document_ids: the document ids to delete
        """
        ids = [convert_id(_id) for _id in document_ids]
        try:
            self.client.delete(
                collection_name=self.index,
                points_selector=ids,
                wait=self.wait_result_from_api,
            )
        except KeyError:
            logger.warning(
                "Called QdrantDocumentStore.delete_documents() on a non-existing ID",
            )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QdrantDocumentStore":
        """
        Deserializes the component from a dictionary.

        :param data:
            The dictionary to deserialize from.
        :returns:
            The deserialized component.
        """
        deserialize_secrets_inplace(data["init_parameters"], keys=["api_key"])
        return default_from_dict(cls, data)

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        params = inspect.signature(self.__init__).parameters  # type: ignore
        # All the __init__ params must be set as attributes
        # Set as init_parms without default values
        init_params = {k: getattr(self, k) for k in params}
        init_params["api_key"] = self.api_key.to_dict() if self.api_key else None
        return default_to_dict(
            self,
            **init_params,
        )

    def get_documents_generator(
        self,
        filters: Optional[Union[Dict[str, Any], rest.Filter]] = None,
    ) -> Generator[Document, None, None]:
        """
        Returns a generator that yields documents from Qdrant based on the provided filters.

        :param filters: Filters applied to the retrieved documents.
        :returns: A generator that yields documents retrieved from Qdrant.
        """

        index = self.index
        qdrant_filters = convert_filters_to_qdrant(filters)

        next_offset = None
        stop_scrolling = False
        while not stop_scrolling:
            records, next_offset = self.client.scroll(
                collection_name=index,
                scroll_filter=qdrant_filters,
                limit=self.scroll_size,
                offset=next_offset,
                with_payload=True,
                with_vectors=True,
            )
            stop_scrolling = next_offset is None or (
                isinstance(next_offset, grpc.PointId) and next_offset.num == 0 and next_offset.uuid == ""
            )

            for record in records:
                yield convert_qdrant_point_to_haystack_document(
                    record, use_sparse_embeddings=self.use_sparse_embeddings
                )

    def get_documents_by_id(
        self,
        ids: List[str],
    ) -> List[Document]:
        """
        Retrieves documents from Qdrant by their IDs.

        :param ids:
            A list of document IDs to retrieve.
        :param index:
            The name of the index to retrieve documents from.
        :returns:
            A list of documents.
        """
        documents: List[Document] = []

        ids = [convert_id(_id) for _id in ids]
        records = self.client.retrieve(
            collection_name=self.index,
            ids=ids,
            with_payload=True,
            with_vectors=True,
        )

        for record in records:
            documents.append(
                convert_qdrant_point_to_haystack_document(record, use_sparse_embeddings=self.use_sparse_embeddings)
            )
        return documents

    def _query_by_sparse(
        self,
        query_sparse_embedding: SparseEmbedding,
        filters: Optional[Union[Dict[str, Any], rest.Filter]] = None,
        top_k: int = 10,
        scale_score: bool = False,
        return_embedding: bool = False,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ) -> List[Document]:
        """
        Queries Qdrant using a sparse embedding and returns the most relevant documents.

        :param query_sparse_embedding: Sparse embedding of the query.
        :param filters: Filters applied to the retrieved documents.
        :param top_k: Maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents.
        :param return_embedding: Whether to return the embeddings of the retrieved documents.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
             value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :returns: List of documents that are most similar to `query_sparse_embedding`.

        :raises QdrantStoreError:
            If the Document Store was initialized with `use_sparse_embeddings=False`.
        """

        if not self.use_sparse_embeddings:
            message = (
                "You are trying to query using sparse embeddings, but the Document Store "
                "was initialized with `use_sparse_embeddings=False`. "
            )
            raise QdrantStoreError(message)

        qdrant_filters = convert_filters_to_qdrant(filters)
        query_indices = query_sparse_embedding.indices
        query_values = query_sparse_embedding.values
        if group_by:
            groups = self.client.query_points_groups(
                collection_name=self.index,
                query=rest.SparseVector(
                    indices=query_indices,
                    values=query_values,
                ),
                using=SPARSE_VECTORS_NAME,
                query_filter=qdrant_filters,
                limit=top_k,
                group_by=group_by,
                group_size=group_size,
                with_vectors=return_embedding,
                score_threshold=score_threshold,
            ).groups
            results = (
                [
                    convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=self.use_sparse_embeddings)
                    for group in groups
                    for point in group.hits
                ]
                if groups
                else []
            )
        else:
            points = self.client.query_points(
                collection_name=self.index,
                query=rest.SparseVector(
                    indices=query_indices,
                    values=query_values,
                ),
                using=SPARSE_VECTORS_NAME,
                query_filter=qdrant_filters,
                limit=top_k,
                with_vectors=return_embedding,
                score_threshold=score_threshold,
            ).points
            results = [
                convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=self.use_sparse_embeddings)
                for point in points
            ]
        if scale_score:
            for document in results:
                score = document.score
                score = float(1 / (1 + np.exp(-score / 100)))
                document.score = score
        return results

    def _query_by_embedding(
        self,
        query_embedding: List[float],
        filters: Optional[Union[Dict[str, Any], rest.Filter]] = None,
        top_k: int = 10,
        scale_score: bool = False,
        return_embedding: bool = False,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ) -> List[Document]:
        """
        Queries Qdrant using a dense embedding and returns the most relevant documents.

        :param query_embedding: Dense embedding of the query.
        :param filters: Filters applied to the retrieved documents.
        :param top_k: Maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents.
        :param return_embedding: Whether to return the embeddings of the retrieved documents.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
             value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :returns: List of documents that are most similar to `query_embedding`.
        """
        qdrant_filters = convert_filters_to_qdrant(filters)
        if group_by:
            groups = self.client.query_points_groups(
                collection_name=self.index,
                query=query_embedding,
                using=DENSE_VECTORS_NAME if self.use_sparse_embeddings else None,
                query_filter=qdrant_filters,
                limit=top_k,
                group_by=group_by,
                group_size=group_size,
                with_vectors=return_embedding,
                score_threshold=score_threshold,
            ).groups
            results = (
                [
                    convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=self.use_sparse_embeddings)
                    for group in groups
                    for point in group.hits
                ]
                if groups
                else []
            )
        else:
            points = self.client.query_points(
                collection_name=self.index,
                query=query_embedding,
                using=DENSE_VECTORS_NAME if self.use_sparse_embeddings else None,
                query_filter=qdrant_filters,
                limit=top_k,
                with_vectors=return_embedding,
                score_threshold=score_threshold,
            ).points
            results = [
                convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=self.use_sparse_embeddings)
                for point in points
            ]

        if scale_score:
            for document in results:
                score = document.score
                if self.similarity == "cosine":
                    score = (score + 1) / 2
                else:
                    score = float(1 / (1 + np.exp(-score / 100)))
                document.score = score
        return results

    def _query_hybrid(
        self,
        query_embedding: List[float],
        query_sparse_embedding: SparseEmbedding,
        filters: Optional[Union[Dict[str, Any], rest.Filter]] = None,
        top_k: int = 10,
        return_embedding: bool = False,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ) -> List[Document]:
        """
        Retrieves documents based on dense and sparse embeddings and fuses the results using Reciprocal Rank Fusion.

        This method is not part of the public interface of `QdrantDocumentStore` and shouldn't be used directly.
        Use the `QdrantHybridRetriever` instead.

        :param query_embedding: Dense embedding of the query.
        :param query_sparse_embedding: Sparse embedding of the query.
        :param filters: Filters applied to the retrieved documents.
        :param top_k: Maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param return_embedding: Whether to return the embeddings of the retrieved documents.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
             value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :returns: List of Document that are most similar to `query_embedding` and `query_sparse_embedding`.

        :raises QdrantStoreError:
            If the Document Store was initialized with `use_sparse_embeddings=False`.
        """

        # This implementation is based on the code from the Python Qdrant client:
        # https://github.com/qdrant/qdrant-client/blob/8e3ea58f781e4110d11c0a6985b5e6bb66b85d33/qdrant_client/qdrant_fastembed.py#L519
        if not self.use_sparse_embeddings:
            message = (
                "You are trying to query using sparse embeddings, but the Document Store "
                "was initialized with `use_sparse_embeddings=False`. "
            )
            raise QdrantStoreError(message)

        qdrant_filters = convert_filters_to_qdrant(filters)

        try:
            if group_by:
                groups = self.client.query_points_groups(
                    collection_name=self.index,
                    prefetch=[
                        rest.Prefetch(
                            query=rest.SparseVector(
                                indices=query_sparse_embedding.indices,
                                values=query_sparse_embedding.values,
                            ),
                            using=SPARSE_VECTORS_NAME,
                            filter=qdrant_filters,
                        ),
                        rest.Prefetch(
                            query=query_embedding,
                            using=DENSE_VECTORS_NAME,
                            filter=qdrant_filters,
                        ),
                    ],
                    query=rest.FusionQuery(fusion=rest.Fusion.RRF),
                    limit=top_k,
                    group_by=group_by,
                    group_size=group_size,
                    score_threshold=score_threshold,
                    with_payload=True,
                    with_vectors=return_embedding,
                ).groups
            else:
                points = self.client.query_points(
                    collection_name=self.index,
                    prefetch=[
                        rest.Prefetch(
                            query=rest.SparseVector(
                                indices=query_sparse_embedding.indices,
                                values=query_sparse_embedding.values,
                            ),
                            using=SPARSE_VECTORS_NAME,
                            filter=qdrant_filters,
                        ),
                        rest.Prefetch(
                            query=query_embedding,
                            using=DENSE_VECTORS_NAME,
                            filter=qdrant_filters,
                        ),
                    ],
                    query=rest.FusionQuery(fusion=rest.Fusion.RRF),
                    limit=top_k,
                    score_threshold=score_threshold,
                    with_payload=True,
                    with_vectors=return_embedding,
                ).points

        except Exception as e:
            msg = "Error during hybrid search"
            raise QdrantStoreError(msg) from e

        if group_by:
            results = (
                [
                    convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=self.use_sparse_embeddings)
                    for group in groups
                    for point in group.hits
                ]
                if groups
                else []
            )
        else:
            results = [convert_qdrant_point_to_haystack_document(point, use_sparse_embeddings=True) for point in points]

        return results

    def get_distance(self, similarity: str) -> rest.Distance:
        """
        Retrieves the distance metric for the specified similarity measure.

        :param similarity:
            The similarity measure to retrieve the distance.
        :returns:
            The corresponding rest.Distance object.
        :raises QdrantStoreError:
            If the provided similarity measure is not supported.
        """
        try:
            return self.SIMILARITY[similarity]
        except KeyError as ke:
            msg = (
                f"Provided similarity '{similarity}' is not supported by Qdrant "
                f"document store. Please choose one of the options: "
                f"{', '.join(self.SIMILARITY.keys())}"
            )
            raise QdrantStoreError(msg) from ke

    def _create_payload_index(self, collection_name: str, payload_fields_to_index: Optional[List[dict]] = None):
        """
        Create payload index for the collection if payload_fields_to_index is provided
        See: https://qdrant.tech/documentation/concepts/indexing/#payload-index
        """
        if payload_fields_to_index is not None:
            for payload_index in payload_fields_to_index:
                self.client.create_payload_index(
                    collection_name=collection_name,
                    field_name=payload_index["field_name"],
                    field_schema=payload_index["field_schema"],
                )

    def _set_up_collection(
        self,
        collection_name: str,
        embedding_dim: int,
        recreate_collection: bool,
        similarity: str,
        use_sparse_embeddings: bool,
        sparse_idf: bool,
        on_disk: bool = False,
        payload_fields_to_index: Optional[List[dict]] = None,
    ):
        """
        Sets up the Qdrant collection with the specified parameters.
        :param collection_name:
            The name of the collection to set up.
        :param embedding_dim:
            The dimension of the embeddings.
        :param recreate_collection:
            Whether to recreate the collection if it already exists.
        :param similarity:
            The similarity measure to use.
        :param use_sparse_embeddings:
            Whether to use sparse embeddings.
        :param sparse_idf:
            Whether to compute the Inverse Document Frequency (IDF) when using sparse embeddings. Required for BM42.
        :param on_disk:
            Whether to store the collection on disk.
        :param payload_fields_to_index:
            List of payload fields to index.

        :raises QdrantStoreError:
            If the collection exists with incompatible settings.
        :raises ValueError:
            If the collection exists with a different similarity measure or embedding dimension.

        """
        distance = self.get_distance(similarity)

        if recreate_collection or not self.client.collection_exists(collection_name):
            # There is no need to verify the current configuration of that
            # collection. It might be just recreated again or does not exist yet.
            self.recreate_collection(
                collection_name, distance, embedding_dim, on_disk, use_sparse_embeddings, sparse_idf
            )
            # Create Payload index if payload_fields_to_index is provided
            self._create_payload_index(collection_name, payload_fields_to_index)
            return

        collection_info = self.client.get_collection(collection_name)

        has_named_vectors = (
            isinstance(collection_info.config.params.vectors, dict)
            and DENSE_VECTORS_NAME in collection_info.config.params.vectors
        )

        if self.use_sparse_embeddings and not has_named_vectors:
            msg = (
                f"Collection '{collection_name}' already exists in Qdrant, "
                f"but it has been originally created without sparse embedding vectors. "
                f"If you want to use that collection, you can set `use_sparse_embeddings=False`. "
                f"To use sparse embeddings, you need to recreate the collection or migrate the existing one. "
                f"See `migrate_to_sparse_embeddings_support` function in "
                f"`haystack_integrations.document_stores.qdrant`."
            )
            raise QdrantStoreError(msg)

        elif not self.use_sparse_embeddings and has_named_vectors:
            msg = (
                f"Collection '{collection_name}' already exists in Qdrant, "
                f"but it has been originally created with sparse embedding vectors."
                f"If you want to use that collection, please set `use_sparse_embeddings=True`."
            )
            raise QdrantStoreError(msg)

        if self.use_sparse_embeddings:
            current_distance = collection_info.config.params.vectors[DENSE_VECTORS_NAME].distance
            current_vector_size = collection_info.config.params.vectors[DENSE_VECTORS_NAME].size
        else:
            current_distance = collection_info.config.params.vectors.distance
            current_vector_size = collection_info.config.params.vectors.size

        if current_distance != distance:
            msg = (
                f"Collection '{collection_name}' already exists in Qdrant, "
                f"but it is configured with a similarity '{current_distance.name}'. "
                f"If you want to use that collection, but with a different "
                f"similarity, please set `recreate_collection=True` argument."
            )
            raise ValueError(msg)

        if current_vector_size != embedding_dim:
            msg = (
                f"Collection '{collection_name}' already exists in Qdrant, "
                f"but it is configured with a vector size '{current_vector_size}'. "
                f"If you want to use that collection, but with a different "
                f"vector size, please set `recreate_collection=True` argument."
            )
            raise ValueError(msg)

    def recreate_collection(
        self,
        collection_name: str,
        distance,
        embedding_dim: int,
        on_disk: Optional[bool] = None,
        use_sparse_embeddings: Optional[bool] = None,
        sparse_idf: bool = False,
    ):
        """
        Recreates the Qdrant collection with the specified parameters.

        :param collection_name:
            The name of the collection to recreate.
        :param distance:
            The distance metric to use for the collection.
        :param embedding_dim:
            The dimension of the embeddings.
        :param on_disk:
            Whether to store the collection on disk.
        :param use_sparse_embeddings:
            Whether to use sparse embeddings.
        :param sparse_idf:
            Whether to compute the Inverse Document Frequency (IDF) when using sparse embeddings. Required for BM42.
        """
        if on_disk is None:
            on_disk = self.on_disk

        if use_sparse_embeddings is None:
            use_sparse_embeddings = self.use_sparse_embeddings

        # dense vectors configuration
        vectors_config = rest.VectorParams(size=embedding_dim, on_disk=on_disk, distance=distance)

        if use_sparse_embeddings:
            # in this case, we need to define named vectors
            vectors_config = {DENSE_VECTORS_NAME: vectors_config}

            sparse_vectors_config = {
                SPARSE_VECTORS_NAME: rest.SparseVectorParams(
                    index=rest.SparseIndexParams(
                        on_disk=on_disk,
                    ),
                    modifier=rest.Modifier.IDF if sparse_idf else None,
                ),
            }

        if self.client.collection_exists(collection_name):
            self.client.delete_collection(collection_name)

        self.client.create_collection(
            collection_name=collection_name,
            vectors_config=vectors_config,
            sparse_vectors_config=sparse_vectors_config if use_sparse_embeddings else None,
            shard_number=self.shard_number,
            replication_factor=self.replication_factor,
            write_consistency_factor=self.write_consistency_factor,
            on_disk_payload=self.on_disk_payload,
            hnsw_config=self.hnsw_config,
            optimizers_config=self.optimizers_config,
            wal_config=self.wal_config,
            quantization_config=self.quantization_config,
            init_from=self.init_from,
        )

    def _handle_duplicate_documents(
        self,
        documents: List[Document],
        policy: DuplicatePolicy = None,
    ):
        """
        Checks whether any of the passed documents is already existing in the chosen index and returns a list of
        documents that are not in the index yet.

        :param documents: A list of Haystack Document objects.
        :param policy: The duplicate policy to use when writing documents.
        :returns: A list of Haystack Document objects.
        """

        if policy in (DuplicatePolicy.SKIP, DuplicatePolicy.FAIL):
            documents = self._drop_duplicate_documents(documents)
            documents_found = self.get_documents_by_id(ids=[doc.id for doc in documents])
            ids_exist_in_db: List[str] = [doc.id for doc in documents_found]

            if len(ids_exist_in_db) > 0 and policy == DuplicatePolicy.FAIL:
                msg = f"Document with ids '{', '.join(ids_exist_in_db)} already exists in index = '{self.index}'."
                raise DuplicateDocumentError(msg)

            documents = list(filter(lambda doc: doc.id not in ids_exist_in_db, documents))

        return documents

    def _drop_duplicate_documents(self, documents: List[Document]) -> List[Document]:
        """
        Drop duplicate documents based on same hash ID.

        :param documents: A list of Haystack Document objects.
        :returns: A list of Haystack Document objects.
        """
        _hash_ids: Set = set()
        _documents: List[Document] = []

        for document in documents:
            if document.id in _hash_ids:
                logger.info(
                    "Duplicate Documents: Document with id '%s' already exists in index '%s'",
                    document.id,
                    self.index,
                )
                continue
            _documents.append(document)
            _hash_ids.add(document.id)

        return _documents
