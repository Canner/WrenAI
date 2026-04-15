import {
  PersistedRuntimeIdentity,
  RuntimeScope,
  toPersistedRuntimeIdentity,
} from '@server/context/runtimeScope';

export type PersistedRuntimeIdentitySource = {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
};

export const EMPTY_PERSISTED_RUNTIME_IDENTITY: PersistedRuntimeIdentity = {
  projectId: null,
  workspaceId: null,
  knowledgeBaseId: null,
  kbSnapshotId: null,
  deployHash: null,
  actorUserId: null,
};

export const hasCanonicalRuntimeIdentity = (
  source?: PersistedRuntimeIdentitySource | PersistedRuntimeIdentity | null,
) =>
  Boolean(
    source?.workspaceId ||
      source?.knowledgeBaseId ||
      source?.kbSnapshotId ||
      source?.deployHash,
  );

export const normalizeCanonicalPersistedRuntimeIdentity = <
  T extends PersistedRuntimeIdentitySource | PersistedRuntimeIdentity,
>(
  runtimeIdentity: T,
): T =>
  hasCanonicalRuntimeIdentity(runtimeIdentity)
    ? {
        ...runtimeIdentity,
        projectId: null,
      }
    : runtimeIdentity;

export const toCanonicalPersistedRuntimeIdentityFromScope = (
  runtimeScope?: RuntimeScope | null,
): PersistedRuntimeIdentity =>
  normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(requireRuntimeScope(runtimeScope)),
  );

export const requireRuntimeScope = (
  runtimeScope?: RuntimeScope | null,
  message = 'Runtime scope is required for this operation',
): RuntimeScope => {
  if (!runtimeScope) {
    throw new Error(message);
  }

  return runtimeScope;
};

export const toProjectBridgeRuntimeIdentity = (
  projectId: number,
): PersistedRuntimeIdentity => ({
  projectId,
  workspaceId: null,
  knowledgeBaseId: null,
  kbSnapshotId: null,
  deployHash: null,
  actorUserId: null,
});

export const resolveCanonicalRuntimeScopeIdFromPersistedIdentity = (
  runtimeIdentity?:
    | PersistedRuntimeIdentitySource
    | PersistedRuntimeIdentity
    | null,
): string | null => {
  if (!runtimeIdentity) {
    return null;
  }

  return (
    runtimeIdentity.deployHash ||
    runtimeIdentity.kbSnapshotId ||
    runtimeIdentity.knowledgeBaseId ||
    runtimeIdentity.workspaceId ||
    null
  );
};

export const resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback =
  (
    runtimeIdentity?:
      | PersistedRuntimeIdentitySource
      | PersistedRuntimeIdentity
      | null,
    fallbackBridgeProjectId?: number | null,
  ): string | null => {
    const canonicalRuntimeScopeId =
      resolveCanonicalRuntimeScopeIdFromPersistedIdentity(runtimeIdentity);
    if (canonicalRuntimeScopeId) {
      return canonicalRuntimeScopeId;
    }

    const bridgeProjectId = resolvePersistedProjectBridgeId(
      runtimeIdentity,
      fallbackBridgeProjectId,
    );
    return bridgeProjectId != null ? bridgeProjectId.toString() : null;
  };

export const toPersistedRuntimeIdentityFromSource = (
  source: PersistedRuntimeIdentitySource,
  fallback?: PersistedRuntimeIdentity | null,
): PersistedRuntimeIdentity => {
  const projectId = source.projectId ?? fallback?.projectId;
  if (
    projectId == null &&
    !hasCanonicalRuntimeIdentity(source) &&
    !hasCanonicalRuntimeIdentity(fallback)
  ) {
    throw new Error('Persisted runtime identity requires projectId');
  }

  return {
    projectId: projectId ?? null,
    workspaceId: source.workspaceId ?? fallback?.workspaceId ?? null,
    knowledgeBaseId:
      source.knowledgeBaseId ?? fallback?.knowledgeBaseId ?? null,
    kbSnapshotId: source.kbSnapshotId ?? fallback?.kbSnapshotId ?? null,
    deployHash: source.deployHash ?? fallback?.deployHash ?? null,
    actorUserId: source.actorUserId ?? fallback?.actorUserId ?? null,
  };
};

export const toPersistedRuntimeIdentityPatch = (
  runtimeIdentity?:
    | PersistedRuntimeIdentitySource
    | PersistedRuntimeIdentity
    | null,
): PersistedRuntimeIdentity => {
  if (!runtimeIdentity) {
    return { ...EMPTY_PERSISTED_RUNTIME_IDENTITY };
  }

  const normalizedRuntimeIdentity =
    normalizeCanonicalPersistedRuntimeIdentity(runtimeIdentity);

  return {
    projectId: resolvePersistedProjectBridgeId(normalizedRuntimeIdentity),
    workspaceId: normalizedRuntimeIdentity.workspaceId ?? null,
    knowledgeBaseId: normalizedRuntimeIdentity.knowledgeBaseId ?? null,
    kbSnapshotId: normalizedRuntimeIdentity.kbSnapshotId ?? null,
    deployHash: normalizedRuntimeIdentity.deployHash ?? null,
    actorUserId: normalizedRuntimeIdentity.actorUserId ?? null,
  };
};

export const isPersistedRuntimeIdentityMatch = (
  source: PersistedRuntimeIdentitySource,
  runtimeIdentity: PersistedRuntimeIdentity,
) => {
  if (
    source.projectId != null &&
    source.projectId !== runtimeIdentity.projectId
  ) {
    return false;
  }

  return (
    (!source.workspaceId ||
      source.workspaceId === runtimeIdentity.workspaceId) &&
    (!source.knowledgeBaseId ||
      source.knowledgeBaseId === runtimeIdentity.knowledgeBaseId) &&
    (!source.kbSnapshotId ||
      source.kbSnapshotId === runtimeIdentity.kbSnapshotId) &&
    (!source.deployHash || source.deployHash === runtimeIdentity.deployHash)
  );
};

export const requirePersistedProjectBridgeId = (
  runtimeIdentity: { projectId?: number | null },
  action: string,
): number => {
  if (!runtimeIdentity.projectId) {
    throw new Error(`${action} requires runtimeIdentity compatibility scope`);
  }

  return runtimeIdentity.projectId;
};

export const resolvePersistedProjectBridgeId = (
  runtimeIdentity?: { projectId?: number | null } | null,
  fallbackBridgeProjectId?: number | null,
): number | null =>
  runtimeIdentity?.projectId ?? fallbackBridgeProjectId ?? null;

export const requirePersistedWorkspaceId = (
  runtimeIdentity: { workspaceId?: string | null },
  message = 'Workspace scope is required',
): string => {
  if (!runtimeIdentity.workspaceId) {
    throw new Error(message);
  }

  return runtimeIdentity.workspaceId;
};

export const requirePersistedKnowledgeBaseId = (
  runtimeIdentity: { knowledgeBaseId?: string | null },
  message = 'Knowledge base scope is required',
): string => {
  if (!runtimeIdentity.knowledgeBaseId) {
    throw new Error(message);
  }

  return runtimeIdentity.knowledgeBaseId;
};

export const resolvePersistedKnowledgeBaseId = (
  runtimeIdentity: { knowledgeBaseId?: string | null },
  payload?: { knowledgeBaseId?: string | null },
  message = 'Knowledge base scope is required',
): string => {
  if (runtimeIdentity.knowledgeBaseId) {
    return runtimeIdentity.knowledgeBaseId;
  }

  if (payload?.knowledgeBaseId) {
    return payload.knowledgeBaseId;
  }

  throw new Error(message);
};
