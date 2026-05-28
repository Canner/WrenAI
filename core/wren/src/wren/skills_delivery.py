"""Serve bundled agent skill content from package data.

Skill content ships inside the wheel under ``wren/skills_content/<name>/``.
``wren skills get <name>`` returns the skill's ``SKILL.md`` main guide. Deeper
``references/`` and bundled ``scripts/`` are surfaced by ``wren skills list``
and (in a follow-up slice) delivered via ``--full`` / ``--script``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from importlib import resources

import yaml

_CONTENT_DIR = "skills_content"


class SkillNotFoundError(Exception):
    """Raised when a requested skill name has no bundled content."""


@dataclass
class SkillInfo:
    name: str
    summary: str
    references: list[str] = field(default_factory=list)
    scripts: list[str] = field(default_factory=list)


def _content_root():
    """Traversable for ``wren/skills_content/`` (anchored on the ``wren`` package)."""
    return resources.files("wren") / _CONTENT_DIR


def _skill_dir(name: str):
    root = _content_root()
    skill = root / name
    if not (skill.is_dir() and (skill / "SKILL.md").is_file()):
        raise SkillNotFoundError(name)
    return skill


def get_skill(name: str) -> str:
    """Return the ``SKILL.md`` main guide for ``name``."""
    return (_skill_dir(name) / "SKILL.md").read_text(encoding="utf-8")


def list_skills() -> list[SkillInfo]:
    """List every bundled skill, sorted by name."""
    root = _content_root()
    out: list[SkillInfo] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name):
        if not entry.is_dir() or not (entry / "SKILL.md").is_file():
            continue
        out.append(
            SkillInfo(
                name=entry.name,
                summary=_summary((entry / "SKILL.md").read_text(encoding="utf-8")),
                references=_md_stems(entry / "references"),
                scripts=_script_stems(entry / "scripts"),
            )
        )
    return out


def _summary(skill_md_text: str) -> str:
    """First sentence of the frontmatter ``description``."""
    desc = _frontmatter_field(skill_md_text, "description")
    if not desc:
        return ""
    return desc.split(". ", 1)[0].rstrip(".")


def _frontmatter_field(text: str, key: str) -> str | None:
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    try:
        data = yaml.safe_load(text[3:end]) or {}
    except yaml.YAMLError:
        return None
    value = data.get(key)
    return value if isinstance(value, str) else None


def _md_stems(directory) -> list[str]:
    if not directory.is_dir():
        return []
    return sorted(p.name[:-3] for p in directory.iterdir() if p.name.endswith(".md"))


def _script_stems(directory) -> list[str]:
    if not directory.is_dir():
        return []
    return sorted(
        p.name.rsplit(".", 1)[0]
        for p in directory.iterdir()
        if p.is_file() and p.name.rsplit(".", 1)[-1] in ("py", "sh")
    )
