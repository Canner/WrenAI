"""End-to-end integration: memory tools running against real Qdrant.

These tests require a Qdrant server (``QDRANT_URL``) and are marked ``slow``
so they don't run in the default ``pytest`` invocation. Embeddings are faked
(patch ``VolcArkEmbedding`` -> ``FakeEmbedding``) so no Volcengine Ark API
call is made - the tests exercise the Qdrant store/recall plumbing, not
embedding quality. Run them explicitly with ``pytest -m slow``.
"""

from __future__ import annotations

import json
import os

import pytest
from wren.memory.embeddings import FakeEmbedding
from wren.memory.store import MemoryStore

from wren_langchain import WrenToolkit

pytestmark = pytest.mark.slow


def _require_qdrant() -> str:
    url = os.environ.get("QDRANT_URL")
    if not url:
        pytest.skip("QDRANT_URL not set; run a Qdrant server for integration tests")
    return url


@pytest.fixture
def project_with_memory(duckdb_project, monkeypatch):
    """Augment the duckdb_project fixture with an indexed Qdrant collection set."""
    url = _require_qdrant()
    monkeypatch.setenv("QDRANT_URL", url)
    monkeypatch.setenv("VOLC_ARK_API_KEY", "fake-key")
    # Toolkit opens its own MemoryStore with the default VolcArkEmbedding;
    # force FakeEmbedding so no Ark API call is made. Both the fixture store
    # and the toolkit store use the default "wren" prefix on the same Qdrant.
    monkeypatch.setenv("WREN_EMBEDDING_PROVIDER", "fake")

    manifest = json.loads((duckdb_project / "target" / "mdl.json").read_text())
    store = MemoryStore(url=url, embedding=FakeEmbedding(dim=8))
    store.reset()
    store.index_schema(manifest, replace=True, seed_queries=False)

    yield duckdb_project
    store.reset()


def test_fetch_context_runs_against_real_qdrant(project_with_memory):
    toolkit = WrenToolkit.from_project(project_with_memory)
    fetch = next(t for t in toolkit.get_tools() if t.name == "wren_fetch_context")

    envelope = fetch.invoke({"question": "customers"})

    assert envelope["ok"] is True
    assert envelope["data"]["strategy"] in {"full", "search"}


def test_store_then_recall_round_trip(project_with_memory):
    toolkit = WrenToolkit.from_project(project_with_memory)
    store = next(t for t in toolkit.get_tools() if t.name == "wren_store_query")
    recall = next(t for t in toolkit.get_tools() if t.name == "wren_recall_queries")

    store_env = store.invoke(
        {
            "nl": "list all customers",
            "sql": "SELECT id, name FROM customers",
            "tags": ["demo"],
        }
    )
    assert store_env["ok"] is True

    recall_env = recall.invoke({"question": "customers list"})
    assert recall_env["ok"] is True
    assert len(recall_env["data"]["results"]) >= 1
    nl_values = [r.get("nl_query") for r in recall_env["data"]["results"]]
    assert "list all customers" in nl_values
