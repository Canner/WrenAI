"""In-app helpers used by generated Streamlit apps to reach the semantic layer.

These run *inside* the served Streamlit process (whose CWD is the project root,
so ``.env`` discovery and profile secret expansion work). They resolve the
project's MDL manifest and a ``WrenEngine`` once per session via Streamlit's
resource cache.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def get_manifest_json() -> str:
    """Return the raw ``target/mdl.json`` text for the active project."""
    from wren.context import discover_project_path  # noqa: PLC0415

    target = discover_project_path() / "target" / "mdl.json"
    if not target.exists():
        raise RuntimeError(
            f"{target} not found — run `wren context build` before serving an app."
        )
    return Path(target).read_text()


def get_engine():
    """Return a cached ``WrenEngine`` for the active project/profile.

    Wrapped in ``st.cache_resource`` so the engine (and its connector) is built
    once per app session rather than on every rerun.
    """
    import streamlit as st  # noqa: PLC0415

    @st.cache_resource(show_spinner=False)
    def _build():
        from wren.cli import _build_engine  # noqa: PLC0415

        return _build_engine(
            mdl=None,
            connection_info=None,
            connection_file=None,
        )

    return _build()
