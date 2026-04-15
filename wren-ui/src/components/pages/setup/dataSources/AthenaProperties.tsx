import { useEffect, useRef } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, ATHENA_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';

interface Props {
  mode?: FORM_MODE;
}

function AthenaClassicFields() {
  return (
    <>
      <Form.Item
        label="AWS Access Key ID"
        name="awsAccessKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_ACCESS_KEY.REQUIRED,
          },
        ]}
      >
        <Input />
      </Form.Item>

      <Form.Item
        label="AWS Secret Access Key"
        name="awsSecretKey"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_SECRET_KEY.REQUIRED,
          },
        ]}
      >
        <Input.Password />
      </Form.Item>
    </>
  );
}

function AthenaOIDCFields(props: { isEditMode: boolean }) {
  const { isEditMode } = props;

  return (
    <>
      <Form.Item
        label="Web Identity Token"
        name="webIdentityToken"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.WEB_IDENTITY_TOKEN.REQUIRED,
          },
        ]}
      >
        <Input.Password
          placeholder="请输入 OAuth 2.0 Access Token 或 OpenID Connect ID Token"
          autoComplete="off"
        />
      </Form.Item>

      <Form.Item
        label="AWS Role ARN"
        name="roleArn"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_ROLE_ARN.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="arn:aws:iam::<account-id>:role/<role-name>"
          disabled={isEditMode}
        />
      </Form.Item>

      <Form.Item
        label="角色会话名称"
        name="roleSessionName"
        extra="可选项，用于 AWS STS AssumeRole 操作中的会话名称。"
      >
        <Input placeholder="请输入会话名称" />
      </Form.Item>
    </>
  );
}

export default function AthenaProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();

  const initialTypeRef = useRef<ATHENA_AUTH_METHOD | null>(null);

  const authType = Form.useWatch('athenaAuthType', form) as ATHENA_AUTH_METHOD;

  // Set default auth type when creating
  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        athenaAuthType: ATHENA_AUTH_METHOD.classic,
      });
    }
  }, [isEditMode, form]);

  // Preserve initial type on edit mode
  useEffect(() => {
    if (isEditMode && authType && initialTypeRef.current === null) {
      initialTypeRef.current = authType;
    }
  }, [isEditMode, authType]);

  const getIsEditModeForComponent = (component: ATHENA_AUTH_METHOD) => {
    if (!isEditMode) return false;
    const initial = initialTypeRef.current || authType;
    return initial === component;
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

      {/* Common fields */}
      <Form.Item
        label="数据库（Schema）"
        name="schema"
        extra="填写包含目标数据表的 Athena 数据库（Schema）。"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DATABASE.REQUIRED,
          },
        ]}
      >
        <Input disabled={isEditMode} />
      </Form.Item>

      <Form.Item
        label="S3 暂存目录"
        name="s3StagingDir"
        required
        extra={
          <>
            Athena 会将查询结果和元数据写入这里指定的 S3 路径。
            <br />
            可在 Athena 控制台的 <b>Settings → Query result location</b>{' '}
            中查看。
          </>
        }
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.S3_STAGING_DIR.REQUIRED,
          },
        ]}
      >
        <Input placeholder="s3://bucket/path" />
      </Form.Item>

      <Form.Item
        label="AWS 区域"
        name="awsRegion"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.AWS_REGION.REQUIRED,
          },
        ]}
      >
        <Input placeholder="us-east-1" disabled={isEditMode} />
      </Form.Item>

      {/* Authentication method switch */}
      <Form.Item label="认证方式" name="athenaAuthType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={ATHENA_AUTH_METHOD.classic}>
            AWS 凭证
          </Radio.Button>
          <Radio.Button value={ATHENA_AUTH_METHOD.oidc}>
            OIDC（Web Identity Token）
          </Radio.Button>
          <Radio.Button value={ATHENA_AUTH_METHOD.instance_profile}>
            实例配置（Instance Profile）
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      {/* Conditional auth fields */}
      {authType === ATHENA_AUTH_METHOD.classic && <AthenaClassicFields />}

      {authType === ATHENA_AUTH_METHOD.oidc && (
        <AthenaOIDCFields
          isEditMode={getIsEditModeForComponent(ATHENA_AUTH_METHOD.oidc)}
        />
      )}

      {authType === ATHENA_AUTH_METHOD.instance_profile && (
        <div className="gray-8" style={{ fontStyle: 'italic' }}>
          系统会自动检测当前计算环境（EC2、ECS、EKS）所绑定 Instance Profile
          角色中的 AWS 凭证。
        </div>
      )}
    </>
  );
}
