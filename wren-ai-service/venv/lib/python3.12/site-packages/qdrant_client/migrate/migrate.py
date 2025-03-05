import time
from typing import Dict, Iterable, List, Optional

from qdrant_client._pydantic_compat import to_dict
from qdrant_client.client_base import QdrantBase
from qdrant_client.http import models


def upload_with_retry(
    client: QdrantBase,
    collection_name: str,
    points: Iterable[models.PointStruct],
    max_attempts: int = 3,
    pause: float = 3.0,
) -> None:
    attempts = 1
    while attempts <= max_attempts:
        try:
            client.upload_points(
                collection_name=collection_name,
                points=points,
                wait=True,
            )
            return
        except Exception as e:
            print(f"Exception: {e}, attempt {attempts}/{max_attempts}")
            if attempts < max_attempts:
                print(f"Next attempt in {pause} seconds")
                time.sleep(pause)
            attempts += 1

    raise Exception(f"Failed to upload points after {max_attempts} attempts")


def migrate(
    source_client: QdrantBase,
    dest_client: QdrantBase,
    collection_names: Optional[List[str]] = None,
    recreate_on_collision: bool = False,
    batch_size: int = 100,
) -> None:
    """
    Migrate collections from source client to destination client

    Args:
        source_client (QdrantBase): Source client
        dest_client (QdrantBase): Destination client
        collection_names (list[str], optional): List of collection names to migrate.
            If None - migrate all source client collections. Defaults to None.
        recreate_on_collision (bool, optional): If True - recreate collection if it exists, otherwise
            raise ValueError.
        batch_size (int, optional): Batch size for scrolling and uploading vectors. Defaults to 100.
    """
    collection_names = _select_source_collections(source_client, collection_names)
    if any(
        _has_custom_shards(source_client, collection_name) for collection_name in collection_names
    ):
        raise ValueError("Migration of collections with custom shards is not supported yet")

    collisions = _find_collisions(dest_client, collection_names)
    absent_dest_collections = set(collection_names) - set(collisions)

    if collisions and not recreate_on_collision:
        raise ValueError(f"Collections already exist in dest_client: {collisions}")

    for collection_name in absent_dest_collections:
        _recreate_collection(source_client, dest_client, collection_name)
        _migrate_collection(source_client, dest_client, collection_name, batch_size)

    for collection_name in collisions:
        _recreate_collection(source_client, dest_client, collection_name)
        _migrate_collection(source_client, dest_client, collection_name, batch_size)


def _has_custom_shards(source_client: QdrantBase, collection_name: str) -> bool:
    collection_info = source_client.get_collection(collection_name)
    return (
        getattr(collection_info.config.params, "sharding_method", None)
        == models.ShardingMethod.CUSTOM
    )


def _select_source_collections(
    source_client: QdrantBase, collection_names: Optional[List[str]] = None
) -> List[str]:
    source_collections = source_client.get_collections().collections
    source_collection_names = [collection.name for collection in source_collections]

    if collection_names is not None:
        assert all(
            collection_name in source_collection_names for collection_name in collection_names
        ), f"Source client does not have collections: {set(collection_names) - set(source_collection_names)}"
    else:
        collection_names = source_collection_names

    return collection_names


def _find_collisions(dest_client: QdrantBase, collection_names: List[str]) -> List[str]:
    dest_collections = dest_client.get_collections().collections
    dest_collection_names = {collection.name for collection in dest_collections}
    existing_dest_collections = dest_collection_names & set(collection_names)
    return list(existing_dest_collections)


def _recreate_collection(
    source_client: QdrantBase,
    dest_client: QdrantBase,
    collection_name: str,
) -> None:
    src_collection_info = source_client.get_collection(collection_name)
    src_config = src_collection_info.config
    src_payload_schema = src_collection_info.payload_schema
    if dest_client.collection_exists(collection_name):
        dest_client.delete_collection(collection_name)
    dest_client.create_collection(
        collection_name,
        vectors_config=src_config.params.vectors,
        sparse_vectors_config=src_config.params.sparse_vectors,
        shard_number=src_config.params.shard_number,
        replication_factor=src_config.params.replication_factor,
        write_consistency_factor=src_config.params.write_consistency_factor,
        on_disk_payload=src_config.params.on_disk_payload,
        hnsw_config=models.HnswConfigDiff(**to_dict(src_config.hnsw_config)),
        optimizers_config=models.OptimizersConfigDiff(**to_dict(src_config.optimizer_config)),
        wal_config=models.WalConfigDiff(**to_dict(src_config.wal_config)),
        quantization_config=src_config.quantization_config,
    )

    _recreate_payload_schema(dest_client, collection_name, src_payload_schema)


def _recreate_payload_schema(
    dest_client: QdrantBase,
    collection_name: str,
    payload_schema: Dict[str, models.PayloadIndexInfo],
) -> None:
    for field_name, field_info in payload_schema.items():
        dest_client.create_payload_index(
            collection_name,
            field_name=field_name,
            field_schema=field_info.data_type if field_info.params is None else field_info.params,
        )


def _migrate_collection(
    source_client: QdrantBase,
    dest_client: QdrantBase,
    collection_name: str,
    batch_size: int = 100,
) -> None:
    """Migrate collection from source client to destination client

    Args:
        collection_name (str): Collection name
        source_client (QdrantBase): Source client
        dest_client (QdrantBase): Destination client
        batch_size (int, optional): Batch size for scrolling and uploading vectors. Defaults to 100.
    """
    records, next_offset = source_client.scroll(collection_name, limit=2, with_vectors=True)
    upload_with_retry(client=dest_client, collection_name=collection_name, points=records)  # type: ignore
    # upload_records has been deprecated due to the usage of models.Record; models.Record has been deprecated as a
    # structure for uploading due to a `shard_key` field, and now is used only as a result structure.
    # since shard_keys are not supported in migration, we can safely type ignore here and use Records for uploading
    while next_offset is not None:
        records, next_offset = source_client.scroll(
            collection_name, offset=next_offset, limit=batch_size, with_vectors=True
        )
        upload_with_retry(client=dest_client, collection_name=collection_name, points=records)  # type: ignore
    source_client_vectors_count = source_client.count(collection_name).count
    dest_client_vectors_count = dest_client.count(collection_name).count
    assert (
        source_client_vectors_count == dest_client_vectors_count
    ), f"Migration failed, vectors count are not equal: source vector count {source_client_vectors_count}, dest vector count {dest_client_vectors_count}"
