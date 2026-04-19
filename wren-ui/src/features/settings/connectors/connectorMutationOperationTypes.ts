import type { ConnectorFormValues, ConnectorView } from './connectorsPageUtils';

export type ConnectorFormInstance = {
  validateFields: () => Promise<ConnectorFormValues>;
  getFieldsValue: () => ConnectorFormValues;
};

export type ConnectorMutationOperationArgs = {
  form: ConnectorFormInstance;
  editingConnector: ConnectorView | null;
  clearSecretChecked: boolean;
  createConnectorBlockedReason?: string | null;
  updateConnectorBlockedReason?: string | null;
  deleteConnectorBlockedReason?: string | null;
  requireWorkspaceSelector: () => { workspaceId?: string };
  loadConnectors: () => Promise<ConnectorView[]>;
  closeModal: () => void;
};
