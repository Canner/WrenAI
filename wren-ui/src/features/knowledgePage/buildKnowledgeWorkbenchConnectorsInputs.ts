import useKnowledgeConnectors from '@/hooks/useKnowledgeConnectors';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchContentDataArgs } from './knowledgeWorkbenchContentDataTypes';

export function buildKnowledgeWorkbenchConnectorsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeRuntimeSelector,
  activeKnowledgeSnapshotId,
  assetModalOpen,
  fetchConnectors,
  handleConnectorLoadError,
  hasRuntimeScope,
  initialKnowledgeSourceType,
  knowledgeSourceOptions,
}: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>): Parameters<
  typeof useKnowledgeConnectors<TConnector>
>[0] {
  return {
    hasRuntimeScope,
    activeKnowledgeBaseId: activeKnowledgeBase?.id,
    activeKbSnapshotId: activeKnowledgeSnapshotId,
    connectorRuntimeSelector: activeKnowledgeRuntimeSelector,
    assetModalOpen,
    sourceOptions: knowledgeSourceOptions,
    initialSourceType: initialKnowledgeSourceType,
    fetchConnectors,
    onLoadError: handleConnectorLoadError,
  };
}

export default buildKnowledgeWorkbenchConnectorsInputs;
