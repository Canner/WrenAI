import { useState } from 'react';
import { message } from 'antd';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  buildConnectorTestPayload,
  buildConnectorTestUrl,
  type ConnectorFormValues,
  type ConnectorTestPayload,
  type ConnectorTestResponse,
  type ConnectorView,
} from './connectorsPageUtils';

type ConnectorFormReadInstance = {
  getFieldsValue: () => ConnectorFormValues;
};

export default function useConnectorTestingOperations({
  form,
  editingConnector,
  clearSecretChecked,
  updateConnectorBlockedReason,
  requireWorkspaceSelector,
}: {
  form: ConnectorFormReadInstance;
  editingConnector: ConnectorView | null;
  clearSecretChecked: boolean;
  updateConnectorBlockedReason?: string | null;
  requireWorkspaceSelector: () => { workspaceId?: string };
}) {
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(
    null,
  );

  const executeConnectorTest = async (
    payload: ConnectorTestPayload,
  ): Promise<ConnectorTestResponse> => {
    const response = await fetch(
      buildConnectorTestUrl(requireWorkspaceSelector()),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || '连接测试失败。');
    }

    return (await response.json()) as ConnectorTestResponse;
  };

  const handleModalTestConnection = async () => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    try {
      const values = form.getFieldsValue();
      const payload = buildConnectorTestPayload({
        values: {
          ...values,
          clearSecret: clearSecretChecked,
        },
        editingConnectorId: editingConnector?.id ?? null,
        preserveExistingSecret:
          Boolean(editingConnector) && !clearSecretChecked,
      });

      if (payload.type !== 'database') {
        message.info('当前仅支持 database 连接器的连接测试。');
        return;
      }

      setTestingConnection(true);
      const result = await executeConnectorTest(payload);
      message.success(result.message || '连接测试成功。');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '连接测试失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestSavedConnector = async (connector: ConnectorView) => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    if (connector.type !== 'database') {
      message.info('当前仅支持 database 连接器的连接测试。');
      return;
    }

    try {
      setTestingConnectorId(connector.id);
      const result = await executeConnectorTest({
        connectorId: connector.id,
        type: connector.type,
        databaseProvider: connector.databaseProvider ?? null,
        config: connector.config ?? null,
      });
      message.success(result.message || '连接测试成功。');
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '连接测试失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setTestingConnectorId(null);
    }
  };

  return {
    testingConnection,
    testingConnectorId,
    handleModalTestConnection,
    handleTestSavedConnector,
  };
}
