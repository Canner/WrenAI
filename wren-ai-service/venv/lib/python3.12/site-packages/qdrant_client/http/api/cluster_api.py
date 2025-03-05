# flake8: noqa E501
from typing import TYPE_CHECKING, Any, Dict, Set, TypeVar, Union

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


class _ClusterApi:
    def __init__(self, api_client: "Union[ApiClient, AsyncApiClient]"):
        self.api_client = api_client

    def _build_for_cluster_status(
        self,
    ):
        """
        Get information about the current state and composition of the cluster
        """
        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse2003,
            method="GET",
            url="/cluster",
            headers=headers if headers else None,
        )

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

    def _build_for_recover_current_peer(
        self,
    ):
        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="POST",
            url="/cluster/recover",
            headers=headers if headers else None,
        )

    def _build_for_remove_peer(
        self,
        peer_id: int,
        force: bool = None,
    ):
        """
        Tries to remove peer from the cluster. Will return an error if peer has shards on it.
        """
        path_params = {
            "peer_id": str(peer_id),
        }

        query_params = {}
        if force is not None:
            query_params["force"] = str(force).lower()

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse200,
            method="DELETE",
            url="/cluster/peer/{peer_id}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
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


class AsyncClusterApi(_ClusterApi):
    async def cluster_status(
        self,
    ) -> m.InlineResponse2003:
        """
        Get information about the current state and composition of the cluster
        """
        return await self._build_for_cluster_status()

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

    async def recover_current_peer(
        self,
    ) -> m.InlineResponse200:
        return await self._build_for_recover_current_peer()

    async def remove_peer(
        self,
        peer_id: int,
        force: bool = None,
    ) -> m.InlineResponse200:
        """
        Tries to remove peer from the cluster. Will return an error if peer has shards on it.
        """
        return await self._build_for_remove_peer(
            peer_id=peer_id,
            force=force,
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


class SyncClusterApi(_ClusterApi):
    def cluster_status(
        self,
    ) -> m.InlineResponse2003:
        """
        Get information about the current state and composition of the cluster
        """
        return self._build_for_cluster_status()

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

    def recover_current_peer(
        self,
    ) -> m.InlineResponse200:
        return self._build_for_recover_current_peer()

    def remove_peer(
        self,
        peer_id: int,
        force: bool = None,
    ) -> m.InlineResponse200:
        """
        Tries to remove peer from the cluster. Will return an error if peer has shards on it.
        """
        return self._build_for_remove_peer(
            peer_id=peer_id,
            force=force,
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
