# flake8: noqa E501
from typing import IO, TYPE_CHECKING, Any, Dict, Set, TypeVar, Union

from pydantic import BaseModel
from pydantic.main import BaseModel
from pydantic.version import VERSION as PYDANTIC_VERSION
from qdrant_client.http.models import *
from qdrant_client.http.models import models as m

PYDANTIC_V2 = PYDANTIC_VERSION.startswith("2.")
Model = TypeVar("Model", bound="BaseModel")

SetIntStr = Set[Union[int, str]]
DictIntStrAny = Dict[Union[int, str], Any]
file = None


def to_json(model: BaseModel, *args: Any, **kwargs: Any) -> str:
    if PYDANTIC_V2:
        return model.model_dump_json(*args, **kwargs)
    else:
        return model.json(*args, **kwargs)


def jsonable_encoder(
    obj: Any,
    include: Union[SetIntStr, DictIntStrAny] = None,
    exclude=None,
    by_alias: bool = True,
    skip_defaults: bool = None,
    exclude_unset: bool = True,
    exclude_none: bool = True,
):
    if hasattr(obj, "json") or hasattr(obj, "model_dump_json"):
        return to_json(
            obj,
            include=include,
            exclude=exclude,
            by_alias=by_alias,
            exclude_unset=bool(exclude_unset or skip_defaults),
            exclude_none=exclude_none,
        )

    return obj


if TYPE_CHECKING:
    from qdrant_client.http.api_client import ApiClient


class _SnapshotsApi:
    def __init__(self, api_client: "Union[ApiClient, AsyncApiClient]"):
        self.api_client = api_client

    def _build_for_create_full_snapshot(
        self,
        wait: bool = None,
    ):
        """
        Create new snapshot of the whole storage
        """
        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20011,
            method="POST",
            url="/snapshots",
            headers=headers if headers else None,
            params=query_params,
        )

    def _build_for_create_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
    ):
        """
        Create new snapshot of a shard for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20011,
            method="POST",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_create_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
    ):
        """
        Create new snapshot for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20011,
            method="POST",
            url="/collections/{collection_name}/snapshots",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_delete_full_snapshot(
        self,
        snapshot_name: str,
        wait: bool = None,
    ):
        """
        Delete snapshot of the whole storage
        """
        path_params = {
            "snapshot_name": str(snapshot_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="DELETE",
            url="/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_delete_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
        wait: bool = None,
    ):
        """
        Delete snapshot of a shard for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
            "snapshot_name": str(snapshot_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="DELETE",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_delete_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
        wait: bool = None,
    ):
        """
        Delete snapshot for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
            "snapshot_name": str(snapshot_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="DELETE",
            url="/collections/{collection_name}/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_get_full_snapshot(
        self,
        snapshot_name: str,
    ):
        """
        Download specified snapshot of the whole storage as a file
        """
        path_params = {
            "snapshot_name": str(snapshot_name),
        }

        headers = {}
        return self.api_client.request(
            type_=file,
            method="GET",
            url="/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_get_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
    ):
        """
        Download specified snapshot of a shard from a collection as a file
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
            "snapshot_name": str(snapshot_name),
        }

        headers = {}
        return self.api_client.request(
            type_=file,
            method="GET",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_get_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
    ):
        """
        Download specified snapshot from a collection as a file
        """
        path_params = {
            "collection_name": str(collection_name),
            "snapshot_name": str(snapshot_name),
        }

        headers = {}
        return self.api_client.request(
            type_=file,
            method="GET",
            url="/collections/{collection_name}/snapshots/{snapshot_name}",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_list_full_snapshots(
        self,
    ):
        """
        Get list of snapshots of the whole storage
        """
        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20010,
            method="GET",
            url="/snapshots",
            headers=headers if headers else None,
        )

    def _build_for_list_shard_snapshots(
        self,
        collection_name: str,
        shard_id: int,
    ):
        """
        Get list of snapshots for a shard of a collection
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20010,
            method="GET",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_list_snapshots(
        self,
        collection_name: str,
    ):
        """
        Get list of snapshots for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20010,
            method="GET",
            url="/collections/{collection_name}/snapshots",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_recover_from_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        snapshot_recover: m.SnapshotRecover = None,
    ):
        """
        Recover local collection data from a snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        body = jsonable_encoder(snapshot_recover)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="PUT",
            url="/collections/{collection_name}/snapshots/recover",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_recover_from_uploaded_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ):
        """
        Recover local collection data from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()
        if priority is not None:
            query_params["priority"] = str(priority)
        if checksum is not None:
            query_params["checksum"] = str(checksum)

        headers = {}
        files: Dict[str, IO[Any]] = {}  # noqa F841
        data: Dict[str, Any] = {}  # noqa F841
        if snapshot is not None:
            files["snapshot"] = snapshot

        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/collections/{collection_name}/snapshots/upload",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            data=data,
            files=files,
        )

    def _build_for_recover_shard_from_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        shard_snapshot_recover: m.ShardSnapshotRecover = None,
    ):
        """
        Recover shard of a local collection data from a snapshot. This will overwrite any data, stored in this shard, for the collection.
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()

        headers = {}
        body = jsonable_encoder(shard_snapshot_recover)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="PUT",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots/recover",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_recover_shard_from_uploaded_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ):
        """
        Recover shard of a local collection from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection shard.
        """
        path_params = {
            "collection_name": str(collection_name),
            "shard_id": str(shard_id),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()
        if priority is not None:
            query_params["priority"] = str(priority)
        if checksum is not None:
            query_params["checksum"] = str(checksum)

        headers = {}
        files: Dict[str, IO[Any]] = {}  # noqa F841
        data: Dict[str, Any] = {}  # noqa F841
        if snapshot is not None:
            files["snapshot"] = snapshot

        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/collections/{collection_name}/shards/{shard_id}/snapshots/upload",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            data=data,
            files=files,
        )


