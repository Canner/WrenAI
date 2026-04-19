import { useState } from 'react';
import { message } from 'antd';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import {
  buildConnectorsCollectionUrl,
  buildConnectorItemUrl,
  buildConnectorSubmitPayload,
} from './connectorsPageUtils';
import type { ConnectorMutationOperationArgs } from './connectorMutationOperationTypes';

export default function useConnectorSubmitOperation({
  form,
  editingConnector,
  clearSecretChecked,
  createConnectorBlockedReason,
  updateConnectorBlockedReason,
  requireWorkspaceSelector,
  loadConnectors,
  closeModal,
}: Pick<
  ConnectorMutationOperationArgs,
  | 'form'
  | 'editingConnector'
  | 'clearSecretChecked'
  | 'createConnectorBlockedReason'
  | 'updateConnectorBlockedReason'
  | 'requireWorkspaceSelector'
  | 'loadConnectors'
  | 'closeModal'
>) {
  const [submitting, setSubmitting] = useState(false);

  const submitConnector = async () => {
    const submitBlockedReason = editingConnector
      ? updateConnectorBlockedReason
      : createConnectorBlockedReason;
    if (submitBlockedReason) {
      message.info(submitBlockedReason);
      return;
    }

    try {
      const values = await form.validateFields();
      const payload = buildConnectorSubmitPayload({
        values: {
          ...values,
          clearSecret: clearSecretChecked,
        },
        editing: Boolean(editingConnector),
        preserveExistingSecret:
          Boolean(editingConnector?.hasSecret) && !clearSecretChecked,
      });

      setSubmitting(true);
      const workspaceSelector = requireWorkspaceSelector();
      const response = await fetch(
        editingConnector
          ? buildConnectorItemUrl(editingConnector.id, workspaceSelector)
          : buildConnectorsCollectionUrl(workspaceSelector),
        {
          method: editingConnector ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || '保存连接器失败。');
      }

      message.success(editingConnector ? '连接器已更新。' : '连接器已创建。');
      closeModal();
      await loadConnectors();
    } catch (error: any) {
      if (error?.errorFields) {
        return;
      }
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '保存连接器失败。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    submitting,
    submitConnector,
  };
}
