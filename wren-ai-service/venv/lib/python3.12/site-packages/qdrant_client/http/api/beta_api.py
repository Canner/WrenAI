# flake8: noqa E501
from typing import TYPE_CHECKING, Any, Dict, Set, TypeVar, Union

from pydantic import BaseModel
from pydantic.main import BaseModel
from pydantic.version import VERSION as PYDANTIC_VERSION
from qdrant_client.http.models import *

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


class _BetaApi:
    def __init__(self, api_client: "Union[ApiClient, AsyncApiClient]"):
        self.api_client = api_client

    def _build_for_clear_issues(
        self,
    ):
        """
        Removes all issues reported so far
        """
        headers = {}
        return self.api_client.request(
            type_=bool,
            method="DELETE",
            url="/issues",
            headers=headers if headers else None,
        )

    def _build_for_get_issues(
        self,
    ):
        """
        Get a report of performance issues and configuration suggestions
        """
        headers = {}
        return self.api_client.request(
            type_=object,
            method="GET",
            url="/issues",
            headers=headers if headers else None,
        )


class AsyncBetaApi(_BetaApi):
    async def clear_issues(
        self,
    ) -> bool:
        """
        Removes all issues reported so far
        """
        return await self._build_for_clear_issues()

    async def get_issues(
        self,
    ) -> object:
        """
        Get a report of performance issues and configuration suggestions
        """
        return await self._build_for_get_issues()


class SyncBetaApi(_BetaApi):
    def clear_issues(
        self,
    ) -> bool:
        """
        Removes all issues reported so far
        """
        return self._build_for_clear_issues()

    def get_issues(
        self,
    ) -> object:
        """
        Get a report of performance issues and configuration suggestions
        """
        return self._build_for_get_issues()
