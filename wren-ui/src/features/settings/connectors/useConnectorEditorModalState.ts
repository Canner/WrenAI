import { useState } from 'react';
import { message } from 'antd';
import {
  getDatabaseConnectorFormValues,
  stringifyJson,
  type ConnectorFormValues,
  type ConnectorView,
} from './connectorsPageUtils';

type ConnectorFormInstance = {
  resetFields: () => void;
  setFieldsValue: (values: Partial<ConnectorFormValues>) => void;
};

export default function useConnectorEditorModalState({
  form,
  createConnectorBlockedReason,
  updateConnectorBlockedReason,
}: {
  form: ConnectorFormInstance;
  createConnectorBlockedReason?: string | null;
  updateConnectorBlockedReason?: string | null;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConnector, setEditingConnector] =
    useState<ConnectorView | null>(null);
  const [clearSecretChecked, setClearSecretChecked] = useState(false);

  const openCreateModal = () => {
    if (createConnectorBlockedReason) {
      message.info(createConnectorBlockedReason);
      return;
    }
    setEditingConnector(null);
    setClearSecretChecked(false);
    form.resetFields();
    form.setFieldsValue({ type: 'rest_json' });
    setModalOpen(true);
  };

  const openEditModal = (connector: ConnectorView) => {
    if (updateConnectorBlockedReason) {
      message.info(updateConnectorBlockedReason);
      return;
    }
    setEditingConnector(connector);
    setClearSecretChecked(false);
    form.setFieldsValue({
      type: connector.type,
      databaseProvider: connector.databaseProvider || 'postgres',
      displayName: connector.displayName,
      configText:
        connector.type === 'database' ? '' : stringifyJson(connector.config),
      secretText: '',
      ...(connector.type === 'database'
        ? getDatabaseConnectorFormValues(connector)
        : {}),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingConnector(null);
    setClearSecretChecked(false);
    form.resetFields();
  };

  return {
    modalOpen,
    editingConnector,
    clearSecretChecked,
    openCreateModal,
    openEditModal,
    closeModal,
    setClearSecretChecked,
  };
}
