"""SDK-specific exception types for wren-pydantic."""


class WrenToolkitInitError(Exception):
    """Raised when ``WrenToolkit.from_project(...)`` cannot validate prerequisites.

    Examples include missing ``wren_project.yml``, missing ``target/mdl.json``,
    or unresolvable profile.
    """


class MemoryNotEnabledError(Exception):
    """Raised when memory operations are called but no memory provider is active.

    Triggered by direct API access to ``toolkit.memory.*`` when the toolkit
    was initialized against a project without ``.wren/memory/``. LLM-facing
    tools handle this case via tool filtering, not by raising.
    """
