import { useState } from 'react';
import { Form, Input, Select } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';
import { SupportedSSLMode } from '../utils';

interface Props {
  mode?: FORM_MODE;
}

export default function MySQLProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  const [sslMode, setSSLMode] = useState<string>(SupportedSSLMode.DISABLE);
  const onSSLModeChange = (value: string) => setSSLMode(value)
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
        <Input placeholder="3306" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Username"
        name="user"
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
            required: true,
            message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
          },
        ]}
      >
        <Input.Password placeholder="input password" />
      </Form.Item>
      <Form.Item
        label="Database name"
        name="database"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input placeholder="MySQL database name" disabled={isEditMode} />
      </Form.Item>
      <Form.Item label="SSL mode" name="sslMode">
        <Select
          defaultValue={SupportedSSLMode.DISABLE}
          style={{ width: 120 }}
          onChange={onSSLModeChange}
          disabled={isEditMode}
          options={[
            { value: SupportedSSLMode.DISABLE },
            { value: SupportedSSLMode.REQUIRE },
            { value: SupportedSSLMode.VERIFY_CA },
          ]}
        />
      </Form.Item>
      {
        sslMode === SupportedSSLMode.VERIFY_CA &&
        <Form.Item
          label="SSL CA File"
          name="ca"
        >
          <Input
            placeholder="Path to Certificate Authority file for SSL"
            disabled={isEditMode}
          />
        </Form.Item>
      }
    </>
  );
}
