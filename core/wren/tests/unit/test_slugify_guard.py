"""slugify must tolerate None/non-str NL text."""
from wren.memory.markdown import slugify


def test_slugify_none():
    assert slugify(None) == "query"


def test_slugify_non_str():
    assert slugify(123) == "123"


def test_slugify_normal():
    assert slugify("Hello World!") == "hello-world"
