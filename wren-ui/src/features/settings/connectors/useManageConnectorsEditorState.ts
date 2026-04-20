import { Form } from 'antd';
import type { ConnectorFormValues } from './connectorsPageUtils';
import useConnectorEditorFields from './useConnectorEditorFields';
import useConnectorEditorModalState from './useConnectorEditorModalState';

export default function useManageConnectorsEditorState({
  createConnectorBlockedReason,
  updateConnectorBlockedReason,
}: {
  createConnectorBlockedReason: string | null;
  updateConnectorBlockedReason: string | null;
}) {
  const [form] = Form.useForm<ConnectorFormValues>();
  const editorModalState = useConnectorEditorModalState({
    form,
    createConnectorBlockedReason,
    updateConnectorBlockedReason,
  });
  const editorFields = useConnectorEditorFields({
    form,
    editingConnector: editorModalState.editingConnector,
  });

  return {
    form,
    ...editorFields,
    ...editorModalState,
  };
}
