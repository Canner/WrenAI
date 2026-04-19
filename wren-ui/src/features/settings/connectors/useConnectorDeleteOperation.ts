import { message } from 'antd';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { buildConnectorItemUrl } from './connectorsPageUtils';
import type { ConnectorMutationOperationArgs } from './connectorMutationOperationTypes';

export default function useConnectorDeleteOperation({
  deleteConnectorBlockedReason,
  requireWorkspaceSelector,
  loadConnectors,
}: Pick<
  ConnectorMutationOperationArgs,
  'deleteConnectorBlockedReason' | 'requireWorkspaceSelector' | 'loadConnectors'
>) {
  const deleteConnector = async (connectorId: string) => {
    if (deleteConnectorBlockedReason) {
      message.info(deleteConnectorBlockedReason);
      return;
    }
    try {
      const response = await fetch(
        buildConnectorItemUrl(connectorId, requireWorkspaceSelector()),
        {
          method: 'DELETE',
        },
      );
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || '删除连接器失败。');
      }

      message.success('连接器已删除。');
      await loadConnectors();
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '删除连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    }
  };

  return {
    deleteConnector,
  };
}
