import logging
import os
from typing import Any, Dict, List, Optional

import numpy as np
import qdrant_client
from haystack import Document, component
from haystack.document_stores.types import DuplicatePolicy
from haystack.utils import Secret
from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever
from haystack_integrations.document_stores.qdrant import (
    QdrantDocumentStore,
    document_store,
)
from haystack_integrations.document_stores.qdrant.converters import (
    DENSE_VECTORS_NAME,
    SPARSE_VECTORS_NAME,
    convert_id,
    convert_qdrant_point_to_haystack_document,
)
from haystack_integrations.document_stores.qdrant.filters import (
    convert_filters_to_qdrant,
)
from qdrant_client.http import models as rest
from tqdm import tqdm

from src.core.provider import DocumentStoreProvider
from src.providers.loader import provider

logger = logging.getLogger("wren-ai-service")


def convert_haystack_documents_to_qdrant_points(
    documents: List[Document],
    *,
    use_sparse_embeddings: bool,
) -> List[rest.PointStruct]:
    points = []
    for document in documents:
        payload = document.to_dict(flatten=True)
        if use_sparse_embeddings:
            vector = {}

            dense_vector = payload.pop("embedding", None)
            if dense_vector is not None:
                vector[DENSE_VECTORS_NAME] = dense_vector

            sparse_vector = payload.pop("sparse_embedding", None)
            if sparse_vector is not None:
                sparse_vector_instance = rest.SparseVector(**sparse_vector)
                vector[SPARSE_VECTORS_NAME] = sparse_vector_instance

        else:
            vector = payload.pop("embedding") or {}
        _id = convert_id(payload.get("id"))

        point = rest.PointStruct(
            payload=payload,
            vector=vector,
            id=_id,
        )
        points.append(point)
    return points


