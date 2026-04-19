import { useMemo } from 'react';
import { message } from 'antd';
import useRestRequest from '@/hooks/useRestRequest';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  buildConnectorsCollectionRequestKey,
  buildConnectorsCollectionUrl,
  normalizeConnectorsCollectionPayload,
  type ConnectorView,
} from './connectorsPageUtils';

export default function useConnectorCatalog({
  enabled,
  workspaceScopedSelector,
}: {
  enabled: boolean;
  workspaceScopedSelector: { workspaceId?: string } | null;
}) {
  const requireWorkspaceSelector = () => {
    if (!workspaceScopedSelector?.workspaceId) {
      throw new Error('当前工作空间未就绪，请稍后重试。');
    }

    return workspaceScopedSelector;
  };

  const {
    data: connectors,
    loading,
    refetch: loadConnectors,
  } = useRestRequest<ConnectorView[]>({
    enabled,
    initialData: [],
    requestKey: buildConnectorsCollectionRequestKey(workspaceScopedSelector),
    request: async ({ signal }) => {
      const response = await fetch(
        buildConnectorsCollectionUrl(requireWorkspaceSelector()),
        { signal },
      );
      if (!response.ok) {
        throw new Error(`加载连接器失败：${response.status}`);
      }

      const payload = await response.json();
      return normalizeConnectorsCollectionPayload(payload);
    },
    onError: (error) => {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    },
  });

  const configuredSecretCount = useMemo(
    () => connectors.filter((connector) => connector.hasSecret).length,
    [connectors],
  );

  return {
    connectors,
    loading,
    loadConnectors,
    configuredSecretCount,
  };
}
