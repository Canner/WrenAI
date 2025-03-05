from asyncio import get_event_loop
from functools import lru_cache
from typing import Any, Awaitable, Callable, Dict, Generic, Type, TypeVar, overload

from httpx import AsyncClient, Client, Request, Response
from pydantic import ValidationError
from qdrant_client.http.api.beta_api import AsyncBetaApi, SyncBetaApi
from qdrant_client.http.api.cluster_api import AsyncClusterApi, SyncClusterApi
from qdrant_client.http.api.collections_api import AsyncCollectionsApi, SyncCollectionsApi
from qdrant_client.http.api.points_api import AsyncPointsApi, SyncPointsApi
from qdrant_client.http.api.service_api import AsyncServiceApi, SyncServiceApi
from qdrant_client.http.api.snapshots_api import AsyncSnapshotsApi, SyncSnapshotsApi
from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse

ClientT = TypeVar("ClientT", bound="ApiClient")
AsyncClientT = TypeVar("AsyncClientT", bound="AsyncApiClient")


class AsyncApis(Generic[AsyncClientT]):
    def __init__(self, host: str = None, **kwargs: Any):
        self.client = AsyncApiClient(host, **kwargs)

        self.beta_api = AsyncBetaApi(self.client)
        self.cluster_api = AsyncClusterApi(self.client)
        self.collections_api = AsyncCollectionsApi(self.client)
        self.points_api = AsyncPointsApi(self.client)
        self.service_api = AsyncServiceApi(self.client)
        self.snapshots_api = AsyncSnapshotsApi(self.client)

    async def aclose(self) -> None:
        await self.client.aclose()


class SyncApis(Generic[ClientT]):
    def __init__(self, host: str = None, **kwargs: Any):
        self.client = ApiClient(host, **kwargs)

        self.beta_api = SyncBetaApi(self.client)
        self.cluster_api = SyncClusterApi(self.client)
        self.collections_api = SyncCollectionsApi(self.client)
        self.points_api = SyncPointsApi(self.client)
        self.service_api = SyncServiceApi(self.client)
        self.snapshots_api = SyncSnapshotsApi(self.client)

    def close(self) -> None:
        self.client.close()


T = TypeVar("T")
Send = Callable[[Request], Response]
SendAsync = Callable[[Request], Awaitable[Response]]
MiddlewareT = Callable[[Request, Send], Response]
AsyncMiddlewareT = Callable[[Request, SendAsync], Awaitable[Response]]


class ApiClient:
    def __init__(self, host: str = None, **kwargs: Any) -> None:
        self.host = host
        self.middleware: MiddlewareT = BaseMiddleware()
        self._client = Client(**kwargs)

    @overload
    def request(self, *, type_: Type[T], method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any) -> T:
        ...

    @overload  # noqa F811
    def request(self, *, type_: None, method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any) -> None:
        ...

    def request(  # noqa F811
        self, *, type_: Any, method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any
    ) -> Any:
        if path_params is None:
            path_params = {}
        url = (self.host or "") + url.format(**path_params)
        if "params" in kwargs and "timeout" in kwargs["params"]:
            kwargs["timeout"] = int(kwargs["params"]["timeout"])
        request = self._client.build_request(method, url, **kwargs)
        return self.send(request, type_)

    @overload
    def request_sync(self, *, type_: Type[T], **kwargs: Any) -> T:
        ...

    @overload  # noqa F811
    def request_sync(self, *, type_: None, **kwargs: Any) -> None:
        ...

    def request_sync(self, *, type_: Any, **kwargs: Any) -> Any:  # noqa F811
        """
        This method is not used by the generated apis, but is included for convenience
        """
        return get_event_loop().run_until_complete(self.request(type_=type_, **kwargs))

    def send(self, request: Request, type_: Type[T]) -> T:
        response = self.middleware(request, self.send_inner)
        if response.status_code in [200, 201, 202]:
            try:
                return parse_as_type(response.json(), type_)
            except ValidationError as e:
                raise ResponseHandlingException(e)
        raise UnexpectedResponse.for_response(response)

    def send_inner(self, request: Request) -> Response:
        try:
            response = self._client.send(request)
        except Exception as e:
            raise ResponseHandlingException(e)
        return response

    def close(self) -> None:
        self._client.close()

    def add_middleware(self, middleware: MiddlewareT) -> None:
        current_middleware = self.middleware

        def new_middleware(request: Request, call_next: Send) -> Response:
            def inner_send(request: Request) -> Response:
                return current_middleware(request, call_next)

            return middleware(request, inner_send)

        self.middleware = new_middleware


class AsyncApiClient:
    def __init__(self, host: str = None, **kwargs: Any) -> None:
        self.host = host
        self.middleware: AsyncMiddlewareT = BaseAsyncMiddleware()
        self._async_client = AsyncClient(**kwargs)

    @overload
    async def request(
        self, *, type_: Type[T], method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any
    ) -> T:
        ...

    @overload  # noqa F811
    async def request(
        self, *, type_: None, method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any
    ) -> None:
        ...

    async def request(  # noqa F811
        self, *, type_: Any, method: str, url: str, path_params: Dict[str, Any] = None, **kwargs: Any
    ) -> Any:
        if path_params is None:
            path_params = {}
        url = (self.host or "") + url.format(**path_params)
        request = self._async_client.build_request(method, url, **kwargs)
        return await self.send(request, type_)

    @overload
    def request_sync(self, *, type_: Type[T], **kwargs: Any) -> T:
        ...

    @overload  # noqa F811
    def request_sync(self, *, type_: None, **kwargs: Any) -> None:
        ...

    def request_sync(self, *, type_: Any, **kwargs: Any) -> Any:  # noqa F811
        """
        This method is not used by the generated apis, but is included for convenience
        """
        return get_event_loop().run_until_complete(self.request(type_=type_, **kwargs))

    async def send(self, request: Request, type_: Type[T]) -> T:
        response = await self.middleware(request, self.send_inner)
        if response.status_code in [200, 201, 202]:
            try:
                return parse_as_type(response.json(), type_)
            except ValidationError as e:
                raise ResponseHandlingException(e)
        raise UnexpectedResponse.for_response(response)

    async def send_inner(self, request: Request) -> Response:
        try:
            response = await self._async_client.send(request)
        except Exception as e:
            raise ResponseHandlingException(e)
        return response

    async def aclose(self) -> None:
        await self._async_client.aclose()

    def add_middleware(self, middleware: AsyncMiddlewareT) -> None:
        current_middleware = self.middleware

        async def new_middleware(request: Request, call_next: SendAsync) -> Response:
            async def inner_send(request: Request) -> Response:
                return await current_middleware(request, call_next)

            return await middleware(request, inner_send)

        self.middleware = new_middleware


class BaseAsyncMiddleware:
    async def __call__(self, request: Request, call_next: SendAsync) -> Response:
        return await call_next(request)


class BaseMiddleware:
    def __call__(self, request: Request, call_next: Send) -> Response:
        return call_next(request)


@lru_cache(maxsize=None)
def _get_parsing_type(type_: Any, source: str) -> Any:
    from pydantic.main import create_model

    type_name = getattr(type_, "__name__", str(type_))
    return create_model(f"ParsingModel[{type_name}] (for {source})", obj=(type_, ...))


def parse_as_type(obj: Any, type_: Type[T]) -> T:
    model_type = _get_parsing_type(type_, source=parse_as_type.__name__)
    return model_type(obj=obj).obj
