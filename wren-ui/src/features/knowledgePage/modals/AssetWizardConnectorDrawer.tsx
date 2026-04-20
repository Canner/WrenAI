import { Button, Drawer, Form, Space, Typography } from 'antd';
import { useCallback, useState } from 'react';
import buildManageConnectorsControlState from '@/features/settings/connectors/buildManageConnectorsControlState';
import ConnectorEditorForm from '@/features/settings/connectors/ConnectorEditorForm';
import useConnectorEditorFields from '@/features/settings/connectors/useConnectorEditorFields';
import useConnectorSubmitOperation from '@/features/settings/connectors/useConnectorSubmitOperation';
import useConnectorTestingOperations from '@/features/settings/connectors/useConnectorTestingOperations';
import type { ConnectorFormValues } from '@/features/settings/connectors/connectorsPageUtils';

const { Paragraph } = Typography;

type AssetWizardConnectorDrawerProps = {
  open: boolean;
  workspaceId?: string | null;
  onClose: () => void;
  onConnectorCreated?: (connectorId: string) => Promise<void> | void;
  onRefreshConnectors?: () => Promise<unknown>;
};

export default function AssetWizardConnectorDrawer({
  open,
  workspaceId,
  onClose,
  onConnectorCreated,
  onRefreshConnectors,
}: AssetWizardConnectorDrawerProps) {
  const [form] = Form.useForm<ConnectorFormValues>();
  const [clearSecretChecked, setClearSecretChecked] = useState(false);
  const editorFields = useConnectorEditorFields({
    form,
    editingConnector: null,
  });

  const handleClose = useCallback(() => {
    setClearSecretChecked(false);
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const requireWorkspaceSelector = useCallback(
    () => ({
      workspaceId: workspaceId || undefined,
    }),
    [workspaceId],
  );

  const { submitting, submitConnector } = useConnectorSubmitOperation({
    form,
    editingConnector: null,
    clearSecretChecked,
    requireWorkspaceSelector,
    loadConnectors: async () => {
      await onRefreshConnectors?.();
      return [];
    },
    closeModal: handleClose,
    onSubmitted: async (connector) => {
      const connectorId =
        connector && typeof connector.id === 'string' ? connector.id : null;
      if (connectorId) {
        await onConnectorCreated?.(connectorId);
      }
    },
  });

  const { testingConnection, handleModalTestConnection } =
    useConnectorTestingOperations({
      form,
      editingConnector: null,
      clearSecretChecked,
      requireWorkspaceSelector,
    });

  const controlState = buildManageConnectorsControlState({
    createConnectorBlockedReason: !workspaceId
      ? '当前工作区上下文未就绪，请稍后重试。'
      : null,
    editingConnector: null,
    submitting,
    updateConnectorBlockedReason: null,
    watchedConnectorType: editorFields.watchedConnectorType,
  });

  return (
    <Drawer
      open={open}
      title="新建数据源"
      width={560}
      destroyOnHidden
      onClose={handleClose}
      footer={
        <Space className="d-flex justify-end">
          <Button
            onClick={handleClose}
            disabled={submitting || testingConnection}
          >
            取消
          </Button>
          <Button
            onClick={() => void handleModalTestConnection()}
            loading={testingConnection}
            disabled={controlState.modalTestDisabled || !workspaceId}
          >
            连接测试
          </Button>
          <Button
            type="primary"
            onClick={() => void submitConnector()}
            loading={submitting}
            disabled={controlState.modalSubmitDisabled || !workspaceId}
          >
            保存并选中
          </Button>
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        在向导内完成数据源创建、连接测试和保存。保存成功后会自动返回当前步骤并选中新数据源。
      </Paragraph>
      <ConnectorEditorForm
        form={form}
        clearSecretChecked={clearSecretChecked}
        watchedConnectorType={editorFields.watchedConnectorType}
        watchedDatabaseProvider={editorFields.watchedDatabaseProvider}
        watchedSnowflakeAuthMode={editorFields.watchedSnowflakeAuthMode}
        watchedRedshiftAuthMode={editorFields.watchedRedshiftAuthMode}
        databaseProviderExample={editorFields.databaseProviderExample}
        connectorTypeOptions={controlState.connectorTypeOptions}
        onClearSecretCheckedChange={setClearSecretChecked}
      />
    </Drawer>
  );
}
