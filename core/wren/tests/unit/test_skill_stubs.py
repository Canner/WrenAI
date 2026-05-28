"""Guard tests for the skills/ distribution stubs.

The new model:
- skills/wren/SKILL.md is the single discovery stub that lists every CLI surface.
- skills/wren-<name>/SKILL.md are deprecated redirect stubs. They must stay
  minimal and only point at `wren skills get <name>`; they must NOT mention
  unrelated commands like `wren ask` or `wren docs get` (any duplication of
  the discovery-stub content there would rot independently).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[4]
_SKILLS = _REPO / "skills"

REDIRECT_SKILLS = [
    "wren-onboarding",
    "wren-usage",
    "wren-generate-mdl",
    "wren-dlt-connector",
    "wren-enrich-context",
]


def test_discovery_stub_exists():
    stub = _SKILLS / "wren" / "SKILL.md"
    assert stub.is_file()
    text = stub.read_text()
    assert text.startswith("---")
    assert "allowed-tools:" in text
    # discovery stub points at the four CLI surfaces
    assert "wren skills list" in text
    assert "wren docs list" in text
    assert "wren ask" in text


@pytest.mark.parametrize("name", REDIRECT_SKILLS)
def test_redirect_stub_is_minimal_and_points_at_cli(name):
    p = _SKILLS / name / "SKILL.md"
    assert p.is_file()
    text = p.read_text()
    # preserved trigger description in frontmatter
    assert text.startswith("---")
    assert "description:" in text.split("---", 2)[1]
    # body redirects to `wren skills get <short-name>`
    short = name.removeprefix("wren-")
    assert f"wren skills get {short}" in text
    # redirect stubs are short by design (kept under 30 lines)
    assert len(text.splitlines()) <= 30, f"{name} redirect grew past 30 lines"


@pytest.mark.parametrize("name", REDIRECT_SKILLS)
def test_redirect_stub_does_not_mention_unrelated_cli_surfaces(name):
    """`wren ask` / `wren docs get` / `wren docs list` are discovery-stub
    territory; if they appear in a redirect stub they'll rot independently."""
    text = (_SKILLS / name / "SKILL.md").read_text()
    forbidden = ("wren ask", "wren docs get", "wren docs list")
    for token in forbidden:
        assert token not in text, f"{name} redirect must not mention '{token}'"


@pytest.mark.parametrize("name", REDIRECT_SKILLS)
def test_redirect_stub_has_no_stale_subdirs(name):
    """The lifted references/scripts/evals now live in package data, so the
    deprecated redirect directories should not retain the old content."""
    for sub in ("references", "scripts", "evals"):
        assert not (_SKILLS / name / sub).exists(), f"{name}/{sub} should be removed"


def test_versions_json_removed():
    assert not (_SKILLS / "versions.json").exists(), (
        "versions.json should be deleted (version drift impossible in the new model)"
    )
    assert not (_SKILLS / "check-versions.sh").exists(), (
        "check-versions.sh should be deleted (no per-skill versions anymore)"
    )


def test_install_sh_includes_new_discovery_stub():
    install = (_SKILLS / "install.sh").read_text()
    assert "ALL_SKILLS=(wren " in install, (
        "install.sh ALL_SKILLS must include the new `wren` discovery stub"
    )


def test_index_json_lists_new_stub_and_5_redirects():
    data = json.loads((_SKILLS / "index.json").read_text())
    names = [s["name"] for s in data["skills"]]
    assert "wren" in names
    for n in REDIRECT_SKILLS:
        assert n in names
