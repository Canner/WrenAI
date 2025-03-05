import json as jsonlib
from http.cookiejar import CookieJar

from geventhttpclient import useragent


class RequestsRequest(useragent.CompatRequest):
    @property
    def body(self):
        return self.payload


class RequestsResponse(useragent.CompatResponse):
    @property
    def request(self):
        return self._request

    @property
    def ok(self):
        return 100 <= self.status_code < 400

    @property
    def reason(self):
        return self._response.status_message

    @property
    def url(self):
        return self._request.url

    @property
    def is_redirect(self):
        """True if this Response is a well-formed HTTP redirect that could have
        been processed automatically (by :meth:`Session.resolve_redirects`).
        """
        return "location" in self.headers and self.status_code in range(300, 310)

    @property
    def raw(self):
        return self.stream

    def raise_for_status(self):
        if 400 <= self.status_code < 600:
            raise useragent.BadStatusCode(self.url, code=self.status_code)


class Session(useragent.UserAgent):
    """This class mimics and blatantly borrows with all due respect
    from the excellent and rightfully popular Requests API.

    Copyright of the original requests project:

    :copyright: (c) 2012 by Kenneth Reitz.
    :license: Apache2, see LICENSE for more details.
    """

    request_type = RequestsRequest
    response_type = RequestsResponse

    def get(self, url, **kw):
        r"""Sends a GET request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        kw.setdefault("allow_redirects", True)
        return self.request("GET", url, **kw)

    def options(self, url, **kw):
        r"""Sends a OPTIONS request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        kw.setdefault("allow_redirects", True)
        return self.request("OPTIONS", url, **kw)

    def head(self, url, **kw):
        r"""Sends a HEAD request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        kw.setdefault("allow_redirects", False)
        return self.request("HEAD", url, **kw)

    def post(self, url, data=None, json=None, **kw):
        r"""Sends a POST request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param data: (optional) Dictionary, list of tuples, bytes, or file-like
            object to send in the body of the HTTP Request.
        :param json: (optional) json to send in the body of the HTTP Request.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        return self.request("POST", url, data=data, json=json, **kw)

    def put(self, url, data=None, **kw):
        r"""Sends a PUT request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param data: (optional) Dictionary, list of tuples, bytes, or file-like
            object to send in the body of the HTTP Request.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        return self.request("PUT", url, data=data, **kw)

    def patch(self, url, data=None, **kw):
        r"""Sends a PATCH request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param data: (optional) Dictionary, list of tuples, bytes, or file-like
            object to send in the body of the HTTP Request.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        return self.request("PATCH", url, data=data, **kw)

    def delete(self, url, **kw):
        r"""Sends a DELETE request. Returns a HTTP Response object.

        :param url: URL for the new a HTTP Request object.
        :param \*\*kw: Optional arguments that ``request`` takes.
        :rtype: CompatResponse
        """

        return self.request("DELETE", url, **kw)

    def request(
        self,
        method,
        url,
        params=None,
        data=None,
        headers=None,
        cookies=None,
        files=None,
        auth=None,
        timeout=None,
        allow_redirects=True,
        proxies=None,
        hooks=None,
        stream=None,
        verify=None,
        cert=None,
        json=None,
    ):
        """Constructs and sends a HTTP request, returns a HTTP Response object.

        NOTE: Only a subset of these parameters is currently (fully) supported.
        And it's also not

        :param method: method for the new request object.
        :param url: URL for the new request object.
        :param params: (optional) Dictionary or bytes to be sent in the query
            string for the request.
        :param data: (optional) Dictionary, list of tuples, bytes, or file-like
            object to send in the body of the request.
        :param json: (optional) json to send in the body of the
            HTTP Request.
        :param headers: (optional) Dictionary of HTTP Headers to send with the
            HTTP Request.
        :param cookies: (optional) Dict or CookieJar object to send with the
            HTTP Request.
        :param files: (optional) Dictionary of ``'filename': file-like-objects``
            for multipart encoding upload.
        :param auth: (optional) Auth tuple or callable to enable
            Basic/Digest/Custom HTTP Auth.
        :param timeout: (optional) How long to wait for the server to send
            data before giving up, as a float, or a :ref:`(connect timeout,
            read timeout) <timeouts>` tuple.
        :type timeout: float or tuple
        :param allow_redirects: (optional) Set to True by default.
        :type allow_redirects: bool
        :param proxies: (optional) Dictionary mapping protocol or protocol and
            hostname to the URL of the proxy.
        :param stream: (optional) whether to immediately download the response
            content. Defaults to ``False``.
        :param verify: (optional) Either a boolean, in which case it controls whether we verify
            the server's TLS certificate, or a string, in which case it must be a path
            to a CA bundle to use. Defaults to ``True``. When set to
            ``False``, requests will accept any TLS certificate presented by
            the server, and will ignore hostname mismatches and/or expired
            certificates, which will make your application vulnerable to
            man-in-the-middle (MitM) attacks. Setting verify to ``False``
            may be useful during local development or testing.
        :param cert: (optional) if String, path to ssl client cert file (.pem).
            If Tuple, ('cert', 'key') pair.
        :rtype: CompatResponse
        """
        for param_name, param in dict(timeout=timeout, cert=cert, verify=verify).items():
            if param is not None:
                raise ValueError(
                    f"{param} can not be set on a per-request basis. Please configure the UserAgent instead."
                )
        for param_name, param in dict(
            cookies=cookies, auth=auth, proxies=proxies, hooks=hooks
        ).items():
            if param is not None:
                raise NotImplementedError(
                    f"{param} is currently unsupported as a keyword argument."
                )
        for param_name, param in dict(hooks=hooks).items():
            if param is not None:
                raise NotImplementedError(f"{param} is not supported")

        if json:
            if data:
                raise ValueError("Can send either data or json, not both at once")
            data = jsonlib.dumps(json)
            if headers is None:
                headers = {}
            headers["Content-Type"] = "application/json"

        response = self.urlopen(
            url,
            method=method.upper(),
            headers=headers,
            files=files,
            payload=data or None,
            params=params,
            max_redirects=None if allow_redirects else 0,
        )
        if stream is False:
            # preload the data
            _ = response.content
        return response

    def __init__(self, *args, **kw):
        """
        requests.Session has no arguments at all. Unfortunately, we're relying way more
        on configuring the Session / UserAgent, while requests focuses more on
        configuring the single requests.
        """
        kw.setdefault("max_redirects", 30)
        super().__init__(*args, **kw)
        if not self.cookiejar:
            self.cookiejar = CookieJar()

    def _verify_status(self, status_code, url=None):
        # Don't raise, whatever the status is
        pass
