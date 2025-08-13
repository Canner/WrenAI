import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Form, Input, Radio, Upload, UploadProps, message } from 'antd';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import { ERROR_TEXTS } from '@/utils/error';
import { FORM_MODE } from '@/utils/enum';
import { readFileContent, extractPrivateKeyString } from '@/utils/file';

const TAB_KEY = {
  PASSWORD_AUTHENTICATION: 'password_authentication',
  KEY_PAIR_AUTHENTICATION: 'key_pair_authentication',
};

interface Props {
  mode?: FORM_MODE;
}

const UploadPrivateKey = (props: {
  onChange?: (value: string) => void;
  value?: string;
}) => {
  const { onChange, value } = props;
  const [fileList, setFileList] = useState<UploadProps['fileList']>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

  const onUploadChange = async (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];

      try {
        const result = await readFileContent(file.originFileObj);
        const extractedPrivateKey = extractPrivateKeyString(result);
        onChange && onChange(extractedPrivateKey);
        setFileList([uploadFile]);
      } catch (error) {
        console.error('Failed to handle file', error);
        message.error(
          'Failed to handle file. Please upload a valid private key file.',
        );
      }
    }
  };

  const onRemove = () => {
    setFileList([]);
    onChange && onChange(undefined);
  };

  return (
    <Upload
      accept=".pem,.key,.p8"
      fileList={fileList}
      onChange={onUploadChange}
      onRemove={onRemove}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>Upload private key</Button>
    </Upload>
  );
};

export default function SnowflakeProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  const [tabKey, setTabKey] = useState(TAB_KEY.PASSWORD_AUTHENTICATION);

  const changeTabKey = (e) => {
    setTabKey(e.target.value);
  };

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
        label="Account"
        name="account"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.ACCOUNT.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="<snowflake_org_id>-<snowflake_user_id>"
          disabled={isEditMode}
        />
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
        <Input placeholder="Snowflake database name" disabled={isEditMode} />
      </Form.Item>
      <Form.Item
        label="Schema"
        name="schema"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.SCHEMA.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="Warehouse"
        name="warehouse"
        extra={
          <span className="gray-6">
            Specifies the virtual warehouse for query execution. If blank, the
            account's default warehouse is used (if configured).
          </span>
        }
      >
        <Input />
      </Form.Item>
      <Form.Item
        label="User"
        name="user"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.USER.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        label={
          <div>
            Authentication method
            <div className="gray-6">
              Username and password authentication will be{' '}
              <span className="gray-7">deprecated by November 2025</span>. We
              recommend switching to key pair authentication.{' '}
              <Link
                className="gray-7 underline"
                href="https://www.snowflake.com/en/blog/blocking-single-factor-password-authentification"
                target="_blank"
                rel="noreferrer noopener"
              >
                Learn more
              </Link>
            </div>
          </div>
        }
      >
        <Radio.Group value={tabKey} onChange={changeTabKey} buttonStyle="solid">
          <Radio.Button value={TAB_KEY.PASSWORD_AUTHENTICATION}>
            Password authentication
          </Radio.Button>
          <Radio.Button value={TAB_KEY.KEY_PAIR_AUTHENTICATION}>
            Key pair authentication
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      <div>
        {tabKey === TAB_KEY.PASSWORD_AUTHENTICATION && (
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
        )}
        {tabKey === TAB_KEY.KEY_PAIR_AUTHENTICATION && (
          <Form.Item
            label="Private key file"
            name="privateKey"
            required
            rules={[
              {
                required: !isEditMode,
                message: ERROR_TEXTS.CONNECTION.PRIVATE_KEY_FILE.REQUIRED,
              },
            ]}
            extra={
              <div className="gray-6">
                Upload your private key file for key pair authentication.
              </div>
            }
          >
            <UploadPrivateKey />
          </Form.Item>
        )}
      </div>
    </>
  );
}
