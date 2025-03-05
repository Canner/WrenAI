import errno
import os

import gevent.socket

from geventhttpclient import __version__
from geventhttpclient.connectionpool import ConnectionPool
from geventhttpclient.header import Headers
from geventhttpclient.response import HTTPConnectionClosed, HTTPSocketPoolResponse
from geventhttpclient.url import URL

CRLF = "\r\n"
WHITESPACE = " "
FIELD_VALUE_SEP = ": "
HOST_PORT_SEP = ":"
SLASH = "/"
PROTO_HTTP = "http"
PROTO_HTTPS = "https"
HEADER_HOST = "Host"
HEADER_CONTENT_LENGTH = "Content-Length"

METHOD_GET = "GET"
METHOD_HEAD = "HEAD"
METHOD_POST = "POST"
METHOD_PUT = "PUT"
METHOD_DELETE = "DELETE"
METHOD_PATCH = "PATCH"
METHOD_OPTIONS = "OPTIONS"
METHOD_TRACE = "TRACE"


def _get_body_length(body):
    """
    Get len of string or file

    :param body:
    :return:
    :rtype: int
    """
    try:
        return len(body)
    except TypeError:
        try:
            return os.fstat(body.fileno()).st_size
        except (AttributeError, OSError):
            return None


class HTTPClient:
    HTTP_11 = "HTTP/1.1"
    HTTP_10 = "HTTP/1.0"

    BLOCK_SIZE = 1024 * 4  # 4KB

    DEFAULT_HEADERS = Headers({"User-Agent": "python/gevent-http-client-" + __version__})

    @classmethod
    def from_url(cls, url, **kw):
        if not isinstance(url, URL):
            url = URL(url)
        enable_ssl = url.scheme == PROTO_HTTPS
        if not enable_ssl:
            kw.pop("ssl_options", None)
        return cls(url.host, port=url.port, ssl=enable_ssl, **kw)

    def __init__(
        self,
        host,
        port=None,
        headers=None,
        block_size=BLOCK_SIZE,
        connection_timeout=ConnectionPool.DEFAULT_CONNECTION_TIMEOUT,
        network_timeout=ConnectionPool.DEFAULT_NETWORK_TIMEOUT,
        disable_ipv6=False,
        concurrency=1,
        ssl=False,
        ssl_options=None,
        ssl_context_factory=None,
        insecure=False,
        proxy_host=None,
        proxy_port=None,
        version=HTTP_11,
        headers_type=Headers,
    ):
        if headers is None:
            headers = headers_type()
        self.host = host
        self.port = port
        connection_host = self.host
        connection_port = self.port
        if proxy_host is not None:
            assert proxy_port is not None, "you have to provide proxy_port if you set proxy_host"
            self.use_proxy = True
            connection_host = proxy_host
            connection_port = proxy_port
        else:
            self.use_proxy = False
        if ssl:
            ssl_options = ssl_options.copy() if ssl_options else {}
        if ssl_options is not None:
            if ssl_context_factory is not None:
                requested_hostname = headers.get("host", self.host)
                ssl_options.setdefault("server_hostname", requested_hostname)
            self.ssl = True
            if not self.port:
                self.port = 443
            if not connection_port:
                connection_port = self.port
            # Import SSL as late as possible, fail hard with Import Error
            from geventhttpclient.connectionpool import SSLConnectionPool

            self._connection_pool = SSLConnectionPool(
                connection_host,
                connection_port,
                self.host,
                self.port,
                size=concurrency,
                ssl_options=ssl_options,
                ssl_context_factory=ssl_context_factory,
                insecure=insecure,
                network_timeout=network_timeout,
                connection_timeout=connection_timeout,
                disable_ipv6=disable_ipv6,
                use_proxy=self.use_proxy,
            )
        else:
            self.ssl = False
            if not self.port:
                self.port = 80
            if not connection_port:
                connection_port = self.port
            self._connection_pool = ConnectionPool(
                connection_host,
                connection_port,
                self.host,
                self.port,
                size=concurrency,
                network_timeout=network_timeout,
                connection_timeout=connection_timeout,
                disable_ipv6=disable_ipv6,
                use_proxy=self.use_proxy,
            )
        self.version = version
        self.headers_type = headers_type
        self.default_headers = headers_type()
        self.default_headers.update(self.DEFAULT_HEADERS)
        self.default_headers.update(headers)
        self.block_size = block_size

        scheme = PROTO_HTTPS if self.ssl else PROTO_HTTP
        port_str = f":{port}" if port else ""
        self._base_url_string = f"{scheme}://{self.host}{port_str}/"

    def close(self):
        self._connection_pool.close()

    # Like urllib2, try to treat the body as a file if we can't determine the
    # file length with `len()`

    def _build_request(self, method, request_uri, body="", headers=None):
        """

        :param method:
        :type method: str or bytes
        :param request_uri:
        :type request_uri: str or bytes
        :param body:
        :type body: str or bytes or file
        :param headers:
        :type headers: dict
        :return:
        :rtype: str or bytes
        """

        if headers is None:
            headers = {}

        header_fields = self.headers_type()
        header_fields.update(self.default_headers)
        header_fields.update(headers)
        if self.version == self.HTTP_11 and HEADER_HOST not in header_fields:
            host_port = self.host
            # IPv6 addresses require square brackets in the Host header.
            if ":" in self.host and self.host[0] != "[" and self.host[-1] != "]":
                host_port = "[" + host_port + "]"
            if self.port not in (80, 443):
                host_port += HOST_PORT_SEP + str(self.port)
            header_fields[HEADER_HOST] = host_port
        if body and HEADER_CONTENT_LENGTH not in header_fields:
            body_length = _get_body_length(body)
            if body_length:
                header_fields[HEADER_CONTENT_LENGTH] = body_length

        request_url = request_uri
        if self.use_proxy:
            base_url = self._base_url_string
            if request_uri.startswith(SLASH):
                base_url = base_url[:-1]
            request_url = base_url + request_url
        elif not request_url.startswith((SLASH, PROTO_HTTP)):
            request_url = SLASH + request_url
        elif request_url.startswith(PROTO_HTTP):
            if request_url.startswith(self._base_url_string):
                request_url = request_url[len(self._base_url_string) - 1 :]
            else:
                raise ValueError("Invalid host in URL")

        request = method + WHITESPACE + request_url + WHITESPACE + self.version + CRLF

        for field, value in header_fields.items():
            request += field + FIELD_VALUE_SEP + str(value) + CRLF
        request += CRLF
        return request

    def request(self, method, request_uri, body=b"", headers=None):
        """

        :param method:
        :param request_uri:
        :param body: byte or file
        :param headers:
        :return:
        """

        if isinstance(body, str):
            body = body.encode("utf-8")

        request = self._build_request(method.upper(), request_uri, body=body, headers=headers)

        attempts_left = self._connection_pool.size + 1

        while 1:
            sock = self._connection_pool.get_socket()
            try:
                _request = request.encode()
                if body:
                    if isinstance(body, bytes):
                        sock.sendall(_request + body)
                    else:
                        sock.sendall(_request)
                        # TODO: Support non file-like iterables, e.g. `(u"string1", u"string2")`.
                        sock.sendfile(body)
                else:
                    sock.sendall(_request)
            except gevent.socket.error as e:
                self._connection_pool.release_socket(sock)
                if (e.errno == errno.ECONNRESET or e.errno == errno.EPIPE) and attempts_left > 0:
                    attempts_left -= 1
                    continue
                raise e

            try:
                response = HTTPSocketPoolResponse(
                    sock,
                    self._connection_pool,
                    block_size=self.block_size,
                    method=method.upper(),
                    headers_type=self.headers_type,
                )
            except HTTPConnectionClosed as e:
                # connection is released by the response itself
                if attempts_left > 0:
                    attempts_left -= 1
                    continue
                raise e
            else:
                response._sent_request = request
                return response

    def get(self, request_uri, headers={}):
        return self.request(METHOD_GET, request_uri, headers=headers)

    def head(self, request_uri, headers=None):
        return self.request(METHOD_HEAD, request_uri, headers=headers)

    def post(self, request_uri, body="", headers=None):
        return self.request(METHOD_POST, request_uri, body=body, headers=headers)

    def put(self, request_uri, body="", headers=None):
        return self.request(METHOD_PUT, request_uri, body=body, headers=headers)

    def delete(self, request_uri, body="", headers=None):
        return self.request(METHOD_DELETE, request_uri, body=body, headers=headers)

    def patch(self, request_uri, body="", headers=None):
        return self.request(METHOD_PATCH, request_uri, body=body, headers=headers)

    def trace(self, request_uri, body="", headers=None):
        return self.request(METHOD_TRACE, request_uri, body=body, headers=headers)

    def options(self, request_uri, headers=None):
        return self.request(METHOD_OPTIONS, request_uri, headers=headers)


class HTTPClientPool:
    """Factory for maintaining a bunch of clients, one per host:port"""

    # TODO: Add some housekeeping and cleanup logic

    def __init__(self, **kw):
        self.clients = {}
        self.client_args = kw

    def get_client(self, url):
        if not isinstance(url, URL):
            url = URL(url)
        client_key = url.host, url.port
        try:
            return self.clients[client_key]
        except KeyError:
            client = HTTPClient.from_url(url, **self.client_args)
            self.clients[client_key] = client
            return client

    def close(self):
        for client in self.clients.values():
            client.close()
        self.clients.clear()
