"""Markdown source-of-truth for NL→SQL memory pairs (``knowledge/sql/<slug>.md``).

Dependency-free: no LanceDB / pyarrow / sentence-transformers. The markdown file
is the source of truth; the LanceDB index (when the ``memory`` extra is
installed) is a derived artifact built from it — mirroring how ``wren context
build`` compiles YAML into ``target/mdl.json``.

File format — YAML frontmatter, optional markdown body for notes::

    ---
    nl: What is the total revenue across all orders?
    sql: |
      SELECT SUM(amount) AS total_revenue FROM orders
    datasource: postgres
    tags:
      - revenue
    source: user
    ---
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_KNOWLEDGE_SQL_SUBDIR = ("knowledge", "sql")
_MAX_SLUG_LEN = 60


def slugify(text: str) -> str:
    """Normalize NL text into a filesystem-safe, deterministic slug."""
    text = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    if len(text) > _MAX_SLUG_LEN:
        text = text[:_MAX_SLUG_LEN].rstrip("-")
    return text or "query"


def knowledge_sql_dir(project_path: Path) -> Path:
    return project_path.joinpath(*_KNOWLEDGE_SQL_SUBDIR)


def parse_query_markdown(path: Path) -> dict:
    """Parse a knowledge/sql/*.md file into its frontmatter dict.

    Returns the frontmatter mapping with an extra ``_body`` key (stripped
    markdown body). Returns {} when the file has no frontmatter.
    """
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    # Split: ---\n<frontmatter>\n---\n<body>
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    data = yaml.safe_load(parts[1]) or {}
    if not isinstance(data, dict):
        return {}
    data["_body"] = parts[2].strip()
    return data


def _resolve_slug(base: str, nl: str, sql_dir: Path) -> str:
    """Deterministic slug; reuse the file for the same NL, suffix on collision."""
    candidate = base
    n = 1
    while True:
        dest = sql_dir / f"{candidate}.md"
        if not dest.exists():
            return candidate
        # Same NL → same logical pair → reuse (update in place).
        existing = parse_query_markdown(dest).get("nl")
        if existing == nl:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def render_query_markdown(
    nl: str,
    sql: str,
    *,
    datasource: str | None = None,
    tags: list[str] | None = None,
    source: str = "user",
) -> str:
    """Render the frontmatter document for a NL→SQL pair."""
    front: dict = {"nl": nl.strip(), "sql": sql.strip(), "source": source}
    if datasource:
        front["datasource"] = datasource
    if tags:
        front["tags"] = tags
    body = yaml.safe_dump(
        front, sort_keys=False, allow_unicode=True, default_flow_style=False
    )
    return f"---\n{body}---\n"


def write_query_markdown(
    project_path: Path,
    nl: str,
    sql: str,
    *,
    datasource: str | None = None,
    tags: list[str] | None = None,
    source: str = "user",
) -> Path:
    """Write a NL→SQL pair to ``knowledge/sql/<slug>.md``. Returns the path.

    Deterministic: the same NL updates the same file; a different NL that
    slugs to an existing name gets a numeric suffix.
    """
    sql_dir = knowledge_sql_dir(project_path)
    sql_dir.mkdir(parents=True, exist_ok=True)
    slug = _resolve_slug(slugify(nl), nl, sql_dir)
    dest = sql_dir / f"{slug}.md"
    dest.write_text(
        render_query_markdown(nl, sql, datasource=datasource, tags=tags, source=source),
        encoding="utf-8",
    )
    return dest
