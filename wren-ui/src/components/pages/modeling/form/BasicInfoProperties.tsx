import { Form, Input, FormInstance } from 'antd';

export default function BasicInfoProperties(props: {
  form: FormInstance;
  label: string;
  name: string;
  errorTexts?: Record<string, any>;
}) {
  return (
    <>
      <Form.Item
        label={props.label}
        name={props.name}
        required
        rules={[
          {
            required: true,
            message: props.errorTexts?.NAME?.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="Description" name="description">
        <Input.TextArea showCount maxLength={1000} />
      </Form.Item>
    </>
  );
}