class AsyncSnapshotsApi(_SnapshotsApi):
    async def create_full_snapshot(
        self,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot of the whole storage
        """
        return await self._build_for_create_full_snapshot(
            wait=wait,
        )

    async def create_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot of a shard for a collection
        """
        return await self._build_for_create_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
        )

    async def create_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot for a collection
        """
        return await self._build_for_create_snapshot(
            collection_name=collection_name,
            wait=wait,
        )

    async def delete_full_snapshot(
        self,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot of the whole storage
        """
        return await self._build_for_delete_full_snapshot(
            snapshot_name=snapshot_name,
            wait=wait,
        )

    async def delete_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot of a shard for a collection
        """
        return await self._build_for_delete_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            snapshot_name=snapshot_name,
            wait=wait,
        )

    async def delete_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot for a collection
        """
        return await self._build_for_delete_snapshot(
            collection_name=collection_name,
            snapshot_name=snapshot_name,
            wait=wait,
        )

    async def get_full_snapshot(
        self,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot of the whole storage as a file
        """
        return await self._build_for_get_full_snapshot(
            snapshot_name=snapshot_name,
        )

    async def get_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot of a shard from a collection as a file
        """
        return await self._build_for_get_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            snapshot_name=snapshot_name,
        )

    async def get_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot from a collection as a file
        """
        return await self._build_for_get_snapshot(
            collection_name=collection_name,
            snapshot_name=snapshot_name,
        )

    async def list_full_snapshots(
        self,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots of the whole storage
        """
        return await self._build_for_list_full_snapshots()

    async def list_shard_snapshots(
        self,
        collection_name: str,
        shard_id: int,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots for a shard of a collection
        """
        return await self._build_for_list_shard_snapshots(
            collection_name=collection_name,
            shard_id=shard_id,
        )

    async def list_snapshots(
        self,
        collection_name: str,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots for a collection
        """
        return await self._build_for_list_snapshots(
            collection_name=collection_name,
        )

    async def recover_from_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        snapshot_recover: m.SnapshotRecover = None,
    ) -> m.InlineResponse200:
        """
        Recover local collection data from a snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        return await self._build_for_recover_from_snapshot(
            collection_name=collection_name,
            wait=wait,
            snapshot_recover=snapshot_recover,
        )

    async def recover_from_uploaded_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ) -> m.InlineResponse200:
        """
        Recover local collection data from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        return await self._build_for_recover_from_uploaded_snapshot(
            collection_name=collection_name,
            wait=wait,
            priority=priority,
            checksum=checksum,
            snapshot=snapshot,
        )

    async def recover_shard_from_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        shard_snapshot_recover: m.ShardSnapshotRecover = None,
    ) -> m.InlineResponse200:
        """
        Recover shard of a local collection data from a snapshot. This will overwrite any data, stored in this shard, for the collection.
        """
        return await self._build_for_recover_shard_from_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
            shard_snapshot_recover=shard_snapshot_recover,
        )

    async def recover_shard_from_uploaded_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ) -> m.InlineResponse200:
        """
        Recover shard of a local collection from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection shard.
        """
        return await self._build_for_recover_shard_from_uploaded_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
            priority=priority,
            checksum=checksum,
            snapshot=snapshot,
        )


