import {
  canCreateKnowledgeBaseInWorkspace,
  isSystemSampleKnowledgeBase,
} from '@/utils/workspaceGovernance';

type KnowledgeBaseRecordLite = {
  id: string;
  defaultKbSnapshot?: {
    id?: string | null;
    deployHash?: string | null;
    displayName?: string | null;
    status?: string | null;
  } | null;
};

export const shouldRouteSwitchKnowledgeBase = (
  _knowledgeBase: KnowledgeBaseRecordLite,
  _currentKnowledgeBaseId?: string | null,
) => false;

export const resolveVisibleKnowledgeBaseId = ({
  activeKnowledgeBaseId,
  pendingKnowledgeBaseId,
}: {
  activeKnowledgeBaseId?: string | null;
  pendingKnowledgeBaseId?: string | null;
}) => pendingKnowledgeBaseId || activeKnowledgeBaseId || null;

export const shouldCommitPendingKnowledgeBaseSwitch = ({
  currentKnowledgeBaseId,
  routeKnowledgeBaseId,
  pendingKnowledgeBaseId,
  routeRuntimeSyncing,
}: {
  currentKnowledgeBaseId?: string | null;
  routeKnowledgeBaseId?: string | null;
  pendingKnowledgeBaseId?: string | null;
  routeRuntimeSyncing: boolean;
}) =>
  !routeRuntimeSyncing &&
  Boolean(pendingKnowledgeBaseId) &&
  pendingKnowledgeBaseId === (routeKnowledgeBaseId || currentKnowledgeBaseId);

export const shouldShowKnowledgeAssetsLoading = ({
  activeKnowledgeBaseUsesRuntime,
  assetCount,
  diagramLoading,
  hasDiagramData,
  routeRuntimeSyncing,
}: {
  activeKnowledgeBaseUsesRuntime: boolean;
  assetCount: number;
  diagramLoading: boolean;
  hasDiagramData: boolean;
  routeRuntimeSyncing: boolean;
}) =>
  activeKnowledgeBaseUsesRuntime &&
  assetCount === 0 &&
  (routeRuntimeSyncing || (diagramLoading && !hasDiagramData));

export const resolveKnowledgeNavBadgeCount = ({
  navKnowledgeBaseId,
  activeKnowledgeBaseId,
  activeAssetCount,
  fallbackCount,
}: {
  navKnowledgeBaseId?: string | null;
  activeKnowledgeBaseId?: string | null;
  activeAssetCount: number;
  fallbackCount?: number | null;
}) => {
  if (
    navKnowledgeBaseId &&
    activeKnowledgeBaseId &&
    navKnowledgeBaseId === activeKnowledgeBaseId &&
    activeAssetCount > 0
  ) {
    return activeAssetCount;
  }

  return fallbackCount || 0;
};

export const canShowKnowledgeLifecycleAction = ({
  workspaceKind,
  knowledgeBaseKind,
  roleKey,
  authorizationActions,
  snapshotReadonly,
}: {
  workspaceKind?: string | null;
  knowledgeBaseKind?: string | null;
  roleKey?: string | null;
  authorizationActions?: Record<string, boolean> | null;
  snapshotReadonly: boolean;
}) => {
  const hasLegacyManagerRole = ['owner', 'admin'].includes(
    String(roleKey || '').toLowerCase(),
  );

  if (snapshotReadonly) {
    return false;
  }

  if (authorizationActions) {
    return (
      Boolean(authorizationActions['knowledge_base.update']) &&
      Boolean(authorizationActions['knowledge_base.archive'])
    );
  }

  return (
    canCreateKnowledgeBaseInWorkspace(workspaceKind) &&
    !isSystemSampleKnowledgeBase(knowledgeBaseKind) &&
    hasLegacyManagerRole
  );
};

export const getKnowledgeLifecycleActionLabel = (archivedAt?: string | null) =>
  archivedAt ? '恢复知识库' : '归档知识库';
