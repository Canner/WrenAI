"""Tests for the _MemoryAPI subscope (toolkit.memory.*)."""

from unittest.mock import MagicMock, patch

import pytest

from wren_pydantic import WrenToolkit
from wren_pydantic.exceptions import MemoryNotEnabledError


def _enable_memory(tmp_project):
    """Helper: create .wren/memory directory so memory auto-enables."""
    (tmp_project / ".wren" / "memory").mkdir(parents=True)
    return tmp_project


def test_memory_fetch_calls_get_context_with_manifest(tmp_project, fake_active_profile):
    """toolkit.memory.fetch passes the loaded manifest to MemoryStore.get_context."""
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.get_context.return_value = {"strategy": "search", "results": []}

    toolkit = WrenToolkit.from_project(project)

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        result = toolkit.memory.fetch("revenue trends", limit=3)

    assert result == {"strategy": "search", "results": []}
    fake_store.get_context.assert_called_once()
    kwargs = fake_store.get_context.call_args.kwargs
    assert kwargs["query"] == "revenue trends"
    assert kwargs["limit"] == 3
    # manifest is loaded read-through and passed through.
    assert "manifest" in kwargs


def test_memory_recall_calls_recall_queries(tmp_project, fake_active_profile):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.recall_queries.return_value = [{"nl": "x", "sql": "SELECT 1"}]

    toolkit = WrenToolkit.from_project(project)

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        result = toolkit.memory.recall("top customers", limit=5)

    assert result == [{"nl": "x", "sql": "SELECT 1"}]
    fake_store.recall_queries.assert_called_once_with(query="top customers", limit=5)


def test_memory_store_calls_store_query(tmp_project, fake_active_profile):
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    toolkit = WrenToolkit.from_project(project)

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        toolkit.memory.store(
            nl="top customers",
            sql="SELECT * FROM customers ORDER BY revenue DESC LIMIT 10",
            tags=["revenue", "ranking"],
        )

    fake_store.store_query.assert_called_once()
    kwargs = fake_store.store_query.call_args.kwargs
    assert kwargs["nl_query"] == "top customers"
    assert kwargs["sql_query"].startswith("SELECT")
    # SDK joins list[str] tags into a Core-compatible comma-separated string.
    assert kwargs["tags"] == "revenue,ranking"


def test_memory_fetch_raises_when_memory_disabled(tmp_project, fake_active_profile):
    """Direct API access when memory is disabled raises MemoryNotEnabledError."""
    toolkit = WrenToolkit.from_project(tmp_project)

    with pytest.raises(MemoryNotEnabledError):
        toolkit.memory.fetch("anything")


def test_memory_store_rejects_tags_containing_commas(tmp_project, fake_active_profile):
    """Commas separate tags in the underlying storage format. A tag like
    "revenue, Q1" would silently corrupt the round-trip if passed through —
    we reject early with ValueError instead."""
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")

    toolkit = WrenToolkit.from_project(project)

    with patch("wren_pydantic._providers.memory.MemoryStore", return_value=fake_store):
        with pytest.raises(ValueError, match="comma"):
            toolkit.memory.store(nl="x", sql="SELECT 1", tags=["revenue, Q1"])

    fake_store.store_query.assert_not_called()


def test_memory_store_caches_across_calls(tmp_project, fake_active_profile):
    """The MemoryStore instance is constructed once and reused across operations."""
    project = _enable_memory(tmp_project)
    fake_store = MagicMock(name="MemoryStore")
    fake_store.get_context.return_value = {}
    fake_store.recall_queries.return_value = []

    toolkit = WrenToolkit.from_project(project)

    with patch(
        "wren_pydantic._providers.memory.MemoryStore", return_value=fake_store
    ) as ctor:
        toolkit.memory.fetch("x")
        toolkit.memory.recall("y")
        toolkit.memory.fetch("z")

    assert ctor.call_count == 1  # constructed exactly once
