import useKnowledgeConnectors from '@/hooks/useKnowledgeConnectors';
import type { ConnectorView, KnowledgeBaseRecord } from './types';
import type { KnowledgeWorkbenchContentDataArgs } from './knowledgeWorkbenchContentDataTypes';

export function buildKnowledgeWorkbenchConnectorsInputs<
  TKnowledgeBase extends KnowledgeBaseRecord,
  TConnector extends ConnectorView,
>({
  activeKnowledgeBase,
  activeKnowledgeRuntimeSelector,
  assetModalOpen,
  fetchConnectors,
  handleConnectorLoadError,
  hasRuntimeScope,
  initialKnowledgeSourceType,
  knowledgeSourceOptions,
}: KnowledgeWorkbenchContentDataArgs<TKnowledgeBase, TConnector>): Parameters<
  typeof useKnowledgeConnectors<TConnector>
>[0] {
  const workspaceId =
    activeKnowledgeRuntimeSelector?.workspaceId ||
    activeKnowledgeBase?.workspaceId;

  return {
    hasRuntimeScope,
    activeWorkspaceId: workspaceId,
    connectorRuntimeSelector: workspaceId ? { workspaceId } : undefined,
    assetModalOpen,
    sourceOptions: knowledgeSourceOptions,
    initialSourceType: initialKnowledgeSourceType,
    fetchConnectors,
    onLoadError: handleConnectorLoadError,
  };
}

export default buildKnowledgeWorkbenchConnectorsInputs;
