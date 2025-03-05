import os

import gevent.queue
import gevent.socket
from gevent import lock

_CA_CERTS = None

try:
    from ssl import get_default_verify_paths
except ImportError:
    _CA_CERTS = None
else:
    _certs = get_default_verify_paths()
    _CA_CERTS = _certs.cafile or _certs.capath

if not _CA_CERTS or os.path.isdir(_CA_CERTS):
    import certifi

    _CA_CERTS = certifi.where()

_DEFAULT_CIPHERS = (
    "ECDH+AESGCM:DH+AESGCM:ECDH+AES256:DH+AES256:ECDH+AES128:DH+AES:ECDH+HIGH:"
    "DH+HIGH:ECDH+3DES:DH+3DES:RSA+AESGCM:RSA+AES:RSA+HIGH:RSA+3DES:ECDH+RC4:"
    "DH+RC4:RSA+RC4:!aNULL:!eNULL:!MD5"  # codespell-ignore
)


DEFAULT_CONNECTION_TIMEOUT = 5.0
DEFAULT_NETWORK_TIMEOUT = 5.0

IGNORED = object()


class ConnectionPool:
    DEFAULT_CONNECTION_TIMEOUT = 5.0
    DEFAULT_NETWORK_TIMEOUT = 5.0

    def __init__(
        self,
        connection_host,
        connection_port,
        request_host,
        request_port,
        size=5,
        disable_ipv6=False,
        connection_timeout=DEFAULT_CONNECTION_TIMEOUT,
        network_timeout=DEFAULT_NETWORK_TIMEOUT,
        use_proxy=False,
    ):
        self._closed = False
        self._connection_host = connection_host
        self._connection_port = connection_port
        self._request_host = request_host
        self._request_port = request_port
        self._semaphore = lock.BoundedSemaphore(size)
        self._socket_queue = gevent.queue.LifoQueue(size)
        self._use_proxy = use_proxy

        self.connection_timeout = connection_timeout
        self.network_timeout = network_timeout
        self.size = size
        self.disable_ipv6 = disable_ipv6

    def _resolve(self):
        """resolve (dns) socket information needed to connect it."""
        family = 0
        if self.disable_ipv6:
            family = gevent.socket.AF_INET
        info = gevent.socket.getaddrinfo(
            self._connection_host,
            self._connection_port,
            family,
            0,
            gevent.socket.SOL_TCP,
        )
        # family, socktype, proto, canonname, sockaddr = info[0]
        return info

    def close(self):
        self._closed = True
        while not self._socket_queue.empty():
            try:
                sock = self._socket_queue.get(block=False)
                try:
                    sock.close()
                except:  # noqa
                    pass
            except gevent.queue.Empty:
                pass

    def _create_tcp_socket(self, family, socktype, protocol):
        """tcp socket factory."""
        sock = gevent.socket.socket(family, socktype, protocol)
        return sock

    def _create_socket(self):
        """might be overridden and super for wrapping into a ssl socket
        or set tcp/socket options
        """
        sock_infos = self._resolve()
        first_error = None
        for sock_info in sock_infos:
            try:
                sock = self._create_tcp_socket(*sock_info[:3])
            except Exception as e:
                if not first_error:
                    first_error = e
                continue

            try:
                sock.settimeout(self.connection_timeout)
                sock = self._connect_socket(sock, sock_info[-1])
                self.after_connect(sock)
                sock.settimeout(self.network_timeout)
                return sock
            except OSError as e:
                sock.close()
                if not first_error:
                    first_error = e
            except:  # noqa
                sock.close()
                raise

        if first_error:
            raise first_error
        else:
            raise RuntimeError(f"Cannot resolve {self._host}:{self._port}")

    def after_connect(self, sock):
        pass

    def _connect_socket(self, sock, address):
        sock.connect(address)
        self._setup_proxy(sock)
        return sock

    def _setup_proxy(self, sock):
        if self._use_proxy:
            sock.send(
                bytes(
                    f"CONNECT {self._request_host}:{self._request_port} HTTP/1.1\r\n\r\n",
                    "utf8",
                )
            )

            resp = sock.recv(4096)
            parts = resp.split()
            if not parts or parts[1] != b"200":
                raise RuntimeError(f"Error response from Proxy server : {resp}")

    def get_socket(self):
        """get a socket from the pool. This blocks until one is available."""
        self._semaphore.acquire()
        if self._closed:
            raise RuntimeError("connection pool closed")
        try:
            return self._socket_queue.get(block=False)
        except gevent.queue.Empty:
            try:
                return self._create_socket()
            except:  # noqa
                self._semaphore.release()
                raise

    def return_socket(self, sock):
        """return a socket to the pool."""
        if self._closed:
            try:
                sock.close()
            except:  # noqa
                pass
            return
        self._socket_queue.put(sock)
        self._semaphore.release()

    def release_socket(self, sock):
        """call when the socket is no more usable."""
        try:
            sock.close()
        except:  # noqa
            pass
        if not self._closed:
            self._semaphore.release()


