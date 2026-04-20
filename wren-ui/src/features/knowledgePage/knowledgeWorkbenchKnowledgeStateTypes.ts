import useKnowledgeBaseMeta from '@/hooks/useKnowledgeBaseMeta';
import useKnowledgeBaseSelection from '@/hooks/useKnowledgeBaseSelection';
import useKnowledgeDataLoaders from '@/hooks/useKnowledgeDataLoaders';
import useKnowledgeRuntimeContext from '@/hooks/useKnowledgeRuntimeContext';
import useKnowledgeRuntimeBindings from './useKnowledgeRuntimeBindings';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchKnowledgeStateArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  buildRuntimeScopeUrl: Parameters<
    typeof useKnowledgeDataLoaders<TKnowledgeBase, TConnector>
  >[0]['buildRuntimeScopeUrl'];
  hasRuntimeScope: boolean;
  routerAsPath: string;
  routerQuery: Record<string, string | string[] | undefined>;
  routerReady: boolean;
  runtimeNavigationWorkspaceId?: string | null;
  transitionTo: Parameters<
    typeof useKnowledgeBaseSelection<TKnowledgeBase>
  >[0]['transitionTo'];
  snapshotReadonlyHint: string;
};

export type KnowledgeWorkbenchBaseMetaState<
  TKnowledgeBase extends KnowledgeBaseRecord,
> = ReturnType<typeof useKnowledgeBaseMeta<TKnowledgeBase>>;

export type KnowledgeWorkbenchRuntimeContextState = ReturnType<
  typeof useKnowledgeRuntimeContext
>;

export type KnowledgeWorkbenchDataLoadersState<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = ReturnType<typeof useKnowledgeDataLoaders<TKnowledgeBase, TConnector>>;

export type KnowledgeWorkbenchRuntimeBindingsState = ReturnType<
  typeof useKnowledgeRuntimeBindings
>;
