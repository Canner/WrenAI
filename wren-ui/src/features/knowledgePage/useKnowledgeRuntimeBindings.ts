import { useMemo } from 'react';
import {
  resolveKnowledgeInitialSourceType,
  resolveKnowledgeSourceOptions,
} from '@/hooks/useKnowledgeConnectors';
import { resolveKnowledgeRuntimeSelector } from '@/hooks/useKnowledgePageActions';
import { CONNECTOR_SOURCE_OPTIONS } from './constants';
import type { KnowledgeBaseRecord } from './types';

export const resolveKnowledgeActiveSnapshotId = (
  activeKnowledgeBase?: KnowledgeBaseRecord | null,
) =>
  activeKnowledgeBase?.defaultKbSnapshot?.id ||
  activeKnowledgeBase?.defaultKbSnapshotId ||
  null;

export const buildKnowledgeRuleSqlCacheScopeKey = ({
  workspaceId,
  knowledgeBaseId,
  kbSnapshotId,
  deployHash,
}: {
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
}) =>
  [
    workspaceId || '',
    knowledgeBaseId || '',
    kbSnapshotId || '',
    deployHash || '',
  ].join('|');

export function useKnowledgeRuntimeBindings({
  activeKnowledgeBase,
  effectiveWorkspaceId,
  runtimeSelectorState,
  runtimeNavigationWorkspaceId,
}: {
  activeKnowledgeBase?: KnowledgeBaseRecord | null;
  effectiveWorkspaceId?: string | null;
  runtimeSelectorState?: {
    currentWorkspace?: {
      id: string;
      kind?: string | null;
      name?: string;
    } | null;
  } | null;
  runtimeNavigationWorkspaceId?: string | null;
}) {
  const currentWorkspace = runtimeSelectorState?.currentWorkspace || null;
  const knowledgeSourceOptions = useMemo(
    () =>
      resolveKnowledgeSourceOptions({
        workspaceKind: currentWorkspace?.kind,
        sourceOptions: CONNECTOR_SOURCE_OPTIONS,
      }),
    [currentWorkspace?.kind],
  );
  const initialKnowledgeSourceType = useMemo(
    () => resolveKnowledgeInitialSourceType(knowledgeSourceOptions),
    [knowledgeSourceOptions],
  );
  const activeKnowledgeRuntimeSelector = useMemo(
    () =>
      resolveKnowledgeRuntimeSelector({
        knowledgeBase: activeKnowledgeBase,
        fallbackSelector: {
          workspaceId:
            effectiveWorkspaceId || runtimeNavigationWorkspaceId || undefined,
        },
      }),
    [activeKnowledgeBase, effectiveWorkspaceId, runtimeNavigationWorkspaceId],
  );
  const activeKnowledgeSnapshotId =
    resolveKnowledgeActiveSnapshotId(activeKnowledgeBase);
  const ruleSqlCacheScopeKey = useMemo(
    () =>
      buildKnowledgeRuleSqlCacheScopeKey({
        workspaceId: activeKnowledgeRuntimeSelector.workspaceId,
        knowledgeBaseId: activeKnowledgeRuntimeSelector.knowledgeBaseId,
        kbSnapshotId: activeKnowledgeRuntimeSelector.kbSnapshotId,
        deployHash: activeKnowledgeRuntimeSelector.deployHash,
      }),
    [
      activeKnowledgeRuntimeSelector.workspaceId,
      activeKnowledgeRuntimeSelector.knowledgeBaseId,
      activeKnowledgeRuntimeSelector.kbSnapshotId,
      activeKnowledgeRuntimeSelector.deployHash,
    ],
  );

  return {
    activeKnowledgeRuntimeSelector,
    activeKnowledgeSnapshotId,
    currentWorkspace,
    initialKnowledgeSourceType,
    knowledgeSourceOptions,
    ruleSqlCacheScopeKey,
  };
}

export default useKnowledgeRuntimeBindings;
