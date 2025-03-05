import asyncio
import collections
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple, Union

import grpc


# type: ignore # noqa: F401
# Source <https://github.com/grpc/grpc/blob/master/examples/python/interceptors/headers/generic_client_interceptor.py>
class _GenericClientInterceptor(
    grpc.UnaryUnaryClientInterceptor,
    grpc.UnaryStreamClientInterceptor,
    grpc.StreamUnaryClientInterceptor,
    grpc.StreamStreamClientInterceptor,
):
    def __init__(self, interceptor_function: Callable):
        self._fn = interceptor_function

    def intercept_unary_unary(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = self._fn(
            client_call_details, iter((request,)), False, False
        )
        response = continuation(new_details, next(new_request_iterator))
        return postprocess(response) if postprocess else response

    def intercept_unary_stream(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = self._fn(
            client_call_details, iter((request,)), False, True
        )
        response_it = continuation(new_details, next(new_request_iterator))
        return postprocess(response_it) if postprocess else response_it

    def intercept_stream_unary(
        self, continuation: Any, client_call_details: Any, request_iterator: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = self._fn(
            client_call_details, request_iterator, True, False
        )
        response = continuation(new_details, new_request_iterator)
        return postprocess(response) if postprocess else response

    def intercept_stream_stream(
        self, continuation: Any, client_call_details: Any, request_iterator: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = self._fn(
            client_call_details, request_iterator, True, True
        )
        response_it = continuation(new_details, new_request_iterator)
        return postprocess(response_it) if postprocess else response_it


class _GenericAsyncClientInterceptor(
    grpc.aio.UnaryUnaryClientInterceptor,
    grpc.aio.UnaryStreamClientInterceptor,
    grpc.aio.StreamUnaryClientInterceptor,
    grpc.aio.StreamStreamClientInterceptor,
):
    def __init__(self, interceptor_function: Callable):
        self._fn = interceptor_function

    async def intercept_unary_unary(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = await self._fn(
            client_call_details, iter((request,)), False, False
        )
        next_request = next(new_request_iterator)
        response = await continuation(new_details, next_request)
        return postprocess(response) if postprocess else response

    async def intercept_unary_stream(
        self, continuation: Any, client_call_details: Any, request: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = await self._fn(
            client_call_details, iter((request,)), False, True
        )
        response_it = await continuation(new_details, next(new_request_iterator))
        return postprocess(response_it) if postprocess else response_it

    async def intercept_stream_unary(
        self, continuation: Any, client_call_details: Any, request_iterator: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = await self._fn(
            client_call_details, request_iterator, True, False
        )
        response = await continuation(new_details, new_request_iterator)
        return postprocess(response) if postprocess else response

    async def intercept_stream_stream(
        self, continuation: Any, client_call_details: Any, request_iterator: Any
    ) -> Any:
        new_details, new_request_iterator, postprocess = await self._fn(
            client_call_details, request_iterator, True, True
        )
        response_it = await continuation(new_details, new_request_iterator)
        return postprocess(response_it) if postprocess else response_it


def create_generic_client_interceptor(intercept_call: Any) -> _GenericClientInterceptor:
    return _GenericClientInterceptor(intercept_call)


def create_generic_async_client_interceptor(
    intercept_call: Any,
) -> _GenericAsyncClientInterceptor:
    return _GenericAsyncClientInterceptor(intercept_call)


# Source:
# <https://github.com/grpc/grpc/blob/master/examples/python/interceptors/headers/header_manipulator_client_interceptor.py>
class _ClientCallDetails(
    collections.namedtuple("_ClientCallDetails", ("method", "timeout", "metadata", "credentials")),
    grpc.ClientCallDetails,
):
    pass


class _ClientAsyncCallDetails(
    collections.namedtuple("_ClientCallDetails", ("method", "timeout", "metadata", "credentials")),
    grpc.aio.ClientCallDetails,
):
    pass


def header_adder_interceptor(
    new_metadata: List[Tuple[str, str]],
    auth_token_provider: Optional[Callable[[], str]] = None,
) -> _GenericClientInterceptor:
    def intercept_call(
        client_call_details: _ClientCallDetails,
        request_iterator: Any,
        _request_streaming: Any,
        _response_streaming: Any,
    ) -> Tuple[_ClientCallDetails, Any, Any]:
        metadata = []

        if client_call_details.metadata is not None:
            metadata = list(client_call_details.metadata)
        for header, value in new_metadata:
            metadata.append(
                (
                    header,
                    value,
                )
            )

        if auth_token_provider:
            if not asyncio.iscoroutinefunction(auth_token_provider):
                metadata.append(("authorization", f"Bearer {auth_token_provider()}"))
            else:
                raise ValueError("Synchronous channel requires synchronous auth token provider.")

        client_call_details = _ClientCallDetails(
            client_call_details.method,
            client_call_details.timeout,
            metadata,
            client_call_details.credentials,
        )
        return client_call_details, request_iterator, None

    return create_generic_client_interceptor(intercept_call)


def header_adder_async_interceptor(
    new_metadata: List[Tuple[str, str]],
    auth_token_provider: Optional[Union[Callable[[], str], Callable[[], Awaitable[str]]]] = None,
) -> _GenericAsyncClientInterceptor:
    async def intercept_call(
        client_call_details: grpc.aio.ClientCallDetails,
        request_iterator: Any,
        _request_streaming: Any,
        _response_streaming: Any,
    ) -> Tuple[_ClientAsyncCallDetails, Any, Any]:
        metadata = []
        if client_call_details.metadata is not None:
            metadata = list(client_call_details.metadata)
        for header, value in new_metadata:
            metadata.append(
                (
                    header,
                    value,
                )
            )

        if auth_token_provider:
            if asyncio.iscoroutinefunction(auth_token_provider):
                token = await auth_token_provider()
            else:
                token = auth_token_provider()
            metadata.append(("authorization", f"Bearer {token}"))

        client_call_details = client_call_details._replace(metadata=metadata)
        return client_call_details, request_iterator, None

    return create_generic_async_client_interceptor(intercept_call)


def parse_channel_options(options: Optional[Dict[str, Any]] = None) -> List[Tuple[str, Any]]:
    default_options: List[Tuple[str, Any]] = [
        ("grpc.max_send_message_length", -1),
        ("grpc.max_receive_message_length", -1),
    ]
    if options is None:
        return default_options

    _options = [(option_name, option_value) for option_name, option_value in options.items()]
    for option_name, option_value in default_options:
        if option_name not in options:
            _options.append((option_name, option_value))
    return _options


def get_channel(
    host: str,
    port: int,
    ssl: bool,
    metadata: Optional[List[Tuple[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
    compression: Optional[grpc.Compression] = None,
    auth_token_provider: Optional[Callable[[], str]] = None,
) -> grpc.Channel:
    # Parse gRPC client options
    _options = parse_channel_options(options)
    metadata_interceptor = header_adder_interceptor(
        new_metadata=metadata or [], auth_token_provider=auth_token_provider
    )

    if ssl:
        ssl_creds = grpc.ssl_channel_credentials()
        channel = grpc.secure_channel(f"{host}:{port}", ssl_creds, _options, compression)
        return grpc.intercept_channel(channel, metadata_interceptor)
    else:
        channel = grpc.insecure_channel(f"{host}:{port}", _options, compression)
        return grpc.intercept_channel(channel, metadata_interceptor)


def get_async_channel(
    host: str,
    port: int,
    ssl: bool,
    metadata: Optional[List[Tuple[str, str]]] = None,
    options: Optional[Dict[str, Any]] = None,
    compression: Optional[grpc.Compression] = None,
    auth_token_provider: Optional[Union[Callable[[], str], Callable[[], Awaitable[str]]]] = None,
) -> grpc.aio.Channel:
    # Parse gRPC client options
    _options = parse_channel_options(options)

    # Create metadata interceptor
    metadata_interceptor = header_adder_async_interceptor(
        new_metadata=metadata or [], auth_token_provider=auth_token_provider
    )

    if ssl:
        ssl_creds = grpc.ssl_channel_credentials()
        return grpc.aio.secure_channel(
            f"{host}:{port}",
            ssl_creds,
            _options,
            compression,
            interceptors=[metadata_interceptor],
        )
    else:
        return grpc.aio.insecure_channel(
            f"{host}:{port}", _options, compression, interceptors=[metadata_interceptor]
        )
