import { useEffect, useState } from 'react';
import { Form, Input, Select, Button, Upload } from 'antd';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { UploadFile } from 'antd/lib/upload/interface';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { hostValidator } from '@/utils/validator';
import { SSLMode } from '@/apollo/server/types';

interface Props {
  mode?: FORM_MODE;
}

const UploadSSL = (props) => {
  const { onChange, value } = props;

  const [fileList, setFileList] = useState<UploadFile[]>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

  const readFileContent = (file: any, callback: (value: string) => void) => {
    const reader = new FileReader();
    reader.onloadend = (_e) => {
      const result = reader.result;

      if (result) {
        const fileContent = String(result);
        callback(fileContent);
      }
    };

    reader.readAsText(file);
  };

  const onUploadChange = (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];
      readFileContent(file.originFileObj, (fileContent: string) => {
        onChange && onChange(fileContent);
      });
      setFileList([uploadFile]);
    }
  };

  const onRemove = () => {
    setFileList([]);
    onChange && onChange(undefined);
  };

  return (
    <Upload
      accept=".pem,.crt,.key"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>Click to upload SSL cert file</Button>
    </Upload>
  );
};

export default function MySQLProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  const [sslMode, setSSLMode] = useState<string>(SSLMode.DISABLED);
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
      <Form.Item label="SSL mode" name="sslMode" initialValue={SSLMode.DISABLED}>
        <Select
          style={{ width: 120 }}
          onChange={onSSLModeChange}
          disabled={isEditMode}
          options={[
            { value: SSLMode.DISABLED, label: 'Disabled' },
            { value: SSLMode.ENABLED, label: 'Enabled' },
            { value: SSLMode.VERIFY_CA, label: 'Verify CA' },
          ]}
        />
      </Form.Item>
      {
        sslMode === SSLMode.VERIFY_CA &&
        <Form.Item
          label="SSL CA file"
          name="sslCA"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CONNECTION.SSL_CERT.REQUIRED,
            },
          ]}
        >
          <UploadSSL />
        </Form.Item>
      }
    </>
  );
}
