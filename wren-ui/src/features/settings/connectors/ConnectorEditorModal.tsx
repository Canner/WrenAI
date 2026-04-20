import { Button, Modal } from 'antd';
import type { ConnectorView } from './connectorsPageUtils';
import ConnectorEditorForm from './ConnectorEditorForm';

type ConnectorEditorModalProps = {
  open: boolean;
  editingConnector?: ConnectorView | null;
  form: any;
  submitting: boolean;
  testingConnection: boolean;
  watchedConnectorType?: string;
  watchedDatabaseProvider?: string;
  watchedSnowflakeAuthMode?: 'password' | 'privateKey';
  watchedRedshiftAuthMode?: 'redshift' | 'redshift_iam';
  clearSecretChecked: boolean;
  databaseProviderExample?: { config: string; secret: string } | null;
  connectorTypeOptions: Array<{ label: string; value: string }>;
  testDisabled: boolean;
  submitDisabled: boolean;
  onCancel: () => void;
  onTest: () => void | Promise<void>;
  onSubmit: () => void | Promise<void>;
  onClearSecretCheckedChange: (checked: boolean) => void;
};

export default function ConnectorEditorModal({
  open,
  editingConnector,
  form,
  submitting,
  testingConnection,
  watchedConnectorType,
  watchedDatabaseProvider,
  watchedSnowflakeAuthMode,
  watchedRedshiftAuthMode,
  clearSecretChecked,
  databaseProviderExample,
  connectorTypeOptions,
  testDisabled,
  submitDisabled,
  onCancel,
  onTest,
  onSubmit,
  onClearSecretCheckedChange,
}: ConnectorEditorModalProps) {
  return (
    <Modal
      title={editingConnector ? '编辑连接器' : '添加连接器'}
      open={open}
      onCancel={onCancel}
      destroyOnClose
      footer={[
        <Button
          key="cancel"
          onClick={onCancel}
          disabled={submitting || testingConnection}
        >
          取消
        </Button>,
        <Button
          key="test"
          onClick={() => void onTest()}
          loading={testingConnection}
          disabled={testDisabled}
        >
          连接测试
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={() => void onSubmit()}
          loading={submitting}
          disabled={submitDisabled}
        >
          保存
        </Button>,
      ]}
    >
      <ConnectorEditorForm
        editingConnector={editingConnector}
        form={form}
        watchedConnectorType={watchedConnectorType}
        watchedDatabaseProvider={watchedDatabaseProvider}
        watchedSnowflakeAuthMode={watchedSnowflakeAuthMode}
        watchedRedshiftAuthMode={watchedRedshiftAuthMode}
        clearSecretChecked={clearSecretChecked}
        databaseProviderExample={databaseProviderExample}
        connectorTypeOptions={connectorTypeOptions}
        onClearSecretCheckedChange={onClearSecretCheckedChange}
      />
    </Modal>
  );
}
