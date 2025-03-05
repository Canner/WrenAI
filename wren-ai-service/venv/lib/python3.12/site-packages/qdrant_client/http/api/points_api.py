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


class _PointsApi:
    def __init__(self, api_client: "Union[ApiClient, AsyncApiClient]"):
        self.api_client = api_client

    def _build_for_batch_update(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_operations: m.UpdateOperations = None,
    ):
        """
        Apply a series of update operations for points, vectors and payloads
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
        body = jsonable_encoder(update_operations)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20014,
            method="POST",
            url="/collections/{collection_name}/points/batch",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_clear_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ):
        """
        Remove all payload for specified points
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
        body = jsonable_encoder(points_selector)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="POST",
            url="/collections/{collection_name}/points/payload/clear",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_count_points(
        self,
        collection_name: str,
        timeout: int = None,
        count_request: m.CountRequest = None,
    ):
        """
        Count points which matches given filtering condition
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(count_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20019,
            method="POST",
            url="/collections/{collection_name}/points/count",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_delete_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_payload: m.DeletePayload = None,
    ):
        """
        Delete specified key payload for points
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
        body = jsonable_encoder(delete_payload)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="POST",
            url="/collections/{collection_name}/points/payload/delete",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_delete_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ):
        """
        Delete points
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
        body = jsonable_encoder(points_selector)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="POST",
            url="/collections/{collection_name}/points/delete",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_delete_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_vectors: m.DeleteVectors = None,
    ):
        """
        Delete named vectors from the given points.
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
        body = jsonable_encoder(delete_vectors)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="POST",
            url="/collections/{collection_name}/points/vectors/delete",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_discover_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request_batch: m.DiscoverRequestBatch = None,
    ):
        """
        Look for points based on target and/or positive and negative example pairs, in batch.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(discover_request_batch)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20017,
            method="POST",
            url="/collections/{collection_name}/points/discover/batch",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_discover_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request: m.DiscoverRequest = None,
    ):
        """
        Use context and a target to find the most similar points to the target, constrained by the context. When using only the context (without a target), a special search - called context search - is performed where pairs of points are used to generate a loss that guides the search towards the zone where most positive examples overlap. This means that the score minimizes the scenario of finding a point closer to a negative than to a positive part of a pair. Since the score of a context relates to loss, the maximum score a point can get is 0.0, and it becomes normal that many points can have a score of 0.0. When using target (with or without context), the score behaves a little different: The  integer part of the score represents the rank with respect to the context, while the decimal part of the score relates to the distance to the target. The context part of the score for  each pair is calculated +1 if the point is closer to a positive than to a negative part of a pair,  and -1 otherwise.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(discover_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20016,
            method="POST",
            url="/collections/{collection_name}/points/discover",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_facet(
        self,
        collection_name: str,
        timeout: int = None,
        consistency: m.ReadConsistency = None,
        facet_request: m.FacetRequest = None,
    ):
        """
        Count points that satisfy the given filter for each unique value of a payload key.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if timeout is not None:
            query_params["timeout"] = str(timeout)
        if consistency is not None:
            query_params["consistency"] = str(consistency)

        headers = {}
        body = jsonable_encoder(facet_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20020,
            method="POST",
            url="/collections/{collection_name}/facet",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_get_point(
        self,
        collection_name: str,
        id: m.ExtendedPointId,
        consistency: m.ReadConsistency = None,
    ):
        """
        Retrieve full information of single point by id
        """
        path_params = {
            "collection_name": str(collection_name),
            "id": str(id),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)

        headers = {}
        return self.api_client.request(
            type_=m.InlineResponse20012,
            method="GET",
            url="/collections/{collection_name}/points/{id}",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
        )

    def _build_for_get_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        point_request: m.PointRequest = None,
    ):
        """
        Retrieve multiple points by specified IDs
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(point_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20013,
            method="POST",
            url="/collections/{collection_name}/points",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_overwrite_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ):
        """
        Replace full payload of points with new one
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
        body = jsonable_encoder(set_payload)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="PUT",
            url="/collections/{collection_name}/points/payload",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_query_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request_batch: m.QueryRequestBatch = None,
    ):
        """
        Universally query points in batch. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(query_request_batch)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20022,
            method="POST",
            url="/collections/{collection_name}/points/query/batch",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_query_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request: m.QueryRequest = None,
    ):
        """
        Universally query points. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(query_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20021,
            method="POST",
            url="/collections/{collection_name}/points/query",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_query_points_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_groups_request: m.QueryGroupsRequest = None,
    ):
        """
        Universally query points, grouped by a given payload field
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(query_groups_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20018,
            method="POST",
            url="/collections/{collection_name}/points/query/groups",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_recommend_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request_batch: m.RecommendRequestBatch = None,
    ):
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(recommend_request_batch)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20017,
            method="POST",
            url="/collections/{collection_name}/points/recommend/batch",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_recommend_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_groups_request: m.RecommendGroupsRequest = None,
    ):
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples, grouped by a given payload field.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(recommend_groups_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20018,
            method="POST",
            url="/collections/{collection_name}/points/recommend/groups",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_recommend_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request: m.RecommendRequest = None,
    ):
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(recommend_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20016,
            method="POST",
            url="/collections/{collection_name}/points/recommend",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_scroll_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        scroll_request: m.ScrollRequest = None,
    ):
        """
        Scroll request - paginate over all points which matches given filtering condition
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(scroll_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20015,
            method="POST",
            url="/collections/{collection_name}/points/scroll",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_search_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request_batch: m.SearchRequestBatch = None,
    ):
        """
        Retrieve by batch the closest points based on vector similarity and given filtering conditions
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(search_request_batch)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20017,
            method="POST",
            url="/collections/{collection_name}/points/search/batch",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_search_matrix_offsets(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ):
        """
        Compute distance matrix for sampled points with an offset based output format
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(search_matrix_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20024,
            method="POST",
            url="/collections/{collection_name}/points/search/matrix/offsets",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_search_matrix_pairs(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ):
        """
        Compute distance matrix for sampled points with a pair based output format
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(search_matrix_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20023,
            method="POST",
            url="/collections/{collection_name}/points/search/matrix/pairs",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_search_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_groups_request: m.SearchGroupsRequest = None,
    ):
        """
        Retrieve closest points based on vector similarity and given filtering conditions, grouped by a given payload field
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(search_groups_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20018,
            method="POST",
            url="/collections/{collection_name}/points/search/groups",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_search_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request: m.SearchRequest = None,
    ):
        """
        Retrieve closest points based on vector similarity and given filtering conditions
        """
        path_params = {
            "collection_name": str(collection_name),
        }

        query_params = {}
        if consistency is not None:
            query_params["consistency"] = str(consistency)
        if timeout is not None:
            query_params["timeout"] = str(timeout)

        headers = {}
        body = jsonable_encoder(search_request)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse20016,
            method="POST",
            url="/collections/{collection_name}/points/search",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_set_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ):
        """
        Set payload values for points
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
        body = jsonable_encoder(set_payload)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="POST",
            url="/collections/{collection_name}/points/payload",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_update_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_vectors: m.UpdateVectors = None,
    ):
        """
        Update specified named vectors on points, keep unspecified vectors intact.
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
        body = jsonable_encoder(update_vectors)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="PUT",
            url="/collections/{collection_name}/points/vectors",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )

    def _build_for_upsert_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        point_insert_operations: m.PointInsertOperations = None,
    ):
        """
        Perform insert + updates on points. If point with given ID already exists - it will be overwritten.
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
        body = jsonable_encoder(point_insert_operations)
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        return self.api_client.request(
            type_=m.InlineResponse2006,
            method="PUT",
            url="/collections/{collection_name}/points",
            headers=headers if headers else None,
            path_params=path_params,
            params=query_params,
            content=body,
        )


