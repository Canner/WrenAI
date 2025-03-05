import errno

import gevent.socket

from geventhttpclient._parser import HTTPParseError, HTTPResponseParser
from geventhttpclient.header import Headers

HEADER_STATE_INIT = 0
HEADER_STATE_FIELD = 1
HEADER_STATE_VALUE = 2
HEADER_STATE_DONE = 3


def copy(data):
    return data[:]


class HTTPConnectionClosed(HTTPParseError):
    pass


class HTTPProtocolViolationError(HTTPParseError):
    pass


class HTTPResponse(HTTPResponseParser):
    def __init__(self, method="GET", headers_type=Headers):
        super().__init__()
        self.method = method.upper()
        self.headers_complete = False
        self.message_begun = False
        self.message_complete = False
        self._headers_index = headers_type()
        self._header_state = HEADER_STATE_INIT
        self._current_header_field = None
        self._current_header_value = None
        self._header_position = 1
        self._body_buffer = bytearray()
        self.status_message = None

    def __getitem__(self, key):
        return self._headers_index[key]

    def get(self, key, default=None):
        return self._headers_index.get(key, default)

    def items(self):
        return self._headers_index.items()

    headers = property(items)

    def info(self):
        # compatibility with http.client
        return self._headers_index

    def __contains__(self, key):
        return key in self._headers_index

    def should_close(self):
        """return if we should close the connection.

        It is not the opposite of should_keep_alive method. It also checks
        that the body as been consumed completely.
        """
        return not self.message_complete or self.parser_failed() or not super().should_keep_alive()

    @property
    def status_code(self):
        return self.get_code()

    @property
    def content_length(self):
        length = self.get("content-length", None)
        if length is not None:
            return int(length)

    @property
    def length(self):
        return self.content_length

    @property
    def version(self):
        return self.get_http_version()

    def _on_status(self, msg):
        self.status_message = msg

    def _on_message_begin(self):
        if self.message_begun:
            raise HTTPProtocolViolationError(f"A new response began before end of {self!r}.")
        self.message_begun = True

    def _on_message_complete(self):
        self.message_complete = True

    def _on_headers_complete(self):
        self._flush_header()
        self._header_state = HEADER_STATE_DONE
        self.headers_complete = True

        if self.method == "HEAD":
            return True  # SKIP BODY
        return False

    def _on_header_field(self, string):
        if self._header_state == HEADER_STATE_FIELD:
            self._current_header_field += string
        else:
            if self._header_state == HEADER_STATE_VALUE:
                self._flush_header()
            self._current_header_field = string

        self._header_state = HEADER_STATE_FIELD

    def _on_header_value(self, string):
        if self._header_state == HEADER_STATE_VALUE:
            self._current_header_value += string
        else:
            self._current_header_value = string

        self._header_state = HEADER_STATE_VALUE

    def _flush_header(self):
        if self._current_header_field is not None:
            self._headers_index.add(self._current_header_field, self._current_header_value)
            self._header_position += 1
            self._current_header_field = None
            self._current_header_value = None

    def _on_body(self, buf):
        self._body_buffer += buf

    def __repr__(self):
        return f"<{self.__class__.__name__} status={self.status_code} headers={dict(self.headers)}>"


class HTTPSocketResponse(HTTPResponse):
    DEFAULT_BLOCK_SIZE = 1024 * 4  # 4KB

    def __init__(
        self, sock, block_size=DEFAULT_BLOCK_SIZE, method="GET", headers_type=Headers, **kw
    ):
        super().__init__(method=method, headers_type=headers_type)
        self._sock = sock
        self.block_size = block_size
        self._read_headers()

    def release(self):
        try:
            if self._sock is not None and self.should_close():
                try:
                    self._sock.close()
                except:  # noqa
                    pass
        finally:
            self._sock = None

    def __del__(self):
        self.release()

    def _read_headers(self):
        try:
            start = True
            while not self.headers_complete:
                try:
                    data = self._sock.recv(self.block_size)
                    self.feed(data)
                    # depending on gevent version we get a conn reset or no data
                    if not len(data) and not self.headers_complete:
                        if start:
                            raise HTTPConnectionClosed("connection closed.")
                        raise HTTPParseError("connection closed before end of the headers")
                    start = False
                except gevent.socket.error as e:
                    if e.errno == errno.ECONNRESET:
                        if start:
                            raise HTTPConnectionClosed("connection closed.")
                    raise

            if self.message_complete:
                self.release()
        except BaseException:
            self.release()
            raise

    def readline(self, sep=b"\r\n"):
        cursor = 0
        multibyte = len(sep) > 1
        while True:
            cursor = self._body_buffer.find(sep[0:1], cursor)
            if cursor >= 0:
                found = True
                if multibyte:
                    pos = cursor
                    cursor = self._body_buffer.find(sep, cursor)
                    if cursor < 0:
                        cursor = pos
                        found = False
                if found:
                    length = cursor + len(sep)
                    line = copy(self._body_buffer[:length])
                    del self._body_buffer[:length]
                    cursor = 0
                    return line
            else:
                cursor = 0
            if self.message_complete:
                return b""
            try:
                data = self._sock.recv(self.block_size)
                self.feed(data)
            except BaseException:
                self.release()
                raise

    def read(self, length=None):
        # get the existing body that may have already been parsed
        # during headers parsing
        if length is not None and len(self._body_buffer) >= length:
            read = self._body_buffer[0:length]
            del self._body_buffer[0:length]
            return copy(read)

        if self._sock is None:
            read = copy(self._body_buffer)
            del self._body_buffer[:]
            return read

        try:
            while not self.message_complete and (length is None or len(self._body_buffer) < length):
                data = self._sock.recv(length or self.block_size)
                self.feed(data)
        except:
            self.release()
            raise

        if length is not None:
            read = copy(self._body_buffer[0:length])
            del self._body_buffer[0:length]
            return read

        read = copy(self._body_buffer)
        del self._body_buffer[:]
        return read

    def __iter__(self):
        return self

    def next(self):
        bytes = self.read(self.block_size)
        if not len(bytes):
            raise StopIteration()
        return bytes

    def _on_message_complete(self):
        super()._on_message_complete()
        self.release()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.release()


class HTTPSocketPoolResponse(HTTPSocketResponse):
    def __init__(self, sock, pool, **kw):
        self._pool = pool
        super().__init__(sock, **kw)

    def release(self):
        try:
            if self._sock is not None:
                if self.should_close():
                    self._pool.release_socket(self._sock)
                else:
                    self._pool.return_socket(self._sock)
        finally:
            self._sock = None
            self._pool = None

    def __del__(self):
        if self._sock is not None:
            self._pool.release_socket(self._sock)
