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

  const editorFields = useConnectorEditorFields({
    form,
  });

  const editorModalState = useConnectorEditorModalState({
    form,
    createConnectorBlockedReason,
    updateConnectorBlockedReason,
  });

  return {
    form,
    ...editorFields,
    ...editorModalState,
  };
}
