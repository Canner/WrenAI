"""`wren.cli` must detect the optional `memory` extra without
eagerly importing it (which would pull lancedb -> torch into every startup)."""

from __future__ import annotations

import importlib
import importlib.util
import subprocess
import sys

import pytest

MEMORY_INSTALLED = bool(importlib.util.find_spec("lancedb")) and bool(
    importlib.util.find_spec("sentence_transformers")
)


def _fresh_import_modules() -> dict[str, bool]:
    """Import wren.cli in a clean subprocess and report loaded heavy modules."""
    code = (
        "import sys, importlib; importlib.import_module('wren.cli'); "
        "print(int('torch' in sys.modules), int('lancedb' in sys.modules))"
    )
    out = subprocess.check_output([sys.executable, "-c", code], text=True).strip()
    torch_loaded, lancedb_loaded = (bool(int(x)) for x in out.split())
    return {
        "torch": torch_loaded,
        "lancedb": lancedb_loaded,
    }


def test_import_cli_does_not_pull_heavy_ml_stack():
    """Importing the CLI must NOT load torch/lancedb, even when memory is installed."""
    loaded = _fresh_import_modules()
    assert loaded["torch"] is False, "torch leaked into CLI startup"
    assert loaded["lancedb"] is False, "lancedb leaked into CLI startup"


@pytest.mark.skipif(not MEMORY_INSTALLED, reason="memory extra not installed")
def test_memory_subcommand_registered_when_extra_present():
    """The `memory` subcommand group is registered when the extra is installed."""
    cli = importlib.import_module("wren.cli")
    names = {g.typer_instance.info.name for g in cli.app.registered_groups}
    assert "memory" in names, "memory subcommand not registered despite extra installed"


@pytest.mark.skipif(MEMORY_INSTALLED, reason="memory extra IS installed")
def test_memory_subcommand_absent_when_extra_missing():
    """The `memory` subcommand group is not registered when the extra is missing."""
    cli = importlib.import_module("wren.cli")
    names = {g.typer_instance.info.name for g in cli.app.registered_groups}
    assert "memory" not in names, "memory subcommand registered without the extra"
