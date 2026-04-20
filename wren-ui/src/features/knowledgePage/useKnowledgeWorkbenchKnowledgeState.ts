import useAuthSession from '@/hooks/useAuthSession';
import useKnowledgeBaseListCache from '@/hooks/useKnowledgeBaseListCache';
import useKnowledgeBaseMeta from '@/hooks/useKnowledgeBaseMeta';
import useKnowledgeBaseSelection from '@/hooks/useKnowledgeBaseSelection';
import useKnowledgeDataLoaders from '@/hooks/useKnowledgeDataLoaders';
import useKnowledgeRuntimeContext from '@/hooks/useKnowledgeRuntimeContext';
import useKnowledgeSelectorFallback from '@/hooks/useKnowledgeSelectorFallback';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { useEffect, useMemo } from 'react';
import { primeKnowledgeBaseList } from '@/utils/runtimePagePrefetch';
import buildKnowledgeWorkbenchBaseMetaInputs from './buildKnowledgeWorkbenchBaseMetaInputs';
import buildKnowledgeWorkbenchBaseSelectionInputs from './buildKnowledgeWorkbenchBaseSelectionInputs';
import buildKnowledgeWorkbenchDataLoadersInputs from './buildKnowledgeWorkbenchDataLoadersInputs';
import buildKnowledgeWorkbenchListCacheInputs from './buildKnowledgeWorkbenchListCacheInputs';
import buildKnowledgeWorkbenchRuntimeBindingsInputs from './buildKnowledgeWorkbenchRuntimeBindingsInputs';
import buildKnowledgeWorkbenchRuntimeContextInputs from './buildKnowledgeWorkbenchRuntimeContextInputs';
import buildKnowledgeWorkbenchSelectorFallbackInputs from './buildKnowledgeWorkbenchSelectorFallbackInputs';
import useKnowledgeRuntimeBindings from './useKnowledgeRuntimeBindings';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchKnowledgeStateArgs } from './knowledgeWorkbenchKnowledgeStateTypes';

export function useKnowledgeWorkbenchKnowledgeState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>(args: KnowledgeWorkbenchKnowledgeStateArgs<TKnowledgeBase, TConnector>) {
  const authSession = useAuthSession();
  const runtimeSelector = useRuntimeSelectorState();
  const refetchRuntimeSelector = runtimeSelector.refetch;
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const currentWorkspace = runtimeSelectorState?.currentWorkspace || null;

  const runtimeContext = useKnowledgeRuntimeContext(
    buildKnowledgeWorkbenchRuntimeContextInputs(args, runtimeSelectorState),
  );
  const {
    effectiveRuntimeSelector,
    currentKnowledgeBaseId,
    currentKbSnapshotId,
    routeKnowledgeBaseId,
    routeKbSnapshotId,
    runtimeSyncScopeKey,
  } = runtimeContext;

  const { knowledgeBasesUrl, cachedKnowledgeBaseList } =
    useKnowledgeBaseListCache<TKnowledgeBase>(
      buildKnowledgeWorkbenchListCacheInputs(args, runtimeContext),
    );
  const selectorKnowledgeBaseList = useMemo(() => {
    if (
      !currentWorkspace?.id ||
      effectiveRuntimeSelector.workspaceId !== currentWorkspace.id
    ) {
      return [] as TKnowledgeBase[];
    }

    return (runtimeSelectorState?.knowledgeBases || []).map((knowledgeBase) => ({
      id: knowledgeBase.id,
      workspaceId: currentWorkspace.id,
      slug: knowledgeBase.slug,
      name: knowledgeBase.name,
      defaultKbSnapshotId: knowledgeBase.defaultKbSnapshotId || null,
      assetCount: knowledgeBase.assetCount ?? 0,
    })) as TKnowledgeBase[];
  }, [
    currentWorkspace?.id,
    effectiveRuntimeSelector.workspaceId,
    runtimeSelectorState?.knowledgeBases,
  ]);
  const initialKnowledgeBaseList = useMemo(
    () =>
      cachedKnowledgeBaseList && cachedKnowledgeBaseList.length > 0
        ? cachedKnowledgeBaseList
        : selectorKnowledgeBaseList,
    [cachedKnowledgeBaseList, selectorKnowledgeBaseList],
  );

  useEffect(() => {
    if (!knowledgeBasesUrl || initialKnowledgeBaseList.length === 0) {
      return;
    }

    primeKnowledgeBaseList({
      url: knowledgeBasesUrl,
      payload: initialKnowledgeBaseList,
    });
  }, [initialKnowledgeBaseList, knowledgeBasesUrl]);

  const selectorKnowledgeBaseFallback = useKnowledgeSelectorFallback(
    buildKnowledgeWorkbenchSelectorFallbackInputs(runtimeContext, {
      currentWorkspaceId: currentWorkspace?.id,
      runtimeSelectorState,
    }),
  );

  const {
    fetchKnowledgeBaseList,
    handleKnowledgeBaseLoadError,
    fetchConnectors,
    handleConnectorLoadError,
  } = useKnowledgeDataLoaders<TKnowledgeBase, TConnector>(
    buildKnowledgeWorkbenchDataLoadersInputs(args),
  );

  const {
    knowledgeBases,
    selectedKnowledgeBaseId,
    pendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
    setPendingKnowledgeBaseId,
    loadKnowledgeBases,
    switchKnowledgeBase,
  } = useKnowledgeBaseSelection<TKnowledgeBase>(
    buildKnowledgeWorkbenchBaseSelectionInputs(args, {
      currentKnowledgeBaseId,
      handleKnowledgeBaseLoadError,
      knowledgeBasesUrl,
      cachedKnowledgeBaseList: initialKnowledgeBaseList,
      routeKnowledgeBaseId,
      fetchKnowledgeBaseList,
    }),
  );

  const meta = useKnowledgeBaseMeta<TKnowledgeBase>(
    buildKnowledgeWorkbenchBaseMetaInputs(args, {
      authorizationActions: authSession.data?.authorization?.actions,
      currentKbSnapshotId,
      currentKnowledgeBaseId,
      knowledgeBases,
      roleKey: authSession.data?.membership?.roleKey,
      routeKbSnapshotId,
      routeKnowledgeBaseId,
      selectedKnowledgeBaseId,
      selectorKnowledgeBaseFallback:
        (selectorKnowledgeBaseFallback as TKnowledgeBase | null | undefined) ||
        undefined,
      workspaceKind: authSession.data?.workspace?.kind,
    }),
  );

  const runtimeBindings = useKnowledgeRuntimeBindings(
    buildKnowledgeWorkbenchRuntimeBindingsInputs(args, {
      activeKnowledgeBase: meta.activeKnowledgeBase,
      effectiveWorkspaceId: effectiveRuntimeSelector.workspaceId,
      runtimeSelectorState,
    }),
  );

  return {
    currentKnowledgeBaseId,
    fetchConnectors,
    handleConnectorLoadError,
    loadKnowledgeBases,
    pendingKnowledgeBaseId,
    refetchRuntimeSelector,
    routeKbSnapshotId,
    routeKnowledgeBaseId,
    runtimeSelectorState,
    runtimeSyncScopeKey,
    setPendingKnowledgeBaseId,
    setSelectedKnowledgeBaseId,
    switchKnowledgeBase,
    knowledgeBases,
    ...meta,
    ...runtimeBindings,
  };
}

export default useKnowledgeWorkbenchKnowledgeState;
