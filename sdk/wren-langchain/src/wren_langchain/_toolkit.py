"""WrenToolkit: facade over an existing CLI-prepared Wren project."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from wren.engine import WrenEngine

from wren_langchain._memory_api import _MemoryAPI
from wren_langchain._prompt import build_system_prompt
from wren_langchain._providers.connection import ProfileConnectionProvider
from wren_langchain._providers.mdl_source import ProjectMDLSource
from wren_langchain._providers.memory import (
    LocalLanceDBMemoryProvider,
    NoopMemoryProvider,
)
from wren_langchain._tools import build_runtime_tools
from wren_langchain._tools_memory import build_memory_tools
from wren_langchain.exceptions import WrenToolkitInitError

if TYPE_CHECKING:
    import pyarrow as pa


class WrenToolkit:
    """Adapter that exposes an existing Wren project as LangChain tools."""

    def __init__(
        self,
        *,
        project_path: Path,
        mdl_source: ProjectMDLSource,
        connection_provider: ProfileConnectionProvider,
        memory_provider: LocalLanceDBMemoryProvider | NoopMemoryProvider,
    ):
        self._project_path = project_path
        self._mdl_source = mdl_source
        self._connection = connection_provider
        self._memory = memory_provider
        # Connector is cached at the toolkit level to avoid reconnecting on
        # every query. The engine itself is rebuilt per call so manifest
        # changes are picked up read-through.
        self._connector_cache: Any = None
        # MemoryStore is heavy (loads sentence-transformer model) — cache
        # the instance and let LanceDB handle data versioning internally.
        self._memory_store_cache: Any = None

    # ── Memory subscope (exposed as toolkit.memory) ────────────────────────

    @property
    def memory(self):
        if not hasattr(self, "_memory_api"):
            self._memory_api = _MemoryAPI(self)
        return self._memory_api

    # ── Direct Python API ──────────────────────────────────────────────────

    def query(self, sql: str, limit: int | None = None) -> pa.Table:
        """Execute SQL through the Wren context layer. Returns a pyarrow Table."""
        engine = self._build_engine()
        try:
            result = engine.query(sql, limit=limit)
        finally:
            self._connector_cache = engine._connector
        return result

    def dry_plan(self, sql: str) -> str:
        """Plan SQL through MDL and return the expanded SQL in target dialect."""
        return self._build_engine().dry_plan(sql)

    def dry_run(self, sql: str) -> None:
        """Validate SQL by planning and asking the DB to plan it without executing."""
        engine = self._build_engine()
        try:
            engine.dry_run(sql)
        finally:
            self._connector_cache = engine._connector

    # ── LangChain adapter ──────────────────────────────────────────────────

    def get_tools(
        self,
        *,
        include_memory_write: bool = True,
        raise_on_error: bool = False,
    ) -> list:
        """Return LangChain-compatible tools bound to this toolkit.

        Memory tools are auto-filtered when memory is disabled (no
        ``.wren/memory/`` directory in the project). ``include_memory_write=False``
        removes ``wren_store_query`` while keeping the read-only memory tools
        (``wren_fetch_context``, ``wren_recall_queries``).

        When memory is disabled, ``include_memory_write`` has no effect — no
        memory tools are added regardless of its value.
        """
        tools = build_runtime_tools(self, raise_on_error=raise_on_error)
        if self._memory.enabled:
            tools.extend(
                build_memory_tools(
                    self,
                    raise_on_error=raise_on_error,
                    include_write=include_memory_write,
                )
            )
        return tools

    def system_prompt(self, *, tools=None) -> str:
        """Return a Wren-aware system prompt suitable for LangChain agents.

        Composition:
          1. Workflow rules — derived from the supplied tool list so the
             prompt stays in sync with what the agent actually has.
          2. Available tools — bullet list rendered from the same list.
          3. Project-specific instructions (from ``instructions.md`` if present).

        Pass the same ``tools`` you give to ``create_agent`` if you customized
        the toolset — e.g. ``get_tools(include_memory_write=False)`` — so the
        workflow drops the persistence step instead of instructing the agent
        to call a tool that no longer exists. When ``tools`` is omitted, the
        toolkit's default ``get_tools()`` output is used.

        To extend, concatenate with your own instructions::

            tools = toolkit.get_tools(include_memory_write=False)
            prompt = (
                f"You are a finance analyst.\\n\\n"
                f"{toolkit.system_prompt(tools=tools)}"
            )
        """
        return build_system_prompt(self, tools=tools)

    # ── Internal ───────────────────────────────────────────────────────────

    def _build_engine(self) -> WrenEngine:
        """Construct a fresh WrenEngine with a read-through manifest.

        The connector is reused across calls when available so DB authentication
        only happens once per toolkit lifetime.
        """
        manifest = self._mdl_source.load_manifest()
        manifest_str = base64.b64encode(json.dumps(manifest).encode("utf-8")).decode()
        engine = WrenEngine(
            manifest_str=manifest_str,
            data_source=self._connection.datasource(),
            connection_info=self._connection.connection_info(),
        )
        if self._connector_cache is not None:
            engine._connector = self._connector_cache
        return engine

    @classmethod
    def from_project(
        cls,
        path: str | Path,
        *,
        profile: str | None = None,
    ) -> WrenToolkit:
        """Build a toolkit from a CLI-prepared Wren project directory.

        Memory is auto-detected from ``<path>/.wren/memory/``: present →
        memory tools are exposed, absent → only the 3 runtime tools.
        To enable, run ``wren memory index`` in the project; to disable,
        delete the directory. There is no kwarg to override.
        """
        project_path = Path(path).expanduser().resolve()

        if not (project_path / "wren_project.yml").exists():
            raise WrenToolkitInitError(
                f"wren_project.yml not found at {project_path}. "
                "Is this a Wren project? Run `wren context init` to create one."
            )

        if not (project_path / "target" / "mdl.json").exists():
            raise WrenToolkitInitError(
                f"target/mdl.json not found at {project_path}/target/mdl.json. "
                "Run `wren context build` first."
            )

        cls._load_project_dotenv(project_path)

        mdl_source = ProjectMDLSource(project_path=project_path)
        connection = ProfileConnectionProvider(
            project_path=project_path,
            explicit_profile=profile,
        )
        memory_provider = cls._resolve_memory_provider(project_path)

        return cls(
            project_path=project_path,
            mdl_source=mdl_source,
            connection_provider=connection,
            memory_provider=memory_provider,
        )

    @staticmethod
    def _load_project_dotenv(project_path: Path) -> None:
        """Load ``<project>/.env`` into ``os.environ`` if present.

        Required for SDK ergonomics: when a caller passes
        ``from_project("/some/path")`` from anywhere on the filesystem, they
        expect that project's secrets to resolve. Core's ``expand_profile_secrets``
        discovers ``.env`` relative to CWD, which doesn't help here.

        Uses ``override=False`` so values the user already exported in their
        shell still win, matching Core's policy.
        """
        env_path = project_path / ".env"
        if not env_path.exists():
            return
        try:
            from dotenv import load_dotenv  # noqa: PLC0415
        except ImportError:
            return
        load_dotenv(env_path, override=False)

    @staticmethod
    def _resolve_memory_provider(
        project_path: Path,
    ) -> LocalLanceDBMemoryProvider | NoopMemoryProvider:
        memory_dir = project_path / ".wren" / "memory"
        # Require a directory (not a regular file or broken symlink) so we
        # never construct LocalLanceDBMemoryProvider against an invalid root.
        if memory_dir.is_dir():
            return LocalLanceDBMemoryProvider(memory_path=memory_dir)
        return NoopMemoryProvider()