try:
    from ssl import PROTOCOL_TLS_CLIENT

    import gevent.ssl

    try:
        from gevent.ssl import create_default_context
    except ImportError:
        create_default_context = None

except ImportError:
    pass
else:

    def init_ssl_context(
        ssl_context_factory, ca_certs, check_hostname=True, ssl_options=None
    ) -> gevent.ssl.SSLContext:
        """
        Initializes an SSL context with additional SSL options.

        :param ssl_context_factory: Callable to create an SSL context
        :param ca_certs: Path to CA certificates file
        :param check_hostname: Whether to enable hostname checking
        :param ssl_options: Optional dictionary of additional SSL options
        :return: Configured SSLContext instance
        """
        ssl_options = ssl_options or {}

        try:
            ssl_context = ssl_context_factory(cafile=ca_certs)
        except TypeError:
            ssl_context = ssl_context_factory()
            ssl_context.load_verify_locations(cafile=ca_certs)

        ssl_context.check_hostname = check_hostname
        if check_hostname:
            ssl_context.verify_mode = gevent.ssl.CERT_REQUIRED

        if "certfile" in ssl_options and "keyfile" in ssl_options:
            ssl_context.load_cert_chain(
                certfile=ssl_options["certfile"], keyfile=ssl_options["keyfile"]
            )

        if "ciphers" in ssl_options:
            ssl_context.set_ciphers(ssl_options["ciphers"])

        # Apply additional SSL options (e.g., options, verify_flags)
        for option in ["options", "verify_flags"]:
            if option in ssl_options:
                setattr(ssl_context, option, ssl_options[option])

        return ssl_context

    class SSLConnectionPool(ConnectionPool):
        """SSLConnectionPool creates connections wrapped with SSL/TLS.

        :param host: hostname
        :param port: port
        :param ssl_options: accepts any options supported by `ssl.wrap_socket`
        :param ssl_context_factory: use `ssl.create_default_context` by default
            if provided. It must be a callable that returns a SSLContext.
        """

        default_options = {
            "ciphers": _DEFAULT_CIPHERS,
            "ca_certs": _CA_CERTS,
            "cert_reqs": gevent.ssl.CERT_REQUIRED,
            "ssl_version": PROTOCOL_TLS_CLIENT,
        }

        def __init__(
            self,
            connection_host,
            connection_port,
            request_host,
            request_port,
            insecure=False,
            ssl_context_factory=None,
            ssl_options=None,
            **kw,
        ):
            self.insecure = insecure

            self.ssl_options = self.default_options.copy()
            self.ssl_options.update(ssl_options or {})

            ssl_context_factory = ssl_context_factory or create_default_context
            if ssl_context_factory is not None:
                self.ssl_context = init_ssl_context(
                    ssl_context_factory,
                    self.ssl_options["ca_certs"],
                    check_hostname=not self.insecure,
                    ssl_options=ssl_options,
                )
            else:
                self.ssl_context = None

            super().__init__(connection_host, connection_port, request_host, request_port, **kw)

        def _connect_socket(self, sock, address):
            sock = super()._connect_socket(sock, address)

            if self.ssl_context is None:
                # create_default_context not available
                return gevent.ssl.wrap_socket(sock, **self.ssl_options)

            server_hostname = self.ssl_options.get("server_hostname", self._request_host)
            return self.ssl_context.wrap_socket(sock, server_hostname=server_hostname)