class SyncSnapshotsApi(_SnapshotsApi):
    def create_full_snapshot(
        self,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot of the whole storage
        """
        return self._build_for_create_full_snapshot(
            wait=wait,
        )

    def create_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot of a shard for a collection
        """
        return self._build_for_create_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
        )

    def create_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
    ) -> m.InlineResponse20011:
        """
        Create new snapshot for a collection
        """
        return self._build_for_create_snapshot(
            collection_name=collection_name,
            wait=wait,
        )

    def delete_full_snapshot(
        self,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot of the whole storage
        """
        return self._build_for_delete_full_snapshot(
            snapshot_name=snapshot_name,
            wait=wait,
        )

    def delete_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot of a shard for a collection
        """
        return self._build_for_delete_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            snapshot_name=snapshot_name,
            wait=wait,
        )

    def delete_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
        wait: bool = None,
    ) -> m.InlineResponse200:
        """
        Delete snapshot for a collection
        """
        return self._build_for_delete_snapshot(
            collection_name=collection_name,
            snapshot_name=snapshot_name,
            wait=wait,
        )

    def get_full_snapshot(
        self,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot of the whole storage as a file
        """
        return self._build_for_get_full_snapshot(
            snapshot_name=snapshot_name,
        )

    def get_shard_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot of a shard from a collection as a file
        """
        return self._build_for_get_shard_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            snapshot_name=snapshot_name,
        )

    def get_snapshot(
        self,
        collection_name: str,
        snapshot_name: str,
    ) -> file:
        """
        Download specified snapshot from a collection as a file
        """
        return self._build_for_get_snapshot(
            collection_name=collection_name,
            snapshot_name=snapshot_name,
        )

    def list_full_snapshots(
        self,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots of the whole storage
        """
        return self._build_for_list_full_snapshots()

    def list_shard_snapshots(
        self,
        collection_name: str,
        shard_id: int,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots for a shard of a collection
        """
        return self._build_for_list_shard_snapshots(
            collection_name=collection_name,
            shard_id=shard_id,
        )

    def list_snapshots(
        self,
        collection_name: str,
    ) -> m.InlineResponse20010:
        """
        Get list of snapshots for a collection
        """
        return self._build_for_list_snapshots(
            collection_name=collection_name,
        )

    def recover_from_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        snapshot_recover: m.SnapshotRecover = None,
    ) -> m.InlineResponse200:
        """
        Recover local collection data from a snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        return self._build_for_recover_from_snapshot(
            collection_name=collection_name,
            wait=wait,
            snapshot_recover=snapshot_recover,
        )

    def recover_from_uploaded_snapshot(
        self,
        collection_name: str,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ) -> m.InlineResponse200:
        """
        Recover local collection data from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection. If collection does not exist - it will be created.
        """
        return self._build_for_recover_from_uploaded_snapshot(
            collection_name=collection_name,
            wait=wait,
            priority=priority,
            checksum=checksum,
            snapshot=snapshot,
        )

    def recover_shard_from_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        shard_snapshot_recover: m.ShardSnapshotRecover = None,
    ) -> m.InlineResponse200:
        """
        Recover shard of a local collection data from a snapshot. This will overwrite any data, stored in this shard, for the collection.
        """
        return self._build_for_recover_shard_from_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
            shard_snapshot_recover=shard_snapshot_recover,
        )

    def recover_shard_from_uploaded_snapshot(
        self,
        collection_name: str,
        shard_id: int,
        wait: bool = None,
        priority: SnapshotPriority = None,
        checksum: str = None,
        snapshot: IO[Any] = None,
    ) -> m.InlineResponse200:
        """
        Recover shard of a local collection from an uploaded snapshot. This will overwrite any data, stored on this node, for the collection shard.
        """
        return self._build_for_recover_shard_from_uploaded_snapshot(
            collection_name=collection_name,
            shard_id=shard_id,
            wait=wait,
            priority=priority,
            checksum=checksum,
            snapshot=snapshot,
        )