class AsyncQdrantDocumentStore(QdrantDocumentStore):
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
        super(AsyncQdrantDocumentStore, self).__init__(
            location=location,
            url=url,
            port=port,
            grpc_port=grpc_port,
            prefer_grpc=prefer_grpc,
            https=https,
            api_key=api_key,
            prefix=prefix,
            timeout=timeout,
            host=host,
            path=path,
            force_disable_check_same_thread=force_disable_check_same_thread,
            index=index,
            embedding_dim=embedding_dim,
            on_disk=on_disk,
            use_sparse_embeddings=use_sparse_embeddings,
            sparse_idf=sparse_idf,
            similarity=similarity,
            return_embedding=return_embedding,
            progress_bar=progress_bar,
            recreate_index=recreate_index,
            shard_number=shard_number,
            replication_factor=replication_factor,
            write_consistency_factor=write_consistency_factor,
            on_disk_payload=on_disk_payload,
            hnsw_config=hnsw_config,
            optimizers_config=optimizers_config,
            wal_config=wal_config,
            quantization_config=quantization_config,
            init_from=init_from,
            wait_result_from_api=wait_result_from_api,
            metadata=metadata,
            write_batch_size=write_batch_size,
            scroll_size=scroll_size,
            payload_fields_to_index=payload_fields_to_index,
        )

        self.async_client = qdrant_client.AsyncQdrantClient(
            location=location,
            url=url,
            port=port,
            grpc_port=grpc_port,
            prefer_grpc=prefer_grpc,
            https=https,
            api_key=api_key.resolve_value() if api_key else None,
            prefix=prefix,
            timeout=timeout,
            host=host,
            path=path,
            force_disable_check_same_thread=force_disable_check_same_thread,
            metadata=metadata or {},
        )

        # to improve the indexing performance
        # see https://qdrant.tech/documentation/guides/multiple-partitions/?q=mul#calibrate-performance
        self.client.create_payload_index(
            collection_name=index, field_name="id", field_schema="keyword"
        )

    async def _query_by_embedding(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ) -> List[Document]:
        qdrant_filters = convert_filters_to_qdrant(filters)

        points = await self.async_client.search(
            collection_name=self.index,
            query_vector=rest.NamedVector(
                name=DENSE_VECTORS_NAME if self.use_sparse_embeddings else "",
                vector=query_embedding,
            ),
            search_params=(
                rest.SearchParams(
                    quantization=rest.QuantizationSearchParams(
                        rescore=True,
                        oversampling=3.0,
                    ),
                )
                if len(query_embedding)
                >= 1024  # reference: https://qdrant.tech/articles/binary-quantization/#when-should-you-not-use-bq
                else None
            ),
            query_filter=qdrant_filters,
            limit=top_k,
            with_vectors=return_embedding,
        )
        results = [
            convert_qdrant_point_to_haystack_document(
                point, use_sparse_embeddings=self.use_sparse_embeddings
            )
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

    async def delete_documents(self, filters: Optional[Dict[str, Any]] = None):
        if not filters:
            qdrant_filters = rest.Filter()
        else:
            qdrant_filters = convert_filters_to_qdrant(filters)

        try:
            await self.async_client.delete(
                collection_name=self.index,
                points_selector=qdrant_filters,
                wait=self.wait_result_from_api,
            )
        except KeyError:
            logger.warning(
                "Called QdrantDocumentStore.delete_documents() on a non-existing ID",
            )

    async def count_documents(self, filters: Optional[Dict[str, Any]] = None) -> int:
        if not filters:
            qdrant_filters = rest.Filter()
        else:
            qdrant_filters = convert_filters_to_qdrant(filters)

        return (
            await self.async_client.count(
                collection_name=self.index, count_filter=qdrant_filters
            )
        ).count

    async def write_documents(
        self, documents: List[Document], policy: DuplicatePolicy = DuplicatePolicy.FAIL
    ):
        for doc in documents:
            if not isinstance(doc, Document):
                msg = f"DocumentStore.write_documents() expects a list of Documents but got an element of {type(doc)}."
                raise ValueError(msg)

        self._set_up_collection(
            self.index,
            self.embedding_dim,
            False,
            self.similarity,
            self.use_sparse_embeddings,
            self.sparse_idf,
            self.on_disk,
            self.payload_fields_to_index,
        )

        if len(documents) == 0:
            logger.warning(
                "Calling QdrantDocumentStore.write_documents() with empty list"
            )
            return

        document_objects = self._handle_duplicate_documents(
            documents=documents,
            policy=policy,
        )

        batched_documents = document_store.get_batches_from_generator(
            document_objects, self.write_batch_size
        )
        with tqdm(
            total=len(document_objects), disable=not self.progress_bar
        ) as progress_bar:
            for document_batch in batched_documents:
                batch = convert_haystack_documents_to_qdrant_points(
                    document_batch,
                    use_sparse_embeddings=self.use_sparse_embeddings,
                )

                await self.async_client.upsert(
                    collection_name=self.index,
                    points=batch,
                    wait=self.wait_result_from_api,
                )

                progress_bar.update(self.write_batch_size)
        return len(document_objects)


class AsyncQdrantEmbeddingRetriever(QdrantEmbeddingRetriever):
    def __init__(
        self,
        document_store: AsyncQdrantDocumentStore,
        filters: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        scale_score: bool = True,
        return_embedding: bool = False,
    ):
        super(AsyncQdrantEmbeddingRetriever, self).__init__(
            document_store=document_store,
            filters=filters,
            top_k=top_k,
            scale_score=scale_score,
            return_embedding=return_embedding,
        )

    @component.output_types(documents=List[Document])
    async def run(
        self,
        query_embedding: List[float],
        filters: Optional[Dict[str, Any]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
    ):
        docs = await self._document_store._query_by_embedding(
            query_embedding=query_embedding,
            filters=filters or self._filters,
            top_k=top_k or self._top_k,
            scale_score=scale_score or self._scale_score,
            return_embedding=return_embedding or self._return_embedding,
        )

        return {"documents": docs}


@provider("qdrant")
class QdrantProvider(DocumentStoreProvider):
    def __init__(
        self,
        location: str = os.getenv("QDRANT_HOST", "qdrant"),
        api_key: Optional[str] = os.getenv("QDRANT_API_KEY", None),
        timeout: Optional[int] = (
            int(os.getenv("QDRANT_TIMEOUT")) if os.getenv("QDRANT_TIMEOUT") else 120
        ),
        embedding_model_dim: int = (
            int(os.getenv("EMBEDDING_MODEL_DIMENSION"))
            if os.getenv("EMBEDDING_MODEL_DIMENSION")
            else 0
        ),
        recreate_index: bool = (
            bool(os.getenv("SHOULD_FORCE_DEPLOY"))
            if os.getenv("SHOULD_FORCE_DEPLOY")
            else False
        ),
        **_,
    ):
        self._location = location
        self._api_key = Secret.from_token(api_key) if api_key else None
        self._timeout = timeout
        self._embedding_model_dim = embedding_model_dim
        self._reset_document_store(recreate_index)

    def _reset_document_store(self, recreate_index: bool):
        self.get_store(recreate_index=recreate_index)
        self.get_store(dataset_name="table_descriptions", recreate_index=recreate_index)
        self.get_store(dataset_name="view_questions", recreate_index=recreate_index)

    def get_store(
        self,
        dataset_name: Optional[str] = None,
        recreate_index: bool = False,
    ):
        logger.info(
            f"Using Qdrant Document Store with Embedding Model Dimension: {self._embedding_model_dim}"
        )

        return AsyncQdrantDocumentStore(
            location=self._location,
            api_key=self._api_key,
            embedding_dim=self._embedding_model_dim,
            index=dataset_name or "Document",
            recreate_index=recreate_index,
            on_disk=True,
            timeout=self._timeout,
            quantization_config=(
                rest.BinaryQuantization(
                    binary=rest.BinaryQuantizationConfig(
                        always_ram=True,
                    )
                )
                if self._embedding_model_dim >= 1024
                else None
            ),
            # to improve the indexing performance, we disable building global index for the whole collection
            # see https://qdrant.tech/documentation/guides/multiple-partitions/?q=mul#calibrate-performance
            hnsw_config=rest.HnswConfigDiff(
                payload_m=16,
                m=0,
            ),
        )

    def get_retriever(
        self,
        document_store: AsyncQdrantDocumentStore,
        top_k: int = 10,
    ):
        return AsyncQdrantEmbeddingRetriever(
            document_store=document_store,
            top_k=top_k,
        )
