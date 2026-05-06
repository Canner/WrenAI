"""End-to-end integration: memory tools running against real LanceDB.

These tests load a sentence-transformer model (~30-40s startup) and are
marked ``slow`` so they don't run in the default ``pytest`` invocation.
Run them explicitly with ``pytest -m slow``.
"""

from __future__ import annotations

import json
import shutil

import pytest
from wren.memory.store import MemoryStore

from wren_langchain import WrenToolkit

pytestmark = pytest.mark.slow


@pytest.fixture
def project_with_memory(duckdb_project):
    """Augment the duckdb_project fixture with an indexed .wren/memory dir."""
    memory_dir = duckdb_project / ".wren" / "memory"
    memory_dir.mkdir(parents=True)

    # Eagerly create the LanceDB tables by indexing the (small) manifest so
    # subsequent fetch/recall calls don't crash on first read.
    manifest = json.loads((duckdb_project / "target" / "mdl.json").read_text())
    store = MemoryStore(path=memory_dir)
    store.index_schema(manifest, replace=True, seed_queries=False)

    yield duckdb_project

    # Best-effort cleanup; tmp_path is auto-cleaned but LanceDB may leave open
    # handles on Windows. On macOS/Linux this is a no-op safety net.
    shutil.rmtree(memory_dir, ignore_errors=True)


def test_fetch_context_runs_against_real_lancedb(project_with_memory):
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
