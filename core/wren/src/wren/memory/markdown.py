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
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}
    # The closing delimiter is a line that is exactly "---" at column 0.
    # Frontmatter values are indented (e.g. block-scalar sql), so a "---" line
    # inside a value is indented and never matches here.
    for i in range(1, len(lines)):
        if lines[i].rstrip("\n") == "---":
            try:
                data = yaml.safe_load("".join(lines[1:i])) or {}
            except yaml.YAMLError:
                return {}  # malformed frontmatter — treat as no pair, don't crash callers
            if not isinstance(data, dict):
                return {}
            data["_body"] = "".join(lines[i + 1 :]).strip()
            return data
    return {}


def load_query_pairs(project_path: Path) -> list[dict]:
    """Load every NL→SQL pair from ``knowledge/sql/*.md`` (the source of truth).

    Returns dicts shaped for ``MemoryStore.load_queries``: ``nl``, ``sql``,
    plus ``datasource`` / ``tags`` / ``source`` when present and ``path`` (the
    source file, relative to the project). Files without a parseable ``nl``+``sql``
    frontmatter are skipped.
    """
    sql_dir = knowledge_sql_dir(project_path)
    if not sql_dir.is_dir():
        return []
    pairs: list[dict] = []
    for md in sorted(sql_dir.glob("*.md")):
        fm = parse_query_markdown(md)
        nl, sql = fm.get("nl"), fm.get("sql")
        if not nl or not sql:
            continue
        pair: dict = {"nl": nl, "sql": sql, "source": fm.get("source", "user")}
        if fm.get("datasource"):
            pair["datasource"] = fm["datasource"]
        if fm.get("tags"):
            pair["tags"] = fm["tags"]
        pair["path"] = str(md.relative_to(project_path))
        pairs.append(pair)
    return pairs


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
    nl = nl.strip()  # canonical form — stored, slugged, and matched consistently
    sql_dir = knowledge_sql_dir(project_path)
    sql_dir.mkdir(parents=True, exist_ok=True)
    slug = _resolve_slug(slugify(nl), nl, sql_dir)
    dest = sql_dir / f"{slug}.md"
    dest.write_text(
        render_query_markdown(nl, sql, datasource=datasource, tags=tags, source=source),
        encoding="utf-8",
    )
    return dest
