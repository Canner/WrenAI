import useKnowledgeAssets from '@/hooks/useKnowledgeAssets';
import useKnowledgeConnectors from '@/hooks/useKnowledgeConnectors';
import useKnowledgeDiagramData from '@/hooks/useKnowledgeDiagramData';
import useKnowledgeRuntimeDataSync from '@/hooks/useKnowledgeRuntimeDataSync';
import type { ConnectorView, KnowledgeBaseRecord } from './types';

export type KnowledgeWorkbenchContentDataArgs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
> = {
  activeKnowledgeBase?: TKnowledgeBase | null;
  activeKnowledgeBaseExecutable: boolean;
  activeKnowledgeRuntimeSelector: Parameters<
    typeof useKnowledgeConnectors<TConnector>
  >[0]['connectorRuntimeSelector'];
  activeKnowledgeSnapshotId?: string | null;
  assetModalOpen: boolean;
  draftAssets: Parameters<typeof useKnowledgeAssets>[0]['draftAssets'];
  fetchConnectors: Parameters<
    typeof useKnowledgeConnectors<TConnector>
  >[0]['fetchConnectors'];
  handleConnectorLoadError?: Parameters<
    typeof useKnowledgeConnectors<TConnector>
  >[0]['onLoadError'];
  hasRuntimeScope: boolean;
  initialKnowledgeSourceType?: string;
  knowledgeOwner?: string | null;
  knowledgeSourceOptions: Parameters<
    typeof useKnowledgeConnectors<TConnector>
  >[0]['sourceOptions'];
  matchedDemoKnowledge?: Parameters<
    typeof useKnowledgeAssets
  >[0]['matchedDemoKnowledge'];
  refetchRuntimeSelector: Parameters<
    typeof useKnowledgeRuntimeDataSync
  >[0]['refetchRuntimeSelector'];
  runtimeSyncScopeKey?: string | null;
  runtimeTransitioning: boolean;
};

export type KnowledgeWorkbenchContentDiagramState = ReturnType<
  typeof useKnowledgeDiagramData
>;
