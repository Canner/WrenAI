import useConnectorDeleteOperation from './useConnectorDeleteOperation';
import useConnectorSubmitOperation from './useConnectorSubmitOperation';
import useConnectorTestingOperations from './useConnectorTestingOperations';
import type { ConnectorMutationOperationArgs } from './connectorMutationOperationTypes';

export type {
  ConnectorFormInstance,
  ConnectorMutationOperationArgs,
} from './connectorMutationOperationTypes';

export default function useConnectorMutationOperations({
  form,
  editingConnector,
  clearSecretChecked,
  createConnectorBlockedReason,
  updateConnectorBlockedReason,
  deleteConnectorBlockedReason,
  requireWorkspaceSelector,
  loadConnectors,
  closeModal,
}: ConnectorMutationOperationArgs) {
  const { submitting, submitConnector } = useConnectorSubmitOperation({
    form,
    editingConnector,
    clearSecretChecked,
    createConnectorBlockedReason,
    updateConnectorBlockedReason,
    requireWorkspaceSelector,
    loadConnectors,
    closeModal,
  });

  const { deleteConnector } = useConnectorDeleteOperation({
    deleteConnectorBlockedReason,
    requireWorkspaceSelector,
    loadConnectors,
  });

  const {
    testingConnection,
    testingConnectorId,
    handleModalTestConnection,
    handleTestSavedConnector,
  } = useConnectorTestingOperations({
    form,
    editingConnector,
    clearSecretChecked,
    updateConnectorBlockedReason,
    requireWorkspaceSelector,
  });

  return {
    submitting,
    testingConnection,
    testingConnectorId,
    submitConnector,
    deleteConnector,
    handleModalTestConnection,
    handleTestSavedConnector,
  };
}
