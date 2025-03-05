import logging
from itertools import count
from typing import Any, Generator, Iterable, Optional, Tuple, Union
from uuid import uuid4

import numpy as np

from qdrant_client.http import SyncApis
from qdrant_client.http.models import Batch, PointsList, PointStruct, ShardKeySelector
from qdrant_client.uploader.uploader import BaseUploader


def upload_batch(
    openapi_client: SyncApis,
    collection_name: str,
    batch: Union[Tuple, Batch],
    max_retries: int,
    shard_key_selector: Optional[ShardKeySelector],
    wait: bool = False,
) -> bool:
    ids_batch, vectors_batch, payload_batch = batch

    ids_batch = (str(uuid4()) for _ in count()) if ids_batch is None else ids_batch
    payload_batch = (None for _ in count()) if payload_batch is None else payload_batch

    points = [
        PointStruct(
            id=idx,
            vector=(vector.tolist() if isinstance(vector, np.ndarray) else vector) or {},
            payload=payload,
        )
        for idx, vector, payload in zip(ids_batch, vectors_batch, payload_batch)
    ]

    for attempt in range(max_retries):
        try:
            openapi_client.points_api.upsert_points(
                collection_name=collection_name,
                point_insert_operations=PointsList(points=points, shard_key=shard_key_selector),
                wait=wait,
            )
            break
        except Exception as e:
            logging.warning(f"Batch upload failed {attempt + 1} times. Retrying...")

            if attempt == max_retries - 1:
                raise e
    return True


class RestBatchUploader(BaseUploader):
    def __init__(
        self,
        uri: str,
        collection_name: str,
        max_retries: int,
        wait: bool = False,
        shard_key_selector: Optional[ShardKeySelector] = None,
        **kwargs: Any,
    ):
        self.collection_name = collection_name
        self.openapi_client: SyncApis = SyncApis(host=uri, **kwargs)
        self.max_retries = max_retries
        self._wait = wait
        self._shard_key_selector = shard_key_selector

    @classmethod
    def start(
        cls,
        collection_name: Optional[str] = None,
        uri: str = "http://localhost:6333",
        max_retries: int = 3,
        **kwargs: Any,
    ) -> "RestBatchUploader":
        if not collection_name:
            raise RuntimeError("Collection name could not be empty")
        return cls(uri=uri, collection_name=collection_name, max_retries=max_retries, **kwargs)

    def process(self, items: Iterable[Any]) -> Generator[bool, None, None]:
        for batch in items:
            yield upload_batch(
                self.openapi_client,
                self.collection_name,
                batch,
                shard_key_selector=self._shard_key_selector,
                max_retries=self.max_retries,
                wait=self._wait,
            )
