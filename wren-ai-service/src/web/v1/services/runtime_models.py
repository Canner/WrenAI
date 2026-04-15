from typing import Optional

from src.core.runtime_identity import (
    RuntimeIdentity,
    resolve_bridge_scope_id,
    resolve_runtime_scope_id,
)


def resolve_request_runtime_scope_id(
    *,
    runtime_scope_id: str | int | None = None,
    project_id: str | int | None = None,
    bridge_scope_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    mdl_hash: str | int | None = None,
) -> Optional[str]:
    resolved_bridge_scope_id = bridge_scope_id if bridge_scope_id is not None else project_id
    return resolve_runtime_scope_id(
        runtime_scope_id=runtime_scope_id,
        project_id=resolved_bridge_scope_id,
        runtime_identity=runtime_identity,
        fallback_id=mdl_hash,
    )


def resolve_request_bridge_scope_id(
    *,
    runtime_scope_id: str | int | None = None,
    project_id: str | int | None = None,
    bridge_scope_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    mdl_hash: str | int | None = None,
) -> Optional[str]:
    del runtime_scope_id
    resolved_bridge_scope_id = bridge_scope_id if bridge_scope_id is not None else project_id
    return resolve_bridge_scope_id(
        project_id=resolved_bridge_scope_id,
        runtime_identity=runtime_identity,
        fallback_id=mdl_hash,
    )
