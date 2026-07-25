"""Provider token discovery — env var → .env files → caller prompts.

Copies the Vercel agent-skill pattern. The token is NEVER accepted as a
``--token`` CLI flag (it would leak into shell history / process lists);
callers export it into the request context instead.
"""

from __future__ import annotations

import os
from pathlib import Path


def _as_token(value: object) -> str | None:
    """Return a non-empty stripped token string, else None.

    Blank / whitespace-only env values (`VERCEL_TOKEN=`) used to be truthy
    enough for `if value := os.environ.get(...)` and were returned as "" or
    spaces, so deploy sent `Authorization: Bearer ` and failed opaquely.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    return value or None


def resolve_token(env_var: str, project_path: Path) -> str | None:
    """3-tier lookup: process env → merged .env files → project .env.

    Returns None when absent — the caller decides whether to prompt.
    """
    # 1. Shell-exported environment always wins.
    if token := _as_token(os.environ.get(env_var)):
        return token

    # 2. Standard .env discovery (cwd → cwd-walk project root → ~/.wren/.env).
    from wren.profile import _ensure_env_loaded  # noqa: PLC0415

    _ensure_env_loaded()
    if token := _as_token(os.environ.get(env_var)):
        return token

    # 3. The explicit project dir's .env — covers --path projects outside cwd.
    project_env = project_path / ".env"
    if project_env.exists():
        try:
            from dotenv import dotenv_values  # noqa: PLC0415

            if token := _as_token(dotenv_values(project_env).get(env_var)):
                return token
        except ImportError:
            pass

    return None
