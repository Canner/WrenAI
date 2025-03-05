from collections.abc import Mapping, MutableMapping

_dict_setitem = dict.__setitem__
_dict_getitem = dict.__getitem__
_dict_delitem = dict.__delitem__
_dict_contains = dict.__contains__
_dict_setdefault = dict.setdefault
_dict_items = dict.items
_dict_values = dict.values


class Headers(dict):
    """
    :param headers:
        An iterable of field-value pairs.

    :param kwargs:
        Additional field-value pairs to pass in to ``Headers.extend``.

    A ``dict`` like container for storing HTTP Headers.

    According to RFC 7230, header field names have to be treated case-insentitive.
    This means `SET-COOKIE` as header field denotes the same field as `set-cookie`.

    In order to implement this behavior efficiently, all header names are lowered
    and used as dictionary key for fast access of certain header lines. The original
    case-sensitive header field is stored alongside the values under the hood.

    Iterating over Header.items() returns all field-value pairs with the original
    cases. The order of the returned items matches the input order, except that
    headers with a matching header field are grouped.

    Use Header.__setitem__() and Header.update() for overwriting the content
    of matching header fields and .add() and .extend() for appending header
    lines instead of overwriting them.

    Note: b"asdf" and "asdf" are separate things. This class tries not to
    enforce the one or the other.

    >>> headers = Headers()
    >>> headers.add('Set-Cookie', 'foo=bar')
    >>> headers.add('set-cookie', 'baz=quxx')
    >>> headers['SET-cookie']
    ['foo=bar', 'baz=quxx']
    >>> headers['content-length'] = '7'
    >>> headers['Content-Length']
    '7'
    >>> headers
    Headers({'Set-Cookie': 'foo=bar, baz=quxx', 'content-length': '7'})
    """

    def __init__(self, headers=None, **kwargs):
        dict.__init__(self)
        if headers is not None:
            if isinstance(headers, type(self)):
                self._copy_from(headers)
            else:
                self.extend(headers)
        if kwargs:
            self.extend(kwargs)

    def __setitem__(self, field, value):
        return _dict_setitem(self, field.lower(), (field, value))

    def __getitem__(self, field):
        vals = _dict_getitem(self, field.lower())
        if isinstance(vals, tuple):
            return vals[1]
        return [val[1] for val in vals]

    def __delitem__(self, field):
        return _dict_delitem(self, field.lower())

    def __contains__(self, field):
        return _dict_contains(self, field.lower())

    def __eq__(self, other):
        if not isinstance(other, Mapping) and not hasattr(other, "keys"):
            return False
        if not isinstance(other, type(self)):
            other = type(self)(other)
        return {f1: self[f1] for f1 in self} == {f2: other[f2] for f2 in other}

    def __ne__(self, other):
        return not self.__eq__(other)

    values = MutableMapping.values
    get = MutableMapping.get
    keys = MutableMapping.keys

    __marker = object()

    def pop(self, field, default=__marker):
        """D.pop(field[,default]) -> value, remove specified field and return the corresponding value.
        If field is not found, d is returned if given, otherwise KeyError is raised.
        """
        # Using the MutableMapping function directly fails due to the private marker.
        # Using ordinary dict.pop would expose the internal structures.
        # So let's reinvent the wheel.
        try:
            value = self[field]
        except KeyError:
            if default is self.__marker:
                raise
            return default
        del self[field]
        return value

    def discard(self, field):
        try:
            del self[field]
        except KeyError:
            pass

    def add(self, field, value):
        """Add a (field, value) pair without overwriting the value if it already
        exists.

        >>> headers = Headers(foo='bar')
        >>> headers.add('Foo', 'baz')
        >>> headers['foo']
        'bar, baz'
        """
        field_lower = field.lower()
        new_vals = field, value
        # Keep the common case aka no item present as fast as possible
        vals = _dict_setdefault(self, field_lower, new_vals)
        if new_vals is not vals:
            # new_vals was not inserted, as there was a previous one
            if isinstance(vals, tuple):
                # Only one item so far, create a list and append new_vals
                _dict_setitem(self, field_lower, [vals, new_vals])
            elif isinstance(vals, list):
                # Already several items got inserted, we have a list
                vals.append(new_vals)
            else:
                raise TypeError("invalid vals stored")

    def extend(self, *args, **kwargs):
        """Generic import function for any type of header-like object.
        Adapted version of MutableMapping.update in order to insert items
        with self.add instead of self.__setitem__
        """
        if len(args) > 1:
            raise TypeError(f"extend() takes at most 1 positional argument ({len(args)} given)")
        other = args[0] if len(args) >= 1 else ()

        if isinstance(other, type(self)):
            for field, value in other.items():
                self.add(field, value)
        elif isinstance(other, Mapping):
            for field in other:
                self.add(field, other[field])
        elif hasattr(other, "keys"):
            for field in other.fields():
                self.add(field, other[field])
        else:
            for field, value in other:
                self.add(field, value)

        for field, value in kwargs.items():
            self.add(field, value)

    def update(self, *args, **kwargs):
        """Generic import function for any type of header-like object.
        Adapted version of MutableMapping.update in order to overwrite items
        while preserving case-sensitive header fields.
        """
        if len(args) > 1:
            raise TypeError(f"extend() takes at most 1 positional argument ({len(args)} given)")
        other = args[0] if len(args) >= 1 else ()

        if isinstance(other, type(self)):
            for field, value in other.items():
                self[field] = value
        elif isinstance(other, Mapping):
            for field in other:
                self[field] = other[field]
        elif hasattr(other, "keys"):
            for field in other.keys():
                self[field] = other[field]
        else:
            for field, value in other:
                self[field] = value

        for field, value in kwargs.items():
            self[field] = value

    def getlist(self, field):
        """Returns a list of all the values for the named field. Returns an
        empty list if the field doesn't exist.
        """
        try:
            vals = _dict_getitem(self, field.lower())
        except KeyError:
            return []
        if isinstance(vals, tuple):
            return [vals[1]]
        return [val[1] for val in vals]

    def get_all(self, field, failobj=None):
        values = self.getlist(field)
        if not values:
            return failobj
        return values

    def _copy_from(self, other):
        for field in other:
            vals = _dict_getitem(other, field)
            if isinstance(vals, list):
                # No need to clone immutable tuples, only lists
                vals = list(vals)
            _dict_setitem(self, field, vals)

    def copy(self):
        clone = type(self)()
        clone._copy_from(self)
        return clone

    def __len__(self):
        return sum(1 if isinstance(vals, tuple) else len(vals) for vals in _dict_values(self))

    def __repr__(self):
        return f"{type(self).__name__}({dict(self.itermerged())})"

    def __str__(self):
        """Return a similar string as the original HTTP text received for parsing. Lines with
        matching header fields are grouped.
        """
        return "\n".join(f"{field}: {value}" for field, value in self.items())

    def itermerged(self):
        """Iterate over all headers, merging lines with duplicate header
        fields together into one item. The case of the first header field
        is preserved.
        """
        for field, vals in _dict_items(self):
            if isinstance(vals, tuple):
                yield vals
            else:
                # this should preserve either binary or string type
                sep = ", " if isinstance(vals[0][0], str) else b", "
                yield vals[0][0], sep.join(val[1] for val in vals)

    def compatible_dict(self):
        """Create a dictionary. Header lines with duplicate field names are
        merged into one line. This can be used for exchange with other
        libraries.
        """
        return dict(self.itermerged())

    def iterlower(self):
        """Iterate over all header lines, including duplicate ones.
        The header fields are all lowered.
        """
        for field, vals in _dict_items(self):
            if isinstance(vals, tuple):
                yield field, vals[1]
            else:
                for val in vals:
                    yield field, val[1]

    def items(self):
        """Iterate over all header lines, including duplicate ones."""
        for field, vals in _dict_items(self):
            if isinstance(vals, tuple):
                yield vals
            else:
                yield from vals

    # Compatibility with http.client
    getheaders = getlist
    getallmatchingheaders = getlist

    def iteroriginal(self):
        import warnings

        warnings.warn(
            "This is deprecated and will be removed in version v2.3.0. "
            "Use Headers.items() instead.",
            DeprecationWarning,
            2,
        )
        return self.items()

    def iget(self, field):
        import warnings

        warnings.warn(
            "This is deprecated and will be removed in version v2.3.0. "
            "Use Headers.getlist() instead.",
            DeprecationWarning,
            2,
        )
        return self.getlist(field)
