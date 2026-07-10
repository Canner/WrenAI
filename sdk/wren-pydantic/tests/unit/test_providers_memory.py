"""Tests for MemoryProvider implementations."""

from unittest.mock import MagicMock, patch

import pytest

from wren_pydantic._providers.memory import (
    NoopMemoryProvider,
    QdrantMemoryProvider,
)
from wren_pydantic.exceptions import MemoryNotEnabledError


def test_noop_memory_provider_is_disabled():
    """NoopMemoryProvider reports as disabled and raises on open()."""
    provider = NoopMemoryProvider()

    assert provider.enabled is False

    with pytest.raises(MemoryNotEnabledError):
        provider.open()


def test_qdrant_provider_is_enabled():
    """A Qdrant provider is enabled."""
    provider = QdrantMemoryProvider()
    assert provider.enabled is True


def test_qdrant_provider_open_constructs_memory_store():
    """open() lazily constructs a wren.memory.MemoryStore against the Qdrant URL."""
    provider = QdrantMemoryProvider(url="http://localhost:6333", api_key="secret")

    fake_store = MagicMock(name="MemoryStore")
    with patch(
        "wren_pydantic._providers.memory.MemoryStore",
        return_value=fake_store,
    ) as ctor:
        store = provider.open()

    assert store is fake_store
    ctor.assert_called_once_with(url="http://localhost:6333", api_key="secret")
