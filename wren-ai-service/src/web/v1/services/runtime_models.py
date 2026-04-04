from typing import Optional

from src.core.runtime_identity import RuntimeIdentity, resolve_legacy_project_id


def resolve_request_project_id(
    *,
    project_id: str | int | None = None,
    runtime_identity: Optional[RuntimeIdentity] = None,
    mdl_hash: str | int | None = None,
) -> Optional[str]:
    return resolve_legacy_project_id(
        project_id=project_id,
        runtime_identity=runtime_identity,
        fallback_id=mdl_hash,
    )
