"""Tests for `wren docs get` / `wren docs list` reference delivery."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from wren import docs_delivery
from wren.cli import app

runner = CliRunner()

_REPO = Path(__file__).resolve().parents[4]
_DOCS_CORE = _REPO / "docs" / "core"


def test_docs_list_includes_known_references():
    result = runner.invoke(app, ["docs", "list"])
    assert result.exit_code == 0
    for name in ("connect", "mdl", "cubes", "installation", "quickstart"):
        assert name in result.output


def test_docs_get_each_reference_matches_source():
    for name, spec in docs_delivery.REFERENCE_SOURCES.items():
        served = docs_delivery.get_reference(name)
        source = (_DOCS_CORE / spec.source).read_text(encoding="utf-8")
        # served content is the synced mirror of the docs/core source
        assert served.strip() == source.strip(), name


def test_docs_get_via_cli():
    result = runner.invoke(app, ["docs", "get", "connect"])
    assert result.exit_code == 0
    assert result.output.strip()


def test_docs_get_unknown_errors_with_hint():
    result = runner.invoke(app, ["docs", "get", "does-not-exist"])
    assert result.exit_code != 0
    assert "wren docs list" in result.output
    with pytest.raises(docs_delivery.ReferenceNotFoundError):
        docs_delivery.get_reference("does-not-exist")


def test_skill_doc_references_resolve():
    """Every `wren docs get <ref>` mentioned in bundled skills must exist."""
    skills_root = Path(docs_delivery.__file__).parent / "skills_content"
    referenced = set()
    for md in skills_root.rglob("*.md"):
        for m in re.finditer(r"wren docs get ([a-z0-9-]+)", md.read_text()):
            referenced.add(m.group(1))
    # the literal placeholder `<reference>` is not a real name; ignore tokens
    # that are obviously placeholders
    referenced.discard("reference")
    unknown = referenced - set(docs_delivery.REFERENCE_SOURCES)
    assert not unknown, f"skills reference unknown docs: {unknown}"


def test_docs_content_in_sync_with_source():
    """The CI sync gate must pass against the working tree."""
    script = _REPO / "core" / "wren" / "scripts" / "sync_docs_content.py"
    result = subprocess.run(
        [sys.executable, str(script), "--check"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


# ── behavior preservation: connection-info is unchanged after the move ──────


def test_connection_info_still_works():
    result = runner.invoke(app, ["docs", "connection-info", "postgres"])
    assert result.exit_code == 0
    assert result.output.strip()


def test_connection_info_json_still_works():
    result = runner.invoke(
        app, ["docs", "connection-info", "postgres", "--format", "json"]
    )
    assert result.exit_code == 0
    assert "{" in result.output
