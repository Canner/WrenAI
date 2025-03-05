import logging
import time

from qdrant_client.http import models

from haystack_integrations.document_stores.qdrant import QdrantDocumentStore

logger = logging.getLogger(__name__)
logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)


def migrate_to_sparse_embeddings_support(old_document_store: QdrantDocumentStore, new_index: str):
    """
    Utility function to migrate an existing `QdrantDocumentStore` to a new one with support for sparse embeddings.

    With qdrant-hasytack v3.3.0, support for sparse embeddings has been added to `QdrantDocumentStore`.
    This feature is disabled by default and can be enabled by setting `use_sparse_embeddings=True` in the init
    parameters. To store sparse embeddings, Document stores/collections created with this feature disabled must be
    migrated to a new collection with the feature enabled.

    This utility function applies to on-premise and cloud instances of Qdrant.
    It does not work for local in-memory/disk-persisted instances.

    The utility function merely migrates the existing documents so that they are ready to store sparse embeddings.
    It does not compute sparse embeddings. To do this, you need to use a Sparse Embedder component.

    Example usage:
    ```python
    from haystack_integrations.document_stores.qdrant import QdrantDocumentStore
    from haystack_integrations.document_stores.qdrant import migrate_to_sparse_embeddings_support

    old_document_store = QdrantDocumentStore(url="http://localhost:6333",
                                             index="Document",
                                             use_sparse_embeddings=False)
    new_index = "Document_sparse"

    migrate_to_sparse_embeddings_support(old_document_store, new_index)

    # now you can use the new document store with sparse embeddings support
    new_document_store = QdrantDocumentStore(url="http://localhost:6333",
                                             index=new_index,
                                             use_sparse_embeddings=True)
    ```


    :param old_document_store: The existing QdrantDocumentStore instance to migrate from.
    :param new_index: The name of the new index/collection to create with sparse embeddings support.
    """

    start = time.time()

    old_collection_name = old_document_store.index
    total_points = old_document_store.count_documents()

    # copy the init parameters of the old document to create a new document store
    init_parameters = old_document_store.to_dict()["init_parameters"]
    init_parameters["index"] = new_index
    init_parameters["use_sparse_embeddings"] = True
    init_parameters["recreate_index"] = True

    new_document_store = QdrantDocumentStore(**init_parameters)

    client = new_document_store.client

    original_indexing_threshold = client.get_collection(
        collection_name=new_index
    ).config.optimizer_config.indexing_threshold

    # disable indexing while adding points so it's faster
    # https://qdrant.tech/documentation/concepts/collections/#update-collection-parameters
    client.update_collection(
        collection_name=new_index,
        optimizer_config=models.OptimizersConfigDiff(indexing_threshold=0),
    )

    # migration loop
    next_page_offset = "first"
    offset = None
    points_transmitted = 0

    while next_page_offset:
        if next_page_offset != "first":
            offset = next_page_offset

        # get the records
        records = client.scroll(
            collection_name=old_collection_name,
            limit=100,
            with_payload=True,
            with_vectors=True,
            offset=offset,
        )

        next_page_offset = records[1]
        current_records = records[0]

        points = []

        for record in current_records:
            vector = {}

            vector["text-dense"] = record.vector

            point = {"id": record.id, "payload": record.payload, "vector": vector}

            embedding_point = models.PointStruct(**point)
            points.append(embedding_point)

        client.upsert(collection_name=new_index, points=points)

        points_transmitted += len(points)
        points_remaining = total_points - points_transmitted

        message = (
            f"Points transmitted: {points_transmitted}/{total_points}\n"
            f"Percent done {points_transmitted/total_points*100:.2f}%\n"
            f"Time elapsed: {time.time() - start:.2f} seconds\n"
            f"Time remaining: {(((time.time() - start) / points_transmitted) * points_remaining) / 60:.2f} minutes\n"
            f"Current offset: {next_page_offset}\n"
        )
        logger.info(message)

    # restore the original indexing threshold (re-enable indexing)
    client.update_collection(
        collection_name=new_index,
        optimizer_config=models.OptimizersConfigDiff(indexing_threshold=original_indexing_threshold),
    )
