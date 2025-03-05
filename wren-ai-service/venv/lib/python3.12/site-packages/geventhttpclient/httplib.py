"""
Provide HTTPConnection, HTTPSConnection and HTTPResponse implementations ready
to use as drop-in replacements for their counterparts in http.client.
"""

import http.client
from contextlib import contextmanager

import gevent.socket
import gevent.ssl

from geventhttpclient import connectionpool, header, response

_UNKNOWN = getattr(http.client, "_UNKNOWN", "UNKNOWN")


class HTTPLibHeaders(header.Headers):
    def __getitem__(self, key):
        value = super().__getitem__(key)
        if isinstance(value, (list, tuple)):
            return ", ".join(value)
        else:
            return value


class HTTPResponse(response.HTTPSocketResponse):
    def __init__(self, sock, debuglevel=0, method=None, url=None, **kw):
        method = "GET" if method is None else method.upper()
        super().__init__(sock, method=method, **kw)
        self.url = url
        self.chunked = _UNKNOWN
        self.chunk_left = _UNKNOWN

    @property
    def msg(self):
        if hasattr(self, "_msg"):
            return self._msg
        self._msg = HTTPLibHeaders(self._headers_index)
        return self._msg

    @msg.setter
    def msg(self, headers):
        # required by do_open()
        self._msg = headers

    @property
    def fp(self):
        return self

    @property
    def version(self):
        v = self.get_http_version()
        if v == "HTTP/1.1":
            return 11
        return 10

    @property
    def status(self):
        return self.status_code

    @property
    def code(self):
        return self.status_code

    @property
    def reason(self):
        return self.msg

    def _read_status(self):
        return (self.version, self.status_code, self.msg)

    def begin(self):
        pass

    def flush(self):
        self._body_buffer.clear()

    def readable(self):
        return True

    def close(self):
        self.release()

    def isclosed(self):
        return self._sock is None

    def read(self, amt=None):
        return super().read(amt)

    def readinto(self, b):
        raise NotImplementedError()

    def read1(self, n=-1):
        raise NotImplementedError()

    def peek(self, n=-1):
        raise NotImplementedError()

    def fileno(self):
        raise NotImplementedError()

    def getheader(self, name, default=None):
        return self.get(name.lower(), default)

    def getheaders(self):
        return list(self._headers_index.items())

    @property
    def will_close(self):
        return self.message_complete and not self.should_keep_alive()

    def _check_close(self):
        return not self.should_keep_alive()

    # For compatibility with old-style urllib responses. cookielib etc.

    def geturl(self):
        return self.url

    def getcode(self):
        return self.status_code


class HTTPConnection(http.client.HTTPConnection):
    response_class = HTTPResponse
    source_address = None
    _hidden_socket = None

    def connect(self):
        self.sock = gevent.socket.create_connection(
            (self.host, self.port), self.timeout, self.source_address
        )
        if self._tunnel_host:
            self._tunnel()

    def getresponse(self):
        # For recent python versions urllib.request.AbstractHTTPHandler.do_open()
        # insists on closing the socket prematurely, right after receiving a response.
        # So in our case, right after just reading the HTTP headers, the socket gets
        # killed. Therefore, we have two options:
        #
        # 1. We read everything into some buffer, before returning the response object
        # 2. We stop do_open() from messing around with the socket
        #
        # As HTTPSocketResponse is not really intended to buffer big chunks of data,
        # option two remains. Better ideas wellcome.

        if not self.sock and self._hidden_socket is not None:
            self.sock = self._hidden_socket
        resp = super().getresponse()
        self._hidden_socket = self.sock
        self.sock = None
        return resp

    def close(self):
        if not self.sock and self._hidden_socket is not None:
            self.sock = self._hidden_socket
        super().close()


try:
    import gevent.ssl
except ImportError:
    pass
else:

    class HTTPSConnection(HTTPConnection):
        default_port = 443

        def __init__(
            self,
            host,
            port=None,
            key_file=None,
            cert_file=None,
            context=None,
            check_hostname=None,
            **kw,
        ):
            super().__init__(host, port, **kw)
            if key_file is not None or cert_file is not None or check_hostname is not None:
                import warnings

                warnings.warn(
                    "key_file, cert_file and check_hostname are "
                    "deprecated, use a custom context instead.",
                    DeprecationWarning,
                    2,
                )
            self.key_file = key_file
            self.cert_file = cert_file or connectionpool._CA_CERTS
            if context is None:
                context = connectionpool.init_ssl_context(
                    gevent.ssl.create_default_context,
                    self.cert_file,
                    check_hostname=check_hostname,
                )
                # send ALPN extension to indicate HTTP/1.1 protocol
                if self._http_vsn == 11:
                    context.set_alpn_protocols(["http/1.1"])
                # enable PHA for TLS 1.3 connections if available
                if context.post_handshake_auth is not None:
                    context.post_handshake_auth = True
            self._context = context

        def connect(self):
            """Connect to a host on a given (SSL) port."""

            sock = gevent.socket.create_connection(
                (self.host, self.port), self.timeout, self.source_address
            )
            if self._tunnel_host:
                self.sock = sock
                self._tunnel()
            self.sock = gevent.ssl.SSLSocket(
                sock, _context=self._context, server_hostname=self.host
            )


def patch():
    http.client.HTTPConnection = HTTPConnection
    http.client.HTTPResponse = HTTPResponse
    try:
        http.client.HTTPSConnection = HTTPSConnection
    except NameError:
        pass


@contextmanager
def patched():
    """Temporarily patch http.client."""
    http_client_HTTPConnection = http.client.HTTPConnection
    http_client_HTTPResponse = http.client.HTTPResponse
    try:
        http_client_HTTPSConnection = http.client.HTTPSConnection
    except NameError:
        pass
    try:
        http.client.HTTPConnection = HTTPConnection
        http.client.HTTPResponse = HTTPResponse
        try:
            http.client.HTTPSConnection = HTTPSConnection
        except NameError:
            pass
        yield
    finally:
        http.client.HTTPConnection = http_client_HTTPConnection
        http.client.HTTPResponse = http_client_HTTPResponse
        try:
            http.client.HTTPSConnection = http_client_HTTPSConnection
        except NameError:
            pass
