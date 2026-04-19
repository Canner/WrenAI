import {
  canShowKnowledgeLifecycleAction,
  getKnowledgeLifecycleActionLabel,
} from '@/hooks/useKnowledgePageHelpers';
import useKnowledgeBaseMeta from '@/hooks/useKnowledgeBaseMeta';
import { resolveReferenceOwner } from './constants';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchKnowledgeStateArgs } from './knowledgeWorkbenchKnowledgeStateTypes';

export function buildKnowledgeWorkbenchBaseMetaInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  {
    snapshotReadonlyHint,
  }: Pick<
    KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>,
    'snapshotReadonlyHint'
  >,
  {
    authorizationActions,
    currentKbSnapshotId,
    currentKnowledgeBaseId,
    knowledgeBases,
    roleKey,
    routeKbSnapshotId,
    routeKnowledgeBaseId,
    selectedKnowledgeBaseId,
    selectorKnowledgeBaseFallback,
    workspaceKind,
  }: {
    authorizationActions?: Record<string, boolean>;
    currentKbSnapshotId?: string | null;
    currentKnowledgeBaseId?: string | null;
    knowledgeBases: Parameters<
      typeof useKnowledgeBaseMeta<TKnowledgeBase>
    >[0]['knowledgeBases'];
    roleKey?: string | null;
    routeKbSnapshotId?: string | null;
    routeKnowledgeBaseId?: string | null;
    selectedKnowledgeBaseId?: string | null;
    selectorKnowledgeBaseFallback?: TKnowledgeBase | null;
    workspaceKind?: string | null;
  },
): Parameters<typeof useKnowledgeBaseMeta<TKnowledgeBase>>[0] {
  return {
    knowledgeBases,
    selectedKnowledgeBaseId,
    routeKnowledgeBaseId: routeKnowledgeBaseId || undefined,
    currentKnowledgeBaseId: currentKnowledgeBaseId || undefined,
    selectorKnowledgeBaseFallback: selectorKnowledgeBaseFallback || undefined,
    routeKbSnapshotId: routeKbSnapshotId || undefined,
    currentKbSnapshotId: currentKbSnapshotId || undefined,
    workspaceKind,
    roleKey,
    authorizationActions,
    snapshotReadonlyHint,
    canShowKnowledgeLifecycleAction,
    resolveLifecycleActionLabel: getKnowledgeLifecycleActionLabel,
    resolveReferenceOwner,
  };
}

export default buildKnowledgeWorkbenchBaseMetaInputs;
