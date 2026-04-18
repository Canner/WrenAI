import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Form, Input, Radio, Upload, UploadProps, message } from 'antd';
import type { RadioChangeEvent } from 'antd';
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
  onChange?: (value?: string) => void;
  value?: string;
}) => {
  const { onChange, value } = props;
  const [fileList, setFileList] = useState<UploadProps['fileList']>([]);

  useEffect(() => {
    if (!value) setFileList([]);
  }, [value]);

  const onUploadChange: NonNullable<UploadProps['onChange']> = async (info) => {
    const { file, fileList } = info;
    if (fileList.length) {
      const uploadFile = fileList[0];

      try {
        if (!file.originFileObj) {
          throw new Error('missing private key file');
        }

        const result = await readFileContent(file.originFileObj);
        const extractedPrivateKey = extractPrivateKeyString(result);
        onChange && onChange(extractedPrivateKey);
        setFileList([uploadFile]);
      } catch {
        message.error('文件处理失败，请上传有效的私钥文件。');
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
      <Button icon={<UploadOutlined />}>上传私钥文件</Button>
    </Upload>
  );
};

export default function SnowflakeProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;
  const [tabKey, setTabKey] = useState(TAB_KEY.PASSWORD_AUTHENTICATION);

  const changeTabKey = (e: RadioChangeEvent) => {
    setTabKey(e.target.value);
  };

  return (
    <>
      <Form.Item
        label="显示名称"
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
        label="账号标识（Account）"
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
        label="数据库名称"
        name="database"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="请输入 Snowflake 数据库名称"
          disabled={isEditMode}
        />
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
        label="用户"
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
            认证方式
            <div className="gray-6">
              用户名密码认证将在{' '}
              <span className="gray-7">2025 年 11 月后废弃</span>，
              建议尽快切换到密钥对认证。{' '}
              <Link
                className="gray-7 underline"
                href="https://www.snowflake.com/en/blog/blocking-single-factor-password-authentification"
                target="_blank"
                rel="noreferrer noopener"
              >
                了解更多
              </Link>
            </div>
          </div>
        }
      >
        <Radio.Group value={tabKey} onChange={changeTabKey} buttonStyle="solid">
          <Radio.Button value={TAB_KEY.PASSWORD_AUTHENTICATION}>
            密码认证
          </Radio.Button>
          <Radio.Button value={TAB_KEY.KEY_PAIR_AUTHENTICATION}>
            密钥对认证
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      <div>
        {tabKey === TAB_KEY.PASSWORD_AUTHENTICATION && (
          <Form.Item
            label="密码"
            name="password"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.PASSWORD.REQUIRED,
              },
            ]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
        )}
        {tabKey === TAB_KEY.KEY_PAIR_AUTHENTICATION && (
          <Form.Item
            label="私钥文件"
            name="privateKey"
            required
            rules={[
              {
                required: !isEditMode,
                message: ERROR_TEXTS.CONNECTION.PRIVATE_KEY_FILE.REQUIRED,
              },
            ]}
            extra={<div className="gray-6">上传用于密钥对认证的私钥文件。</div>}
          >
            <UploadPrivateKey />
          </Form.Item>
        )}
      </div>
    </>
  );
}
