import { useCallback, useEffect, useMemo, useState } from 'react';
import useKnowledgeAssetSource from './useKnowledgeAssetSource';
import { canImportSampleDatasetInWorkspace } from '@/utils/workspaceGovernance';
import type { SourceOption } from '@/features/knowledgePage/types';

type ConnectorSourceOption = Pick<SourceOption, 'key' | 'category'>;

export const resolveKnowledgeConnectorScopeKey = ({
  hasRuntimeScope,
  activeWorkspaceId,
}: {
  hasRuntimeScope: boolean;
  activeWorkspaceId?: string | null;
}) => {
  if (!hasRuntimeScope || !activeWorkspaceId) {
    return null;
  }

  return activeWorkspaceId;
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

export const resolveKnowledgeSourceOptions = ({
  workspaceKind,
  sourceOptions,
}: {
  workspaceKind?: string | null;
  sourceOptions: SourceOption[];
}) =>
  canImportSampleDatasetInWorkspace(workspaceKind)
    ? sourceOptions
    : sourceOptions.filter((option) => option.category === 'connector');

export const resolveKnowledgeInitialSourceType = (
  sourceOptions: ConnectorSourceOption[],
) => sourceOptions[0]?.key || 'database';

type ConnectorInput = {
  id: string;
  displayName: string;
  type: string;
};

export default function useKnowledgeConnectors<
  TConnector extends ConnectorInput,
>({
  hasRuntimeScope,
  activeWorkspaceId,
  connectorRuntimeSelector,
  assetModalOpen,
  sourceOptions,
  initialSourceType,
  fetchConnectors,
  onLoadError,
}: {
  hasRuntimeScope: boolean;
  activeWorkspaceId?: string | null;
  connectorRuntimeSelector?: {
    workspaceId?: string;
    knowledgeBaseId?: string;
    kbSnapshotId?: string;
    deployHash?: string;
    runtimeScopeId?: string;
  };
  assetModalOpen: boolean;
  sourceOptions: SourceOption[];
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
        activeWorkspaceId,
      }),
    [activeWorkspaceId, hasRuntimeScope],
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

  const loadConnectors = useCallback(async () => {
    if (!connectorScopeKey) {
      setConnectors([]);
      setConnectorsLoading(false);
      return [];
    }

    setConnectorsLoading(true);
    try {
      const payload = await fetchConnectors(connectorRuntimeSelector);
      const nextConnectors = Array.isArray(payload) ? payload : [];
      setConnectors(nextConnectors);
      return nextConnectors;
    } catch (error) {
      onLoadError?.(error);
      setConnectors([]);
      return [];
    } finally {
      setConnectorsLoading(false);
    }
  }, [
    connectorRuntimeSelector,
    connectorScopeKey,
    fetchConnectors,
    onLoadError,
  ]);

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

    void loadConnectors();
  }, [connectorScopeKey, loadConnectors, shouldLoadConnectors]);

  return {
    connectors,
    connectorsLoading,
    connectorScopeKey,
    loadConnectors,
    shouldLoadConnectors,
    ...assetSource,
  };
}
