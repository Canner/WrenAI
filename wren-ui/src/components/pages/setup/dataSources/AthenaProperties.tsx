import { useEffect, useRef } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';

export enum ATHENA_AUTH_METHOD {
  classic = 'classic',
  oidc = 'oidc',
}

interface Props {
  mode?: FORM_MODE;
}

function AthenaClassicFields() {
  return (
    <>
      <Form.Item
        label="AWS access key ID"
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
        label="AWS secret access key"
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
        label="Web identity token"
        name="webIdentityToken"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.WEB_IDENTITY_TOKEN.REQUIRED,
          },
        ]}
      >
        <Input.TextArea
          rows={3}
          placeholder="Paste Google OIDC token here"
        />
      </Form.Item>

      <Form.Item
        label="AWS role ARN"
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
        label="Role session name"
        name="roleSessionName"
        extra="Optional session name used in STS AssumeRoleWithWebIdentity"
      >
        <Input placeholder="Optional session name" />
      </Form.Item>
    </>
  );
}

export default function AthenaProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();

  const initialTypeRef = useRef<ATHENA_AUTH_METHOD | null>(null);

  const authType = Form.useWatch(
    'athenaAuthType',
    form,
  ) as ATHENA_AUTH_METHOD;

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

      {/* Common fields */}
      <Form.Item
        label="Database (schema)"
        name="schema"
        extra="The Athena database (schema) that contains your tables."
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
        label="S3 staging directory"
        name="s3StagingDir"
        required
        extra={
          <>
            The S3 path where Athena stores query results and metadata.
            <br />
            Find this in Athena console under{' '}
            <b>Settings → Query result location</b>.
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
        label="AWS region"
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
      <Form.Item label="Authentication method" name="athenaAuthType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={ATHENA_AUTH_METHOD.classic}>
            AWS credentials
          </Radio.Button>
          <Radio.Button value={ATHENA_AUTH_METHOD.oidc}>
            OIDC (web identity)
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      {/* Conditional auth fields */}
      {authType === ATHENA_AUTH_METHOD.classic && <AthenaClassicFields />}

      {authType === ATHENA_AUTH_METHOD.oidc && (
        <AthenaOIDCFields
          isEditMode={getIsEditModeForComponent(
            ATHENA_AUTH_METHOD.oidc,
          )}
        />
      )}
    </>
  );
}
