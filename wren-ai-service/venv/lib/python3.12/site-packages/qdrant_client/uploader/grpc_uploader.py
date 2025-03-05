import logging
from itertools import count
from typing import Any, Generator, Iterable, Optional, Tuple, Union
from uuid import uuid4

from qdrant_client import grpc as grpc
from qdrant_client.connection import get_channel
from qdrant_client.conversions.conversion import RestToGrpc, payload_to_grpc
from qdrant_client.grpc import PointId, PointsStub, PointStruct
from qdrant_client.http.models import Batch, ShardKeySelector
from qdrant_client.uploader.uploader import BaseUploader


def upload_batch_grpc(
    points_client: PointsStub,
    collection_name: str,
    batch: Union[Batch, Tuple],
    max_retries: int,
    shard_key_selector: Optional[ShardKeySelector],
    wait: bool = False,
) -> bool:
    ids_batch, vectors_batch, payload_batch = batch

    ids_batch = (PointId(uuid=str(uuid4())) for _ in count()) if ids_batch is None else ids_batch
    payload_batch = (None for _ in count()) if payload_batch is None else payload_batch

    points = [
        PointStruct(
            id=RestToGrpc.convert_extended_point_id(idx) if not isinstance(idx, PointId) else idx,
            vectors=RestToGrpc.convert_vector_struct(vector),
            payload=payload_to_grpc(payload or {}),
        )
        for idx, vector, payload in zip(ids_batch, vectors_batch, payload_batch)
    ]

    for attempt in range(max_retries):
        try:
            points_client.Upsert(
                grpc.UpsertPoints(
                    collection_name=collection_name,
                    points=points,
                    wait=wait,
                    shard_key_selector=RestToGrpc.convert_shard_key_selector(shard_key_selector)
                    if shard_key_selector is not None
                    else None,
                )
            )
            break
        except Exception as e:
            logging.warning(f"Batch upload failed {attempt + 1} times. Retrying...")

            if attempt == max_retries - 1:
                raise e
    return True


class GrpcBatchUploader(BaseUploader):
    def __init__(
        self,
        host: str,
        port: int,
        collection_name: str,
        max_retries: int,
        wait: bool = False,
        shard_key_selector: Optional[ShardKeySelector] = None,
        **kwargs: Any,
    ):
        self.collection_name = collection_name
        self._host = host
        self._port = port
        self.max_retries = max_retries
        self._kwargs = kwargs
        self._wait = wait
        self._shard_key_selector = shard_key_selector

    @classmethod
    def start(
        cls,
        collection_name: Optional[str] = None,
        host: str = "localhost",
        port: int = 6334,
        max_retries: int = 3,
        **kwargs: Any,
    ) -> "GrpcBatchUploader":
        if not collection_name:
            raise RuntimeError("Collection name could not be empty")

        return cls(
            host=host,
            port=port,
            collection_name=collection_name,
            max_retries=max_retries,
            **kwargs,
        )

    def process_upload(self, items: Iterable[Any]) -> Generator[bool, None, None]:
        channel = get_channel(host=self._host, port=self._port, **self._kwargs)
        points_client = PointsStub(channel)
        for batch in items:
            yield upload_batch_grpc(
                points_client,
                self.collection_name,
                batch,
                shard_key_selector=self._shard_key_selector,
                max_retries=self.max_retries,
                wait=self._wait,
            )

    def process(self, items: Iterable[Any]) -> Generator[bool, None, None]:
        yield from self.process_upload(items)
