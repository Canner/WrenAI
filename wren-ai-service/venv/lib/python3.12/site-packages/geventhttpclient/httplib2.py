"""
Drop-in replacement for httplib2. Make sure to monkey patch everything first!

import gevent.monkey
gevent.monkey.patch_all()

from geventhttpclient import httplib
httplib.patch()

from geventhttpclient import httplib2

http = httplib2.Http(concurrency=5)
"""

from contextlib import contextmanager

import gevent.queue

import geventhttpclient.httplib


class ClientPool:
    """
    Pool implementation for HTTP clients, that weren't designed with concurrency in mind.
    Usage example:

    pool = ClientPool(MyHttpClient)
    with pool.get() as client:
        response = client.request("127.0.0.1")
    """

    def __init__(self, factory, concurrency=5):
        self.factory = factory
        self.queue = gevent.queue.Queue(concurrency)
        for i in range(concurrency):
            self.queue.put(factory())

    @contextmanager
    def get(self):
        client = self.queue.get()
        yield client
        self.queue.put(client)

    def close(self):
        for client in self.queue:
            client.close()


with geventhttpclient.httplib.patched():
    import httplib2

    class Http:
        """Imitate a httplib2.Http client. Except that it is now run concurrently."""

        def __init__(self, *args, **kw):
            self.concurrency = max(kw.pop("concurrency", 0), 2)  # never smaller than 2
            self.args = args
            self.kw = kw
            self.pool = ClientPool(self._http_factory, concurrency=self.concurrency)

        def _http_factory(self):
            return httplib2.Http(*self.args, **self.kw)

        def request(self, *args, **kw):
            with self.pool.get() as client:
                return client.request(*args, **kw)

        def close(self):
            self.pool.close()
