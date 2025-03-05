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


class _CollectionsApi:
    def __init__(self, api_client: "Union[ApiClient, AsyncApiClient]"):
        self.api_client = api_client

    def _build_for_collection_cluster_info(
        self,
        collection_name: str,
    ):
        """
        Get cluster information for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2008,
            method="GET",
            url="/collections/{collection_name}/cluster",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_collection_exists(
        self,
        collection_name: str,
    ):
        """
        Returns \"true\" if the given collection name exists, and \"false\" otherwise
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2007,
            method="GET",
            url="/collections/{collection_name}/exists",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_create_collection(
        self,
        collection_name: str,
        timeout: int = None,
        create_collection: m.CreateCollection = None,
    ):
        """
        Create new collection with given parameters
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(create_collection)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="PUT",
            url="/collections/{collection_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_create_field_index(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        create_field_index: m.CreateFieldIndex = None,
    ):
        """
        Create index for field in collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()
        if ordering is not None:
            query_params["ordering"] = str(ordering)

        headers = {}
        body = jsonable_encoder(create_field_index)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="PUT",
            url="/collections/{collection_name}/index",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_create_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        create_sharding_key: m.CreateShardingKey = None,
    ):
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(create_sharding_key)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="PUT",
            url="/collections/{collection_name}/shards",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
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

    def _build_for_delete_collection(
        self,
        collection_name: str,
        timeout: int = None,
    ):
        """
        Drop collection and all associated data
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="DELETE",
            url="/collections/{collection_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_delete_field_index(
        self,
        collection_name: str,
        field_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
    ):
        """
        Delete field index for collection
        """
        path_params = {
            "collection_name": str(collection_name),
            "field_name": str(field_name),
        }

        query_params = {}
        if wait is not None:
            query_params["wait"] = str(wait).lower()
        if ordering is not None:
            query_params["ordering"] = str(ordering)

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="DELETE",
            url="/collections/{collection_name}/index/{field_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_delete_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        drop_sharding_key: m.DropShardingKey = None,
    ):
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(drop_sharding_key)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/collections/{collection_name}/shards/delete",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
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

    def _build_for_get_collection(
        self,
        collection_name: str,
    ):
        """
        Get detailed information about specified existing collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2005,
            method="GET",
            url="/collections/{collection_name}",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_get_collection_aliases(
        self,
        collection_name: str,
    ):
        """
        Get list of all aliases for a collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2009,
            method="GET",
            url="/collections/{collection_name}/aliases",
            headers=headers if headers else None,
            path_params=path_params,
        )

    def _build_for_get_collections(
        self,
    ):
        """
        Get list name of all existing collections
        """
        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2004,
            method="GET",
            url="/collections",
            headers=headers if headers else None,
        )

    def _build_for_get_collections_aliases(
        self,
    ):
        """
        Get list of all existing collections aliases
        """
        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2009,
            method="GET",
            url="/aliases",
            headers=headers if headers else None,
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

    def _build_for_update_aliases(
        self,
        timeout: int = None,
        change_aliases_operation: m.ChangeAliasesOperation = None,
    ):
        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(change_aliases_operation)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/collections/aliases",
            headers=headers if headers else None,
            params=query_params,
            content=body,
        )

    def _build_for_update_collection(
        self,
        collection_name: str,
        timeout: int = None,
        update_collection: m.UpdateCollection = None,
    ):
        """
        Update parameters of the existing collection
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(update_collection)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="PATCH",
            url="/collections/{collection_name}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_update_collection_cluster(
        self,
        collection_name: str,
        timeout: int = None,
        cluster_operations: m.ClusterOperations = None,
    ):
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(cluster_operations)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/collections/{collection_name}/cluster",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )


