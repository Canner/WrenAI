import { Form, Input, Switch } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';

interface Props {
  mode?: FORM_MODE;
}

export default function TrinoProperties({ mode }: Props) {
  const isEditMode = mode === FORM_MODE.EDIT;
  return (
    <>
      <Form.Item
        label="Display name"
        name="displayName"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="Host"
        name="host"
        required
        rules={[
          {
            required: true,
            validator: hostValidator,
          },
        ]}
      >
        <Input placeholder="10.1.1.1" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Port"
        name="port"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.PORT.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Schemas"
        name="schemas"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.SCHEMAS.REQUIRED,
          },
        ]}
      >
        <Input placeholder="catalog.schema1, catalog.schema2" />
      </Form.Item>
      <Form.Item
        label="Username"
        name="username"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USERNAME.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="Password"
        name="password"
        required
        rules={[
          {
            required: false,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder="Input password" />
      </Form.Item>
      <Form.Item
        label="OAuth2 Client ID"
        name="clientId"
        rules={[
          {
            required: false,
            message: ERROR_TEXTS.CONNECTION.CLIENT_ID.REQUIRED,
          },
        ]}
      >
        <Input placeholder="OAuth2 Client ID" />
      </Form.Item>
      <Form.Item
        label="OAuth2 Client Secret"
        name="clientSecret"
        rules={[
          {
            required: false,
            message: ERROR_TEXTS.CONNECTION.CLIENT_SECRET.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder="OAuth2 Client Secret" />
      </Form.Item>
      <Form.Item
        label="OAuth2 Token URL"
        name="tokenUrl"
        rules={[
          {
            required: false,
            message: ERROR_TEXTS.CONNECTION.TOKEN_URL.REQUIRED,
          },
        ]}
      >
        <Input placeholder="OAuth2 Token URL" />
      </Form.Item>
      <Form.Item label="Use SSL" name="ssl" valuePropName="checked">
        <Switch />
      </Form.Item>
    </>
  );
}
