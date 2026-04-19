import { CONNECTOR_TYPE_OPTIONS } from './connectorsPageUtils';

type BuildManageConnectorsControlStateArgs = {
  createConnectorBlockedReason?: string | null;
  editingConnector?: unknown;
  submitting: boolean;
  updateConnectorBlockedReason?: string | null;
  watchedConnectorType?: string;
};

export function buildManageConnectorsControlState({
  createConnectorBlockedReason,
  editingConnector,
  submitting,
  updateConnectorBlockedReason,
  watchedConnectorType,
}: BuildManageConnectorsControlStateArgs) {
  return {
    connectorTypeOptions: CONNECTOR_TYPE_OPTIONS,
    modalTestDisabled:
      Boolean(updateConnectorBlockedReason) ||
      submitting ||
      watchedConnectorType !== 'database',
    modalSubmitDisabled: Boolean(
      editingConnector
        ? updateConnectorBlockedReason
        : createConnectorBlockedReason,
    ),
  };
}

export default buildManageConnectorsControlState;
