import { Form, FormInstance, Space, Button } from 'antd';
import BasicInfoProperties from './BasicInfoProperties';
import CacheProperties from './CacheProperties';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';

export interface ButtonProps {
  onCancel: () => void;
  onNext: () => void;
}

export default function ModelBasicForm(props: {
  form: FormInstance;
  formMode: FORM_MODE;
}) {
  const { form } = props;
  return (
    <Form form={form} layout="vertical">
      <BasicInfoProperties
        form={form}
        label="Metric name"
        name="displayName"
        errorTexts={ERROR_TEXTS.MODELING_CREATE_METRIC}
      />
      <CacheProperties form={form} />
    </Form>
  );
}

export const ButtonGroup = (props: ButtonProps) => {
  const { onNext, onCancel } = props;
  return (
    <Space className="d-flex justify-end">
      <Button onClick={onCancel}>Cancel</Button>
      <Button type="primary" onClick={onNext}>
        Next
      </Button>
    </Space>
  );
};