class AsyncCollectionsApi(_CollectionsApi):
    async def collection_cluster_info(
        self,
        collection_name: str,
    ) -> m.InlineResponse2008:
        """
        Get cluster information for a collection
        """
        return await self._build_for_collection_cluster_info(
            collection_name=collection_name,
        )

    async def collection_exists(
        self,
        collection_name: str,
    ) -> m.InlineResponse2007:
        """
        Returns \"true\" if the given collection name exists, and \"false\" otherwise
        """
        return await self._build_for_collection_exists(
            collection_name=collection_name,
        )

    async def create_collection(
        self,
        collection_name: str,
        timeout: int = None,
        create_collection: m.CreateCollection = None,
    ) -> m.InlineResponse200:
        """
        Create new collection with given parameters
        """
        return await self._build_for_create_collection(
            collection_name=collection_name,
            timeout=timeout,
            create_collection=create_collection,
        )

    async def create_field_index(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        create_field_index: m.CreateFieldIndex = None,
    ) -> m.InlineResponse2006:
        """
        Create index for field in collection
        """
        return await self._build_for_create_field_index(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            create_field_index=create_field_index,
        )

    async def create_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        create_sharding_key: m.CreateShardingKey = None,
    ) -> m.InlineResponse200:
        return await self._build_for_create_shard_key(
            collection_name=collection_name,
            timeout=timeout,
            create_sharding_key=create_sharding_key,
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

    async def delete_collection(
        self,
        collection_name: str,
        timeout: int = None,
    ) -> m.InlineResponse200:
        """
        Drop collection and all associated data
        """
        return await self._build_for_delete_collection(
            collection_name=collection_name,
            timeout=timeout,
        )

    async def delete_field_index(
        self,
        collection_name: str,
        field_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
    ) -> m.InlineResponse2006:
        """
        Delete field index for collection
        """
        return await self._build_for_delete_field_index(
            collection_name=collection_name,
            field_name=field_name,
            wait=wait,
            ordering=ordering,
        )

    async def delete_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        drop_sharding_key: m.DropShardingKey = None,
    ) -> m.InlineResponse200:
        return await self._build_for_delete_shard_key(
            collection_name=collection_name,
            timeout=timeout,
            drop_sharding_key=drop_sharding_key,
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

    async def get_collection(
        self,
        collection_name: str,
    ) -> m.InlineResponse2005:
        """
        Get detailed information about specified existing collection
        """
        return await self._build_for_get_collection(
            collection_name=collection_name,
        )

    async def get_collection_aliases(
        self,
        collection_name: str,
    ) -> m.InlineResponse2009:
        """
        Get list of all aliases for a collection
        """
        return await self._build_for_get_collection_aliases(
            collection_name=collection_name,
        )

    async def get_collections(
        self,
    ) -> m.InlineResponse2004:
        """
        Get list name of all existing collections
        """
        return await self._build_for_get_collections()

    async def get_collections_aliases(
        self,
    ) -> m.InlineResponse2009:
        """
        Get list of all existing collections aliases
        """
        return await self._build_for_get_collections_aliases()

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

    async def update_aliases(
        self,
        timeout: int = None,
        change_aliases_operation: m.ChangeAliasesOperation = None,
    ) -> m.InlineResponse200:
        return await self._build_for_update_aliases(
            timeout=timeout,
            change_aliases_operation=change_aliases_operation,
        )

    async def update_collection(
        self,
        collection_name: str,
        timeout: int = None,
        update_collection: m.UpdateCollection = None,
    ) -> m.InlineResponse200:
        """
        Update parameters of the existing collection
        """
        return await self._build_for_update_collection(
            collection_name=collection_name,
            timeout=timeout,
            update_collection=update_collection,
        )

    async def update_collection_cluster(
        self,
        collection_name: str,
        timeout: int = None,
        cluster_operations: m.ClusterOperations = None,
    ) -> m.InlineResponse200:
        return await self._build_for_update_collection_cluster(
            collection_name=collection_name,
            timeout=timeout,
            cluster_operations=cluster_operations,
        )


class SyncCollectionsApi(_CollectionsApi):
    def collection_cluster_info(
        self,
        collection_name: str,
    ) -> m.InlineResponse2008:
        """
        Get cluster information for a collection
        """
        return self._build_for_collection_cluster_info(
            collection_name=collection_name,
        )

    def collection_exists(
        self,
        collection_name: str,
    ) -> m.InlineResponse2007:
        """
        Returns \"true\" if the given collection name exists, and \"false\" otherwise
        """
        return self._build_for_collection_exists(
            collection_name=collection_name,
        )

    def create_collection(
        self,
        collection_name: str,
        timeout: int = None,
        create_collection: m.CreateCollection = None,
    ) -> m.InlineResponse200:
        """
        Create new collection with given parameters
        """
        return self._build_for_create_collection(
            collection_name=collection_name,
            timeout=timeout,
            create_collection=create_collection,
        )

    def create_field_index(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        create_field_index: m.CreateFieldIndex = None,
    ) -> m.InlineResponse2006:
        """
        Create index for field in collection
        """
        return self._build_for_create_field_index(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            create_field_index=create_field_index,
        )

    def create_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        create_sharding_key: m.CreateShardingKey = None,
    ) -> m.InlineResponse200:
        return self._build_for_create_shard_key(
            collection_name=collection_name,
            timeout=timeout,
            create_sharding_key=create_sharding_key,
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

    def delete_collection(
        self,
        collection_name: str,
        timeout: int = None,
    ) -> m.InlineResponse200:
        """
        Drop collection and all associated data
        """
        return self._build_for_delete_collection(
            collection_name=collection_name,
            timeout=timeout,
        )

    def delete_field_index(
        self,
        collection_name: str,
        field_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
    ) -> m.InlineResponse2006:
        """
        Delete field index for collection
        """
        return self._build_for_delete_field_index(
            collection_name=collection_name,
            field_name=field_name,
            wait=wait,
            ordering=ordering,
        )

    def delete_shard_key(
        self,
        collection_name: str,
        timeout: int = None,
        drop_sharding_key: m.DropShardingKey = None,
    ) -> m.InlineResponse200:
        return self._build_for_delete_shard_key(
            collection_name=collection_name,
            timeout=timeout,
            drop_sharding_key=drop_sharding_key,
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

    def get_collection(
        self,
        collection_name: str,
    ) -> m.InlineResponse2005:
        """
        Get detailed information about specified existing collection
        """
        return self._build_for_get_collection(
            collection_name=collection_name,
        )

    def get_collection_aliases(
        self,
        collection_name: str,
    ) -> m.InlineResponse2009:
        """
        Get list of all aliases for a collection
        """
        return self._build_for_get_collection_aliases(
            collection_name=collection_name,
        )

    def get_collections(
        self,
    ) -> m.InlineResponse2004:
        """
        Get list name of all existing collections
        """
        return self._build_for_get_collections()

    def get_collections_aliases(
        self,
    ) -> m.InlineResponse2009:
        """
        Get list of all existing collections aliases
        """
        return self._build_for_get_collections_aliases()

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

    def update_aliases(
        self,
        timeout: int = None,
        change_aliases_operation: m.ChangeAliasesOperation = None,
    ) -> m.InlineResponse200:
        return self._build_for_update_aliases(
            timeout=timeout,
            change_aliases_operation=change_aliases_operation,
        )

    def update_collection(
        self,
        collection_name: str,
        timeout: int = None,
        update_collection: m.UpdateCollection = None,
    ) -> m.InlineResponse200:
        """
        Update parameters of the existing collection
        """
        return self._build_for_update_collection(
            collection_name=collection_name,
            timeout=timeout,
            update_collection=update_collection,
        )

    def update_collection_cluster(
        self,
        collection_name: str,
        timeout: int = None,
        cluster_operations: m.ClusterOperations = None,
    ) -> m.InlineResponse200:
        return self._build_for_update_collection_cluster(
            collection_name=collection_name,
            timeout=timeout,
            cluster_operations=cluster_operations,
        )
