import { useEffect, useMemo, useState } from 'react';
import useKnowledgeAssetSource from './useKnowledgeAssetSource';

type ConnectorSourceOption = {
  key: string;
  category: 'demo' | 'connector';
};

export const resolveKnowledgeConnectorScopeKey = ({
  hasRuntimeScope,
  activeKnowledgeBaseId,
  activeKbSnapshotId,
}: {
  hasRuntimeScope: boolean;
  activeKnowledgeBaseId?: string | null;
  activeKbSnapshotId?: string | null;
}) => {
  if (!hasRuntimeScope || !activeKnowledgeBaseId || !activeKbSnapshotId) {
    return null;
  }

  return `${activeKnowledgeBaseId}:${activeKbSnapshotId}`;
};

export const shouldLoadKnowledgeConnectors = ({
  assetModalOpen,
  connectorScopeKey,
  selectedSourceType,
  sourceOptions,
}: {
  assetModalOpen: boolean;
  connectorScopeKey: string | null;
  selectedSourceType: string;
  sourceOptions: ConnectorSourceOption[];
}) => {
  if (!connectorScopeKey || !assetModalOpen) {
    return false;
  }

  return (
    sourceOptions.find((option) => option.key === selectedSourceType)
      ?.category === 'connector'
  );
};

type ConnectorInput = {
  id: string;
  displayName: string;
  type: string;
};

export default function useKnowledgeConnectors<
  TConnector extends ConnectorInput,
>({
  hasRuntimeScope,
  activeKnowledgeBaseId,
  activeKbSnapshotId,
  connectorRuntimeSelector,
  assetModalOpen,
  sourceOptions,
  initialSourceType,
  fetchConnectors,
  onLoadError,
}: {
  hasRuntimeScope: boolean;
  activeKnowledgeBaseId?: string | null;
  activeKbSnapshotId?: string | null;
  connectorRuntimeSelector?: {
    workspaceId?: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    deployHash?: string;
    runtimeScopeId?: string;
  };
  assetModalOpen: boolean;
  sourceOptions: ConnectorSourceOption[];
  initialSourceType?: string;
  fetchConnectors: (selector?: {
    workspaceId?: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    deployHash?: string;
    runtimeScopeId?: string;
  }) => Promise<TConnector[]>;
  onLoadError?: (error: unknown) => void;
}) {
  const [connectors, setConnectors] = useState<TConnector[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);

  const assetSource = useKnowledgeAssetSource({
    sourceOptions,
    connectors,
    initialSourceType,
  });
  const { selectedSourceType } = assetSource;

  const connectorScopeKey = useMemo(
    () =>
      resolveKnowledgeConnectorScopeKey({
        hasRuntimeScope,
        activeKnowledgeBaseId,
        activeKbSnapshotId,
      }),
    [activeKbSnapshotId, activeKnowledgeBaseId, hasRuntimeScope],
  );

  const shouldLoadConnectors = useMemo(
    () =>
      shouldLoadKnowledgeConnectors({
        assetModalOpen,
        connectorScopeKey,
        selectedSourceType,
        sourceOptions,
      }),
    [assetModalOpen, connectorScopeKey, selectedSourceType, sourceOptions],
  );

  useEffect(() => {
    if (!connectorScopeKey) {
      setConnectorsLoading(false);
      setConnectors([]);
      return;
    }

    if (!shouldLoadConnectors) {
      setConnectorsLoading(false);
      return;
    }

    const loadConnectors = async () => {
      setConnectorsLoading(true);
      try {
        const payload = await fetchConnectors(connectorRuntimeSelector);
        setConnectors(Array.isArray(payload) ? payload : []);
      } catch (error) {
        onLoadError?.(error);
        setConnectors([]);
      } finally {
        setConnectorsLoading(false);
      }
    };

    void loadConnectors();
  }, [
    connectorRuntimeSelector,
    connectorScopeKey,
    fetchConnectors,
    onLoadError,
    shouldLoadConnectors,
  ]);

  return {
    connectors,
    connectorsLoading,
    connectorScopeKey,
    shouldLoadConnectors,
    ...assetSource,
  };
}
