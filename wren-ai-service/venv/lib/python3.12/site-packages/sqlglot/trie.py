import typing as t
from enum import Enum, auto

key = t.Sequence[t.Hashable]


class TrieResult(Enum):
    FAILED = auto()
    PREFIX = auto()
    EXISTS = auto()


def new_trie(keywords: t.Iterable[key], trie: t.Optional[t.Dict] = None) -> t.Dict:
    """
    Creates a new trie out of a collection of keywords.

    The trie is represented as a sequence of nested dictionaries keyed by either single
    character strings, or by 0, which is used to designate that a keyword is in the trie.

    Example:
        >>> new_trie(["bla", "foo", "blab"])
        {'b': {'l': {'a': {0: True, 'b': {0: True}}}}, 'f': {'o': {'o': {0: True}}}}

    Args:
        keywords: the keywords to create the trie from.
        trie: a trie to mutate instead of creating a new one

    Returns:
        The trie corresponding to `keywords`.
    """
    trie = {} if trie is None else trie

    for key in keywords:
        current = trie
        for char in key:
            current = current.setdefault(char, {})

        current[0] = True

    return trie


def in_trie(trie: t.Dict, key: key) -> t.Tuple[TrieResult, t.Dict]:
    """
    Checks whether a key is in a trie.

    Examples:
        >>> in_trie(new_trie(["cat"]), "bob")
        (<TrieResult.FAILED: 1>, {'c': {'a': {'t': {0: True}}}})

        >>> in_trie(new_trie(["cat"]), "ca")
        (<TrieResult.PREFIX: 2>, {'t': {0: True}})

        >>> in_trie(new_trie(["cat"]), "cat")
        (<TrieResult.EXISTS: 3>, {0: True})

    Args:
        trie: The trie to be searched.
        key: The target key.

    Returns:
        A pair `(value, subtrie)`, where `subtrie` is the sub-trie we get at the point
        where the search stops, and `value` is a TrieResult value that can be one of:

        - TrieResult.FAILED: the search was unsuccessful
        - TrieResult.PREFIX: `value` is a prefix of a keyword in `trie`
        - TrieResult.EXISTS: `key` exists in `trie`
    """
    if not key:
        return (TrieResult.FAILED, trie)

    current = trie
    for char in key:
        if char not in current:
            return (TrieResult.FAILED, current)
        current = current[char]

    if 0 in current:
        return (TrieResult.EXISTS, current)

    return (TrieResult.PREFIX, current)
