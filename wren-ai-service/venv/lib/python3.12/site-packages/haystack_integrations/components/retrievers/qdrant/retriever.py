from typing import Any, Dict, List, Optional, Union

from haystack import Document, component, default_from_dict, default_to_dict
from haystack.dataclasses.sparse_embedding import SparseEmbedding
from haystack.document_stores.types import FilterPolicy
from haystack.document_stores.types.filter_policy import apply_filter_policy
from qdrant_client.http import models

from haystack_integrations.document_stores.qdrant import QdrantDocumentStore


@component
class QdrantEmbeddingRetriever:
    """
    A component for retrieving documents from an QdrantDocumentStore using dense vectors.

    Usage example:
    ```python
    from haystack.dataclasses import Document
    from haystack_integrations.components.retrievers.qdrant import QdrantEmbeddingRetriever
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

    document_store = QdrantDocumentStore(
        ":memory:",
        recreate_index=True,
        return_embedding=True,
    )

    document_store.write_documents([Document(content="test", embedding=[0.5]*768)])

    retriever = QdrantEmbeddingRetriever(document_store=document_store)

    # using a fake vector to keep the example simple
    retriever.run(query_embedding=[0.1]*768)
    ```
    """

    def __init__(
        self,
        document_store: QdrantDocumentStore,
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: int = 10,
        scale_score: bool = False,
        return_embedding: bool = False,
        filter_policy: Union[str, FilterPolicy] = FilterPolicy.REPLACE,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Create a QdrantEmbeddingRetriever component.

        :param document_store: An instance of QdrantDocumentStore.
        :param filters: A dictionary with filters to narrow down the search space.
        :param top_k: The maximum number of documents to retrieve. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents or not.
        :param return_embedding: Whether to return the embedding of the retrieved Documents.
        :param filter_policy: Policy to determine how filters are applied.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the `similarity` function specified in the Document Store.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
            value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :raises ValueError: If `document_store` is not an instance of `QdrantDocumentStore`.
        """

        if not isinstance(document_store, QdrantDocumentStore):
            msg = "document_store must be an instance of QdrantDocumentStore"
            raise ValueError(msg)

        self._document_store = document_store
        self._filters = filters
        self._top_k = top_k
        self._scale_score = scale_score
        self._return_embedding = return_embedding
        self._filter_policy = (
            filter_policy if isinstance(filter_policy, FilterPolicy) else FilterPolicy.from_str(filter_policy)
        )
        self._score_threshold = score_threshold
        self._group_by = group_by
        self._group_size = group_size

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        d = default_to_dict(
            self,
            document_store=self._document_store,
            filters=self._filters,
            top_k=self._top_k,
            filter_policy=self._filter_policy.value,
            scale_score=self._scale_score,
            return_embedding=self._return_embedding,
            score_threshold=self._score_threshold,
            group_by=self._group_by,
            group_size=self._group_size,
        )
        d["init_parameters"]["document_store"] = self._document_store.to_dict()

        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QdrantEmbeddingRetriever":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.
        :returns:
            Deserialized component.
        """
        document_store = QdrantDocumentStore.from_dict(data["init_parameters"]["document_store"])
        data["init_parameters"]["document_store"] = document_store
        # Pipelines serialized with old versions of the component might not
        # have the filter_policy field.
        if filter_policy := data["init_parameters"].get("filter_policy"):
            data["init_parameters"]["filter_policy"] = FilterPolicy.from_str(filter_policy)
        return default_from_dict(cls, data)

    @component.output_types(documents=List[Document])
    def run(
        self,
        query_embedding: List[float],
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Run the Embedding Retriever on the given input data.

        :param query_embedding: Embedding of the query.
        :param filters: A dictionary with filters to narrow down the search space.
        :param top_k: The maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents or not.
        :param return_embedding: Whether to return the embedding of the retrieved Documents.
        :param score_threshold: A minimal score threshold for the result.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
            value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.
        :returns:
            The retrieved documents.

        """
        filters = apply_filter_policy(self._filter_policy, self._filters, filters)

        docs = self._document_store._query_by_embedding(
            query_embedding=query_embedding,
            filters=filters,
            top_k=top_k or self._top_k,
            scale_score=scale_score or self._scale_score,
            return_embedding=return_embedding or self._return_embedding,
            score_threshold=score_threshold or self._score_threshold,
            group_by=group_by or self._group_by,
            group_size=group_size or self._group_size,
        )

        return {"documents": docs}


@component
class QdrantSparseEmbeddingRetriever:
    """
    A component for retrieving documents from an QdrantDocumentStore using sparse vectors.

    Usage example:
    ```python
    from haystack_integrations.components.retrievers.qdrant import QdrantSparseEmbeddingRetriever
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore
    from haystack.dataclasses import Document, SparseEmbedding

    document_store = QdrantDocumentStore(
        ":memory:",
        use_sparse_embeddings=True,
        recreate_index=True,
        return_embedding=True,
    )

    doc = Document(content="test", sparse_embedding=SparseEmbedding(indices=[0, 3, 5], values=[0.1, 0.5, 0.12]))
    document_store.write_documents([doc])

    retriever = QdrantSparseEmbeddingRetriever(document_store=document_store)
    sparse_embedding = SparseEmbedding(indices=[0, 1, 2, 3], values=[0.1, 0.8, 0.05, 0.33])
    retriever.run(query_sparse_embedding=sparse_embedding)
    ```
    """

    def __init__(
        self,
        document_store: QdrantDocumentStore,
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: int = 10,
        scale_score: bool = False,
        return_embedding: bool = False,
        filter_policy: Union[str, FilterPolicy] = FilterPolicy.REPLACE,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Create a QdrantSparseEmbeddingRetriever component.

        :param document_store: An instance of QdrantDocumentStore.
        :param filters: A dictionary with filters to narrow down the search space.
        :param top_k: The maximum number of documents to retrieve. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents or not.
        :param return_embedding: Whether to return the sparse embedding of the retrieved Documents.
        :param filter_policy: Policy to determine how filters are applied. Defaults to "replace".
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
            value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :raises ValueError: If `document_store` is not an instance of `QdrantDocumentStore`.
        """

        if not isinstance(document_store, QdrantDocumentStore):
            msg = "document_store must be an instance of QdrantDocumentStore"
            raise ValueError(msg)

        self._document_store = document_store
        self._filters = filters
        self._top_k = top_k
        self._scale_score = scale_score
        self._return_embedding = return_embedding
        self._filter_policy = (
            filter_policy if isinstance(filter_policy, FilterPolicy) else FilterPolicy.from_str(filter_policy)
        )
        self._score_threshold = score_threshold
        self._group_by = group_by
        self._group_size = group_size

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        d = default_to_dict(
            self,
            document_store=self._document_store,
            filters=self._filters,
            top_k=self._top_k,
            scale_score=self._scale_score,
            filter_policy=self._filter_policy.value,
            return_embedding=self._return_embedding,
            score_threshold=self._score_threshold,
            group_by=self._group_by,
            group_size=self._group_size,
        )
        d["init_parameters"]["document_store"] = self._document_store.to_dict()

        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QdrantSparseEmbeddingRetriever":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.
        :returns:
            Deserialized component.
        """
        document_store = QdrantDocumentStore.from_dict(data["init_parameters"]["document_store"])
        data["init_parameters"]["document_store"] = document_store
        # Pipelines serialized with old versions of the component might not
        # have the filter_policy field.
        if filter_policy := data["init_parameters"].get("filter_policy"):
            data["init_parameters"]["filter_policy"] = FilterPolicy.from_str(filter_policy)
        return default_from_dict(cls, data)

    @component.output_types(documents=List[Document])
    def run(
        self,
        query_sparse_embedding: SparseEmbedding,
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: Optional[int] = None,
        scale_score: Optional[bool] = None,
        return_embedding: Optional[bool] = None,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Run the Sparse Embedding Retriever on the given input data.

        :param query_sparse_embedding: Sparse Embedding of the query.
        :param filters: Filters applied to the retrieved Documents. The way runtime filters are applied depends on
                        the `filter_policy` chosen at retriever initialization. See init method docstring for more
                        details.
        :param top_k: The maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param scale_score: Whether to scale the scores of the retrieved documents or not.
        :param return_embedding: Whether to return the embedding of the retrieved Documents.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
            value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.
        :returns:
            The retrieved documents.

        """
        filters = apply_filter_policy(self._filter_policy, self._filters, filters)

        docs = self._document_store._query_by_sparse(
            query_sparse_embedding=query_sparse_embedding,
            filters=filters,
            top_k=top_k or self._top_k,
            scale_score=scale_score or self._scale_score,
            return_embedding=return_embedding or self._return_embedding,
            score_threshold=score_threshold or self._score_threshold,
            group_by=group_by or self._group_by,
            group_size=group_size or self._group_size,
        )

        return {"documents": docs}


@component
class QdrantHybridRetriever:
    """
    A component for retrieving documents from an QdrantDocumentStore using both dense and sparse vectors
    and fusing the results using Reciprocal Rank Fusion.

    Usage example:
    ```python
    from haystack_integrations.components.retrievers.qdrant import QdrantHybridRetriever
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore
    from haystack.dataclasses import Document, SparseEmbedding

    document_store = QdrantDocumentStore(
        ":memory:",
        use_sparse_embeddings=True,
        recreate_index=True,
        return_embedding=True,
        wait_result_from_api=True,
    )

    doc = Document(content="test",
                   embedding=[0.5]*768,
                   sparse_embedding=SparseEmbedding(indices=[0, 3, 5], values=[0.1, 0.5, 0.12]))

    document_store.write_documents([doc])

    retriever = QdrantHybridRetriever(document_store=document_store)
    embedding = [0.1]*768
    sparse_embedding = SparseEmbedding(indices=[0, 1, 2, 3], values=[0.1, 0.8, 0.05, 0.33])
    retriever.run(query_embedding=embedding, query_sparse_embedding=sparse_embedding)
    ```
    """

    def __init__(
        self,
        document_store: QdrantDocumentStore,
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: int = 10,
        return_embedding: bool = False,
        filter_policy: Union[str, FilterPolicy] = FilterPolicy.REPLACE,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Create a QdrantHybridRetriever component.

        :param document_store: An instance of QdrantDocumentStore.
        :param filters: A dictionary with filters to narrow down the search space.
        :param top_k: The maximum number of documents to retrieve. If using `group_by` parameters, maximum number of
             groups to return.
        :param return_embedding: Whether to return the embeddings of the retrieved Documents.
        :param filter_policy: Policy to determine how filters are applied.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
             value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.

        :raises ValueError: If 'document_store' is not an instance of QdrantDocumentStore.
        """

        if not isinstance(document_store, QdrantDocumentStore):
            msg = "document_store must be an instance of QdrantDocumentStore"
            raise ValueError(msg)

        self._document_store = document_store
        self._filters = filters
        self._top_k = top_k
        self._return_embedding = return_embedding
        self._filter_policy = (
            filter_policy if isinstance(filter_policy, FilterPolicy) else FilterPolicy.from_str(filter_policy)
        )
        self._score_threshold = score_threshold
        self._group_by = group_by
        self._group_size = group_size

    def to_dict(self) -> Dict[str, Any]:
        """
        Serializes the component to a dictionary.

        :returns:
            Dictionary with serialized data.
        """
        return default_to_dict(
            self,
            document_store=self._document_store.to_dict(),
            filters=self._filters,
            top_k=self._top_k,
            filter_policy=self._filter_policy.value,
            return_embedding=self._return_embedding,
            score_threshold=self._score_threshold,
            group_by=self._group_by,
            group_size=self._group_size,
        )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QdrantHybridRetriever":
        """
        Deserializes the component from a dictionary.

        :param data:
            Dictionary to deserialize from.
        :returns:
            Deserialized component.
        """
        document_store = QdrantDocumentStore.from_dict(data["init_parameters"]["document_store"])
        data["init_parameters"]["document_store"] = document_store
        # Pipelines serialized with old versions of the component might not
        # have the filter_policy field.
        if filter_policy := data["init_parameters"].get("filter_policy"):
            data["init_parameters"]["filter_policy"] = FilterPolicy.from_str(filter_policy)
        return default_from_dict(cls, data)

    @component.output_types(documents=List[Document])
    def run(
        self,
        query_embedding: List[float],
        query_sparse_embedding: SparseEmbedding,
        filters: Optional[Union[Dict[str, Any], models.Filter]] = None,
        top_k: Optional[int] = None,
        return_embedding: Optional[bool] = None,
        score_threshold: Optional[float] = None,
        group_by: Optional[str] = None,
        group_size: Optional[int] = None,
    ):
        """
        Run the Sparse Embedding Retriever on the given input data.

        :param query_embedding: Dense embedding of the query.
        :param query_sparse_embedding: Sparse embedding of the query.
        :param filters: Filters applied to the retrieved Documents. The way runtime filters are applied depends on
                        the `filter_policy` chosen at retriever initialization. See init method docstring for more
                        details.
        :param top_k: The maximum number of documents to return. If using `group_by` parameters, maximum number of
             groups to return.
        :param return_embedding: Whether to return the embedding of the retrieved Documents.
        :param score_threshold: A minimal score threshold for the result.
            Score of the returned result might be higher or smaller than the threshold
             depending on the Distance function used.
            E.g. for cosine similarity only higher scores will be returned.
        :param group_by: Payload field to group by, must be a string or number field. If the field contains more than 1
             value, all values will be used for grouping. One point can be in multiple groups.
        :param group_size: Maximum amount of points to return per group. Default is 3.
        :returns:
            The retrieved documents.

        """
        filters = apply_filter_policy(self._filter_policy, self._filters, filters)

        docs = self._document_store._query_hybrid(
            query_embedding=query_embedding,
            query_sparse_embedding=query_sparse_embedding,
            filters=filters,
            top_k=top_k or self._top_k,
            return_embedding=return_embedding or self._return_embedding,
            score_threshold=score_threshold or self._score_threshold,
            group_by=group_by or self._group_by,
            group_size=group_size or self._group_size,
        )

        return {"documents": docs}
