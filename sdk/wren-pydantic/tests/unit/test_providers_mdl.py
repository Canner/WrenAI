"""Tests for MDLSource implementations."""

import json

import pytest

from wren_pydantic._providers.mdl_source import ProjectMDLSource
from wren_pydantic.exceptions import WrenToolkitInitError


def test_project_mdl_source_reads_target_mdl_json(tmp_path):
    """ProjectMDLSource reads the project's target/mdl.json on every load."""
    target = tmp_path / "target"
    target.mkdir()
    manifest = {"models": [{"name": "orders"}]}
    (target / "mdl.json").write_text(json.dumps(manifest))

    source = ProjectMDLSource(project_path=tmp_path)

    assert source.load_manifest() == manifest


def test_project_mdl_source_picks_up_file_changes_between_calls(tmp_path):
    """Subsequent load_manifest() calls reflect on-disk changes (read-through)."""
    target = tmp_path / "target"
    target.mkdir()
    mdl_file = target / "mdl.json"
    mdl_file.write_text(json.dumps({"models": [{"name": "v1"}]}))

    source = ProjectMDLSource(project_path=tmp_path)
    first = source.load_manifest()

    mdl_file.write_text(json.dumps({"models": [{"name": "v2"}]}))
    second = source.load_manifest()

    assert first["models"][0]["name"] == "v1"
    assert second["models"][0]["name"] == "v2"


def test_project_mdl_source_raises_on_missing_target(tmp_path):
    """A missing target/mdl.json raises WrenToolkitInitError when loading."""
    source = ProjectMDLSource(project_path=tmp_path)

    with pytest.raises(WrenToolkitInitError, match="target/mdl.json"):
        source.load_manifest()


def test_project_mdl_source_normalizes_malformed_json_to_init_error(tmp_path):
    """Malformed mdl.json must surface as WrenToolkitInitError, not raw JSONDecodeError,
    so callers don't need to special-case JSON internals."""
    target = tmp_path / "target"
    target.mkdir()
    (target / "mdl.json").write_text("{not valid json")

    source = ProjectMDLSource(project_path=tmp_path)

    with pytest.raises(WrenToolkitInitError, match="not valid JSON"):
        source.load_manifest()
