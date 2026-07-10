"""MDL sources resolve where the manifest comes from.

v0.1 ships only ``ProjectMDLSource`` which reads ``target/mdl.json`` from a
prepared Wren project directory. Each ``load_manifest()`` call re-reads the
file from disk so that ``wren context build`` updates by an external CLI run
are picked up on the next tool invocation without needing ``toolkit.reload()``.
"""

import json
from pathlib import Path
from typing import Any

from wren_langchain.exceptions import WrenToolkitInitError


class ProjectMDLSource:
    """Read the manifest from ``<project>/target/mdl.json``."""

    def __init__(self, *, project_path: Path):
        self._project_path = project_path
        self._mdl_path = project_path / "target" / "mdl.json"

    def load_manifest(self) -> dict[str, Any]:
        if not self._mdl_path.exists():
            raise WrenToolkitInitError(
                f"target/mdl.json not found at {self._mdl_path}. "
                "Run `wren context build` first."
            )
        try:
            return json.loads(self._mdl_path.read_text())
        except json.JSONDecodeError as exc:
            # Normalize malformed manifest into the common init-error contract
            # so callers don't need to special-case JSON errors.
            raise WrenToolkitInitError(
                f"target/mdl.json at {self._mdl_path} is not valid JSON: {exc.msg} "
                f"(line {exc.lineno}, col {exc.colno}). "
                "Re-run `wren context build` to regenerate it."
            ) from exc

    @property
    def mdl_path(self) -> Path:
        return self._mdl_path
