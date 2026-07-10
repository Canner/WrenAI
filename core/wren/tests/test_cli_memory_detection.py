"""`wren.cli` must detect the optional `memory` extra without
eagerly importing it (which would pull qdrant-client/openai into every startup)."""

from __future__ import annotations

import importlib
import importlib.util
import subprocess
import sys

import pytest

MEMORY_INSTALLED = bool(importlib.util.find_spec("qdrant_client")) and bool(
    importlib.util.find_spec("openai")
)


def _fresh_import_modules() -> dict[str, bool]:
    """Import wren.cli in a clean subprocess and report loaded heavy modules."""
    code = (
        "import sys, importlib; importlib.import_module('wren.cli'); "
        "print(int('qdrant_client' in sys.modules), int('openai' in sys.modules))"
    )
    out = subprocess.check_output([sys.executable, "-c", code], text=True).strip()
    qdrant_loaded, openai_loaded = (bool(int(x)) for x in out.split())
    return {
        "qdrant_client": qdrant_loaded,
        "openai": openai_loaded,
    }


def test_import_cli_does_not_pull_heavy_ml_stack():
    """Importing the CLI must NOT load qdrant-client/openai, even when memory is installed."""
    loaded = _fresh_import_modules()
    assert loaded["qdrant_client"] is False, "qdrant_client leaked into CLI startup"
    assert loaded["openai"] is False, "openai leaked into CLI startup"


@pytest.mark.skipif(not MEMORY_INSTALLED, reason="memory extra not installed")
def test_memory_subcommand_registered_when_extra_present():
    """The `memory` subcommand group is registered when the extra is installed."""
    cli = importlib.import_module("wren.cli")
    names = {g.typer_instance.info.name for g in cli.app.registered_groups}
    assert "memory" in names, "memory subcommand not registered despite extra installed"


def test_memory_subcommand_always_registered():
    """`memory` is always registered - `wren memory store` writes knowledge/sql/*.md
    without the extra; qdrant-backed commands degrade with a clear message."""
    cli = importlib.import_module("wren.cli")
    names = {g.typer_instance.info.name for g in cli.app.registered_groups}
    assert "memory" in names, "memory subcommand should always be registered"
