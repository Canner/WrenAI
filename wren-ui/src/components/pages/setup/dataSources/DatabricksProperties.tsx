import { useEffect } from 'react';
import { Form, Input, Radio } from 'antd';
import { FORM_MODE, DATABRICKS_AUTH_METHOD } from '@/utils/enum';
import { ERROR_TEXTS } from '@/utils/error';
import { hostValidator } from '@/utils/validator';

interface Props {
  mode?: FORM_MODE;
}

export default function DatabricksProperties(props: Props) {
  const { mode } = props;
  const isEditMode = mode === FORM_MODE.EDIT;

  const form = Form.useFormInstance();
  const databricksType = Form.useWatch(
    'databricksType',
    form,
  ) as DATABRICKS_AUTH_METHOD;

  useEffect(() => {
    if (!isEditMode) {
      form.setFieldsValue({
        databricksType: DATABRICKS_AUTH_METHOD.token,
      });
    }
  }, [isEditMode, form]);

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
      <Form.Item label="Authentication method" name="databricksType">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value={DATABRICKS_AUTH_METHOD.token}>
            Personal Access Token (PAT)
          </Radio.Button>
          <Radio.Button value={DATABRICKS_AUTH_METHOD.service_principal}>
            Service Principal
          </Radio.Button>
        </Radio.Group>
      </Form.Item>
      <Form.Item
        label="Server hostname"
        name="serverHostname"
        required
        rules={[
          {
            required: true,
            validator: hostValidator,
          },
        ]}
      >
        <Input
          placeholder="e.g. adb-123456789.12.azuredatabricks.net"
          disabled={isEditMode}
        />
      </Form.Item>
      <Form.Item
        label="HTTP path"
        name="httpPath"
        required
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.HTTP_PATH.REQUIRED,
          },
        ]}
      >
        <Input
          placeholder="e.g. /sql/1.0/endpoints/abc123"
          disabled={isEditMode}
        />
      </Form.Item>
      {databricksType === DATABRICKS_AUTH_METHOD.token && (
        <Form.Item
          label="Access token"
          name="accessToken"
          required
          rules={[
            {
              required: true,
              message: ERROR_TEXTS.CONNECTION.PERSONAL_ACCESS_TOKEN.REQUIRED,
            },
          ]}
        >
          <Input.Password placeholder="Enter your Databricks personal access token" />
        </Form.Item>
      )}
      {databricksType === DATABRICKS_AUTH_METHOD.service_principal && (
        <>
          <Form.Item
            label="Client ID"
            name="clientId"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_ID.REQUIRED,
              },
            ]}
          >
            <Input placeholder="Enter your service principal’s Client ID" />
          </Form.Item>
          <Form.Item
            label="Client secret"
            name="clientSecret"
            required
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.CONNECTION.CLIENT_SECRET.REQUIRED,
              },
            ]}
          >
            <Input.Password placeholder="Enter your service principal’s Client Secret" />
          </Form.Item>
          <Form.Item label="Azure tenant ID" name="azureTenantId">
            <Input placeholder="e.g. 72f988bf-86f1-41af-91ab-2d7cd011db47" />
          </Form.Item>
        </>
      )}
    </>
  );
}
