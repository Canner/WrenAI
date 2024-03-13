import { useMemo } from 'react';
import { Form, FormInstance, Button, Space } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import Editor from '@/components/editor';
import PreviewDataContent from '@/components/PreviewDataContent';
import useAutoCompleteSource from '@/hooks/useAutoCompleteSource';

export interface ButtonProps {
  form: FormInstance;
  onPreview: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  onBack: () => void;
}

export default function ViewDetailForm(props: {
  form: FormInstance;
  formMode: FORM_MODE;
}) {
  const { form } = props;

  const autoCompleteSource = useAutoCompleteSource();

  // TODO: add async API for preview result.
  const previewResult = { columns: [], data: [] };

  const previewColumns = useMemo(() => {
    return previewResult.columns || [];
  }, [previewResult]);

  const previewData = useMemo(() => {
    return previewResult.data || [];
  }, [previewResult]);

  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="statement"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.MODELING_CREATE_VIEW.SQL.REQUIRED,
          },
        ]}
      >
        <Editor autoCompleteSource={autoCompleteSource} />
      </Form.Item>

      <Form.Item label="Data preview (50 rows)">
        <PreviewDataContent columns={previewColumns} data={previewData} />
      </Form.Item>
    </Form>
  );
}

export const ButtonGroup = (props: ButtonProps) => {
  const { form, onPreview, onCancel, onBack, onSubmit } = props;
  const statement = Form.useWatch('statement', form) || '';
  return (
    <div className="d-flex justify-space-between">
      <Button onClick={onPreview} disabled={!statement.length}>
        Preview data
      </Button>
      <Space className="d-flex justify-end">
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onSubmit}>
          Submit
        </Button>
      </Space>
    </div>
  );
};
