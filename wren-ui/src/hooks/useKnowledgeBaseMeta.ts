import { useMemo } from 'react';
import {
  getReferenceDemoKnowledgeByName,
  getReferenceDisplayKnowledgeName,
  type ReferenceDemoKnowledge,
} from '@/utils/referenceDemoKnowledge';
import { isHistoricalSnapshotReadonly } from '@/utils/runtimeSnapshot';
import { canCreateKnowledgeBaseInWorkspace } from '@/utils/workspaceGovernance';

type KnowledgeBaseLike = {
  id: string;
  name?: string | null;
  kind?: string | null;
  sampleDataset?: string | null;
  slug?: string | null;
  description?: string | null;
  createdBy?: string | null;
  defaultKbSnapshotId?: string | null;
  archivedAt?: string | null;
};

type LifecycleActionChecker = (args: {
  workspaceKind?: string | null;
  knowledgeBaseKind?: string | null;
  roleKey?: string | null;
  authorizationActions?: Record<string, boolean> | null;
  snapshotReadonly: boolean;
}) => boolean;

export const resolveActiveKnowledgeBaseFromList = <
  TKnowledgeBase extends KnowledgeBaseLike,
>({
  knowledgeBases,
  selectedKnowledgeBaseId,
  routeKnowledgeBaseId,
  currentKnowledgeBaseId,
  selectorKnowledgeBaseFallback,
}: {
  knowledgeBases: TKnowledgeBase[];
  selectedKnowledgeBaseId?: string | null;
  routeKnowledgeBaseId?: string;
  currentKnowledgeBaseId?: string;
  selectorKnowledgeBaseFallback?: TKnowledgeBase | null;
}) =>
  knowledgeBases.find((kb) => kb.id === routeKnowledgeBaseId) ||
  knowledgeBases.find((kb) => kb.id === currentKnowledgeBaseId) ||
  knowledgeBases.find((kb) => kb.id === selectedKnowledgeBaseId) ||
  knowledgeBases[0] ||
  selectorKnowledgeBaseFallback ||
  null;

export default function useKnowledgeBaseMeta<
  TKnowledgeBase extends KnowledgeBaseLike,
