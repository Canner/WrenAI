import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type {
  KnowledgeWorkbenchControllerInteractionInputs,
  KnowledgeWorkbenchKnowledgeState,
} from './knowledgeWorkbenchPageInteractionInputTypes';

export function buildKnowledgeWorkbenchPageInteractionKnowledgeInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(
  knowledgeState: KnowledgeWorkbenchKnowledgeState<TKnowledgeBase, TConnector>,
): Pick<
  KnowledgeWorkbenchControllerInteractionInputs<TKnowledgeBase, TConnector>,
  | 'activeKnowledgeBase'
  | 'activeKnowledgeBaseExecutable'
  | 'activeKnowledgeRuntimeSelector'
  | 'activeKnowledgeSnapshotId'
  | 'canCreateKnowledgeBase'
  | 'createKnowledgeBaseBlockedReason'
  | 'currentKnowledgeBaseId'
  | 'isKnowledgeMutationDisabled'
  | 'isReadonlyKnowledgeBase'
  | 'isSnapshotReadonlyKnowledgeBase'
  | 'knowledgeBases'
  | 'knowledgeOwner'
  | 'loadKnowledgeBases'
  | 'pendingKnowledgeBaseId'
  | 'refetchRuntimeSelector'
  | 'routeKnowledgeBaseId'
  | 'ruleSqlCacheScopeKey'
  | 'setPendingKnowledgeBaseId'
  | 'setSelectedKnowledgeBaseId'
> {
  const {
    activeKnowledgeBase,
    activeKnowledgeBaseExecutable,
    activeKnowledgeRuntimeSelector,
    activeKnowledgeSnapshotId,
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    currentKnowledgeBaseId,
    isKnowledgeMutationDisabled,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    knowledgeBases,
    knowledgeOwner,
    loadKnowledgeBases,
    pendingKnowledgeBaseId,
    refetchRuntimeSelector,
    routeKnowledgeBaseId,
    ruleSqlCacheScopeKey,
    setPendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
  } = knowledgeState;

  return {
    activeKnowledgeBase,
    activeKnowledgeBaseExecutable,
    activeKnowledgeRuntimeSelector,
    activeKnowledgeSnapshotId,
    canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason,
    currentKnowledgeBaseId,
    isKnowledgeMutationDisabled,
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
    knowledgeBases,
    knowledgeOwner,
    loadKnowledgeBases,
    pendingKnowledgeBaseId,
    refetchRuntimeSelector,
    routeKnowledgeBaseId,
    ruleSqlCacheScopeKey,
    setPendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
  };
}

export default buildKnowledgeWorkbenchPageInteractionKnowledgeInputs;
