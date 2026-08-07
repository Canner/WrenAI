"""Tests bounded LRU behavior for get_session_context."""

import pytest

import wren.mdl
from wren.mdl import get_session_context

pytestmark = pytest.mark.unit

# Asserted literally, never derived from the cache under test: the tests,
# not the implementation, pin the capacity policy.
EXPECTED_MAXSIZE = 32


class _FakeSessionContext:
    def __init__(self, *args, **kwargs):
        self.args = args


@pytest.fixture()
def fake_session_context(monkeypatch):
    # Keep this unit test fast and isolated from the native SessionContext.
    # setattr targets the shared wren_core module object (wren.mdl does
    # `import wren_core`), so the fake is process-wide until monkeypatch
    # restores it; clearing the cache on both sides of the yield keeps
    # fake-backed entries from leaking into other tests.
    monkeypatch.setattr(wren.mdl.wren_core, "SessionContext", _FakeSessionContext)
    get_session_context.cache_clear()
    yield
    get_session_context.cache_clear()


def _manifest(i: int) -> str:
    # Mirrors production keying: engine.py passes the per-query extracted
    # manifest as manifest_str, so distinct table subsets are distinct keys.
    return f"manifest-{i}"


def test_cache_is_bounded_to_32(fake_session_context):
    # Pin the configured cache bound as part of the public cache policy.
    assert get_session_context.cache_info().maxsize == EXPECTED_MAXSIZE

    for i in range(EXPECTED_MAXSIZE + 4):
        get_session_context(_manifest(i), None, None, None)
    assert get_session_context.cache_info().currsize == EXPECTED_MAXSIZE


def test_cache_evicts_least_recently_used(fake_session_context):
    initial_contexts = [
        get_session_context(_manifest(i), None, None, None)
        for i in range(EXPECTED_MAXSIZE)
    ]
    # Holding the originals keeps the evicted instance alive: the identity
    # assertions prove removal from the cache, not object destruction.
    victim = initial_contexts[1]

    # Refresh key 0, then overflow by one: key 1 becomes the LRU and is
    # evicted; key 0 survives.
    kept = get_session_context(_manifest(0), None, None, None)
    get_session_context(_manifest(EXPECTED_MAXSIZE), None, None, None)

    assert get_session_context(_manifest(0), None, None, None) is kept
    assert get_session_context(_manifest(1), None, None, None) is not victim