>({
  knowledgeBases,
  selectedKnowledgeBaseId,
  routeKnowledgeBaseId,
  currentKnowledgeBaseId,
  selectorKnowledgeBaseFallback,
  routeKbSnapshotId,
  currentKbSnapshotId,
  workspaceKind,
  roleKey,
  authorizationActions,
  snapshotReadonlyHint,
  canShowKnowledgeLifecycleAction,
  resolveLifecycleActionLabel,
  resolveReferenceOwner,
}: {
  knowledgeBases: TKnowledgeBase[];
  selectedKnowledgeBaseId?: string | null;
  routeKnowledgeBaseId?: string;
  currentKnowledgeBaseId?: string;
  selectorKnowledgeBaseFallback?: TKnowledgeBase | null;
  routeKbSnapshotId?: string;
  currentKbSnapshotId?: string;
  workspaceKind?: string | null;
  roleKey?: string | null;
  authorizationActions?: Record<string, boolean> | null;
  snapshotReadonlyHint: string;
  canShowKnowledgeLifecycleAction: LifecycleActionChecker;
  resolveLifecycleActionLabel: (archivedAt?: string | null) => string;
  resolveReferenceOwner: (
    owner: string | null | undefined,
    fallback?: string,
  ) => string;
}) {
  const activeKnowledgeBase = useMemo(
    () =>
      resolveActiveKnowledgeBaseFromList({
        knowledgeBases,
        selectedKnowledgeBaseId,
        routeKnowledgeBaseId,
        currentKnowledgeBaseId,
        selectorKnowledgeBaseFallback,
      }),
    [
      currentKnowledgeBaseId,
      knowledgeBases,
      routeKnowledgeBaseId,
      selectedKnowledgeBaseId,
      selectorKnowledgeBaseFallback,
    ],
  );
  const activeKnowledgeBaseUsesRuntime = Boolean(
    activeKnowledgeBase?.id &&
    activeKnowledgeBase.id === routeKnowledgeBaseId &&
    routeKbSnapshotId,
  );
  const activeKnowledgeBaseExecutable = Boolean(
    activeKnowledgeBase?.defaultKbSnapshotId,
  );
  const currentRoleKey = roleKey || null;
  const hasLegacyKnowledgeBaseCreateRole = ['owner', 'admin'].includes(
    String(currentRoleKey || '').toLowerCase(),
  );
  const resolvedAuthorizationActions = authorizationActions || {};
  const canCreateKnowledgeBase =
    canCreateKnowledgeBaseInWorkspace(workspaceKind) &&
    (Object.keys(resolvedAuthorizationActions).length > 0
      ? Boolean(resolvedAuthorizationActions['knowledge_base.create'])
      : hasLegacyKnowledgeBaseCreateRole);
  const createKnowledgeBaseBlockedReason = !canCreateKnowledgeBaseInWorkspace(
    workspaceKind,
  )
    ? '系统样例空间不支持创建知识库'
    : '仅管理员或所有者可创建知识库';
  const isReadonlyKnowledgeBase = activeKnowledgeBase?.kind === 'system_sample';
  const isSnapshotReadonlyKnowledgeBase = isHistoricalSnapshotReadonly({
    selectorHasRuntime: activeKnowledgeBaseUsesRuntime,
    currentKbSnapshotId,
    defaultKbSnapshotId: activeKnowledgeBase?.defaultKbSnapshotId,
  });
  const isKnowledgeMutationDisabled =
    isReadonlyKnowledgeBase || isSnapshotReadonlyKnowledgeBase;
  const canManageKnowledgeBaseLifecycle = canShowKnowledgeLifecycleAction({
    workspaceKind,
    knowledgeBaseKind: activeKnowledgeBase?.kind,
    roleKey: currentRoleKey,
    authorizationActions: resolvedAuthorizationActions,
    snapshotReadonly: isSnapshotReadonlyKnowledgeBase,
  });
  const knowledgeLifecycleActionLabel = resolveLifecycleActionLabel(
    activeKnowledgeBase?.archivedAt,
  );
  const knowledgeMutationHint = isReadonlyKnowledgeBase
    ? '系统样例知识库仅供浏览体验，不支持编辑或接入业务资产。'
    : isSnapshotReadonlyKnowledgeBase
      ? snapshotReadonlyHint
      : null;
  const matchedDemoKnowledge = useMemo<ReferenceDemoKnowledge | null>(
    () => getReferenceDemoKnowledgeByName(activeKnowledgeBase) || null,
    [activeKnowledgeBase],
  );
  const isReferenceDemoKnowledge = Boolean(matchedDemoKnowledge);
  const knowledgeDescription = useMemo(
    () =>
      getReferenceDemoKnowledgeByName(activeKnowledgeBase)?.description ||
      activeKnowledgeBase?.description ||
      (isReferenceDemoKnowledge ? matchedDemoKnowledge?.description : null),
    [
      activeKnowledgeBase?.description,
      activeKnowledgeBase,
      isReferenceDemoKnowledge,
      matchedDemoKnowledge?.description,
    ],
  );
  const knowledgeOwner = useMemo(
    () =>
      resolveReferenceOwner(
        activeKnowledgeBase?.createdBy,
        matchedDemoKnowledge?.owner || '工作区成员',
      ),
    [
      activeKnowledgeBase?.createdBy,
      matchedDemoKnowledge?.owner,
      resolveReferenceOwner,
    ],
  );
  const displayKnowledgeName = useMemo(
    () =>
      getReferenceDisplayKnowledgeName(activeKnowledgeBase) ||
      activeKnowledgeBase?.name ||
      '知识库',
    [activeKnowledgeBase],
  );

  return {
    activeKnowledgeBase,
    activeKnowledgeBaseUsesRuntime,
    activeKnowledgeBaseExecutable,
    currentRoleKey,
    authorizationActions: resolvedAuthorizationActions,
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    isKnowledgeMutationDisabled,
    canManageKnowledgeBaseLifecycle,
    knowledgeLifecycleActionLabel,
    knowledgeMutationHint,
    matchedDemoKnowledge,
    isReferenceDemoKnowledge,
    knowledgeDescription,
    knowledgeOwner,
    displayKnowledgeName,
  };
}
