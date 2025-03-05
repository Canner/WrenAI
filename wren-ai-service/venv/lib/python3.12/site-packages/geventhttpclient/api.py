"""
This module mimics and blatantly borrows with all due respect
from the excellent and rightfully popular Requests API.

Copyright of the original requests project:

:copyright: (c) 2012 by Kenneth Reitz.
:license: Apache2, see LICENSE for more details.
"""

import geventhttpclient.requests


def request(method, url, **kw):
    """Constructs and sends a HTTP request. WARNING: Only a subset of the following parameters is currently supported

    :param method: method for the new request object: ``GET``, ``OPTIONS``, ``HEAD``, ``POST``, ``PUT``, ``PATCH``, or ``DELETE``.
    :param url: URL for the new HTTP Request object.
    :param params: (optional) Dictionary, list of tuples or bytes to send
        in the query string for the HTTP Request.
    :param data: (optional) Dictionary, list of tuples, bytes, or file-like
        object to send in the body of the HTTP Request.
    :param json: (optional) A JSON serializable Python object to send in the body of the HTTP Request.
    :param headers: (optional) Dictionary of HTTP Headers to send with the HTTP Request.
    :param cookies: (optional) Dict or CookieJar object to send with the HTTP Request.
    :param files: (optional) Dictionary of ``'name': file-like-objects`` (or ``{'name': file-tuple}``) for multipart encoding upload.
        ``file-tuple`` can be a 2-tuple ``('filename', fileobj)``, 3-tuple ``('filename', fileobj, 'content_type')``
        or a 4-tuple ``('filename', fileobj, 'content_type', custom_headers)``, where ``'content-type'`` is a string
        defining the content type of the given file and ``custom_headers`` a dict-like object containing additional headers
        to add for the file.
    :param auth: (optional) Auth tuple to enable Basic/Digest/Custom HTTP Auth.
    :param timeout: (optional) How many seconds to wait for the server to send data
        before giving up, as a float, or a :ref:`(connect timeout, read
        timeout) <timeouts>` tuple.
    :type timeout: float or tuple
    :param allow_redirects: (optional) Boolean. Enable/disable GET/OPTIONS/POST/PUT/PATCH/DELETE/HEAD redirection. Defaults to ``True``.
    :type allow_redirects: bool
    :param proxies: (optional) Dictionary mapping protocol to the URL of the proxy.
    :param verify: (optional) Either a boolean, in which case it controls whether we verify
            the server's TLS certificate, or a string, in which case it must be a path
            to a CA bundle to use. Defaults to ``True``.
    :param stream: (optional) if ``False``, the response content will be immediately downloaded.
    :param cert: (optional) if String, path to ssl client cert file (.pem). If Tuple, ('cert', 'key') pair.
    :return: HTTP Response object
    :rtype: HTTP Response

    Usage::

      >>> import geventhttpclient
      >>> req = geventhttpclient.request('GET', 'https://httpbingo.org/get')
      >>> req
      <Response [200]>
    """

    # By using the 'with' statement we are sure the session is closed, thus we
    # avoid leaving sockets open which can trigger a ResourceWarning in some
    # cases, and look like a memory leak in others.
    with geventhttpclient.requests.Session() as session:
        return session.request(method=method, url=url, **kw)


def get(url, params=None, **kw):
    r"""Sends a GET request.

    :param url: URL for the new HTTP Request object.
    :param params: (optional) Dictionary, list of tuples or bytes to send
        in the query string for the HTTP Request.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("get", url, params=params, **kw)


def options(url, **kw):
    r"""Sends an OPTIONS request.

    :param url: URL for the new HTTP Request object.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("options", url, **kw)


def head(url, **kw):
    r"""Sends a HEAD request.

    :param url: URL for the new HTTP Request object.
    :param \*\*kw: Optional arguments that ``request`` takes. If
        `allow_redirects` is not provided, it will be set to `False` (as
        opposed to the default :meth:`request` behavior).
    :return: HTTP Response object
    :rtype: requests.Response
    """

    kw.setdefault("allow_redirects", False)
    return request("head", url, **kw)


def post(url, data=None, json=None, **kw):
    r"""Sends a POST request.

    :param url: URL for the new HTTP Request object.
    :param data: (optional) Dictionary, list of tuples, bytes, or file-like
        object to send in the body of the HTTP Request.
    :param json: (optional) A JSON serializable Python object to send in the body of the HTTP Request.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("post", url, data=data, json=json, **kw)


def put(url, data=None, **kw):
    r"""Sends a PUT request.

    :param url: URL for the new HTTP Request object.
    :param data: (optional) Dictionary, list of tuples, bytes, or file-like
        object to send in the body of the HTTP Request.
    :param json: (optional) A JSON serializable Python object to send in the body of the HTTP Request.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("put", url, data=data, **kw)


def patch(url, data=None, **kw):
    r"""Sends a PATCH request.

    :param url: URL for the new HTTP Request object.
    :param data: (optional) Dictionary, list of tuples, bytes, or file-like
        object to send in the body of the HTTP Request.
    :param json: (optional) A JSON serializable Python object to send in the body of the HTTP Request.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("patch", url, data=data, **kw)


def delete(url, **kw):
    r"""Sends a DELETE request.

    :param url: URL for the new HTTP Request object.
    :param \*\*kw: Optional arguments that ``request`` takes.
    :return: HTTP Response object
    :rtype: requests.Response
    """

    return request("delete", url, **kw)