class AsyncPointsApi(_PointsApi):
    async def batch_update(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_operations: m.UpdateOperations = None,
    ) -> m.InlineResponse20014:
        """
        Apply a series of update operations for points, vectors and payloads
        """
        return await self._build_for_batch_update(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            update_operations=update_operations,
        )

    async def clear_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ) -> m.InlineResponse2006:
        """
        Remove all payload for specified points
        """
        return await self._build_for_clear_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            points_selector=points_selector,
        )

    async def count_points(
        self,
        collection_name: str,
        timeout: int = None,
        count_request: m.CountRequest = None,
    ) -> m.InlineResponse20019:
        """
        Count points which matches given filtering condition
        """
        return await self._build_for_count_points(
            collection_name=collection_name,
            timeout=timeout,
            count_request=count_request,
        )

    async def delete_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_payload: m.DeletePayload = None,
    ) -> m.InlineResponse2006:
        """
        Delete specified key payload for points
        """
        return await self._build_for_delete_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            delete_payload=delete_payload,
        )

    async def delete_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ) -> m.InlineResponse2006:
        """
        Delete points
        """
        return await self._build_for_delete_points(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            points_selector=points_selector,
        )

    async def delete_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_vectors: m.DeleteVectors = None,
    ) -> m.InlineResponse2006:
        """
        Delete named vectors from the given points.
        """
        return await self._build_for_delete_vectors(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            delete_vectors=delete_vectors,
        )

    async def discover_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request_batch: m.DiscoverRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Look for points based on target and/or positive and negative example pairs, in batch.
        """
        return await self._build_for_discover_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            discover_request_batch=discover_request_batch,
        )

    async def discover_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request: m.DiscoverRequest = None,
    ) -> m.InlineResponse20016:
        """
        Use context and a target to find the most similar points to the target, constrained by the context. When using only the context (without a target), a special search - called context search - is performed where pairs of points are used to generate a loss that guides the search towards the zone where most positive examples overlap. This means that the score minimizes the scenario of finding a point closer to a negative than to a positive part of a pair. Since the score of a context relates to loss, the maximum score a point can get is 0.0, and it becomes normal that many points can have a score of 0.0. When using target (with or without context), the score behaves a little different: The  integer part of the score represents the rank with respect to the context, while the decimal part of the score relates to the distance to the target. The context part of the score for  each pair is calculated +1 if the point is closer to a positive than to a negative part of a pair,  and -1 otherwise.
        """
        return await self._build_for_discover_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            discover_request=discover_request,
        )

    async def facet(
        self,
        collection_name: str,
        timeout: int = None,
        consistency: m.ReadConsistency = None,
        facet_request: m.FacetRequest = None,
    ) -> m.InlineResponse20020:
        """
        Count points that satisfy the given filter for each unique value of a payload key.
        """
        return await self._build_for_facet(
            collection_name=collection_name,
            timeout=timeout,
            consistency=consistency,
            facet_request=facet_request,
        )

    async def get_point(
        self,
        collection_name: str,
        id: m.ExtendedPointId,
        consistency: m.ReadConsistency = None,
    ) -> m.InlineResponse20012:
        """
        Retrieve full information of single point by id
        """
        return await self._build_for_get_point(
            collection_name=collection_name,
            id=id,
            consistency=consistency,
        )

    async def get_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        point_request: m.PointRequest = None,
    ) -> m.InlineResponse20013:
        """
        Retrieve multiple points by specified IDs
        """
        return await self._build_for_get_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            point_request=point_request,
        )

    async def overwrite_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ) -> m.InlineResponse2006:
        """
        Replace full payload of points with new one
        """
        return await self._build_for_overwrite_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            set_payload=set_payload,
        )

    async def query_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request_batch: m.QueryRequestBatch = None,
    ) -> m.InlineResponse20022:
        """
        Universally query points in batch. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        return await self._build_for_query_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_request_batch=query_request_batch,
        )

    async def query_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request: m.QueryRequest = None,
    ) -> m.InlineResponse20021:
        """
        Universally query points. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        return await self._build_for_query_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_request=query_request,
        )

    async def query_points_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_groups_request: m.QueryGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Universally query points, grouped by a given payload field
        """
        return await self._build_for_query_points_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_groups_request=query_groups_request,
        )

    async def recommend_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request_batch: m.RecommendRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        return await self._build_for_recommend_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_request_batch=recommend_request_batch,
        )

    async def recommend_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_groups_request: m.RecommendGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples, grouped by a given payload field.
        """
        return await self._build_for_recommend_point_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_groups_request=recommend_groups_request,
        )

    async def recommend_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request: m.RecommendRequest = None,
    ) -> m.InlineResponse20016:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        return await self._build_for_recommend_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_request=recommend_request,
        )

    async def scroll_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        scroll_request: m.ScrollRequest = None,
    ) -> m.InlineResponse20015:
        """
        Scroll request - paginate over all points which matches given filtering condition
        """
        return await self._build_for_scroll_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            scroll_request=scroll_request,
        )

    async def search_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request_batch: m.SearchRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Retrieve by batch the closest points based on vector similarity and given filtering conditions
        """
        return await self._build_for_search_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_request_batch=search_request_batch,
        )

    async def search_matrix_offsets(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ) -> m.InlineResponse20024:
        """
        Compute distance matrix for sampled points with an offset based output format
        """
        return await self._build_for_search_matrix_offsets(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_matrix_request=search_matrix_request,
        )

    async def search_matrix_pairs(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ) -> m.InlineResponse20023:
        """
        Compute distance matrix for sampled points with a pair based output format
        """
        return await self._build_for_search_matrix_pairs(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_matrix_request=search_matrix_request,
        )

    async def search_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_groups_request: m.SearchGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Retrieve closest points based on vector similarity and given filtering conditions, grouped by a given payload field
        """
        return await self._build_for_search_point_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_groups_request=search_groups_request,
        )

    async def search_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request: m.SearchRequest = None,
    ) -> m.InlineResponse20016:
        """
        Retrieve closest points based on vector similarity and given filtering conditions
        """
        return await self._build_for_search_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_request=search_request,
        )

    async def set_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ) -> m.InlineResponse2006:
        """
        Set payload values for points
        """
        return await self._build_for_set_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            set_payload=set_payload,
        )

    async def update_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_vectors: m.UpdateVectors = None,
    ) -> m.InlineResponse2006:
        """
        Update specified named vectors on points, keep unspecified vectors intact.
        """
        return await self._build_for_update_vectors(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            update_vectors=update_vectors,
        )

    async def upsert_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        point_insert_operations: m.PointInsertOperations = None,
    ) -> m.InlineResponse2006:
        """
        Perform insert + updates on points. If point with given ID already exists - it will be overwritten.
        """
        return await self._build_for_upsert_points(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            point_insert_operations=point_insert_operations,
        )


class SyncPointsApi(_PointsApi):
    def batch_update(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_operations: m.UpdateOperations = None,
    ) -> m.InlineResponse20014:
        """
        Apply a series of update operations for points, vectors and payloads
        """
        return self._build_for_batch_update(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            update_operations=update_operations,
        )

    def clear_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ) -> m.InlineResponse2006:
        """
        Remove all payload for specified points
        """
        return self._build_for_clear_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            points_selector=points_selector,
        )

    def count_points(
        self,
        collection_name: str,
        timeout: int = None,
        count_request: m.CountRequest = None,
    ) -> m.InlineResponse20019:
        """
        Count points which matches given filtering condition
        """
        return self._build_for_count_points(
            collection_name=collection_name,
            timeout=timeout,
            count_request=count_request,
        )

    def delete_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_payload: m.DeletePayload = None,
    ) -> m.InlineResponse2006:
        """
        Delete specified key payload for points
        """
        return self._build_for_delete_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            delete_payload=delete_payload,
        )

    def delete_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        points_selector: m.PointsSelector = None,
    ) -> m.InlineResponse2006:
        """
        Delete points
        """
        return self._build_for_delete_points(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            points_selector=points_selector,
        )

    def delete_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        delete_vectors: m.DeleteVectors = None,
    ) -> m.InlineResponse2006:
        """
        Delete named vectors from the given points.
        """
        return self._build_for_delete_vectors(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            delete_vectors=delete_vectors,
        )

    def discover_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request_batch: m.DiscoverRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Look for points based on target and/or positive and negative example pairs, in batch.
        """
        return self._build_for_discover_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            discover_request_batch=discover_request_batch,
        )

    def discover_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        discover_request: m.DiscoverRequest = None,
    ) -> m.InlineResponse20016:
        """
        Use context and a target to find the most similar points to the target, constrained by the context. When using only the context (without a target), a special search - called context search - is performed where pairs of points are used to generate a loss that guides the search towards the zone where most positive examples overlap. This means that the score minimizes the scenario of finding a point closer to a negative than to a positive part of a pair. Since the score of a context relates to loss, the maximum score a point can get is 0.0, and it becomes normal that many points can have a score of 0.0. When using target (with or without context), the score behaves a little different: The  integer part of the score represents the rank with respect to the context, while the decimal part of the score relates to the distance to the target. The context part of the score for  each pair is calculated +1 if the point is closer to a positive than to a negative part of a pair,  and -1 otherwise.
        """
        return self._build_for_discover_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            discover_request=discover_request,
        )

    def facet(
        self,
        collection_name: str,
        timeout: int = None,
        consistency: m.ReadConsistency = None,
        facet_request: m.FacetRequest = None,
    ) -> m.InlineResponse20020:
        """
        Count points that satisfy the given filter for each unique value of a payload key.
        """
        return self._build_for_facet(
            collection_name=collection_name,
            timeout=timeout,
            consistency=consistency,
            facet_request=facet_request,
        )

    def get_point(
        self,
        collection_name: str,
        id: m.ExtendedPointId,
        consistency: m.ReadConsistency = None,
    ) -> m.InlineResponse20012:
        """
        Retrieve full information of single point by id
        """
        return self._build_for_get_point(
            collection_name=collection_name,
            id=id,
            consistency=consistency,
        )

    def get_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        point_request: m.PointRequest = None,
    ) -> m.InlineResponse20013:
        """
        Retrieve multiple points by specified IDs
        """
        return self._build_for_get_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            point_request=point_request,
        )

    def overwrite_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ) -> m.InlineResponse2006:
        """
        Replace full payload of points with new one
        """
        return self._build_for_overwrite_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            set_payload=set_payload,
        )

    def query_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request_batch: m.QueryRequestBatch = None,
    ) -> m.InlineResponse20022:
        """
        Universally query points in batch. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        return self._build_for_query_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_request_batch=query_request_batch,
        )

    def query_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_request: m.QueryRequest = None,
    ) -> m.InlineResponse20021:
        """
        Universally query points. This endpoint covers all capabilities of search, recommend, discover, filters. But also enables hybrid and multi-stage queries.
        """
        return self._build_for_query_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_request=query_request,
        )

    def query_points_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        query_groups_request: m.QueryGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Universally query points, grouped by a given payload field
        """
        return self._build_for_query_points_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            query_groups_request=query_groups_request,
        )

    def recommend_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request_batch: m.RecommendRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        return self._build_for_recommend_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_request_batch=recommend_request_batch,
        )

    def recommend_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_groups_request: m.RecommendGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples, grouped by a given payload field.
        """
        return self._build_for_recommend_point_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_groups_request=recommend_groups_request,
        )

    def recommend_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        recommend_request: m.RecommendRequest = None,
    ) -> m.InlineResponse20016:
        """
        Look for the points which are closer to stored positive examples and at the same time further to negative examples.
        """
        return self._build_for_recommend_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            recommend_request=recommend_request,
        )

    def scroll_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        scroll_request: m.ScrollRequest = None,
    ) -> m.InlineResponse20015:
        """
        Scroll request - paginate over all points which matches given filtering condition
        """
        return self._build_for_scroll_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            scroll_request=scroll_request,
        )

    def search_batch_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request_batch: m.SearchRequestBatch = None,
    ) -> m.InlineResponse20017:
        """
        Retrieve by batch the closest points based on vector similarity and given filtering conditions
        """
        return self._build_for_search_batch_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_request_batch=search_request_batch,
        )

    def search_matrix_offsets(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ) -> m.InlineResponse20024:
        """
        Compute distance matrix for sampled points with an offset based output format
        """
        return self._build_for_search_matrix_offsets(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_matrix_request=search_matrix_request,
        )

    def search_matrix_pairs(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_matrix_request: m.SearchMatrixRequest = None,
    ) -> m.InlineResponse20023:
        """
        Compute distance matrix for sampled points with a pair based output format
        """
        return self._build_for_search_matrix_pairs(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_matrix_request=search_matrix_request,
        )

    def search_point_groups(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_groups_request: m.SearchGroupsRequest = None,
    ) -> m.InlineResponse20018:
        """
        Retrieve closest points based on vector similarity and given filtering conditions, grouped by a given payload field
        """
        return self._build_for_search_point_groups(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_groups_request=search_groups_request,
        )

    def search_points(
        self,
        collection_name: str,
        consistency: m.ReadConsistency = None,
        timeout: int = None,
        search_request: m.SearchRequest = None,
    ) -> m.InlineResponse20016:
        """
        Retrieve closest points based on vector similarity and given filtering conditions
        """
        return self._build_for_search_points(
            collection_name=collection_name,
            consistency=consistency,
            timeout=timeout,
            search_request=search_request,
        )

    def set_payload(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        set_payload: m.SetPayload = None,
    ) -> m.InlineResponse2006:
        """
        Set payload values for points
        """
        return self._build_for_set_payload(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            set_payload=set_payload,
        )

    def update_vectors(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        update_vectors: m.UpdateVectors = None,
    ) -> m.InlineResponse2006:
        """
        Update specified named vectors on points, keep unspecified vectors intact.
        """
        return self._build_for_update_vectors(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            update_vectors=update_vectors,
        )

    def upsert_points(
        self,
        collection_name: str,
        wait: bool = None,
        ordering: WriteOrdering = None,
        point_insert_operations: m.PointInsertOperations = None,
    ) -> m.InlineResponse2006:
        """
        Perform insert + updates on points. If point with given ID already exists - it will be overwritten.
        """
        return self._build_for_upsert_points(
            collection_name=collection_name,
            wait=wait,
            ordering=ordering,
            point_insert_operations=point_insert_operations,
        )
